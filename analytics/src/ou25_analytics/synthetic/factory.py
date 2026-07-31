"""Synthetic data factory; no row represents a real sporting event."""

import hashlib

import numpy as np
import pandas as pd

from ou25_analytics.market.probabilities import (
    break_even_probability,
    forebet_probability_1x,
    overround_1x2,
    proportional_no_vig_1x2,
)


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def make_synthetic_tables(seed: int) -> dict[str, pd.DataFrame]:
    """Build a deterministic, clearly fictional 12-fixture analytical snapshot."""

    generator = np.random.default_rng(seed)
    fixture_rows: list[dict[str, object]] = []
    forebet_rows: list[dict[str, object]] = []
    odds_rows: list[dict[str, object]] = []
    probability_rows: list[dict[str, object]] = []
    decision_rows: list[dict[str, object]] = []
    outcome_rows: list[dict[str, object]] = []
    start = pd.Timestamp("2030-01-01T18:00:00Z")

    for index in range(12):
        fixture_id = f"SYNTH_FIXTURE_{index + 1:02d}"
        kickoff = start + pd.Timedelta(days=index * 2)
        fixture_rows.append(
            {
                "fixture_id": fixture_id,
                "competition_key": "SYNTH_LEAGUE_ALPHA",
                "home_team_id": f"SYNTH_TEAM_{index * 2 + 1:02d}",
                "away_team_id": f"SYNTH_TEAM_{index * 2 + 2:02d}",
                "kickoff_at_utc": kickoff,
                "fixture_status": "FINISHED",
            }
        )

        if index % 2 == 0:
            home_probability, draw_probability, away_probability = 0.50, 0.30, 0.20
            prices = (2.05, 3.45, 4.10)
        else:
            home_probability, draw_probability, away_probability = 0.28, 0.25, 0.47
            prices = (3.20, 3.40, 2.30)
        if index == 1:
            prices = (2.10, 3.30, 3.80)  # controlled Forebet/market divergence

        forebet_rows.append(
            {
                "forebet_snapshot_id": f"SYNTH_FOREBET_{index + 1:02d}",
                "fixture_id": fixture_id,
                "captured_at_utc": kickoff - pd.Timedelta(hours=26),
                "home_probability": home_probability,
                "draw_probability": draw_probability,
                "away_probability": away_probability,
                "parser_version": "synthetic-parser-v1",
                "content_hash": _hash(f"forebet-{seed}-{index}"),
            }
        )

        no_vig = proportional_no_vig_1x2(prices)
        overround = overround_1x2(prices)
        market_values = {"1": no_vig[0], "X": no_vig[1], "2": no_vig[2], "1X": 1 / 1.50}
        for selection_key, probability in market_values.items():
            probability_rows.append(
                {
                    "market_probability_id": f"SYNTH_MARKET_P_{index + 1:02d}_{selection_key}",
                    "fixture_id": fixture_id,
                    "market_key": "MATCH_RESULT" if selection_key != "1X" else "DOUBLE_CHANCE",
                    "selection_key": selection_key,
                    "calculated_at_utc": kickoff - pd.Timedelta(hours=24, minutes=30),
                    "probability": float(probability),
                    "overround": overround if selection_key != "1X" else 1.0,
                    "no_vig_method": "PROPORTIONAL" if selection_key != "1X" else "BREAK_EVEN",
                    "input_hash": _hash(f"market-input-{seed}-{index}-{selection_key}"),
                }
            )

        for bookmaker_index, bookmaker_key in enumerate(("SYNTH_BOOK_A", "SYNTH_BOOK_B")):
            adjustment = bookmaker_index * 0.02
            prices_by_selection = {
                "1": prices[0] + adjustment,
                "X": prices[1] + adjustment,
                "2": prices[2] + adjustment,
                "1X": 1.50 + adjustment,
            }
            for selection_key, decimal_odds in prices_by_selection.items():
                odds_rows.append(
                    {
                        "odds_snapshot_id": (
                            f"SYNTH_ODDS_{index + 1:02d}_{bookmaker_index + 1}_{selection_key}"
                        ),
                        "fixture_id": fixture_id,
                        "bookmaker_key": bookmaker_key,
                        "market_key": "MATCH_RESULT" if selection_key != "1X" else "DOUBLE_CHANCE",
                        "selection_key": selection_key,
                        "captured_at_utc": kickoff - pd.Timedelta(hours=25 - bookmaker_index),
                        "decimal_odds": decimal_odds,
                        "market_status": "ACTIVE",
                        "is_in_play": False,
                        "content_hash": _hash(
                            f"odds-{seed}-{index}-{bookmaker_index}-{selection_key}"
                        ),
                    }
                )

        status = ("SELECTED", "ABSTAINED", "BLOCKED", "UNRESOLVED")[index % 4]
        selected_odds_id = f"SYNTH_ODDS_{index + 1:02d}_1_1X" if status == "SELECTED" else None
        estimated_probability = (
            forebet_probability_1x(home_probability, draw_probability)
            if status == "SELECTED"
            else None
        )
        selected_break_even = break_even_probability(1.50) if status == "SELECTED" else None
        decision_rows.append(
            {
                "decision_id": f"SYNTH_DECISION_{index + 1:02d}",
                "fixture_id": fixture_id,
                "decided_at_utc": kickoff - pd.Timedelta(hours=23),
                "decision_status": status,
                "reason_code": f"SYNTH_{status}_REASON",
                "selected_odds_snapshot_id": selected_odds_id,
                "estimated_probability": estimated_probability,
                "break_even_probability": selected_break_even,
                "estimated_edge": (
                    estimated_probability - selected_break_even
                    if estimated_probability is not None and selected_break_even is not None
                    else None
                ),
                "policy_version": "synthetic-policy-v1",
                "input_hash": _hash(f"decision-{seed}-{index}"),
            }
        )

        home_score = int(generator.integers(0, 4))
        away_score = int(generator.integers(0, 4))
        result_1x2 = "1" if home_score > away_score else "2" if away_score > home_score else "X"
        outcome_rows.append(
            {
                "outcome_id": f"SYNTH_OUTCOME_{index + 1:02d}_V1",
                "fixture_id": fixture_id,
                "observed_at_utc": kickoff + pd.Timedelta(hours=3),
                "home_score": home_score,
                "away_score": away_score,
                "result_1x2": result_1x2,
                "outcome_status": "PROVISIONAL" if index == 0 else "CONFIRMED",
                "supersedes_outcome_id": None,
                "content_hash": _hash(f"outcome-{seed}-{index}-v1"),
            }
        )

    first_kickoff = start
    outcome_rows.append(
        {
            "outcome_id": "SYNTH_OUTCOME_01_V2",
            "fixture_id": "SYNTH_FIXTURE_01",
            "observed_at_utc": first_kickoff + pd.Timedelta(hours=4),
            "home_score": 2,
            "away_score": 1,
            "result_1x2": "1",
            "outcome_status": "CORRECTED",
            "supersedes_outcome_id": "SYNTH_OUTCOME_01_V1",
            "content_hash": _hash(f"outcome-{seed}-0-v2"),
        }
    )

    tables = {
        "fixtures": pd.DataFrame(fixture_rows),
        "forebet_snapshots": pd.DataFrame(forebet_rows),
        "odds_snapshots": pd.DataFrame(odds_rows),
        "market_probabilities": pd.DataFrame(probability_rows),
        "prematch_decisions": pd.DataFrame(decision_rows),
        "outcomes": pd.DataFrame(outcome_rows),
    }
    for table_name, frame in tables.items():
        for column in frame.columns:
            if column.endswith("_at_utc"):
                frame[column] = pd.to_datetime(frame[column], utc=True)
        tables[table_name] = frame
    return tables


def make_invalid_copy(tables: dict[str, pd.DataFrame], violation: str) -> dict[str, pd.DataFrame]:
    """Return a deep copy containing one controlled invalidity for tests."""

    invalid = {name: frame.copy(deep=True) for name, frame in tables.items()}
    if violation == "duplicate_fixture":
        invalid["fixtures"] = pd.concat(
            [invalid["fixtures"], invalid["fixtures"].iloc[[0]]], ignore_index=True
        )
    elif violation == "broken_fixture_reference":
        invalid["forebet_snapshots"].loc[0, "fixture_id"] = "SYNTH_MISSING_FIXTURE"
    elif violation == "naive_timestamp":
        invalid["odds_snapshots"]["captured_at_utc"] = invalid["odds_snapshots"][
            "captured_at_utc"
        ].dt.tz_localize(None)
    elif violation == "forebet_after_kickoff":
        invalid["forebet_snapshots"].loc[0, "captured_at_utc"] = invalid["fixtures"].loc[
            0, "kickoff_at_utc"
        ]
    elif violation == "odds_after_decision":
        selected_id = invalid["prematch_decisions"].loc[0, "selected_odds_snapshot_id"]
        mask = invalid["odds_snapshots"]["odds_snapshot_id"].eq(selected_id)
        decided_at = pd.Timestamp(str(invalid["prematch_decisions"].at[0, "decided_at_utc"]))
        invalid["odds_snapshots"].loc[mask, "captured_at_utc"] = decided_at + pd.Timedelta(
            minutes=1
        )
    elif violation == "selected_odds_other_fixture":
        invalid["prematch_decisions"].loc[0, "selected_odds_snapshot_id"] = invalid[
            "odds_snapshots"
        ].loc[8, "odds_snapshot_id"]
    elif violation == "probability_out_of_range":
        invalid["forebet_snapshots"].loc[0, "home_probability"] = 1.2
    elif violation == "missing_hash":
        invalid["outcomes"].loc[0, "content_hash"] = ""
    elif violation == "outcome_before_kickoff":
        kickoff = pd.Timestamp(str(invalid["fixtures"].at[0, "kickoff_at_utc"]))
        invalid["outcomes"].loc[0, "observed_at_utc"] = kickoff - pd.Timedelta(minutes=1)
    else:
        raise ValueError(f"unknown synthetic violation: {violation}")
    return invalid
