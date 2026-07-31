"""Explicit prematch-only SQLite-to-analytics query mappings."""

from dataclasses import dataclass
from typing import Literal

ColumnKind = Literal["string", "float", "integer", "boolean", "timestamp"]


@dataclass(frozen=True)
class TableMapping:
    """One fixed, versioned and non-user-configurable extraction mapping."""

    output_table: str
    source_table: str
    source_columns: tuple[str, ...]
    output_columns: tuple[str, ...]
    output_types: tuple[ColumnKind, ...]
    availability_column: str | None
    conceptual_primary_key: tuple[str, ...]
    fixture_foreign_key: str | None
    cutoff_filter: str
    prematch_allowed: bool
    evaluation_only: bool
    select_sql: str
    total_count_sql: str
    eligible_count_sql: str
    cutoff_parameter_count: int


PREMATCH_FIXTURES = TableMapping(
    output_table="fixtures",
    source_table="Fixture",
    source_columns=("id", "competitionKey", "localTeamId", "awayTeamId", "kickoffAtUtc", "status"),
    output_columns=(
        "fixture_id",
        "competition_key",
        "home_team_id",
        "away_team_id",
        "kickoff_at_utc",
        "fixture_status",
    ),
    output_types=("string", "string", "string", "string", "timestamp", "string"),
    availability_column=None,
    conceptual_primary_key=("id",),
    fixture_foreign_key=None,
    cutoff_filter="referenced by an eligible prematch row at or before cutoff",
    prematch_allowed=True,
    evaluation_only=False,
    select_sql="""
        SELECT
            f."id" AS "fixture_id",
            f."competitionKey" AS "competition_key",
            f."localTeamId" AS "home_team_id",
            f."awayTeamId" AS "away_team_id",
            f."kickoffAtUtc" AS "kickoff_at_utc",
            f."status" AS "fixture_status"
        FROM "Fixture" AS f
        WHERE EXISTS (
            SELECT 1 FROM "ForebetSnapshot" AS fs
            WHERE fs."fixtureId" = f."id" AND utc_epoch_micros(fs."capturedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "OddsSnapshot" AS os
            WHERE os."fixtureId" = f."id" AND utc_epoch_micros(os."capturedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "MarketProbabilitySnapshot" AS mp
            WHERE mp."fixtureId" = f."id" AND utc_epoch_micros(mp."calculatedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "PreMatchDecision" AS pd
            WHERE pd."fixtureId" = f."id" AND utc_epoch_micros(pd."decidedAtUtc") <= ?
        )
        ORDER BY f."kickoffAtUtc", f."id"
    """,
    total_count_sql='SELECT COUNT("id") AS "row_count" FROM "Fixture"',
    eligible_count_sql="""
        SELECT COUNT(f."id") AS "row_count"
        FROM "Fixture" AS f
        WHERE EXISTS (
            SELECT 1 FROM "ForebetSnapshot" AS fs
            WHERE fs."fixtureId" = f."id" AND utc_epoch_micros(fs."capturedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "OddsSnapshot" AS os
            WHERE os."fixtureId" = f."id" AND utc_epoch_micros(os."capturedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "MarketProbabilitySnapshot" AS mp
            WHERE mp."fixtureId" = f."id" AND utc_epoch_micros(mp."calculatedAtUtc") <= ?
        ) OR EXISTS (
            SELECT 1 FROM "PreMatchDecision" AS pd
            WHERE pd."fixtureId" = f."id" AND utc_epoch_micros(pd."decidedAtUtc") <= ?
        )
    """,
    cutoff_parameter_count=4,
)

FOREBET = TableMapping(
    output_table="forebet_snapshots",
    source_table="ForebetSnapshot",
    source_columns=(
        "id",
        "fixtureId",
        "capturedAtUtc",
        "homeProbability",
        "drawProbability",
        "awayProbability",
        "parserVersion",
        "contentHash",
    ),
    output_columns=(
        "forebet_snapshot_id",
        "fixture_id",
        "captured_at_utc",
        "home_probability",
        "draw_probability",
        "away_probability",
        "parser_version",
        "content_hash",
    ),
    output_types=("string", "string", "timestamp", "float", "float", "float", "string", "string"),
    availability_column="capturedAtUtc",
    conceptual_primary_key=("id",),
    fixture_foreign_key="fixtureId",
    cutoff_filter="capturedAtUtc <= cutoff_at_utc",
    prematch_allowed=True,
    evaluation_only=False,
    select_sql="""
        SELECT
            "id" AS "forebet_snapshot_id",
            "fixtureId" AS "fixture_id",
            "capturedAtUtc" AS "captured_at_utc",
            "homeProbability" AS "home_probability",
            "drawProbability" AS "draw_probability",
            "awayProbability" AS "away_probability",
            "parserVersion" AS "parser_version",
            "contentHash" AS "content_hash"
        FROM "ForebetSnapshot"
        WHERE utc_epoch_micros("capturedAtUtc") <= ?
        ORDER BY "fixtureId", "capturedAtUtc", "id"
    """,
    total_count_sql='SELECT COUNT("id") AS "row_count" FROM "ForebetSnapshot"',
    eligible_count_sql=(
        'SELECT COUNT("id") AS "row_count" FROM "ForebetSnapshot" '
        'WHERE utc_epoch_micros("capturedAtUtc") <= ?'
    ),
    cutoff_parameter_count=1,
)

ODDS = TableMapping(
    output_table="odds_snapshots",
    source_table="OddsSnapshot",
    source_columns=(
        "id",
        "fixtureId",
        "bookmakerId",
        "marketSelectionId",
        "capturedAtUtc",
        "decimalOdds",
        "marketStatus",
        "isInPlay",
        "contentHash",
    ),
    output_columns=(
        "odds_snapshot_id",
        "fixture_id",
        "bookmaker_key",
        "market_key",
        "selection_key",
        "captured_at_utc",
        "decimal_odds",
        "market_status",
        "is_in_play",
        "content_hash",
    ),
    output_types=(
        "string",
        "string",
        "string",
        "string",
        "string",
        "timestamp",
        "float",
        "string",
        "boolean",
        "string",
    ),
    availability_column="capturedAtUtc",
    conceptual_primary_key=("id",),
    fixture_foreign_key="fixtureId",
    cutoff_filter="capturedAtUtc <= cutoff_at_utc",
    prematch_allowed=True,
    evaluation_only=False,
    select_sql="""
        SELECT
            os."id" AS "odds_snapshot_id",
            os."fixtureId" AS "fixture_id",
            b."stableKey" AS "bookmaker_key",
            md."stableKey" AS "market_key",
            ms."stableKey" AS "selection_key",
            os."capturedAtUtc" AS "captured_at_utc",
            os."decimalOdds" AS "decimal_odds",
            os."marketStatus" AS "market_status",
            os."isInPlay" AS "is_in_play",
            os."contentHash" AS "content_hash"
        FROM "OddsSnapshot" AS os
        JOIN "Bookmaker" AS b ON b."id" = os."bookmakerId"
        JOIN "MarketSelection" AS ms ON ms."id" = os."marketSelectionId"
        JOIN "MarketDefinition" AS md ON md."id" = ms."marketDefinitionId"
        WHERE utc_epoch_micros(os."capturedAtUtc") <= ?
        ORDER BY os."fixtureId", os."capturedAtUtc", os."id"
    """,
    total_count_sql='SELECT COUNT("id") AS "row_count" FROM "OddsSnapshot"',
    eligible_count_sql=(
        'SELECT COUNT("id") AS "row_count" FROM "OddsSnapshot" '
        'WHERE utc_epoch_micros("capturedAtUtc") <= ?'
    ),
    cutoff_parameter_count=1,
)

MARKET_PROBABILITIES = TableMapping(
    output_table="market_probabilities",
    source_table="MarketProbabilitySnapshot",
    source_columns=(
        "id",
        "fixtureId",
        "marketSelectionId",
        "calculatedAtUtc",
        "probability",
        "overround",
        "marginRemovalMethod",
        "inputSetHash",
    ),
    output_columns=(
        "market_probability_id",
        "fixture_id",
        "market_key",
        "selection_key",
        "calculated_at_utc",
        "probability",
        "overround",
        "no_vig_method",
        "input_hash",
    ),
    output_types=(
        "string",
        "string",
        "string",
        "string",
        "timestamp",
        "float",
        "float",
        "string",
        "string",
    ),
    availability_column="calculatedAtUtc",
    conceptual_primary_key=("id",),
    fixture_foreign_key="fixtureId",
    cutoff_filter="calculatedAtUtc <= cutoff_at_utc",
    prematch_allowed=True,
    evaluation_only=False,
    select_sql="""
        SELECT
            mp."id" AS "market_probability_id",
            mp."fixtureId" AS "fixture_id",
            md."stableKey" AS "market_key",
            ms."stableKey" AS "selection_key",
            mp."calculatedAtUtc" AS "calculated_at_utc",
            mp."probability" AS "probability",
            mp."overround" AS "overround",
            mp."marginRemovalMethod" AS "no_vig_method",
            mp."inputSetHash" AS "input_hash"
        FROM "MarketProbabilitySnapshot" AS mp
        JOIN "MarketSelection" AS ms ON ms."id" = mp."marketSelectionId"
        JOIN "MarketDefinition" AS md ON md."id" = ms."marketDefinitionId"
        WHERE utc_epoch_micros(mp."calculatedAtUtc") <= ?
        ORDER BY mp."fixtureId", mp."calculatedAtUtc", mp."id"
    """,
    total_count_sql=('SELECT COUNT("id") AS "row_count" FROM "MarketProbabilitySnapshot"'),
    eligible_count_sql=(
        'SELECT COUNT("id") AS "row_count" FROM "MarketProbabilitySnapshot" '
        'WHERE utc_epoch_micros("calculatedAtUtc") <= ?'
    ),
    cutoff_parameter_count=1,
)

DECISIONS = TableMapping(
    output_table="prematch_decisions",
    source_table="PreMatchDecision",
    source_columns=(
        "id",
        "fixtureId",
        "decidedAtUtc",
        "status",
        "reasonCode",
        "selectedOddsSnapshotId",
        "estimatedProbability",
        "breakEvenProbability",
        "estimatedEdge",
        "policyVersion",
        "inputHash",
    ),
    output_columns=(
        "decision_id",
        "fixture_id",
        "decided_at_utc",
        "decision_status",
        "reason_code",
        "selected_odds_snapshot_id",
        "estimated_probability",
        "break_even_probability",
        "estimated_edge",
        "policy_version",
        "input_hash",
    ),
    output_types=(
        "string",
        "string",
        "timestamp",
        "string",
        "string",
        "string",
        "float",
        "float",
        "float",
        "string",
        "string",
    ),
    availability_column="decidedAtUtc",
    conceptual_primary_key=("id",),
    fixture_foreign_key="fixtureId",
    cutoff_filter="decidedAtUtc <= cutoff_at_utc",
    prematch_allowed=True,
    evaluation_only=False,
    select_sql="""
        SELECT
            "id" AS "decision_id",
            "fixtureId" AS "fixture_id",
            "decidedAtUtc" AS "decided_at_utc",
            "status" AS "decision_status",
            "reasonCode" AS "reason_code",
            "selectedOddsSnapshotId" AS "selected_odds_snapshot_id",
            "estimatedProbability" AS "estimated_probability",
            "breakEvenProbability" AS "break_even_probability",
            "estimatedEdge" AS "estimated_edge",
            "policyVersion" AS "policy_version",
            "inputHash" AS "input_hash"
        FROM "PreMatchDecision"
        WHERE utc_epoch_micros("decidedAtUtc") <= ?
        ORDER BY "fixtureId", "decidedAtUtc", "id"
    """,
    total_count_sql='SELECT COUNT("id") AS "row_count" FROM "PreMatchDecision"',
    eligible_count_sql=(
        'SELECT COUNT("id") AS "row_count" FROM "PreMatchDecision" '
        'WHERE utc_epoch_micros("decidedAtUtc") <= ?'
    ),
    cutoff_parameter_count=1,
)

PREMATCH_MAPPINGS: tuple[TableMapping, ...] = (
    PREMATCH_FIXTURES,
    FOREBET,
    ODDS,
    MARKET_PROBABILITIES,
    DECISIONS,
)
