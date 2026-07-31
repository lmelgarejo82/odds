"""Evaluation-only mappings kept outside the prematch extraction module."""

from dataclasses import replace

from ou25_analytics.extraction.mappings import PREMATCH_FIXTURES, TableMapping

EVALUATION_FIXTURES = replace(
    PREMATCH_FIXTURES,
    cutoff_filter="referenced by an eligible prematch or outcome row at cutoff",
    select_sql=PREMATCH_FIXTURES.select_sql.replace(
        '\n        ORDER BY f."kickoffAtUtc", f."id"',
        """
        OR EXISTS (
            SELECT 1 FROM "Outcome" AS o
            WHERE o."fixtureId" = f."id" AND utc_epoch_micros(o."observedAtUtc") <= ?
        )
        ORDER BY f."kickoffAtUtc", f."id"
    """,
    ),
    eligible_count_sql=PREMATCH_FIXTURES.eligible_count_sql
    + """
        OR EXISTS (
            SELECT 1 FROM "Outcome" AS o
            WHERE o."fixtureId" = f."id" AND utc_epoch_micros(o."observedAtUtc") <= ?
        )""",
    cutoff_parameter_count=5,
)

OUTCOMES = TableMapping(
    output_table="outcomes",
    source_table="Outcome",
    source_columns=(
        "id",
        "fixtureId",
        "observedAtUtc",
        "homeScore",
        "awayScore",
        "result1X2",
        "status",
        "supersedesOutcomeId",
        "contentHash",
    ),
    output_columns=(
        "outcome_id",
        "fixture_id",
        "observed_at_utc",
        "home_score",
        "away_score",
        "result_1x2",
        "outcome_status",
        "supersedes_outcome_id",
        "content_hash",
    ),
    output_types=(
        "string",
        "string",
        "timestamp",
        "integer",
        "integer",
        "string",
        "string",
        "string",
        "string",
    ),
    availability_column="observedAtUtc",
    conceptual_primary_key=("id",),
    fixture_foreign_key="fixtureId",
    cutoff_filter="observedAtUtc <= cutoff_at_utc",
    prematch_allowed=False,
    evaluation_only=True,
    select_sql="""
        SELECT
            "id" AS "outcome_id",
            "fixtureId" AS "fixture_id",
            "observedAtUtc" AS "observed_at_utc",
            "homeScore" AS "home_score",
            "awayScore" AS "away_score",
            CASE "result1X2"
                WHEN 'HOME' THEN '1'
                WHEN 'DRAW' THEN 'X'
                WHEN 'AWAY' THEN '2'
                ELSE "result1X2"
            END AS "result_1x2",
            "status" AS "outcome_status",
            "supersedesOutcomeId" AS "supersedes_outcome_id",
            "contentHash" AS "content_hash"
        FROM "Outcome"
        WHERE utc_epoch_micros("observedAtUtc") <= ?
        ORDER BY "fixtureId", "observedAtUtc", "id"
    """,
    total_count_sql='SELECT COUNT("id") AS "row_count" FROM "Outcome"',
    eligible_count_sql=(
        'SELECT COUNT("id") AS "row_count" FROM "Outcome" '
        'WHERE utc_epoch_micros("observedAtUtc") <= ?'
    ),
    cutoff_parameter_count=1,
)
