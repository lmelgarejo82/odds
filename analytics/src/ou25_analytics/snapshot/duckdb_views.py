"""Ephemeral DuckDB views over verified Parquet snapshots."""

from pathlib import Path
from types import TracebackType

import duckdb

from ou25_analytics.contracts.manifest import SnapshotManifest
from ou25_analytics.contracts.schemas import CONTRACTS
from ou25_analytics.snapshot.reader import verify_snapshot


class DuckDBSnapshotViews:
    """Own an in-memory DuckDB connection and register boundary-specific views."""

    def __init__(self, database: str = ":memory:") -> None:
        if database != ":memory:":
            raise ValueError("persistent DuckDB databases are prohibited in this foundation")
        self.connection = duckdb.connect(database=database)

    def __enter__(self) -> "DuckDBSnapshotViews":
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    def close(self) -> None:
        """Close the in-memory database."""

        self.connection.close()

    def register_snapshot(
        self, snapshot_path: Path, *, include_outcomes: bool = False
    ) -> SnapshotManifest:
        """Register verified pre-match views and optional evaluation outcomes."""

        manifest = verify_snapshot(snapshot_path)
        for table_name, contract in CONTRACTS.items():
            if not contract.decision_allowed:
                continue
            parquet_path = snapshot_path / manifest.parquet_files[table_name]
            escaped = str(parquet_path).replace("'", "''")
            self.connection.execute(
                f'CREATE OR REPLACE VIEW "prematch_{table_name}" AS '
                f"SELECT * FROM read_parquet('{escaped}')"
            )
        if include_outcomes:
            if "outcomes" not in manifest.tables:
                raise ValueError("prematch snapshots cannot register evaluation outcomes")
            parquet_path = snapshot_path / manifest.parquet_files["outcomes"]
            escaped = str(parquet_path).replace("'", "''")
            self.connection.execute(
                'CREATE OR REPLACE VIEW "evaluation_outcomes" AS '
                f"SELECT * FROM read_parquet('{escaped}')"
            )
        return manifest

    def view_names(self) -> set[str]:
        """Return currently registered view names."""

        rows = self.connection.execute(
            "SELECT table_name FROM information_schema.views WHERE table_schema = 'main'"
        ).fetchall()
        return {str(row[0]) for row in rows}
