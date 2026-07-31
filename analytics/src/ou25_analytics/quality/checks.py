"""Deterministic structural and temporal quality checks."""

from datetime import datetime

import pandas as pd

from ou25_analytics.contracts.manifest import require_utc
from ou25_analytics.contracts.schemas import CONTRACTS
from ou25_analytics.quality.report import CheckResult, QualityReport

IDENTIFIER_COLUMNS = {
    "fixtures": "fixture_id",
    "forebet_snapshots": "forebet_snapshot_id",
    "odds_snapshots": "odds_snapshot_id",
    "market_probabilities": "market_probability_id",
    "prematch_decisions": "decision_id",
    "outcomes": "outcome_id",
}


def _is_utc(series: pd.Series) -> bool:
    dtype = series.dtype
    return isinstance(dtype, pd.DatetimeTZDtype) and str(dtype.tz) == "UTC"


def _check(
    check_id: str,
    invalid: pd.Series,
    identifiers: pd.Series,
    message: str,
    *,
    severity: str = "ERROR",
    sample_limit: int,
) -> CheckResult:
    mask = invalid.fillna(True).astype(bool)
    samples = identifiers.loc[mask].astype(str).head(sample_limit).tolist()
    affected = int(mask.sum())
    return CheckResult(
        check_id=check_id,
        severity=severity,
        passed=affected == 0,
        affected_rows=affected,
        total_rows=len(invalid),
        sample_identifiers=samples,
        message=message,
    )


def _empty_mask(frame: pd.DataFrame) -> pd.Series:
    return pd.Series(False, index=frame.index, dtype=bool)


def _as_utc(series: pd.Series) -> pd.Series:
    return pd.to_datetime(series, utc=True, errors="coerce")


def run_quality_checks(
    tables: dict[str, pd.DataFrame],
    *,
    snapshot_id: str,
    cutoff_at_utc: datetime,
    sample_limit: int = 5,
    forebet_tolerance: float = 0.000_001,
) -> QualityReport:
    """Run bounded quality diagnostics without printing or mutating input data."""

    require_utc(cutoff_at_utc, "cutoff_at_utc")
    if sample_limit < 1:
        raise ValueError("sample_limit must be positive")
    if forebet_tolerance < 0:
        raise ValueError("forebet_tolerance must be non-negative")

    checks: list[CheckResult] = []
    coverage = {name: len(frame) for name, frame in tables.items()}
    fixtures = tables["fixtures"]
    fixture_ids = set(fixtures["fixture_id"].dropna().astype(str))
    unique_fixtures = fixtures.drop_duplicates("fixture_id", keep="first").set_index("fixture_id")
    kickoff_by_fixture = _as_utc(unique_fixtures["kickoff_at_utc"])

    for table_name, contract in CONTRACTS.items():
        frame = tables[table_name]
        identifier = frame[IDENTIFIER_COLUMNS[table_name]]
        primary = frame.loc[:, list(contract.primary_key)]
        checks.append(
            _check(
                f"{table_name}.primary_key_not_null",
                primary.isna().any(axis=1),
                identifier,
                "conceptual primary keys must not be null",
                sample_limit=sample_limit,
            )
        )
        checks.append(
            _check(
                f"{table_name}.primary_key_unique",
                primary.duplicated(keep=False),
                identifier,
                "conceptual primary keys must be unique",
                sample_limit=sample_limit,
            )
        )
        for field in contract.schema:
            if str(field.type).startswith("timestamp"):
                invalid = _empty_mask(frame) if _is_utc(frame[field.name]) else ~_empty_mask(frame)
                checks.append(
                    _check(
                        f"{table_name}.{field.name}.utc",
                        invalid,
                        identifier,
                        "timestamps must be timezone-aware UTC",
                        sample_limit=sample_limit,
                    )
                )
        if contract.fixture_foreign_key is not None:
            references = frame[contract.fixture_foreign_key]
            checks.append(
                _check(
                    f"{table_name}.fixture_reference",
                    ~references.astype(str).isin(fixture_ids) | references.isna(),
                    identifier,
                    "fixture references must resolve",
                    sample_limit=sample_limit,
                )
            )
        checks.append(
            CheckResult(
                check_id=f"{table_name}.coverage",
                severity="INFO",
                passed=True,
                affected_rows=0,
                total_rows=len(frame),
                sample_identifiers=[],
                message=f"{len(frame)} rows available",
            )
        )

    forebet = tables["forebet_snapshots"]
    forebet_ids = forebet["forebet_snapshot_id"]
    forebet_kickoff = forebet["fixture_id"].map(kickoff_by_fixture)
    checks.append(
        _check(
            "forebet_snapshots.before_kickoff",
            _as_utc(forebet["captured_at_utc"]) >= forebet_kickoff,
            forebet_ids,
            "Forebet snapshots must precede kickoff",
            sample_limit=sample_limit,
        )
    )
    for column in ("home_probability", "draw_probability", "away_probability"):
        checks.append(
            _check(
                f"forebet_snapshots.{column}.range",
                ~forebet[column].between(0.0, 1.0, inclusive="both"),
                forebet_ids,
                "probabilities must be in [0,1]",
                sample_limit=sample_limit,
            )
        )
    forebet_sum = forebet[["home_probability", "draw_probability", "away_probability"]].sum(axis=1)
    checks.append(
        _check(
            "forebet_snapshots.probability_sum",
            (forebet_sum - 1.0).abs() > forebet_tolerance,
            forebet_ids,
            "Forebet probabilities must sum to one within tolerance",
            sample_limit=sample_limit,
        )
    )

    odds = tables["odds_snapshots"]
    odds_ids = odds["odds_snapshot_id"]
    odds_kickoff = odds["fixture_id"].map(kickoff_by_fixture)
    checks.extend(
        [
            _check(
                "odds_snapshots.before_kickoff",
                _as_utc(odds["captured_at_utc"]) >= odds_kickoff,
                odds_ids,
                "odds snapshots must precede kickoff",
                sample_limit=sample_limit,
            ),
            _check(
                "odds_snapshots.decimal_odds",
                odds["decimal_odds"] <= 1.0,
                odds_ids,
                "decimal odds must be greater than one",
                sample_limit=sample_limit,
            ),
        ]
    )

    probabilities = tables["market_probabilities"]
    checks.append(
        _check(
            "market_probabilities.probability.range",
            ~probabilities["probability"].between(0.0, 1.0, inclusive="both"),
            probabilities["market_probability_id"],
            "market probabilities must be in [0,1]",
            sample_limit=sample_limit,
        )
    )

    decisions = tables["prematch_decisions"]
    decision_ids = decisions["decision_id"]
    decision_kickoff = decisions["fixture_id"].map(kickoff_by_fixture)
    checks.append(
        _check(
            "prematch_decisions.before_kickoff",
            _as_utc(decisions["decided_at_utc"]) >= decision_kickoff,
            decision_ids,
            "decisions must be strictly before kickoff",
            sample_limit=sample_limit,
        )
    )
    selected = decisions["decision_status"].eq("SELECTED")
    missing_selected_odds = selected & decisions["selected_odds_snapshot_id"].isna()
    checks.append(
        _check(
            "prematch_decisions.selected_odds_required",
            missing_selected_odds,
            decision_ids,
            "SELECTED decisions require an exact odds snapshot",
            sample_limit=sample_limit,
        )
    )

    odds_lookup = odds.set_index("odds_snapshot_id", drop=False)
    selected_rows = decisions.loc[decisions["selected_odds_snapshot_id"].notna()].copy()
    selected_ids = selected_rows["selected_odds_snapshot_id"].astype(str)
    found = selected_ids.isin(odds_lookup.index)
    selected_odds = odds_lookup.reindex(selected_ids).set_axis(selected_rows.index)
    checks.extend(
        [
            _check(
                "prematch_decisions.selected_odds_exists",
                ~found.set_axis(selected_rows.index),
                selected_rows["decision_id"],
                "selected odds references must resolve",
                sample_limit=sample_limit,
            ),
            _check(
                "prematch_decisions.selected_odds_fixture",
                found.set_axis(selected_rows.index)
                & selected_odds["fixture_id"].ne(selected_rows["fixture_id"]),
                selected_rows["decision_id"],
                "selected odds must belong to the same fixture",
                sample_limit=sample_limit,
            ),
            _check(
                "prematch_decisions.odds_available_at_decision",
                found.set_axis(selected_rows.index)
                & _as_utc(selected_odds["captured_at_utc"]).gt(
                    _as_utc(selected_rows["decided_at_utc"])
                ),
                selected_rows["decision_id"],
                "selected odds must be captured at or before the decision",
                sample_limit=sample_limit,
            ),
            _check(
                "prematch_decisions.no_in_play_odds",
                found.set_axis(selected_rows.index) & selected_odds["is_in_play"].fillna(False),
                selected_rows["decision_id"],
                "pre-match decisions cannot select in-play odds",
                sample_limit=sample_limit,
            ),
            _check(
                "prematch_decisions.active_market",
                found.set_axis(selected_rows.index) & selected_odds["market_status"].ne("ACTIVE"),
                selected_rows["decision_id"],
                "selected odds must have an active market",
                sample_limit=sample_limit,
            ),
        ]
    )

    outcomes = tables["outcomes"]
    outcome_ids = outcomes["outcome_id"]
    outcome_kickoff = outcomes["fixture_id"].map(kickoff_by_fixture)
    checks.append(
        _check(
            "outcomes.after_kickoff",
            _as_utc(outcomes["observed_at_utc"]) < outcome_kickoff,
            outcome_ids,
            "outcomes cannot be observed before kickoff",
            sample_limit=sample_limit,
        )
    )
    outcome_lookup = outcomes.set_index("outcome_id", drop=False)
    corrections = outcomes.loc[outcomes["supersedes_outcome_id"].notna()].copy()
    superseded_ids = corrections["supersedes_outcome_id"].astype(str)
    superseded_found = superseded_ids.isin(outcome_lookup.index)
    superseded = outcome_lookup.reindex(superseded_ids).set_axis(corrections.index)
    inconsistent = ~superseded_found.set_axis(corrections.index)
    inconsistent |= superseded_found.set_axis(corrections.index) & (
        superseded["fixture_id"].ne(corrections["fixture_id"])
        | _as_utc(superseded["observed_at_utc"]).gt(_as_utc(corrections["observed_at_utc"]))
    )
    checks.append(
        _check(
            "outcomes.corrections_consistent",
            inconsistent,
            corrections["outcome_id"],
            "corrections must reference an earlier outcome for the same fixture",
            sample_limit=sample_limit,
        )
    )

    temporal_columns = {
        "forebet_snapshots": "captured_at_utc",
        "odds_snapshots": "captured_at_utc",
        "market_probabilities": "calculated_at_utc",
        "prematch_decisions": "decided_at_utc",
        "outcomes": "observed_at_utc",
    }
    for table_name, timestamp_column in temporal_columns.items():
        frame = tables[table_name]
        checks.append(
            _check(
                f"{table_name}.cutoff",
                _as_utc(frame[timestamp_column]) > cutoff_at_utc,
                frame[IDENTIFIER_COLUMNS[table_name]],
                "rows must not contain observations after the snapshot cutoff",
                sample_limit=sample_limit,
            )
        )

    hash_columns = {
        "forebet_snapshots": "content_hash",
        "odds_snapshots": "content_hash",
        "market_probabilities": "input_hash",
        "prematch_decisions": "input_hash",
        "outcomes": "content_hash",
    }
    for table_name, hash_column in hash_columns.items():
        frame = tables[table_name]
        hashes = frame[hash_column]
        checks.append(
            _check(
                f"{table_name}.{hash_column}.present",
                hashes.isna() | hashes.astype(str).str.strip().eq(""),
                frame[IDENTIFIER_COLUMNS[table_name]],
                "content and input hashes must be present",
                sample_limit=sample_limit,
            )
        )

    return QualityReport(snapshot_id=snapshot_id, checks=checks, coverage=coverage)
