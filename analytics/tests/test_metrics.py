import math

import numpy as np
import pytest

from ou25_analytics.backtesting.metrics import (
    accuracy,
    average_odds,
    binary_brier_score,
    binary_log_loss,
    calibration_table,
    coverage,
    cumulative_profit,
    flat_stake_profit,
    hit_rate,
    longest_losing_streak,
    maximum_drawdown,
    multiclass_brier_score,
    roi,
    yield_rate,
)


def test_known_predictive_metrics() -> None:
    assert binary_brier_score([0.8, 0.3], [1, 0]) == pytest.approx(0.065)
    expected_log_loss = -(math.log(0.8) + math.log(0.7)) / 2
    assert binary_log_loss([0.8, 0.3], [1, 0], clip=1e-6) == pytest.approx(expected_log_loss)
    assert multiclass_brier_score([[0.7, 0.2, 0.1]], [0]) == pytest.approx(0.14)
    assert accuracy(["1", "X", "2"], ["1", "2", "2"]) == pytest.approx(2 / 3)
    assert coverage(3, 12) == pytest.approx(0.25)


def test_calibration_uses_explicit_bins() -> None:
    table = calibration_table([0.1, 0.4, 0.9], [0, 1, 1], bin_edges=[0.0, 0.5, 1.0])
    assert table["sample_size"].tolist() == [2, 1]
    assert table.loc[0, "mean_probability"] == pytest.approx(0.25)
    assert table.loc[1, "outcome_rate"] == pytest.approx(1.0)


def test_known_flat_stake_roi_drawdown_and_losing_streak() -> None:
    profits = flat_stake_profit([2.0, 3.0, 1.5, 2.5], [1, 0, 0, 1])
    assert profits.tolist() == pytest.approx([1.0, -1.0, -1.0, 1.5])
    assert roi(profits) == pytest.approx(0.125)
    assert yield_rate(profits, total_staked=4.0) == pytest.approx(0.125)
    assert cumulative_profit(profits).tolist() == pytest.approx([1.0, 0.0, -1.0, 0.5])
    assert maximum_drawdown(profits) == pytest.approx(2.0)
    assert longest_losing_streak(profits) == 2
    assert average_odds([2.0, 3.0]) == pytest.approx(2.5)
    assert hit_rate([1, 0, 1, 1]) == pytest.approx(0.75)


def test_void_bet_has_zero_profit() -> None:
    assert flat_stake_profit([2.0], [0], voided=[1]).tolist() == [0.0]


@pytest.mark.parametrize(
    "operation",
    [
        lambda: binary_brier_score([], []),
        lambda: flat_stake_profit([], []),
        lambda: roi([]),
        lambda: accuracy([], []),
        lambda: average_odds([]),
        lambda: hit_rate([]),
        lambda: maximum_drawdown([]),
        lambda: longest_losing_streak([]),
    ],
)
def test_empty_samples_are_rejected(operation) -> None:
    with pytest.raises(ValueError, match="empty"):
        operation()


def test_invalid_metric_inputs_are_rejected() -> None:
    with pytest.raises(ValueError):
        binary_log_loss([0.5], [1], clip=0.5)
    with pytest.raises(ValueError):
        multiclass_brier_score([[0.6, 0.3, 0.3]], [0])
    with pytest.raises(ValueError):
        calibration_table([0.5], [1], bin_edges=[0.1, 1.0])
    with pytest.raises(ValueError):
        coverage(2, 1)
    with pytest.raises(ValueError):
        roi(np.array([1.0]), total_staked=0)
