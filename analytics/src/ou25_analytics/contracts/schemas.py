"""Canonical PyArrow schemas and tabular validation."""

from dataclasses import dataclass
from typing import Final

import pandas as pd
import pyarrow as pa

UTC_TIMESTAMP: Final = pa.timestamp("us", tz="UTC")


class ContractError(ValueError):
    """Raised when a table does not satisfy its analytical contract."""


@dataclass(frozen=True)
class TableContract:
    """Schema plus semantic metadata needed for reproducible validation."""

    schema: pa.Schema
    primary_key: tuple[str, ...]
    fixture_foreign_key: str | None
    sort_columns: tuple[str, ...]
    units: dict[str, str]
    ranges: dict[str, tuple[float, float]]
    decision_allowed: bool
    evaluation_only: bool = False


def _field(name: str, data_type: pa.DataType, *, nullable: bool = False) -> pa.Field:
    return pa.field(name, data_type, nullable=nullable)


CONTRACTS: Final[dict[str, TableContract]] = {
    "fixtures": TableContract(
        schema=pa.schema(
            [
                _field("fixture_id", pa.string()),
                _field("competition_key", pa.string()),
                _field("home_team_id", pa.string()),
                _field("away_team_id", pa.string()),
                _field("kickoff_at_utc", UTC_TIMESTAMP),
                _field("fixture_status", pa.string()),
            ]
        ),
        primary_key=("fixture_id",),
        fixture_foreign_key=None,
        sort_columns=("kickoff_at_utc", "fixture_id"),
        units={"kickoff_at_utc": "UTC"},
        ranges={},
        decision_allowed=True,
    ),
    "forebet_snapshots": TableContract(
        schema=pa.schema(
            [
                _field("forebet_snapshot_id", pa.string()),
                _field("fixture_id", pa.string()),
                _field("captured_at_utc", UTC_TIMESTAMP),
                _field("home_probability", pa.float64()),
                _field("draw_probability", pa.float64()),
                _field("away_probability", pa.float64()),
                _field("parser_version", pa.string()),
                _field("content_hash", pa.string()),
            ]
        ),
        primary_key=("forebet_snapshot_id",),
        fixture_foreign_key="fixture_id",
        sort_columns=("fixture_id", "captured_at_utc", "forebet_snapshot_id"),
        units={"captured_at_utc": "UTC", "*_probability": "fraction [0,1]"},
        ranges={
            "home_probability": (0.0, 1.0),
            "draw_probability": (0.0, 1.0),
            "away_probability": (0.0, 1.0),
        },
        decision_allowed=True,
    ),
    "odds_snapshots": TableContract(
        schema=pa.schema(
            [
                _field("odds_snapshot_id", pa.string()),
                _field("fixture_id", pa.string()),
                _field("bookmaker_key", pa.string()),
                _field("market_key", pa.string()),
                _field("selection_key", pa.string()),
                _field("captured_at_utc", UTC_TIMESTAMP),
                _field("decimal_odds", pa.float64()),
                _field("market_status", pa.string()),
                _field("is_in_play", pa.bool_()),
                _field("content_hash", pa.string()),
            ]
        ),
        primary_key=("odds_snapshot_id",),
        fixture_foreign_key="fixture_id",
        sort_columns=("fixture_id", "captured_at_utc", "odds_snapshot_id"),
        units={"captured_at_utc": "UTC", "decimal_odds": "decimal price"},
        ranges={"decimal_odds": (1.0, float("inf"))},
        decision_allowed=True,
    ),
    "market_probabilities": TableContract(
        schema=pa.schema(
            [
                _field("market_probability_id", pa.string()),
                _field("fixture_id", pa.string()),
                _field("market_key", pa.string()),
                _field("selection_key", pa.string()),
                _field("calculated_at_utc", UTC_TIMESTAMP),
                _field("probability", pa.float64()),
                _field("overround", pa.float64()),
                _field("no_vig_method", pa.string()),
                _field("input_hash", pa.string()),
            ]
        ),
        primary_key=("market_probability_id",),
        fixture_foreign_key="fixture_id",
        sort_columns=("fixture_id", "calculated_at_utc", "market_probability_id"),
        units={
            "calculated_at_utc": "UTC",
            "probability": "fraction [0,1]",
            "overround": "implied probability sum",
        },
        ranges={"probability": (0.0, 1.0), "overround": (1.0, float("inf"))},
        decision_allowed=True,
    ),
    "prematch_decisions": TableContract(
        schema=pa.schema(
            [
                _field("decision_id", pa.string()),
                _field("fixture_id", pa.string()),
                _field("decided_at_utc", UTC_TIMESTAMP),
                _field("decision_status", pa.string()),
                _field("reason_code", pa.string()),
                _field("selected_odds_snapshot_id", pa.string(), nullable=True),
                _field("estimated_probability", pa.float64(), nullable=True),
                _field("break_even_probability", pa.float64(), nullable=True),
                _field("estimated_edge", pa.float64(), nullable=True),
                _field("policy_version", pa.string()),
                _field("input_hash", pa.string()),
            ]
        ),
        primary_key=("decision_id",),
        fixture_foreign_key="fixture_id",
        sort_columns=("fixture_id", "decided_at_utc", "decision_id"),
        units={
            "decided_at_utc": "UTC",
            "estimated_probability": "fraction [0,1]",
            "break_even_probability": "fraction [0,1]",
            "estimated_edge": "probability points as fraction",
        },
        ranges={
            "estimated_probability": (0.0, 1.0),
            "break_even_probability": (0.0, 1.0),
            "estimated_edge": (-1.0, 1.0),
        },
        decision_allowed=True,
    ),
    "outcomes": TableContract(
        schema=pa.schema(
            [
                _field("outcome_id", pa.string()),
                _field("fixture_id", pa.string()),
                _field("observed_at_utc", UTC_TIMESTAMP),
                _field("home_score", pa.int64()),
                _field("away_score", pa.int64()),
                _field("result_1x2", pa.string()),
                _field("outcome_status", pa.string()),
                _field("supersedes_outcome_id", pa.string(), nullable=True),
                _field("content_hash", pa.string()),
            ]
        ),
        primary_key=("outcome_id",),
        fixture_foreign_key="fixture_id",
        sort_columns=("fixture_id", "observed_at_utc", "outcome_id"),
        units={"observed_at_utc": "UTC", "*_score": "goals"},
        ranges={"home_score": (0.0, float("inf")), "away_score": (0.0, float("inf"))},
        decision_allowed=False,
        evaluation_only=True,
    ),
}


def _is_utc_series(series: pd.Series) -> bool:
    dtype = series.dtype
    return isinstance(dtype, pd.DatetimeTZDtype) and str(dtype.tz) == "UTC"


def validate_dataframe(table_name: str, frame: pd.DataFrame) -> pa.Table:
    """Validate critical columns, UTC timestamps, ranges and Arrow types."""

    if table_name not in CONTRACTS:
        raise ContractError(f"unknown analytical table: {table_name}")
    contract = CONTRACTS[table_name]
    required = set(contract.schema.names)
    missing = sorted(required.difference(frame.columns))
    if missing:
        raise ContractError(f"{table_name} is missing critical columns: {missing}")

    for field in contract.schema:
        if pa.types.is_timestamp(field.type) and not _is_utc_series(frame[field.name]):
            raise ContractError(f"{table_name}.{field.name} must be timezone-aware UTC")
        if not field.nullable and frame[field.name].isna().any():
            raise ContractError(f"{table_name}.{field.name} contains null values")

    for column, (minimum, maximum) in contract.ranges.items():
        values = frame[column].dropna()
        if ((values < minimum) | (values > maximum)).any():
            raise ContractError(f"{table_name}.{column} is outside [{minimum}, {maximum}]")

    ordered = frame.loc[:, contract.schema.names]
    try:
        return pa.Table.from_pandas(
            ordered, schema=contract.schema, preserve_index=False, safe=True
        )
    except (pa.ArrowInvalid, pa.ArrowTypeError) as error:
        raise ContractError(f"{table_name} has incompatible Arrow types: {error}") from error


def validate_all_tables(tables: dict[str, pd.DataFrame]) -> dict[str, pa.Table]:
    """Require and validate the complete canonical snapshot table set."""

    missing = sorted(set(CONTRACTS).difference(tables))
    unexpected = sorted(set(tables).difference(CONTRACTS))
    if missing or unexpected:
        raise ContractError(f"table set mismatch; missing={missing}, unexpected={unexpected}")
    return {name: validate_dataframe(name, tables[name]) for name in CONTRACTS}
