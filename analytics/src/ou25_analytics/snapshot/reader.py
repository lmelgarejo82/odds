"""Read-only verification and loading of analytical snapshots."""

import json
from pathlib import Path

import pandas as pd
from pydantic import ValidationError

from ou25_analytics.contracts.manifest import SnapshotManifest
from ou25_analytics.contracts.schemas import SUPPORTED_TABLE_SETS, validate_dataframe
from ou25_analytics.snapshot.writer import sha256_file


class SnapshotIntegrityError(ValueError):
    """Raised when a published snapshot is missing or corrupted."""


def _safe_child(snapshot_path: Path, filename: str) -> Path:
    if Path(filename).name != filename:
        raise SnapshotIntegrityError(f"unsafe manifest filename: {filename}")
    return snapshot_path / filename


def verify_snapshot(snapshot_path: Path) -> SnapshotManifest:
    """Validate manifest structure, required files and every recorded hash."""

    manifest_path = snapshot_path / "manifest.json"
    if not manifest_path.is_file():
        raise SnapshotIntegrityError("manifest.json is missing")
    try:
        manifest = SnapshotManifest.model_validate(json.loads(manifest_path.read_text()))
    except (json.JSONDecodeError, ValidationError) as error:
        raise SnapshotIntegrityError(f"invalid manifest: {error}") from error

    if frozenset(manifest.tables) not in SUPPORTED_TABLE_SETS:
        raise SnapshotIntegrityError("manifest table set is not a supported snapshot profile")
    quality_path = snapshot_path / "quality-report.json"
    if not quality_path.is_file():
        raise SnapshotIntegrityError("quality-report.json is missing")
    if sha256_file(quality_path) != manifest.quality_report_sha256:
        raise SnapshotIntegrityError("quality report hash mismatch")

    for table_name in manifest.tables:
        parquet_path = _safe_child(snapshot_path, manifest.parquet_files[table_name])
        if not parquet_path.is_file():
            raise SnapshotIntegrityError(f"Parquet file is missing for {table_name}")
        if sha256_file(parquet_path) != manifest.parquet_sha256[table_name]:
            raise SnapshotIntegrityError(f"Parquet hash mismatch for {table_name}")
    return manifest


def read_snapshot(
    snapshot_path: Path, requested_tables: set[str] | None = None
) -> tuple[SnapshotManifest, dict[str, pd.DataFrame]]:
    """Verify the whole snapshot, then load and revalidate requested tables."""

    manifest = verify_snapshot(snapshot_path)
    selected = set(manifest.tables) if requested_tables is None else requested_tables
    unknown = selected.difference(manifest.tables)
    if unknown:
        raise SnapshotIntegrityError(f"requested unknown tables: {sorted(unknown)}")
    frames: dict[str, pd.DataFrame] = {}
    for table_name in sorted(selected):
        parquet_path = _safe_child(snapshot_path, manifest.parquet_files[table_name])
        frame = pd.read_parquet(parquet_path, engine="pyarrow", to_pandas_kwargs={})
        validate_dataframe(table_name, frame)
        if len(frame) != manifest.row_counts[table_name]:
            raise SnapshotIntegrityError(f"row count mismatch for {table_name}")
        frames[table_name] = frame
    return manifest, frames
