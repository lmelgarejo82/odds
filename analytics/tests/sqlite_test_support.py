"""Shared test-only orchestration for disposable synthetic SQLite exports."""

from datetime import UTC, datetime, timedelta
from pathlib import Path

from ou25_analytics.extraction.exporter import ExportResult, export_sqlite_snapshot
from ou25_analytics.extraction.profiles import ExportProfile

CUTOFF = datetime(2026, 1, 15, 12, tzinfo=UTC)


def export_fixture(
    tmp_path: Path,
    database: Path,
    profile: ExportProfile,
    *,
    snapshot_id: str,
) -> ExportResult:
    return export_sqlite_snapshot(
        tmp_path / "snapshots",
        source_database_path=database,
        allowed_source_root=database.parent,
        profile=profile,
        snapshot_id=snapshot_id,
        created_at_utc=CUTOFF + timedelta(hours=1),
        cutoff_at_utc=CUTOFF,
        source_kind="SYNTHETIC_SQLITE",
        source_reference="synthetic:seed:42",
        source_git_commit="SYNTHETIC_SOURCE",
        analytics_git_commit="TEST_WORKTREE",
        analytics_lock_sha256="a" * 64,
        synthetic=True,
    )
