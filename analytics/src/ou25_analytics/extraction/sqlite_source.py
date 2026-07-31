"""Hardened, immutable and read-only SQLite source boundary."""

import hashlib
import os
import sqlite3
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from types import TracebackType
from typing import Literal
from urllib.parse import quote

from ou25_analytics.extraction.cutoff import source_timestamp_to_epoch_micros


class SQLiteExtractionError(RuntimeError):
    """Base error for the SQLite extraction boundary."""


class SQLiteSourceNotFrozen(SQLiteExtractionError):
    """Raised when a source has live SQLite sidecars or unsafe path state."""


class SQLiteOperationDenied(SQLiteExtractionError):
    """Raised when SQLite's authorizer rejects an operation."""


class SQLiteSchemaIncompatible(SQLiteExtractionError):
    """Raised when fixed mappings cannot be applied to the source schema."""


class SQLiteSourceChanged(SQLiteExtractionError):
    """Raised when a frozen source changes during extraction."""


@dataclass(frozen=True)
class SourceObservation:
    """Source identity measured without mutating the file."""

    sha256: str
    byte_size: int
    mtime_ns: int
    data_version: int


_PROHIBITED_EXACT_PATHS = frozenset(
    {
        Path("/home/yvaforma/odds/ou25-consensus-lab/prisma/dev.db"),
        Path("/home/yvaforma/odds/ou25-market-v2/prisma/dev.db"),
        Path("/home/yvaforma/odds/ou25-market-v2/var/market-v2/market-v2.sqlite"),
    }
)

_DENIED_ACTIONS = frozenset(
    value
    for value in (
        sqlite3.SQLITE_INSERT,
        sqlite3.SQLITE_UPDATE,
        sqlite3.SQLITE_DELETE,
        sqlite3.SQLITE_CREATE_INDEX,
        sqlite3.SQLITE_CREATE_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_INDEX,
        sqlite3.SQLITE_CREATE_TEMP_TABLE,
        sqlite3.SQLITE_CREATE_TEMP_TRIGGER,
        sqlite3.SQLITE_CREATE_TEMP_VIEW,
        sqlite3.SQLITE_CREATE_TRIGGER,
        sqlite3.SQLITE_CREATE_VIEW,
        sqlite3.SQLITE_DROP_INDEX,
        sqlite3.SQLITE_DROP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_INDEX,
        sqlite3.SQLITE_DROP_TEMP_TABLE,
        sqlite3.SQLITE_DROP_TEMP_TRIGGER,
        sqlite3.SQLITE_DROP_TEMP_VIEW,
        sqlite3.SQLITE_DROP_TRIGGER,
        sqlite3.SQLITE_DROP_VIEW,
        sqlite3.SQLITE_ALTER_TABLE,
        sqlite3.SQLITE_REINDEX,
        sqlite3.SQLITE_ATTACH,
        sqlite3.SQLITE_DETACH,
    )
)
_SAFE_PRAGMAS = frozenset(
    {
        "data_version",
        "foreign_key_list",
        "query_only",
        "schema_version",
        "table_info",
        "user_version",
    }
)
_ALLOWED_TRANSACTIONS = frozenset({"BEGIN", "ROLLBACK"})
_PROHIBITED_PROBES: dict[str, str] = {
    "UPDATE": 'UPDATE "Fixture" SET "status" = "status" WHERE 0',
    "DELETE": 'DELETE FROM "Fixture" WHERE 0',
    "CREATE": 'CREATE TABLE "__forbidden_probe" ("id" INTEGER)',
    "ATTACH": "ATTACH DATABASE ':memory:' AS forbidden_probe",
}


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class FrozenSQLiteSource:
    """Own one consistent read transaction over an explicitly allowed frozen file."""

    def __init__(self, database_path: Path, *, allowed_source_root: Path) -> None:
        self.path = self._validate_path(database_path, allowed_source_root)
        self.allowed_source_root = allowed_source_root
        self._connection: sqlite3.Connection | None = None
        self._before: SourceObservation | None = None
        self._after: SourceObservation | None = None
        self._last_denied: str | None = None
        self._executed_sql: list[str] = []

    @staticmethod
    def _validate_path(database_path: Path, allowed_source_root: Path) -> Path:
        normalized = Path(os.path.normpath(str(database_path)))
        normalized_root = Path(os.path.normpath(str(allowed_source_root)))
        if not database_path.is_absolute() or database_path != normalized:
            raise SQLiteSourceNotFrozen(
                "SQLITE_SOURCE_NOT_FROZEN: source path must be absolute and normalized"
            )
        if not allowed_source_root.is_absolute() or allowed_source_root != normalized_root:
            raise SQLiteSourceNotFrozen(
                "SQLITE_SOURCE_NOT_FROZEN: allowed root must be absolute and normalized"
            )
        if database_path in _PROHIBITED_EXACT_PATHS or database_path.is_relative_to(Path("/srv")):
            raise SQLiteSourceNotFrozen("SQLITE_SOURCE_NOT_FROZEN: prohibited source path")
        if database_path.is_symlink():
            raise SQLiteSourceNotFrozen("SQLITE_SOURCE_NOT_FROZEN: symlinks are prohibited")
        if not database_path.exists():
            raise SQLiteSourceNotFrozen("SQLITE_SOURCE_NOT_FROZEN: source does not exist")
        if not database_path.is_file():
            raise SQLiteSourceNotFrozen("SQLITE_SOURCE_NOT_FROZEN: source must be a file")
        if not allowed_source_root.exists() or not allowed_source_root.is_dir():
            raise SQLiteSourceNotFrozen("SQLITE_SOURCE_NOT_FROZEN: allowed root is invalid")
        resolved_root = allowed_source_root.resolve(strict=True)
        resolved_path = database_path.resolve(strict=True)
        if resolved_path != database_path or not resolved_path.is_relative_to(resolved_root):
            raise SQLiteSourceNotFrozen(
                "SQLITE_SOURCE_NOT_FROZEN: source is outside the allowed root or uses symlinks"
            )
        for suffix in ("-wal", "-shm", "-journal"):
            if Path(f"{database_path}{suffix}").exists():
                raise SQLiteSourceNotFrozen(
                    f"SQLITE_SOURCE_NOT_FROZEN: live sidecar present ({suffix})"
                )
        return database_path

    @property
    def before(self) -> SourceObservation:
        if self._before is None:
            raise SQLiteExtractionError("source is not open")
        return self._before

    @property
    def after(self) -> SourceObservation:
        if self._after is None:
            raise SQLiteExtractionError("source has not been verified after extraction")
        return self._after

    @property
    def executed_sql(self) -> tuple[str, ...]:
        return tuple(self._executed_sql)

    def __enter__(self) -> "FrozenSQLiteSource":
        stat = self.path.stat()
        initial_hash = _sha256_file(self.path)
        uri = f"file:{quote(self.path.as_posix(), safe='/')}?mode=ro&immutable=1"
        connection = sqlite3.connect(uri, uri=True, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.enable_load_extension(False)
        connection.create_function(
            "utc_epoch_micros", 1, source_timestamp_to_epoch_micros, deterministic=True
        )
        connection.execute("PRAGMA query_only=ON")
        query_only = connection.execute("PRAGMA query_only").fetchone()
        if query_only is None or int(query_only[0]) != 1:
            connection.close()
            raise SQLiteOperationDenied("SQLITE_OPERATION_DENIED: query_only was not enabled")
        self._connection = connection
        connection.set_trace_callback(self._executed_sql.append)
        connection.set_authorizer(self._authorize)
        self._execute_trusted("BEGIN")
        data_version = self._scalar_int("PRAGMA data_version")
        self._before = SourceObservation(
            sha256=initial_hash,
            byte_size=stat.st_size,
            mtime_ns=stat.st_mtime_ns,
            data_version=data_version,
        )
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        verification_error: SQLiteSourceChanged | None = None
        try:
            self.verify_unchanged()
        except SQLiteSourceChanged as error:
            verification_error = error
        finally:
            if self._connection is not None:
                try:
                    self._execute_trusted("ROLLBACK")
                finally:
                    self._connection.close()
                    self._connection = None
        if verification_error is not None:
            raise verification_error

    def _authorize(
        self,
        action: int,
        argument_one: str | None,
        argument_two: str | None,
        database_name: str | None,
        trigger_name: str | None,
    ) -> int:
        del database_name, trigger_name
        denied = False
        if action in _DENIED_ACTIONS:
            denied = True
        elif action == sqlite3.SQLITE_PRAGMA:
            denied = (argument_one or "").lower() not in _SAFE_PRAGMAS
        elif action == sqlite3.SQLITE_TRANSACTION:
            denied = (argument_one or "").upper() not in _ALLOWED_TRANSACTIONS
        elif action == sqlite3.SQLITE_FUNCTION:
            denied = (argument_two or argument_one or "").lower() == "load_extension"
        if denied:
            self._last_denied = f"action={action} arg1={argument_one} arg2={argument_two}"
            return sqlite3.SQLITE_DENY
        return sqlite3.SQLITE_OK

    def _require_connection(self) -> sqlite3.Connection:
        if self._connection is None:
            raise SQLiteExtractionError("source is not open")
        return self._connection

    def _execute_trusted(self, sql: str, parameters: Sequence[object] = ()) -> sqlite3.Cursor:
        try:
            return self._require_connection().execute(sql, tuple(parameters))
        except sqlite3.DatabaseError as error:
            if self._last_denied is not None:
                detail = self._last_denied
                self._last_denied = None
                raise SQLiteOperationDenied(
                    f"SQLITE_OPERATION_DENIED: authorizer rejected {detail}"
                ) from error
            if "user-defined function raised exception" in str(error):
                raise SQLiteSchemaIncompatible(
                    "SQLITE_SCHEMA_INCOMPATIBLE: invalid source UTC timestamp"
                ) from error
            raise

    def _fetch_trusted(self, sql: str, parameters: Sequence[object] = ()) -> list[sqlite3.Row]:
        return list(self._execute_trusted(sql, parameters).fetchall())

    def _scalar_int(self, sql: str, parameters: Sequence[object] = ()) -> int:
        row = self._execute_trusted(sql, parameters).fetchone()
        if row is None:
            raise SQLiteSchemaIncompatible(
                "SQLITE_SCHEMA_INCOMPATIBLE: scalar query returned no row"
            )
        return int(row[0])

    def _probe_denied_operation(
        self, operation: Literal["UPDATE", "DELETE", "CREATE", "ATTACH"]
    ) -> None:
        """Run one fixed negative security probe; never accepts arbitrary SQL."""

        self._execute_trusted(_PROHIBITED_PROBES[operation])

    def verify_unchanged(self) -> SourceObservation:
        """Re-observe hash/stat/data_version and reject any mutation."""

        stat = self.path.stat()
        observation = SourceObservation(
            sha256=_sha256_file(self.path),
            byte_size=stat.st_size,
            mtime_ns=stat.st_mtime_ns,
            data_version=self._scalar_int("PRAGMA data_version"),
        )
        self._after = observation
        if observation != self.before:
            raise SQLiteSourceChanged(
                "SQLITE_SOURCE_CHANGED: hash, size, mtime or data_version changed during export"
            )
        return observation
