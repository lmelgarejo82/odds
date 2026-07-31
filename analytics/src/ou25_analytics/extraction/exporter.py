"""SQLite-to-Parquet orchestration with explicit temporal and profile boundaries."""

import shutil
import sqlite3
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pandas as pd

from ou25_analytics.contracts.manifest import (
    ExclusionCounts,
    SnapshotManifest,
    SQLiteExtractionMetadata,
    require_utc,
)
from ou25_analytics.contracts.schemas import validate_snapshot_tables
from ou25_analytics.extraction.cutoff import datetime_to_epoch_micros, parse_utc_z
from ou25_analytics.extraction.mappings import TableMapping
from ou25_analytics.extraction.profiles import ExportProfile, mappings_for_profile
from ou25_analytics.extraction.schema_inspector import inspect_schema
from ou25_analytics.extraction.sqlite_source import (
    FrozenSQLiteSource,
    SQLiteSchemaIncompatible,
)
from ou25_analytics.snapshot.reader import read_snapshot
from ou25_analytics.snapshot.writer import write_snapshot


@dataclass(frozen=True)
class ExportResult:
    """Verified result and bounded diagnostics for one synthetic export."""

    snapshot_path: Path
    manifest: SnapshotManifest
    exclusion_counts: dict[str, ExclusionCounts]
    executed_sql: tuple[str, ...]


def _materialize(mapping: TableMapping, rows: list[sqlite3.Row]) -> pd.DataFrame:
    records = [dict(zip(row.keys(), row, strict=True)) for row in rows]
    frame = pd.DataFrame.from_records(records, columns=mapping.output_columns)
    for column, kind in zip(mapping.output_columns, mapping.output_types, strict=True):
        if kind == "timestamp":
            parsed = [
                parse_utc_z(str(value), field_name=f"{mapping.source_table}.{column}")
                for value in frame[column]
            ]
            frame[column] = pd.to_datetime(parsed, utc=True)
        elif kind == "float":
            frame[column] = pd.to_numeric(frame[column], errors="raise").astype("float64")
        elif kind == "integer":
            frame[column] = pd.to_numeric(frame[column], errors="raise").astype("int64")
        elif kind == "boolean":
            numeric = pd.to_numeric(frame[column], errors="raise")
            if not numeric.isin([0, 1]).all():
                raise SQLiteSchemaIncompatible(
                    f"SQLITE_SCHEMA_INCOMPATIBLE: {mapping.source_table}.{column} is not boolean"
                )
            frame[column] = numeric.astype("bool")
        elif kind == "string":
            frame[column] = frame[column].map(lambda value: None if pd.isna(value) else str(value))
    return frame


def _extract_mapping(
    source: FrozenSQLiteSource, mapping: TableMapping, *, cutoff_micros: int
) -> tuple[pd.DataFrame, ExclusionCounts]:
    parameters = (cutoff_micros,) * mapping.cutoff_parameter_count
    rows = source._fetch_trusted(mapping.select_sql, parameters)  # noqa: SLF001
    frame = _materialize(mapping, rows)
    source_total = source._scalar_int(mapping.total_count_sql)  # noqa: SLF001
    eligible = source._scalar_int(mapping.eligible_count_sql, parameters)  # noqa: SLF001
    exported = len(frame)
    if source_total < eligible or eligible != exported:
        raise SQLiteSchemaIncompatible(
            f"SQLITE_SCHEMA_INCOMPATIBLE: row accounting mismatch for {mapping.output_table}"
        )
    is_fixture = mapping.output_table == "fixtures"
    excluded_after_cutoff = 0 if is_fixture else source_total - eligible
    excluded_unreferenced = source_total - eligible if is_fixture else 0
    counts = ExclusionCounts(
        source_total_rows=source_total,
        eligible_rows_at_cutoff=eligible,
        exported_rows=exported,
        excluded_after_cutoff=excluded_after_cutoff,
        excluded_invalid=0,
        excluded_unreferenced=excluded_unreferenced,
        excluded_other=0,
    )
    return frame, counts


def export_sqlite_snapshot(
    output_root: Path,
    *,
    source_database_path: Path,
    allowed_source_root: Path,
    profile: ExportProfile,
    snapshot_id: str,
    created_at_utc: datetime,
    cutoff_at_utc: datetime,
    source_kind: str,
    source_reference: str,
    source_git_commit: str,
    analytics_git_commit: str,
    analytics_lock_sha256: str,
    synthetic: bool,
) -> ExportResult:
    """Extract one frozen synthetic SQLite source and publish a verified snapshot."""

    require_utc(created_at_utc, "created_at_utc")
    require_utc(cutoff_at_utc, "cutoff_at_utc")
    if created_at_utc < cutoff_at_utc:
        raise ValueError("created_at_utc must be at or after cutoff_at_utc")
    if (
        not synthetic
        or source_kind != "SYNTHETIC_SQLITE"
        or not source_reference.startswith("synthetic:")
    ):
        raise ValueError("SYNTHETIC_SOURCE_ONLY: this exporter lot accepts synthetic sources only")

    cutoff_micros = datetime_to_epoch_micros(cutoff_at_utc, field_name="cutoff_at_utc")
    source = FrozenSQLiteSource(source_database_path, allowed_source_root=allowed_source_root)
    published: Path | None = None
    exclusion_counts: dict[str, ExclusionCounts] = {}
    try:
        with source:
            schema = inspect_schema(source, profile=profile)
            tables: dict[str, pd.DataFrame] = {}
            for mapping in mappings_for_profile(profile):
                frame, counts = _extract_mapping(source, mapping, cutoff_micros=cutoff_micros)
                tables[mapping.output_table] = frame
                exclusion_counts[mapping.output_table] = counts
            validate_snapshot_tables(tables)
            metadata = SQLiteExtractionMetadata(
                source_database_byte_size=source.before.byte_size,
                source_database_mtime_ns=source.before.mtime_ns,
                sqlite_user_version=schema.user_version,
                sqlite_schema_version=schema.schema_version,
                sqlite_schema_fingerprint=schema.fingerprint,
                export_profile=profile.value,
                source_hash_verified_after_export=True,
                excluded_rows_by_table=exclusion_counts,
                exclusion_reasons_by_table={
                    table_name: {
                        "after_cutoff": counts.excluded_after_cutoff,
                        "invalid": counts.excluded_invalid,
                        "unreferenced": counts.excluded_unreferenced,
                        "other": counts.excluded_other,
                    }
                    for table_name, counts in exclusion_counts.items()
                },
            )
            published = write_snapshot(
                output_root,
                tables,
                snapshot_id=snapshot_id,
                created_at_utc=created_at_utc,
                cutoff_at_utc=cutoff_at_utc,
                source_kind=source_kind,
                source_reference=source_reference,
                source_database_sha256=source.before.sha256,
                source_git_commit=source_git_commit,
                analytics_git_commit=analytics_git_commit,
                analytics_lock_sha256=analytics_lock_sha256,
                synthetic=True,
                excluded_rows={
                    table_name: counts.source_total_rows - counts.exported_rows
                    for table_name, counts in exclusion_counts.items()
                },
                sqlite_extraction=metadata,
                notes=[
                    "Synthetic frozen SQLite source only",
                    "Fixtures are included only when referenced by profile-visible eligible rows",
                ],
            )
            source.verify_unchanged()
    except BaseException:
        if published is not None and published.exists():
            shutil.rmtree(published)
        raise

    if published is None:
        raise AssertionError("snapshot publication did not complete")
    manifest, _ = read_snapshot(published)
    return ExportResult(
        snapshot_path=published,
        manifest=manifest,
        exclusion_counts=exclusion_counts,
        executed_sql=source.executed_sql,
    )
