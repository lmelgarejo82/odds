import inspect

import pandas as pd
import pytest

from ou25_analytics.features.prematch import build_prematch_features
from ou25_analytics.synthetic.factory import make_invalid_copy


def _build(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    return build_prematch_features(
        tables["fixtures"],
        tables["forebet_snapshots"],
        tables["odds_snapshots"],
        tables["market_probabilities"],
        tables["prematch_decisions"],
    )


def test_builder_signature_does_not_accept_outcomes() -> None:
    assert "outcomes" not in inspect.signature(build_prematch_features).parameters


def test_features_include_edge_hours_and_bookmaker_coverage(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    features = _build(synthetic_tables).set_index("fixture_id")
    first = features.loc["SYNTH_FIXTURE_01"]
    assert len(features) == 12
    assert first["forebet_p_1x"] == pytest.approx(0.8)
    assert first["break_even_probability"] == pytest.approx(1 / 1.5)
    assert first["forebet_edge"] == pytest.approx(0.8 - 1 / 1.5)
    assert first["hours_before_kickoff"] == pytest.approx(25.0)
    assert first["bookmaker_count"] == 2


def test_favorites_capture_concordance_and_divergence(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    features = _build(synthetic_tables).set_index("fixture_id")
    assert not bool(features.loc["SYNTH_FIXTURE_01", "favorites_disagree"])
    assert bool(features.loc["SYNTH_FIXTURE_02", "favorites_disagree"])


def test_builder_rejects_cross_fixture_selected_odds(
    synthetic_tables: dict[str, pd.DataFrame],
) -> None:
    invalid = make_invalid_copy(synthetic_tables, "selected_odds_other_fixture")
    with pytest.raises(ValueError, match="same fixture"):
        _build(invalid)


def test_builder_can_operate_without_decisions(synthetic_tables: dict[str, pd.DataFrame]) -> None:
    features = build_prematch_features(
        synthetic_tables["fixtures"],
        synthetic_tables["forebet_snapshots"],
        synthetic_tables["odds_snapshots"],
        synthetic_tables["market_probabilities"],
    )
    assert len(features) == 12
    assert set(features["selection_key"]) == {"1X"}
