"""Allowlisted SQLite schema inspection and deterministic fingerprinting."""

import hashlib
import json
import re
from dataclasses import dataclass

from ou25_analytics.extraction.profiles import ExportProfile
from ou25_analytics.extraction.sqlite_source import (
    FrozenSQLiteSource,
    SQLiteSchemaIncompatible,
)

KNOWN_MARKET_V2_TABLES = frozenset(
    {
        "ImportBatch",
        "SourceArtifact",
        "Team",
        "TeamAlias",
        "Fixture",
        "ForebetSnapshot",
        "Bookmaker",
        "MarketDefinition",
        "MarketSelection",
        "OddsCaptureRun",
        "OddsSnapshot",
        "MarketProbabilitySnapshot",
        "MarketProbabilityInput",
        "PreMatchDecision",
        "Outcome",
        "Settlement",
        "EvaluationRun",
        "DecisionEvaluation",
    }
)

PREMATCH_SCHEMA_TABLES = (
    "Fixture",
    "ForebetSnapshot",
    "Bookmaker",
    "MarketDefinition",
    "MarketSelection",
    "OddsSnapshot",
    "MarketProbabilitySnapshot",
    "PreMatchDecision",
)
EVALUATION_SCHEMA_TABLES = (*PREMATCH_SCHEMA_TABLES, "Outcome")

REQUIRED_COLUMN_TYPES: dict[str, dict[str, frozenset[str]]] = {
    "Fixture": {
        "id": frozenset({"TEXT"}),
        "localTeamId": frozenset({"TEXT"}),
        "awayTeamId": frozenset({"TEXT"}),
        "competitionKey": frozenset({"TEXT"}),
        "kickoffAtUtc": frozenset({"DATETIME", "TEXT"}),
        "status": frozenset({"TEXT"}),
    },
    "ForebetSnapshot": {
        "id": frozenset({"TEXT"}),
        "fixtureId": frozenset({"TEXT"}),
        "capturedAtUtc": frozenset({"DATETIME", "TEXT"}),
        "homeProbability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "drawProbability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "awayProbability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "parserVersion": frozenset({"TEXT"}),
        "contentHash": frozenset({"TEXT"}),
    },
    "Bookmaker": {"id": frozenset({"TEXT"}), "stableKey": frozenset({"TEXT"})},
    "MarketDefinition": {"id": frozenset({"TEXT"}), "stableKey": frozenset({"TEXT"})},
    "MarketSelection": {
        "id": frozenset({"TEXT"}),
        "marketDefinitionId": frozenset({"TEXT"}),
        "stableKey": frozenset({"TEXT"}),
    },
    "OddsSnapshot": {
        "id": frozenset({"TEXT"}),
        "fixtureId": frozenset({"TEXT"}),
        "bookmakerId": frozenset({"TEXT"}),
        "marketSelectionId": frozenset({"TEXT"}),
        "capturedAtUtc": frozenset({"DATETIME", "TEXT"}),
        "decimalOdds": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "marketStatus": frozenset({"TEXT"}),
        "isInPlay": frozenset({"BOOLEAN", "INTEGER"}),
        "contentHash": frozenset({"TEXT"}),
    },
    "MarketProbabilitySnapshot": {
        "id": frozenset({"TEXT"}),
        "fixtureId": frozenset({"TEXT"}),
        "marketSelectionId": frozenset({"TEXT"}),
        "marginRemovalMethod": frozenset({"TEXT"}),
        "overround": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "probability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "calculatedAtUtc": frozenset({"DATETIME", "TEXT"}),
        "inputSetHash": frozenset({"TEXT"}),
    },
    "PreMatchDecision": {
        "id": frozenset({"TEXT"}),
        "fixtureId": frozenset({"TEXT"}),
        "decidedAtUtc": frozenset({"DATETIME", "TEXT"}),
        "status": frozenset({"TEXT"}),
        "reasonCode": frozenset({"TEXT"}),
        "policyVersion": frozenset({"TEXT"}),
        "inputHash": frozenset({"TEXT"}),
        "selectedOddsSnapshotId": frozenset({"TEXT"}),
        "estimatedProbability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "breakEvenProbability": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
        "estimatedEdge": frozenset({"DECIMAL", "REAL", "NUMERIC"}),
    },
    "Outcome": {
        "id": frozenset({"TEXT"}),
        "fixtureId": frozenset({"TEXT"}),
        "observedAtUtc": frozenset({"DATETIME", "TEXT"}),
        "homeScore": frozenset({"INTEGER"}),
        "awayScore": frozenset({"INTEGER"}),
        "result1X2": frozenset({"TEXT"}),
        "status": frozenset({"TEXT"}),
        "supersedesOutcomeId": frozenset({"TEXT"}),
        "contentHash": frozenset({"TEXT"}),
    },
}

_TABLE_INFO_SQL = {
    "Fixture": 'PRAGMA table_info("Fixture")',
    "ForebetSnapshot": 'PRAGMA table_info("ForebetSnapshot")',
    "Bookmaker": 'PRAGMA table_info("Bookmaker")',
    "MarketDefinition": 'PRAGMA table_info("MarketDefinition")',
    "MarketSelection": 'PRAGMA table_info("MarketSelection")',
    "OddsSnapshot": 'PRAGMA table_info("OddsSnapshot")',
    "MarketProbabilitySnapshot": 'PRAGMA table_info("MarketProbabilitySnapshot")',
    "PreMatchDecision": 'PRAGMA table_info("PreMatchDecision")',
    "Outcome": 'PRAGMA table_info("Outcome")',
}
_FOREIGN_KEY_SQL = {
    "Fixture": 'PRAGMA foreign_key_list("Fixture")',
    "ForebetSnapshot": 'PRAGMA foreign_key_list("ForebetSnapshot")',
    "Bookmaker": 'PRAGMA foreign_key_list("Bookmaker")',
    "MarketDefinition": 'PRAGMA foreign_key_list("MarketDefinition")',
    "MarketSelection": 'PRAGMA foreign_key_list("MarketSelection")',
    "OddsSnapshot": 'PRAGMA foreign_key_list("OddsSnapshot")',
    "MarketProbabilitySnapshot": 'PRAGMA foreign_key_list("MarketProbabilitySnapshot")',
    "PreMatchDecision": 'PRAGMA foreign_key_list("PreMatchDecision")',
    "Outcome": 'PRAGMA foreign_key_list("Outcome")',
}
_UNKNOWN_TABLE_SQL = """
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name NOT LIKE 'sqlite_%'
      AND name NOT IN (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ORDER BY name
"""


@dataclass(frozen=True)
class SQLiteSchemaMetadata:
    """Profile-scoped schema identity."""

    user_version: int
    schema_version: int
    fingerprint: str
    inspected_tables: tuple[str, ...]


def _normalize_sql(sql: str) -> str:
    return re.sub(r"\s+", " ", sql).strip()


def inspect_schema(source: FrozenSQLiteSource, *, profile: ExportProfile) -> SQLiteSchemaMetadata:
    """Reject unknown/incompatible schema and fingerprint only profile-visible tables."""

    table_rows = source._fetch_trusted(  # noqa: SLF001 - same extraction boundary
        _UNKNOWN_TABLE_SQL, tuple(sorted(KNOWN_MARKET_V2_TABLES))
    )
    unknown = [str(row["name"]) for row in table_rows]
    if unknown:
        raise SQLiteSchemaIncompatible(f"SQLITE_SCHEMA_INCOMPATIBLE: unknown tables: {unknown}")
    active = (
        PREMATCH_SCHEMA_TABLES if profile is ExportProfile.PREMATCH else EVALUATION_SCHEMA_TABLES
    )
    fingerprint_tables: list[dict[str, object]] = []
    for table_name in active:
        sql_row = source._fetch_trusted(  # noqa: SLF001
            "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?", (table_name,)
        )
        if len(sql_row) != 1 or sql_row[0]["sql"] is None:
            raise SQLiteSchemaIncompatible(
                f"SQLITE_SCHEMA_INCOMPATIBLE: missing table {table_name}"
            )
        column_rows = source._fetch_trusted(_TABLE_INFO_SQL[table_name])  # noqa: SLF001
        columns = {str(row["name"]): str(row["type"]).upper() for row in column_rows}
        missing_columns = sorted(set(REQUIRED_COLUMN_TYPES[table_name]).difference(columns))
        if missing_columns:
            raise SQLiteSchemaIncompatible(
                f"SQLITE_SCHEMA_INCOMPATIBLE: {table_name} missing columns {missing_columns}"
            )
        incompatible = sorted(
            column
            for column, accepted in REQUIRED_COLUMN_TYPES[table_name].items()
            if columns[column] not in accepted
        )
        if incompatible:
            raise SQLiteSchemaIncompatible(
                f"SQLITE_SCHEMA_INCOMPATIBLE: {table_name} incompatible columns {incompatible}"
            )
        foreign_keys = [dict(row) for row in source._fetch_trusted(_FOREIGN_KEY_SQL[table_name])]  # noqa: SLF001
        fingerprint_tables.append(
            {
                "name": table_name,
                "columns": [dict(row) for row in column_rows],
                "foreign_keys": foreign_keys,
                "sql": _normalize_sql(str(sql_row[0]["sql"])),
            }
        )

    payload = json.dumps(fingerprint_tables, sort_keys=True, separators=(",", ":"))
    fingerprint = hashlib.sha256(payload.encode()).hexdigest()
    return SQLiteSchemaMetadata(
        user_version=source._scalar_int("PRAGMA user_version"),  # noqa: SLF001
        schema_version=source._scalar_int("PRAGMA schema_version"),  # noqa: SLF001
        fingerprint=fingerprint,
        inspected_tables=tuple(active),
    )
