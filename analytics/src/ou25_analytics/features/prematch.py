"""Feature generation limited to information available before kickoff."""

import math
from typing import cast

import pandas as pd

from ou25_analytics.market.probabilities import break_even_probability


def _latest(frame: pd.DataFrame, timestamp: str) -> pd.DataFrame:
    return (
        frame.sort_values(timestamp, kind="mergesort").groupby("fixture_id", as_index=False).tail(1)
    )


def build_prematch_features(
    fixtures: pd.DataFrame,
    forebet_snapshots: pd.DataFrame,
    odds_snapshots: pd.DataFrame,
    market_probabilities: pd.DataFrame,
    prematch_decisions: pd.DataFrame | None = None,
) -> pd.DataFrame:
    """Build one feature row per fixture without accepting post-match data."""

    latest_forebet = _latest(forebet_snapshots, "captured_at_utc").set_index("fixture_id")
    latest_market = (
        market_probabilities.sort_values("calculated_at_utc", kind="mergesort")
        .groupby(["fixture_id", "selection_key"], as_index=False)
        .tail(1)
    )
    decisions_by_fixture = (
        prematch_decisions.sort_values("decided_at_utc", kind="mergesort")
        .groupby("fixture_id", as_index=False)
        .tail(1)
        .set_index("fixture_id")
        if prematch_decisions is not None
        else None
    )
    odds_by_id = odds_snapshots.set_index("odds_snapshot_id", drop=False)
    rows: list[dict[str, object]] = []

    for fixture in fixtures.sort_values(["kickoff_at_utc", "fixture_id"]).itertuples(index=False):
        fixture_id = str(fixture.fixture_id)
        if fixture_id not in latest_forebet.index:
            continue
        forebet = cast(pd.Series, latest_forebet.loc[fixture_id])
        kickoff_at = pd.Timestamp(str(fixture.kickoff_at_utc))
        eligible_odds = odds_snapshots.loc[
            odds_snapshots["fixture_id"].eq(fixture_id)
            & odds_snapshots["captured_at_utc"].lt(kickoff_at)
            & odds_snapshots["market_status"].eq("ACTIVE")
            & ~odds_snapshots["is_in_play"]
        ]
        selected_odds_id: str | None = None
        if decisions_by_fixture is not None and fixture_id in decisions_by_fixture.index:
            decision = cast(pd.Series, decisions_by_fixture.loc[fixture_id])
            raw_selected = decision["selected_odds_snapshot_id"]
            if pd.notna(raw_selected):
                selected_odds_id = str(raw_selected)
        if selected_odds_id is not None:
            if selected_odds_id not in odds_by_id.index:
                raise ValueError(f"selected odds do not exist: {selected_odds_id}")
            selected_odds = cast(pd.Series, odds_by_id.loc[selected_odds_id])
            if str(selected_odds["fixture_id"]) != fixture_id:
                raise ValueError("decision and selected odds must belong to the same fixture")
            chosen_odds: pd.Series | None = selected_odds
        else:
            preferred = eligible_odds.loc[eligible_odds["selection_key"].eq("1X")]
            candidates = preferred if not preferred.empty else eligible_odds
            chosen_odds = (
                candidates.sort_values(["captured_at_utc", "odds_snapshot_id"]).iloc[-1]
                if not candidates.empty
                else None
            )

        fixture_market = latest_market.loc[latest_market["fixture_id"].eq(fixture_id)]
        market_map = dict(
            zip(
                fixture_market["selection_key"].astype(str),
                fixture_market["probability"].astype(float),
                strict=True,
            )
        )
        forebet_home = float(cast(float, forebet["home_probability"]))
        forebet_draw = float(cast(float, forebet["draw_probability"]))
        forebet_away = float(cast(float, forebet["away_probability"]))
        favorite_forebet = max(
            (("1", forebet_home), ("X", forebet_draw), ("2", forebet_away)),
            key=lambda item: item[1],
        )[0]
        market_candidates = {key: market_map[key] for key in ("1", "X", "2") if key in market_map}
        favorite_market = (
            max(market_candidates.items(), key=lambda item: item[1])[0]
            if market_candidates
            else None
        )
        decimal_odds = (
            float(cast(float, chosen_odds["decimal_odds"])) if chosen_odds is not None else math.nan
        )
        selection_key = str(chosen_odds["selection_key"]) if chosen_odds is not None else None
        forebet_for_selection = (
            {
                "1": forebet_home,
                "X": forebet_draw,
                "2": forebet_away,
                "1X": forebet_home + forebet_draw,
            }.get(selection_key, math.nan)
            if selection_key is not None
            else math.nan
        )
        break_even = (
            break_even_probability(decimal_odds) if math.isfinite(decimal_odds) else math.nan
        )
        captured_at = pd.Timestamp(
            chosen_odds["captured_at_utc"]
            if chosen_odds is not None
            else forebet["captured_at_utc"]
        )
        rows.append(
            {
                "fixture_id": fixture_id,
                "forebet_p_home": forebet_home,
                "forebet_p_draw": forebet_draw,
                "forebet_p_away": forebet_away,
                "forebet_p_1x": forebet_home + forebet_draw,
                "market_p_home": market_map.get("1", math.nan),
                "market_p_draw": market_map.get("X", math.nan),
                "market_p_away": market_map.get("2", math.nan),
                "market_p_1x": market_map.get("1X", math.nan),
                "selection_key": selection_key,
                "decimal_odds": decimal_odds,
                "break_even_probability": break_even,
                "forebet_edge": forebet_for_selection - break_even,
                "favorite_forebet": favorite_forebet,
                "favorite_market": favorite_market,
                "favorites_disagree": favorite_forebet != favorite_market,
                "hours_before_kickoff": (kickoff_at - captured_at).total_seconds() / 3600.0,
                "bookmaker_count": int(eligible_odds["bookmaker_key"].nunique()),
            }
        )
    return pd.DataFrame(rows)
