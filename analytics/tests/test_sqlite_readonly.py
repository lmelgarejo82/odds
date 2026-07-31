import sqlite3
from pathlib import Path

import pytest

from ou25_analytics.extraction.sqlite_source import (
    FrozenSQLiteSource,
    SQLiteOperationDenied,
    SQLiteSourceNotFrozen,
)


def test_mode_ro_and_query_only_independently_prevent_writes(synthetic_sqlite: Path) -> None:
    uri = f"file:{synthetic_sqlite.as_posix()}?mode=ro&immutable=1"
    read_only = sqlite3.connect(uri, uri=True, isolation_level=None)
    try:
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            read_only.execute('UPDATE "Fixture" SET "status" = "UNKNOWN"')
    finally:
        read_only.close()

    query_only = sqlite3.connect(synthetic_sqlite)
    try:
        query_only.execute("PRAGMA query_only=ON")
        assert query_only.execute("PRAGMA query_only").fetchone() == (1,)
        with pytest.raises(sqlite3.OperationalError, match="readonly"):
            query_only.execute('DELETE FROM "Fixture"')
    finally:
        query_only.close()


@pytest.mark.parametrize("operation", ["UPDATE", "DELETE", "CREATE", "ATTACH"])
def test_authorizer_rejects_fixed_write_probes(synthetic_sqlite: Path, operation: str) -> None:
    with (
        FrozenSQLiteSource(synthetic_sqlite, allowed_source_root=synthetic_sqlite.parent) as source,
        pytest.raises(SQLiteOperationDenied, match="SQLITE_OPERATION_DENIED"),
    ):
        source._probe_denied_operation(operation)  # type: ignore[arg-type]  # noqa: SLF001


def test_nonexistent_directory_symlink_and_outside_root_are_rejected(tmp_path: Path) -> None:
    missing = (tmp_path / "missing.sqlite").absolute()
    with pytest.raises(SQLiteSourceNotFrozen, match="does not exist"):
        FrozenSQLiteSource(missing, allowed_source_root=tmp_path.absolute())
    assert not missing.exists()

    directory = (tmp_path / "directory").absolute()
    directory.mkdir()
    with pytest.raises(SQLiteSourceNotFrozen, match="must be a file"):
        FrozenSQLiteSource(directory, allowed_source_root=tmp_path.absolute())

    target = tmp_path / "target.sqlite"
    sqlite3.connect(target).close()
    symlink = tmp_path / "source-link.sqlite"
    symlink.symlink_to(target)
    with pytest.raises(SQLiteSourceNotFrozen, match="symlinks"):
        FrozenSQLiteSource(symlink.absolute(), allowed_source_root=tmp_path.absolute())

    with pytest.raises(SQLiteSourceNotFrozen, match="outside"):
        FrozenSQLiteSource(target.absolute(), allowed_source_root=directory)


@pytest.mark.parametrize("suffix", ["-wal", "-shm", "-journal"])
def test_live_sidecars_are_rejected(synthetic_sqlite: Path, suffix: str) -> None:
    sidecar = Path(f"{synthetic_sqlite}{suffix}")
    sidecar.write_bytes(b"synthetic live marker")
    with pytest.raises(SQLiteSourceNotFrozen, match="SQLITE_SOURCE_NOT_FROZEN"):
        FrozenSQLiteSource(synthetic_sqlite, allowed_source_root=synthetic_sqlite.parent)


def test_hash_size_mtime_and_data_version_remain_stable(synthetic_sqlite: Path) -> None:
    stat_before = synthetic_sqlite.stat()
    with FrozenSQLiteSource(
        synthetic_sqlite, allowed_source_root=synthetic_sqlite.parent
    ) as source:
        observed = source.verify_unchanged()
        assert observed == source.before
        assert source.before.sha256 == source.after.sha256
    stat_after = synthetic_sqlite.stat()
    assert stat_after.st_size == stat_before.st_size
    assert stat_after.st_mtime_ns == stat_before.st_mtime_ns
