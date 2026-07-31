import inspect
from collections.abc import Callable
from pathlib import Path

import pandas as pd
import pytest

from ou25_analytics.features.prematch import build_prematch_features
from ou25_analytics.snapshot.duckdb_views import DuckDBSnapshotViews


def test_feature_module_has_no_outcome_import_or_operational_database_access() -> None:
    source = inspect.getsource(inspect.getmodule(build_prematch_features))
    assert "outcome" not in source.lower()
    assert "sqlite" not in source.lower()
    assert "prisma" not in source.lower()
    assert "fetch(" not in source.lower()


def test_prematch_views_exclude_outcomes_and_evaluation_is_explicit(
    tmp_path: Path,
    synthetic_tables: dict[str, pd.DataFrame],
    snapshot_writer: Callable[[Path, dict[str, pd.DataFrame], str], Path],
) -> None:
    snapshot = snapshot_writer(tmp_path, synthetic_tables, "DUCKDB_BOUNDARY")
    with DuckDBSnapshotViews() as views:
        views.register_snapshot(snapshot)
        assert "prematch_fixtures" in views.view_names()
        assert all("outcome" not in name for name in views.view_names())
        views.register_snapshot(snapshot, include_outcomes=True)
        assert "evaluation_outcomes" in views.view_names()


def test_duckdb_rejects_persistent_database_paths(tmp_path: Path) -> None:
    with pytest.raises(ValueError, match="persistent DuckDB"):
        DuckDBSnapshotViews(str(tmp_path / "analytics.duckdb"))


def test_package_sources_do_not_read_operational_sqlite() -> None:
    package_root = Path(__file__).parents[1] / "src" / "ou25_analytics"
    source = "\n".join(path.read_text() for path in package_root.rglob("*.py"))
    assert "market-v2.sqlite" not in source
    assert "prisma/dev.db" not in source
    assert "sqlite3" not in source
