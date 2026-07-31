"""Atomic writer for immutable Parquet analytical snapshots."""

import hashlib
import json
import shutil
import tempfile
from datetime import datetime
from pathlib import Path

import pandas as pd
import pyarrow.parquet as pq

from ou25_analytics.contracts.manifest import DateRange, SnapshotManifest
from ou25_analytics.contracts.schemas import CONTRACTS, validate_all_tables, validate_dataframe
from ou25_analytics.quality.checks import run_quality_checks


class SnapshotValidationError(ValueError):
    """Raised before an invalid snapshot can be published."""


def sha256_file(path: Path) -> str:
    """Return a streaming SHA-256 digest."""

    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _canonical_json_bytes(payload: object) -> bytes:
    return (
        json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False) + "\n"
    ).encode()


def _table_date_range(table_name: str, frame: pd.DataFrame) -> DateRange:
    timestamp_columns = [
        field.name
        for field in CONTRACTS[table_name].schema
        if str(field.type).startswith("timestamp")
    ]
    if not timestamp_columns or frame.empty:
        return DateRange(minimum_at_utc=None, maximum_at_utc=None)
    values = frame[timestamp_columns[0]]
    return DateRange(
        minimum_at_utc=values.min().to_pydatetime(), maximum_at_utc=values.max().to_pydatetime()
    )


def write_snapshot(
    output_root: Path,
    tables: dict[str, pd.DataFrame],
    *,
    snapshot_id: str,
    created_at_utc: datetime,
    cutoff_at_utc: datetime,
    source_kind: str,
    source_reference: str,
    source_database_sha256: str | None,
    source_git_commit: str,
    analytics_git_commit: str,
    analytics_lock_sha256: str,
    synthetic: bool,
    schema_version: str = "1",
    excluded_rows: dict[str, int] | None = None,
    notes: list[str] | None = None,
) -> Path:
    """Validate, stage and atomically publish one immutable snapshot."""

    output_root.mkdir(parents=True, exist_ok=True)
    destination = output_root / snapshot_id
    if destination.exists():
        raise FileExistsError(f"snapshot already exists: {snapshot_id}")

    staging = Path(tempfile.mkdtemp(prefix=f".{snapshot_id}.staging-", dir=output_root))
    try:
        validate_all_tables(tables)
        quality = run_quality_checks(
            tables,
            snapshot_id=snapshot_id,
            cutoff_at_utc=cutoff_at_utc,
        )
        if quality.has_errors:
            failed = [check.check_id for check in quality.checks if not check.passed]
            raise SnapshotValidationError(f"quality checks failed: {failed}")

        parquet_files: dict[str, str] = {}
        parquet_hashes: dict[str, str] = {}
        row_counts: dict[str, int] = {}
        date_ranges: dict[str, DateRange] = {}
        for table_name in sorted(CONTRACTS):
            contract = CONTRACTS[table_name]
            ordered = tables[table_name].sort_values(
                list(contract.sort_columns), kind="mergesort", ignore_index=True
            )
            arrow_table = validate_dataframe(table_name, ordered)
            filename = f"{table_name}.parquet"
            parquet_path = staging / filename
            pq.write_table(
                arrow_table,
                parquet_path,
                compression="zstd",
                use_dictionary=True,
                write_statistics=True,
            )
            parquet_files[table_name] = filename
            parquet_hashes[table_name] = sha256_file(parquet_path)
            row_counts[table_name] = len(ordered)
            date_ranges[table_name] = _table_date_range(table_name, ordered)

        quality_path = staging / "quality-report.json"
        quality_path.write_bytes(_canonical_json_bytes(quality.model_dump(mode="json")))
        manifest = SnapshotManifest(
            snapshot_id=snapshot_id,
            schema_version=schema_version,
            created_at_utc=created_at_utc,
            cutoff_at_utc=cutoff_at_utc,
            source_kind=source_kind,
            source_reference=source_reference,
            source_database_sha256=source_database_sha256,
            source_git_commit=source_git_commit,
            analytics_git_commit=analytics_git_commit,
            analytics_lock_sha256=analytics_lock_sha256,
            synthetic=synthetic,
            tables=sorted(CONTRACTS),
            row_counts=row_counts,
            date_ranges=date_ranges,
            parquet_files=parquet_files,
            parquet_sha256=parquet_hashes,
            quality_report_sha256=sha256_file(quality_path),
            excluded_rows=excluded_rows or {name: 0 for name in CONTRACTS},
            notes=notes or [],
        )
        (staging / "manifest.json").write_bytes(
            _canonical_json_bytes(manifest.model_dump(mode="json"))
        )
        staging.replace(destination)
        return destination
    except BaseException:
        shutil.rmtree(staging, ignore_errors=True)
        raise
