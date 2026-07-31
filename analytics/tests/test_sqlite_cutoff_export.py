from datetime import UTC, datetime
from pathlib import Path

import pytest
from sqlite_test_support import CUTOFF, export_fixture

from ou25_analytics.extraction.cutoff import CutoffError, parse_cutoff_z
from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.snapshot.reader import read_snapshot


def test_cutoff_includes_exact_rows_future_fixture_and_excludes_microsecond_after(
    tmp_path: Path, synthetic_sqlite: Path
) -> None:
    result = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.PREMATCH, snapshot_id="CUTOFF_PREMATCH"
    )
    _, tables = read_snapshot(result.snapshot_path)
    assert "SYNTH_SQL_FIXTURE_02" in set(tables["fixtures"]["fixture_id"])
    assert "SYNTH_SQL_FIXTURE_03" not in set(tables["fixtures"]["fixture_id"])
    exact = tables["forebet_snapshots"].loc[
        tables["forebet_snapshots"]["fixture_id"].eq("SYNTH_SQL_FIXTURE_02")
    ]
    assert exact["captured_at_utc"].iloc[0].to_pydatetime() == CUTOFF
    assert "SYNTH_SQL_DECISION_02" in set(tables["prematch_decisions"]["decision_id"])
    assert "SYNTH_SQL_DECISION_03" not in set(tables["prematch_decisions"]["decision_id"])
    assert set(tables["odds_snapshots"]["market_status"]) == {"ACTIVE", "SUSPENDED"}


def test_evaluation_outcome_cutoff_is_inclusive(tmp_path: Path, synthetic_sqlite: Path) -> None:
    result = export_fixture(
        tmp_path, synthetic_sqlite, ExportProfile.EVALUATION, snapshot_id="CUTOFF_EVALUATION"
    )
    _, tables = read_snapshot(result.snapshot_path)
    assert "SYNTH_SQL_OUTCOME_01_V1" in set(tables["outcomes"]["outcome_id"])
    assert "SYNTH_SQL_OUTCOME_02_V1" not in set(tables["outcomes"]["outcome_id"])
    assert result.exclusion_counts["outcomes"].excluded_after_cutoff == 1


@pytest.mark.parametrize(
    "value",
    [
        "2026-01-15T12:00:00",
        "2026-01-15T13:00:00+01:00",
        "not-a-timestamp",
    ],
)
def test_cutoff_rejects_naive_offset_and_invalid_text(value: str) -> None:
    with pytest.raises(CutoffError, match="ending in Z"):
        parse_cutoff_z(value)
    assert parse_cutoff_z("2026-01-15T12:00:00Z") == datetime(2026, 1, 15, 12, tzinfo=UTC)
