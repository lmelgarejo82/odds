import inspect
from datetime import timedelta
from pathlib import Path

import pytest
from sqlite_test_support import CUTOFF

from ou25_analytics.extraction.exporter import export_sqlite_snapshot
from ou25_analytics.extraction.profiles import ExportProfile, prematch_mappings


def test_prematch_mapping_function_has_no_outcome_dependency() -> None:
    source = inspect.getsource(prematch_mappings)
    assert "outcome" not in source.lower()
    assert all(mapping.prematch_allowed for mapping in prematch_mappings())
    assert all(not mapping.evaluation_only for mapping in prematch_mappings())


def test_exporter_rejects_non_synthetic_sources_before_opening(tmp_path: Path) -> None:
    missing = (tmp_path / "never-open.sqlite").absolute()
    with pytest.raises(ValueError, match="SYNTHETIC_SOURCE_ONLY"):
        export_sqlite_snapshot(
            tmp_path / "snapshots",
            source_database_path=missing,
            allowed_source_root=tmp_path.absolute(),
            profile=ExportProfile.PREMATCH,
            snapshot_id="FORBIDDEN_REAL",
            created_at_utc=CUTOFF + timedelta(hours=1),
            cutoff_at_utc=CUTOFF,
            source_kind="REAL_SQLITE",
            source_reference="real:forbidden",
            source_git_commit="SOURCE",
            analytics_git_commit="WORKTREE",
            analytics_lock_sha256="a" * 64,
            synthetic=False,
        )
    assert not missing.exists()


def test_cli_exposes_no_arbitrary_database_argument() -> None:
    import ou25_analytics.cli as cli

    source = inspect.getsource(cli)
    assert 'add_argument("--database"' not in source
    assert "export-synthetic-sqlite" in source
