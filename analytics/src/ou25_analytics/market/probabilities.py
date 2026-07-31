"""Pure decimal-odds and no-vig calculations."""

import math
from typing import Protocol


def _probability(value: float, name: str) -> float:
    if not math.isfinite(value) or not 0.0 <= value <= 1.0:
        raise ValueError(f"{name} must be finite and in [0,1]")
    return value


def implied_probability(decimal_odds: float) -> float:
    """Return raw implied probability ``1 / decimal_odds``."""

    if not math.isfinite(decimal_odds) or decimal_odds <= 1.0:
        raise ValueError("decimal_odds must be finite and greater than one")
    return 1.0 / decimal_odds


def overround_1x2(decimal_odds: tuple[float, float, float]) -> float:
    """Return the sum of raw implied probabilities for home, draw and away."""

    return sum(implied_probability(price) for price in decimal_odds)


def proportional_no_vig_1x2(decimal_odds: tuple[float, float, float]) -> tuple[float, float, float]:
    """Remove 1X2 margin by dividing each raw probability by the overround."""

    raw = tuple(implied_probability(price) for price in decimal_odds)
    total = sum(raw)
    return raw[0] / total, raw[1] / total, raw[2] / total


class NoVigMethod(Protocol):
    """Extensible interface for future no-vig methods."""

    name: str

    def probabilities(self, decimal_odds: tuple[float, float, float]) -> tuple[float, float, float]:
        """Convert a complete 1X2 price vector into probabilities."""


class ProportionalNoVig:
    """Current proportional no-vig implementation."""

    name = "PROPORTIONAL"

    def probabilities(self, decimal_odds: tuple[float, float, float]) -> tuple[float, float, float]:
        return proportional_no_vig_1x2(decimal_odds)


def forebet_probability_1x(home_probability: float, draw_probability: float) -> float:
    """Return Forebet double-chance probability for home or draw."""

    home = _probability(home_probability, "home_probability")
    draw = _probability(draw_probability, "draw_probability")
    combined = home + draw
    if combined > 1.0:
        raise ValueError("home_probability + draw_probability must not exceed one")
    return combined


def forebet_probability_x2(draw_probability: float, away_probability: float) -> float:
    """Return Forebet double-chance probability for draw or away."""

    draw = _probability(draw_probability, "draw_probability")
    away = _probability(away_probability, "away_probability")
    combined = draw + away
    if combined > 1.0:
        raise ValueError("draw_probability + away_probability must not exceed one")
    return combined


def break_even_probability(decimal_odds: float) -> float:
    """Return the win probability required for zero expected unit profit."""

    return implied_probability(decimal_odds)


def expected_value_unit(probability: float, decimal_odds: float) -> float:
    """Return unit expected value ``probability * decimal_odds - 1``."""

    implied_probability(decimal_odds)
    return _probability(probability, "probability") * decimal_odds - 1.0


def probability_edge(estimated_probability: float, break_even: float) -> float:
    """Return probability edge as estimated minus break-even probability."""

    return _probability(estimated_probability, "estimated_probability") - _probability(
        break_even, "break_even"
    )
