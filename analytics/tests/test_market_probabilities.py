import math

import pytest

from ou25_analytics.market.probabilities import (
    ProportionalNoVig,
    break_even_probability,
    expected_value_unit,
    forebet_probability_1x,
    forebet_probability_x2,
    implied_probability,
    overround_1x2,
    probability_edge,
    proportional_no_vig_1x2,
)


def test_implied_break_even_expected_value_and_edge() -> None:
    assert implied_probability(2.0) == pytest.approx(0.5)
    assert break_even_probability(2.0) == pytest.approx(0.5)
    assert expected_value_unit(0.6, 2.0) == pytest.approx(0.2)
    assert probability_edge(0.6, 0.5) == pytest.approx(0.1)


def test_overround_and_proportional_normalization() -> None:
    prices = (2.0, 3.5, 4.0)
    overround = overround_1x2(prices)
    probabilities = proportional_no_vig_1x2(prices)
    assert overround > 1.0
    assert sum(probabilities) == pytest.approx(1.0)
    assert ProportionalNoVig().name == "PROPORTIONAL"
    assert ProportionalNoVig().probabilities(prices) == pytest.approx(probabilities)


def test_forebet_double_chance_probabilities() -> None:
    assert forebet_probability_1x(0.5, 0.3) == pytest.approx(0.8)
    assert forebet_probability_x2(0.3, 0.2) == pytest.approx(0.5)


@pytest.mark.parametrize("price", [1.0, 0.0, math.inf])
def test_invalid_decimal_odds_are_rejected(price: float) -> None:
    with pytest.raises(ValueError, match="greater than one"):
        implied_probability(price)


def test_invalid_probabilities_are_rejected() -> None:
    with pytest.raises(ValueError, match="must not exceed"):
        forebet_probability_1x(0.8, 0.3)
    with pytest.raises(ValueError, match=r"\[0,1\]"):
        probability_edge(1.1, 0.5)
