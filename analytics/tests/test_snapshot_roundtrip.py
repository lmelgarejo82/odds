from collections.abc import Callable
from pathlib import Path

import pandas as pd
import pytest

from ou25_analytics.snapshot.reader import SnapshotIntegrityError, read_snapshot, verify_snapshot
from ou25_analytics.snapshot.writer import SnapshotValidationError
from ou25_analytics.synthetic.factory import make_invalid_copy


def test_pandas_parquet_roundtrip_and_manifest_hashes(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    snapshot = snapshot_writer(tmp_path, synthetic_tables, "ROUNDTRIP")
    manifest, loaded = read_snapshot(snapshot)
    assert manifest.snapshot_id == "ROUNDTRIP"
    assert manifest.synthetic
    assert manifest.row_counts == {name: len(frame) for name, frame in synthetic_tables.items()}
    assert set(loaded) == set(synthetic_tables)
    assert len(manifest.parquet_sha256) == 6
    assert all(len(value) == 64 for value in manifest.parquet_sha256.values())
    assert (
        loaded["fixtures"]["fixture_id"].tolist()
        == synthetic_tables["fixtures"]["fixture_id"].tolist()
    )


def test_reader_can_select_tables_but_verifies_whole_snapshot(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    snapshot = snapshot_writer(tmp_path, synthetic_tables, "SELECTIVE")
    _, loaded = read_snapshot(snapshot, {"fixtures", "odds_snapshots"})
    assert set(loaded) == {"fixtures", "odds_snapshots"}
    with pytest.raises(SnapshotIntegrityError, match="unknown tables"):
        read_snapshot(snapshot, {"not_a_table"})


def test_writer_rejects_overwrite(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    snapshot_writer(tmp_path, synthetic_tables, "IMMUTABLE")
    with pytest.raises(FileExistsError, match="already exists"):
        snapshot_writer(tmp_path, synthetic_tables, "IMMUTABLE")


def test_reader_detects_corruption_and_missing_files(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    corrupted = snapshot_writer(tmp_path, synthetic_tables, "CORRUPTED")
    with (corrupted / "fixtures.parquet").open("ab") as handle:
        handle.write(b"corruption")
    with pytest.raises(SnapshotIntegrityError, match="hash mismatch"):
        verify_snapshot(corrupted)

    missing = snapshot_writer(tmp_path, synthetic_tables, "MISSING")
    (missing / "outcomes.parquet").unlink()
    with pytest.raises(SnapshotIntegrityError, match="missing"):
        verify_snapshot(missing)


def test_failed_quality_cleans_staging(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    invalid = make_invalid_copy(synthetic_tables, "duplicate_fixture")
    with pytest.raises(SnapshotValidationError, match="quality checks failed"):
        snapshot_writer(tmp_path, invalid, "INVALID")
    assert not (tmp_path / "INVALID").exists()
    assert list(tmp_path.glob(".INVALID.staging-*")) == []
