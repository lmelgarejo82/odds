"""Deterministic SQLite fixture factory; never contains real sporting data."""

import hashlib
import sqlite3
from datetime import UTC, datetime, timedelta
from pathlib import Path


def _hash(value: str) -> str:
    return hashlib.sha256(value.encode()).hexdigest()


def _utc(value: datetime) -> str:
    return value.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


_SCHEMA_SQL = """
PRAGMA foreign_keys=ON;
PRAGMA journal_mode=DELETE;
PRAGMA user_version=2;
CREATE TABLE "Team" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "canonicalKey" TEXT NOT NULL UNIQUE,
    "displayName" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL
);
CREATE TABLE "Fixture" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "localTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "competitionKey" TEXT NOT NULL,
    "kickoffAtUtc" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "sourceArtifactId" TEXT,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("localTeamId") REFERENCES "Team" ("id"),
    FOREIGN KEY ("awayTeamId") REFERENCES "Team" ("id")
);
CREATE TABLE "ForebetSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "homeProbability" DECIMAL NOT NULL,
    "drawProbability" DECIMAL NOT NULL,
    "awayProbability" DECIMAL NOT NULL,
    "predictedScore" TEXT,
    "sourceArtifactId" TEXT NOT NULL,
    "parserVersion" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id")
);
CREATE TABLE "Bookmaker" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL UNIQUE,
    "name" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL
);
CREATE TABLE "MarketDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "stableKey" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parameters" TEXT,
    "createdAtUtc" DATETIME NOT NULL
);
CREATE TABLE "MarketSelection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "marketDefinitionId" TEXT NOT NULL,
    "stableKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "parameters" TEXT,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("marketDefinitionId") REFERENCES "MarketDefinition" ("id")
);
CREATE TABLE "OddsSnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "bookmakerId" TEXT NOT NULL,
    "marketSelectionId" TEXT NOT NULL,
    "oddsCaptureRunId" TEXT NOT NULL,
    "capturedAtUtc" DATETIME NOT NULL,
    "decimalOdds" DECIMAL NOT NULL,
    "rawOdds" TEXT,
    "lineValue" DECIMAL,
    "marketStatus" TEXT NOT NULL,
    "isInPlay" BOOLEAN NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id"),
    FOREIGN KEY ("bookmakerId") REFERENCES "Bookmaker" ("id"),
    FOREIGN KEY ("marketSelectionId") REFERENCES "MarketSelection" ("id")
);
CREATE TABLE "MarketProbabilitySnapshot" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "marketSelectionId" TEXT NOT NULL,
    "marginRemovalMethod" TEXT NOT NULL,
    "overround" DECIMAL NOT NULL,
    "probability" DECIMAL NOT NULL,
    "calculatedAtUtc" DATETIME NOT NULL,
    "version" TEXT NOT NULL,
    "inputSetHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id"),
    FOREIGN KEY ("marketSelectionId") REFERENCES "MarketSelection" ("id")
);
CREATE TABLE "PreMatchDecision" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "decidedAtUtc" DATETIME NOT NULL,
    "status" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "inputHash" TEXT NOT NULL,
    "selectedOddsSnapshotId" TEXT,
    "estimatedProbability" DECIMAL,
    "breakEvenProbability" DECIMAL,
    "estimatedEdge" DECIMAL,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id"),
    FOREIGN KEY ("selectedOddsSnapshotId") REFERENCES "OddsSnapshot" ("id")
);
CREATE TABLE "Outcome" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "fixtureId" TEXT NOT NULL,
    "observedAtUtc" DATETIME NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "awayScore" INTEGER NOT NULL,
    "result1X2" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceArtifactId" TEXT NOT NULL,
    "supersedesOutcomeId" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAtUtc" DATETIME NOT NULL,
    FOREIGN KEY ("fixtureId") REFERENCES "Fixture" ("id"),
    FOREIGN KEY ("supersedesOutcomeId") REFERENCES "Outcome" ("id")
);
"""


def create_synthetic_sqlite(root: Path, *, seed: int) -> Path:
    """Create, close and return one extraction-compatible synthetic SQLite source."""

    if not root.is_absolute():
        raise ValueError("synthetic root must be absolute")
    root.mkdir(parents=True, exist_ok=True)
    database = root / "synthetic-source.sqlite"
    if database.exists():
        raise FileExistsError(f"synthetic database already exists: {database}")
    connection = sqlite3.connect(database)
    try:
        connection.executescript(_SCHEMA_SQL)
        created = datetime(2026, 1, 1, tzinfo=UTC)
        cutoff = datetime(2026, 1, 15, 12, tzinfo=UTC)
        fixtures = (
            ("SYNTH_SQL_FIXTURE_01", datetime(2026, 1, 14, 18, tzinfo=UTC), "FINISHED"),
            ("SYNTH_SQL_FIXTURE_02", datetime(2026, 1, 16, 18, tzinfo=UTC), "SCHEDULED"),
            ("SYNTH_SQL_FIXTURE_03", datetime(2026, 1, 17, 18, tzinfo=UTC), "SCHEDULED"),
            ("SYNTH_SQL_FIXTURE_04", datetime(2026, 1, 13, 18, tzinfo=UTC), "FINISHED"),
        )
        team_rows = []
        fixture_rows = []
        for index, (fixture_id, kickoff, status) in enumerate(fixtures, start=1):
            home_id = f"SYNTH_SQL_TEAM_{index * 2 - 1:02d}"
            away_id = f"SYNTH_SQL_TEAM_{index * 2:02d}"
            team_rows.extend(
                [
                    (home_id, home_id, f"Synthetic Home {index}", _utc(created)),
                    (away_id, away_id, f"Synthetic Away {index}", _utc(created)),
                ]
            )
            fixture_rows.append(
                (
                    fixture_id,
                    home_id,
                    away_id,
                    "SYNTH_SQL_COMPETITION",
                    _utc(kickoff),
                    status,
                    None,
                    _utc(created),
                )
            )
        connection.executemany(
            'INSERT INTO "Team" ("id", "canonicalKey", "displayName", "createdAtUtc") '
            "VALUES (?, ?, ?, ?)",
            team_rows,
        )
        connection.executemany(
            'INSERT INTO "Fixture" ("id", "localTeamId", "awayTeamId", "competitionKey", '
            '"kickoffAtUtc", "status", "sourceArtifactId", "createdAtUtc") '
            "VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            fixture_rows,
        )
        connection.executemany(
            'INSERT INTO "Bookmaker" ("id", "stableKey", "name", "createdAtUtc") '
            "VALUES (?, ?, ?, ?)",
            [
                ("SYNTH_BOOK_1", "SYNTH_BOOK_A", "Synthetic Book A", _utc(created)),
                ("SYNTH_BOOK_2", "SYNTH_BOOK_B", "Synthetic Book B", _utc(created)),
            ],
        )
        connection.executemany(
            'INSERT INTO "MarketDefinition" '
            '("id", "stableKey", "version", "displayName", "parameters", "createdAtUtc") '
            "VALUES (?, ?, ?, ?, ?, ?)",
            [
                ("SYNTH_MD_1X2", "MATCH_RESULT", "1", "Synthetic 1X2", None, _utc(created)),
                ("SYNTH_MD_DC", "DOUBLE_CHANCE", "1", "Synthetic DC", None, _utc(created)),
            ],
        )
        selection_rows = [
            ("SYNTH_SEL_1", "SYNTH_MD_1X2", "1", "Synthetic Home", None, _utc(created)),
            ("SYNTH_SEL_X", "SYNTH_MD_1X2", "X", "Synthetic Draw", None, _utc(created)),
            ("SYNTH_SEL_2", "SYNTH_MD_1X2", "2", "Synthetic Away", None, _utc(created)),
            ("SYNTH_SEL_1X", "SYNTH_MD_DC", "1X", "Synthetic 1X", None, _utc(created)),
        ]
        connection.executemany(
            'INSERT INTO "MarketSelection" '
            '("id", "marketDefinitionId", "stableKey", "displayName", "parameters", '
            '"createdAtUtc") VALUES (?, ?, ?, ?, ?, ?)',
            selection_rows,
        )

        availability = {
            "SYNTH_SQL_FIXTURE_01": datetime(2026, 1, 14, 10, tzinfo=UTC),
            "SYNTH_SQL_FIXTURE_02": cutoff,
            "SYNTH_SQL_FIXTURE_03": cutoff + timedelta(microseconds=1),
            "SYNTH_SQL_FIXTURE_04": datetime(2026, 1, 12, 10, tzinfo=UTC),
        }
        statuses = ("SELECTED", "ABSTAINED", "BLOCKED", "UNRESOLVED")
        for index, (fixture_id, kickoff, _) in enumerate(fixtures, start=1):
            observed = availability[fixture_id]
            connection.execute(
                'INSERT INTO "ForebetSnapshot" '
                '("id", "fixtureId", "capturedAtUtc", "homeProbability", '
                '"drawProbability", "awayProbability", "predictedScore", "sourceArtifactId", '
                '"parserVersion", "contentHash", "createdAtUtc") '
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    f"SYNTH_SQL_FOREBET_{index:02d}",
                    fixture_id,
                    _utc(observed),
                    0.5,
                    0.3,
                    0.2,
                    None,
                    "SYNTH_ARTIFACT",
                    "synthetic-parser-v1",
                    _hash(f"forebet-{seed}-{index}"),
                    _utc(created),
                ),
            )
            odds_time = min(observed, kickoff - timedelta(hours=26))
            odds_ids: dict[str, str] = {}
            for selection_id, selection_key, price in (
                ("SYNTH_SEL_1", "1", 2.1),
                ("SYNTH_SEL_X", "X", 3.4),
                ("SYNTH_SEL_2", "2", 3.8),
                ("SYNTH_SEL_1X", "1X", 1.5),
            ):
                odds_id = f"SYNTH_SQL_ODDS_{index:02d}_{selection_key}"
                odds_ids[selection_key] = odds_id
                market_status = (
                    "SUSPENDED"
                    if fixture_id == "SYNTH_SQL_FIXTURE_02" and selection_key == "2"
                    else "ACTIVE"
                )
                connection.execute(
                    'INSERT INTO "OddsSnapshot" '
                    '("id", "fixtureId", "bookmakerId", "marketSelectionId", '
                    '"oddsCaptureRunId", "capturedAtUtc", "decimalOdds", "rawOdds", '
                    '"lineValue", "marketStatus", "isInPlay", "sourceArtifactId", '
                    '"contentHash", "createdAtUtc") '
                    "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                    (
                        odds_id,
                        fixture_id,
                        "SYNTH_BOOK_1",
                        selection_id,
                        "SYNTH_RUN",
                        _utc(odds_time),
                        price,
                        None,
                        None,
                        market_status,
                        0,
                        "SYNTH_ARTIFACT",
                        _hash(f"odds-{seed}-{index}-{selection_key}"),
                        _utc(created),
                    ),
                )
                connection.execute(
                    'INSERT INTO "MarketProbabilitySnapshot" '
                    '("id", "fixtureId", "marketSelectionId", "marginRemovalMethod", '
                    '"overround", "probability", "calculatedAtUtc", "version", '
                    '"inputSetHash", "createdAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    (
                        f"SYNTH_SQL_PROB_{index:02d}_{selection_key}",
                        fixture_id,
                        selection_id,
                        "PROPORTIONAL" if selection_key != "1X" else "BREAK_EVEN",
                        1.05 if selection_key != "1X" else 1.0,
                        {"1": 0.45, "X": 0.27, "2": 0.28, "1X": 0.72}[selection_key],
                        _utc(observed),
                        "synthetic-v1",
                        _hash(f"probability-{seed}-{index}-{selection_key}"),
                        _utc(created),
                    ),
                )
            status = statuses[index - 1]
            selected_id = odds_ids["1X"] if status == "SELECTED" else None
            connection.execute(
                'INSERT INTO "PreMatchDecision" '
                '("id", "fixtureId", "decidedAtUtc", "status", "reasonCode", '
                '"policyVersion", "inputHash", "selectedOddsSnapshotId", '
                '"estimatedProbability", "breakEvenProbability", "estimatedEdge", '
                '"createdAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                (
                    f"SYNTH_SQL_DECISION_{index:02d}",
                    fixture_id,
                    _utc(observed),
                    status,
                    f"SYNTH_{status}",
                    "synthetic-policy-v1",
                    _hash(f"decision-{seed}-{index}"),
                    selected_id,
                    0.8 if selected_id else None,
                    2 / 3 if selected_id else None,
                    0.8 - (2 / 3) if selected_id else None,
                    _utc(created),
                ),
            )

        outcome_rows = [
            (
                "SYNTH_SQL_OUTCOME_04_V1",
                "SYNTH_SQL_FIXTURE_04",
                _utc(datetime(2026, 1, 13, 21, tzinfo=UTC)),
                1,
                1,
                "DRAW",
                "PROVISIONAL",
                "SYNTH_ARTIFACT",
                None,
                _hash(f"outcome-{seed}-4-v1"),
                _utc(created),
            ),
            (
                "SYNTH_SQL_OUTCOME_04_V2",
                "SYNTH_SQL_FIXTURE_04",
                _utc(datetime(2026, 1, 13, 22, tzinfo=UTC)),
                2,
                1,
                "HOME",
                "CORRECTED",
                "SYNTH_ARTIFACT",
                "SYNTH_SQL_OUTCOME_04_V1",
                _hash(f"outcome-{seed}-4-v2"),
                _utc(created),
            ),
            (
                "SYNTH_SQL_OUTCOME_01_V1",
                "SYNTH_SQL_FIXTURE_01",
                _utc(cutoff),
                2,
                0,
                "HOME",
                "CONFIRMED",
                "SYNTH_ARTIFACT",
                None,
                _hash(f"outcome-{seed}-1-v1"),
                _utc(created),
            ),
            (
                "SYNTH_SQL_OUTCOME_02_V1",
                "SYNTH_SQL_FIXTURE_02",
                _utc(datetime(2026, 1, 16, 21, tzinfo=UTC)),
                0,
                1,
                "AWAY",
                "CONFIRMED",
                "SYNTH_ARTIFACT",
                None,
                _hash(f"outcome-{seed}-2-v1"),
                _utc(created),
            ),
        ]
        connection.executemany(
            'INSERT INTO "Outcome" '
            '("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", '
            '"result1X2", "status", "sourceArtifactId", "supersedesOutcomeId", '
            '"contentHash", "createdAtUtc") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            outcome_rows,
        )
        connection.commit()
    finally:
        connection.close()
    for suffix in ("-wal", "-shm", "-journal"):
        sidecar = Path(f"{database}{suffix}")
        if sidecar.exists():
            raise RuntimeError(f"synthetic SQLite did not freeze cleanly: {sidecar}")
    return database
