from pathlib import Path

import pytest
from sqlite_test_support import export_fixture

from ou25_analytics.contracts.schemas import EVALUATION_TABLES, PREMATCH_TABLES
from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.snapshot.duckdb_views import DuckDBSnapshotViews


def test_prematch_has_five_tables_no_outcome_artifacts_or_queries(
    tmp_path: Path, synthetic_sqlite: Path
) -> None:
    result = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.PREMATCH, snapshot_id="PROFILE_PREMATCH"
    )
    assert set(result.manifest.tables) == set(PREMATCH_TABLES)
    assert "outcomes" not in result.manifest.row_counts
    assert "outcomes" not in result.manifest.date_ranges
    assert not (result.snapshot_path / "outcomes.parquet").exists()
    assert all('FROM "Outcome"' not in statement for statement in result.executed_sql)
    assert all('table_info("Outcome")' not in statement for statement in result.executed_sql)
    assert all('foreign_key_list("Outcome")' not in statement for statement in result.executed_sql)
    with DuckDBSnapshotViews() as views:
        views.register_snapshot(result.snapshot_path)
        assert all("outcome" not in name for name in views.view_names())
        with pytest.raises(ValueError, match="prematch snapshots"):
            views.register_snapshot(result.snapshot_path, include_outcomes=True)


def test_evaluation_adds_outcomes_through_explicit_boundary(
    tmp_path: Path, synthetic_sqlite: Path
) -> None:
    result = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.EVALUATION, snapshot_id="PROFILE_EVALUATION"
    )
    assert set(result.manifest.tables) == set(EVALUATION_TABLES)
    assert (result.snapshot_path / "outcomes.parquet").is_file()
    assert any('"Outcome"' in statement for statement in result.executed_sql)
    with DuckDBSnapshotViews() as views:
        views.register_snapshot(result.snapshot_path, include_outcomes=True)
        assert "evaluation_outcomes" in views.view_names()


def test_all_mappings_are_explicit_and_never_select_star() -> None:
    from ou25_analytics.extraction.profiles import evaluation_mappings, prematch_mappings

    for mapping in (*prematch_mappings(), *evaluation_mappings()):
        assert "SELECT *" not in mapping.select_sql.upper()
        assert mapping.source_columns
        assert mapping.output_columns
        assert len(mapping.output_columns) == len(mapping.output_types)
