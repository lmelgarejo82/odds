"""Pure metrics; predictive correctness never implies economic profitability."""

from collections.abc import Sequence

import numpy as np
import pandas as pd
from numpy.typing import ArrayLike, NDArray


def _one_dimensional(
    values: ArrayLike, name: str, *, allow_empty: bool = False
) -> NDArray[np.float64]:
    array = np.asarray(values, dtype=float)
    if array.ndim != 1:
        raise ValueError(f"{name} must be one-dimensional")
    if not allow_empty and array.size == 0:
        raise ValueError(f"{name} must not be empty")
    if not np.isfinite(array).all():
        raise ValueError(f"{name} must contain finite values")
    return array


def _same_length(first: NDArray[np.float64], second: NDArray[np.float64]) -> None:
    if first.size != second.size:
        raise ValueError("inputs must have equal length")


def binary_brier_score(probabilities: ArrayLike, outcomes: ArrayLike) -> float:
    """Return mean squared error for binary probabilities and labels in {0,1}."""

    predicted = _one_dimensional(probabilities, "probabilities")
    observed = _one_dimensional(outcomes, "outcomes")
    _same_length(predicted, observed)
    if ((predicted < 0) | (predicted > 1)).any() or not np.isin(observed, [0, 1]).all():
        raise ValueError("binary probabilities and outcomes must be in [0,1] and {0,1}")
    return float(np.mean((predicted - observed) ** 2))


def multiclass_brier_score(probabilities: ArrayLike, outcomes: ArrayLike) -> float:
    """Return mean summed squared error for ordered 1X2 class indices 0,1,2."""

    predicted = np.asarray(probabilities, dtype=float)
    observed = np.asarray(outcomes, dtype=int)
    if predicted.ndim != 2 or predicted.shape[1] != 3 or predicted.shape[0] == 0:
        raise ValueError("probabilities must have non-empty shape (n, 3)")
    if observed.ndim != 1 or observed.size != predicted.shape[0]:
        raise ValueError("outcomes must have shape (n,) matching probabilities")
    if not np.isfinite(predicted).all() or ((predicted < 0) | (predicted > 1)).any():
        raise ValueError("probabilities must be finite and in [0,1]")
    if not np.allclose(predicted.sum(axis=1), 1.0) or not np.isin(observed, [0, 1, 2]).all():
        raise ValueError("1X2 rows must sum to one and outcomes must be 0, 1 or 2")
    one_hot = np.eye(3, dtype=float)[observed]
    return float(np.mean(np.sum((predicted - one_hot) ** 2, axis=1)))


def binary_log_loss(probabilities: ArrayLike, outcomes: ArrayLike, *, clip: float) -> float:
    """Return binary log loss after explicit symmetric probability clipping."""

    if not 0.0 < clip < 0.5:
        raise ValueError("clip must be between zero and 0.5")
    predicted = _one_dimensional(probabilities, "probabilities")
    observed = _one_dimensional(outcomes, "outcomes")
    _same_length(predicted, observed)
    if ((predicted < 0) | (predicted > 1)).any() or not np.isin(observed, [0, 1]).all():
        raise ValueError("binary probabilities and outcomes are invalid")
    clipped = np.clip(predicted, clip, 1.0 - clip)
    return float(-np.mean(observed * np.log(clipped) + (1.0 - observed) * np.log(1.0 - clipped)))


def accuracy(predicted: Sequence[object], observed: Sequence[object]) -> float:
    """Return classification accuracy for a non-empty sample."""

    if len(predicted) == 0 or len(predicted) != len(observed):
        raise ValueError("predicted and observed must be non-empty and equally sized")
    return sum(left == right for left, right in zip(predicted, observed, strict=True)) / len(
        predicted
    )


def coverage(selected_count: int, eligible_count: int) -> float:
    """Return selected decisions divided by the explicitly supplied eligible count."""

    if eligible_count <= 0 or selected_count < 0 or selected_count > eligible_count:
        raise ValueError("coverage counts are invalid")
    return selected_count / eligible_count


def calibration_table(
    probabilities: ArrayLike, outcomes: ArrayLike, *, bin_edges: Sequence[float]
) -> pd.DataFrame:
    """Aggregate count, mean prediction and outcome rate in explicit bins."""

    predicted = _one_dimensional(probabilities, "probabilities")
    observed = _one_dimensional(outcomes, "outcomes")
    _same_length(predicted, observed)
    edges = np.asarray(bin_edges, dtype=float)
    if edges.ndim != 1 or edges.size < 2 or not np.all(np.diff(edges) > 0):
        raise ValueError("bin_edges must be strictly increasing")
    if edges[0] != 0.0 or edges[-1] != 1.0:
        raise ValueError("bin_edges must span zero to one")
    if ((predicted < 0) | (predicted > 1)).any() or not np.isin(observed, [0, 1]).all():
        raise ValueError("binary probabilities and outcomes are invalid")
    bins = np.digitize(predicted, edges[1:-1], right=False)
    rows = []
    for index in range(edges.size - 1):
        mask = bins == index
        rows.append(
            {
                "bin_lower": edges[index],
                "bin_upper": edges[index + 1],
                "sample_size": int(mask.sum()),
                "mean_probability": float(predicted[mask].mean()) if mask.any() else np.nan,
                "outcome_rate": float(observed[mask].mean()) if mask.any() else np.nan,
            }
        )
    return pd.DataFrame(rows)


def flat_stake_profit(
    decimal_odds: ArrayLike, won: ArrayLike, *, voided: ArrayLike | None = None
) -> NDArray[np.float64]:
    """Return per-bet unit profit: odds-1 for wins, -1 for losses and 0 for voids."""

    odds = _one_dimensional(decimal_odds, "decimal_odds")
    wins = _one_dimensional(won, "won")
    _same_length(odds, wins)
    if (odds <= 1).any() or not np.isin(wins, [0, 1]).all():
        raise ValueError("decimal odds or binary win labels are invalid")
    voids = (
        np.zeros(odds.size, dtype=float) if voided is None else _one_dimensional(voided, "voided")
    )
    _same_length(odds, voids)
    if not np.isin(voids, [0, 1]).all():
        raise ValueError("voided must contain binary labels")
    return np.where(voids == 1, 0.0, np.where(wins == 1, odds - 1.0, -1.0))


def roi(profits: ArrayLike, *, total_staked: float | None = None) -> float:
    """Return profit divided by staked units; default is one unit per row."""

    values = _one_dimensional(profits, "profits")
    denominator = float(values.size) if total_staked is None else total_staked
    if not np.isfinite(denominator) or denominator <= 0:
        raise ValueError("total_staked must be positive and finite")
    return float(values.sum() / denominator)


def yield_rate(profits: ArrayLike, *, total_staked: float | None = None) -> float:
    """Return flat-stake yield using the same unit-stake convention as ROI."""

    return roi(profits, total_staked=total_staked)


def average_odds(decimal_odds: ArrayLike) -> float:
    """Return arithmetic mean decimal odds for a non-empty sample."""

    odds = _one_dimensional(decimal_odds, "decimal_odds")
    if (odds <= 1).any():
        raise ValueError("decimal odds must be greater than one")
    return float(odds.mean())


def hit_rate(won: ArrayLike) -> float:
    """Return wins divided by settled observations."""

    wins = _one_dimensional(won, "won")
    if not np.isin(wins, [0, 1]).all():
        raise ValueError("won must contain binary labels")
    return float(wins.mean())


def cumulative_profit(profits: ArrayLike) -> NDArray[np.float64]:
    """Return the ordered cumulative unit-profit curve."""

    return np.cumsum(_one_dimensional(profits, "profits"))


def maximum_drawdown(profits: ArrayLike) -> float:
    """Return the largest peak-to-trough loss, with the initial bankroll peak at zero."""

    curve = cumulative_profit(profits)
    extended = np.concatenate(([0.0], curve))
    running_peak = np.maximum.accumulate(extended)
    return float(np.max(running_peak - extended))


def longest_losing_streak(profits: ArrayLike) -> int:
    """Return the maximum consecutive count of strictly negative profits."""

    values = _one_dimensional(profits, "profits")
    longest = 0
    current = 0
    for value in values:
        current = current + 1 if value < 0 else 0
        longest = max(longest, current)
    return longest
