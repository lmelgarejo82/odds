import hashlib
import json
from pathlib import Path

import pandas as pd
import pytest
from sqlite_test_support import export_fixture

from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.extraction.sqlite_source import SQLiteSourceChanged
from ou25_analytics.extraction.synthetic_sqlite import create_synthetic_sqlite
from ou25_analytics.snapshot.reader import SnapshotIntegrityError, read_snapshot, verify_snapshot


def test_manifest_source_metadata_hashes_and_exclusion_accounting(
    tmp_path: Path, synthetic_sqlite: Path
) -> None:
    source_hash = hashlib.sha256(synthetic_sqlite.read_bytes()).hexdigest()
    result = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.EVALUATION, snapshot_id="INTEGRITY"
    )
    manifest = verify_snapshot(result.snapshot_path)
    assert manifest.source_database_sha256 == source_hash
    assert manifest.sqlite_extraction is not None
    assert manifest.sqlite_extraction.source_hash_verified_after_export
    assert manifest.sqlite_extraction.source_database_byte_size == synthetic_sqlite.stat().st_size
    assert len(manifest.sqlite_extraction.sqlite_schema_fingerprint) == 64
    for table_name, counts in manifest.sqlite_extraction.excluded_rows_by_table.items():
        assert counts.exported_rows == manifest.row_counts[table_name]
        assert (
            counts.exported_rows
            + sum(
                (
                    counts.excluded_after_cutoff,
                    counts.excluded_invalid,
                    counts.excluded_unreferenced,
                    counts.excluded_other,
                )
            )
            == counts.source_total_rows
        )


def test_exported_corruption_manifest_corruption_and_overwrite_are_rejected(
    tmp_path: Path, synthetic_sqlite: Path
) -> None:
    corrupted = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.PREMATCH, snapshot_id="CORRUPT_PARQUET"
    )
    with (corrupted.snapshot_path / "fixtures.parquet").open("ab") as handle:
        handle.write(b"synthetic corruption")
    with pytest.raises(SnapshotIntegrityError, match="hash mismatch"):
        verify_snapshot(corrupted.snapshot_path)

    other_root = tmp_path / "other"
    other_database = create_synthetic_sqlite(other_root / "source", seed=42)
    invalid_manifest = export_fixture(
        other_root, other_database, ExportProfile.PREMATCH, snapshot_id="CORRUPT_MANIFEST"
    )
    manifest_path = invalid_manifest.snapshot_path / "manifest.json"
    payload = json.loads(manifest_path.read_text())
    payload["sqlite_extraction"]["sqlite_schema_fingerprint"] = "invalid"
    manifest_path.write_text(json.dumps(payload))
    with pytest.raises(SnapshotIntegrityError, match="invalid manifest"):
        verify_snapshot(invalid_manifest.snapshot_path)

    clean_root = tmp_path / "overwrite"
    clean_database = create_synthetic_sqlite(clean_root / "source", seed=42)
    export_fixture(clean_root, clean_database, ExportProfile.PREMATCH, snapshot_id="IMMUTABLE")
    with pytest.raises(FileExistsError, match="already exists"):
        export_fixture(clean_root, clean_database, ExportProfile.PREMATCH, snapshot_id="IMMUTABLE")


def test_source_hash_change_fails_and_removes_published_snapshot(
    tmp_path: Path, synthetic_sqlite: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import ou25_analytics.extraction.sqlite_source as source_module

    real_hash = source_module._sha256_file  # noqa: SLF001
    calls = 0

    def changing_hash(path: Path) -> str:
        nonlocal calls
        calls += 1
        return real_hash(path) if calls == 1 else "0" * 64

    monkeypatch.setattr(source_module, "_sha256_file", changing_hash)
    with pytest.raises(SQLiteSourceChanged, match="SQLITE_SOURCE_CHANGED"):
        export_fixture(
            tmp_path, synthetic_sqlite, ExportProfile.PREMATCH, snapshot_id="SOURCE_CHANGED"
        )
    assert not (tmp_path / "snapshots" / "SOURCE_CHANGED").exists()
    assert list((tmp_path / "snapshots").glob(".SOURCE_CHANGED.staging-*")) == []


def test_semantic_parquet_content_is_deterministic(tmp_path: Path) -> None:
    first_db = create_synthetic_sqlite(tmp_path / "first-source", seed=99)
    second_db = create_synthetic_sqlite(tmp_path / "second-source", seed=99)
    first = export_fixture(
        tmp_path / "first-export", first_db, ExportProfile.EVALUATION, snapshot_id="DETERMINISTIC"
    )
    second = export_fixture(
        tmp_path / "second-export", second_db, ExportProfile.EVALUATION, snapshot_id="DETERMINISTIC"
    )
    first_manifest, first_tables = read_snapshot(first.snapshot_path)
    second_manifest, second_tables = read_snapshot(second.snapshot_path)
    assert first_manifest.row_counts == second_manifest.row_counts
    for table_name in first_tables:
        pd.testing.assert_frame_equal(first_tables[table_name], second_tables[table_name])
