from datetime import datetime

import pandas as pd
import pytest

from ou25_analytics.quality.checks import run_quality_checks
from ou25_analytics.quality.report import QualityReport
from ou25_analytics.synthetic.factory import make_invalid_copy


def _cutoff(tables: dict[str, pd.DataFrame]) -> datetime:
    return tables["outcomes"]["observed_at_utc"].max().to_pydatetime()


def _failed_ids(report: QualityReport) -> set[str]:
    return {check.check_id for check in report.checks if not check.passed}


def test_valid_synthetic_data_passes_and_reports_coverage(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    report = run_quality_checks(
        synthetic_tables, snapshot_id="VALID", cutoff_at_utc=_cutoff(synthetic_tables)
    )
    assert not report.has_errors
    assert report.coverage["fixtures"] == 12
    assert report.coverage["outcomes"] == 13


@pytest.mark.parametrize(
    ("violation", "expected_check"),
    [
        ("duplicate_fixture", "fixtures.primary_key_unique"),
        ("broken_fixture_reference", "forebet_snapshots.fixture_reference"),
        ("forebet_after_kickoff", "forebet_snapshots.before_kickoff"),
        ("odds_after_decision", "prematch_decisions.odds_available_at_decision"),
        ("selected_odds_other_fixture", "prematch_decisions.selected_odds_fixture"),
        ("probability_out_of_range", "forebet_snapshots.home_probability.range"),
        ("missing_hash", "outcomes.content_hash.present"),
        ("outcome_before_kickoff", "outcomes.after_kickoff"),
    ],
)
def test_controlled_invalidities_are_reported(
    synthetic_tables: dict[str, pd.DataFrame], violation: str, expected_check: str
) -> None:
    invalid = make_invalid_copy(synthetic_tables, violation)
    report = run_quality_checks(invalid, snapshot_id="INVALID", cutoff_at_utc=_cutoff(invalid))
    assert expected_check in _failed_ids(report)


def test_post_cutoff_and_inconsistent_correction_are_reported(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    tables = {name: frame.copy(deep=True) for name, frame in synthetic_tables.items()}
    tables["outcomes"].loc[12, "supersedes_outcome_id"] = "DOES_NOT_EXIST"
    cutoff = tables["outcomes"]["observed_at_utc"].min().to_pydatetime()
    report = run_quality_checks(tables, snapshot_id="CUTOFF", cutoff_at_utc=cutoff)
    failed = _failed_ids(report)
    assert "outcomes.cutoff" in failed
    assert "outcomes.corrections_consistent" in failed


def test_decision_market_and_price_rules_are_reported(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    tables = {name: frame.copy(deep=True) for name, frame in synthetic_tables.items()}
    selected_id = tables["prematch_decisions"].loc[0, "selected_odds_snapshot_id"]
    selected_mask = tables["odds_snapshots"]["odds_snapshot_id"].eq(selected_id)
    tables["odds_snapshots"].loc[selected_mask, "decimal_odds"] = 1.0
    tables["odds_snapshots"].loc[selected_mask, "is_in_play"] = True
    tables["odds_snapshots"].loc[selected_mask, "market_status"] = "SUSPENDED"
    report = run_quality_checks(tables, snapshot_id="ODDS", cutoff_at_utc=_cutoff(tables))
    assert {
        "odds_snapshots.decimal_odds",
        "prematch_decisions.no_in_play_odds",
        "prematch_decisions.active_market",
    }.issubset(_failed_ids(report))


def test_samples_are_bounded(synthetic_tables: dict[str, pd.DataFrame]) -> None:
    tables = {name: frame.copy(deep=True) for name, frame in synthetic_tables.items()}
    tables["forebet_snapshots"]["content_hash"] = ""
    report = run_quality_checks(
        tables, snapshot_id="BOUNDED", cutoff_at_utc=_cutoff(tables), sample_limit=2
    )
    failed = next(
        check for check in report.checks if check.check_id.endswith("content_hash.present")
    )
    assert failed.affected_rows == 12
    assert len(failed.sample_identifiers) == 2


def test_quality_options_are_validated(synthetic_tables: dict[str, pd.DataFrame]) -> None:
    cutoff = _cutoff(synthetic_tables)
    with pytest.raises(ValueError, match="sample_limit"):
        run_quality_checks(synthetic_tables, snapshot_id="X", cutoff_at_utc=cutoff, sample_limit=0)
    with pytest.raises(ValueError, match="tolerance"):
        run_quality_checks(
            synthetic_tables, snapshot_id="X", cutoff_at_utc=cutoff, forebet_tolerance=-1
        )


def test_remaining_temporal_and_forebet_sum_rules_are_reported(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    tables = {name: frame.copy(deep=True) for name, frame in synthetic_tables.items()}
    first_kickoff = tables["fixtures"].loc[0, "kickoff_at_utc"]
    tables["odds_snapshots"].loc[0, "captured_at_utc"] = first_kickoff
    tables["prematch_decisions"].loc[0, "decided_at_utc"] = first_kickoff
    tables["forebet_snapshots"].loc[
        0,
        [
            "home_probability",
            "draw_probability",
            "away_probability",
        ],
    ] = [0.4, 0.4, 0.4]
    original_observed = tables["outcomes"].loc[0, "observed_at_utc"]
    tables["outcomes"].loc[12, "observed_at_utc"] = original_observed - pd.Timedelta(minutes=1)
    report = run_quality_checks(tables, snapshot_id="TEMPORAL", cutoff_at_utc=_cutoff(tables))
    assert {
        "odds_snapshots.before_kickoff",
        "prematch_decisions.before_kickoff",
        "forebet_snapshots.probability_sum",
        "outcomes.corrections_consistent",
    }.issubset(_failed_ids(report))


def test_naive_timestamp_is_reported_without_aborting_quality(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    naive = make_invalid_copy(synthetic_tables, "naive_timestamp")
    report = run_quality_checks(naive, snapshot_id="NAIVE", cutoff_at_utc=_cutoff(naive))
    assert "odds_snapshots.captured_at_utc.utc" in _failed_ids(report)
