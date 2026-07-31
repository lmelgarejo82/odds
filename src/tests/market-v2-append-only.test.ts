import { createRequire } from "node:module";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

type Statement = {
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
};

type TestDatabase = {
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
};

type DatabaseConstructor = new (path: string) => TestDatabase;

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: DatabaseConstructor;
};
const migrationSql = readFileSync(
  resolve(process.cwd(), "prisma/market-v2/migrations/20260731000000_initial/migration.sql"),
  "utf8",
);
const temporaryDirectories: string[] = [];

let database: TestDatabase;
let temporaryDirectory: string;

function insertPrematchFoundation(): void {
  database.exec(`
    INSERT INTO "SourceArtifact"
      ("id", "sourceName", "sourceReference", "sha256", "capturedAtUtc")
      VALUES ('artifact-1', 'TEST', 'memory://artifact-1', 'sha256-artifact-1', '2026-08-01T16:00:00Z');
    INSERT INTO "Team" ("id", "canonicalKey", "displayName") VALUES
      ('team-home', 'home', 'Home'),
      ('team-away', 'away', 'Away');
    INSERT INTO "Fixture"
      ("id", "localTeamId", "awayTeamId", "competitionKey", "kickoffAtUtc", "status", "sourceArtifactId")
      VALUES ('fixture-1', 'team-home', 'team-away', 'competition-1', '2026-08-01T18:00:00Z', 'SCHEDULED', 'artifact-1');
    INSERT INTO "Bookmaker" ("id", "stableKey", "name")
      VALUES ('bookmaker-1', 'bookmaker-1', 'Test Bookmaker');
    INSERT INTO "MarketDefinition" ("id", "stableKey", "version", "displayName")
      VALUES ('market-1x2-v1', 'MATCH_RESULT', 'v1', 'Match result');
    INSERT INTO "MarketSelection" ("id", "marketDefinitionId", "stableKey", "displayName")
      VALUES ('selection-home', 'market-1x2-v1', 'HOME', '1');
    INSERT INTO "OddsCaptureRun"
      ("id", "sourceName", "startedAtUtc", "completedAtUtc", "status", "policyVersion")
      VALUES ('odds-run-1', 'TEST', '2026-08-01T16:59:00Z', '2026-08-01T17:01:00Z', 'COMPLETED', 'capture-v1');
    INSERT INTO "OddsSnapshot"
      ("id", "fixtureId", "bookmakerId", "marketSelectionId", "oddsCaptureRunId", "capturedAtUtc", "decimalOdds", "marketStatus", "isInPlay", "sourceArtifactId", "contentHash")
      VALUES ('odds-1', 'fixture-1', 'bookmaker-1', 'selection-home', 'odds-run-1', '2026-08-01T17:00:00Z', 2.05, 'ACTIVE', 0, 'artifact-1', 'odds-hash-1');
  `);
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "ou25-market-v2-"));
  temporaryDirectories.push(temporaryDirectory);
  database = new DatabaseSync(join(temporaryDirectory, "market-v2-test.sqlite"));
  database.exec("PRAGMA foreign_keys = ON;");
  database.exec(migrationSql);
  insertPrematchFoundation();
});

afterEach(() => {
  database.close();
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

afterAll(() => {
  expect(temporaryDirectories.every((directory) => !existsSync(directory))).toBe(true);
});

describe("Market V2 SQLite append-only enforcement", () => {
  it("rejects UPDATE and DELETE for an odds snapshot", () => {
    expect(() =>
      database.exec('UPDATE "OddsSnapshot" SET "decimalOdds" = 2.10 WHERE "id" = \'odds-1\';'),
    ).toThrow(/MARKET_V2_APPEND_ONLY: OddsSnapshot UPDATE rejected/);
    expect(() => database.exec('DELETE FROM "OddsSnapshot" WHERE "id" = \'odds-1\';')).toThrow(
      /MARKET_V2_APPEND_ONLY: OddsSnapshot DELETE rejected/,
    );
  });

  it("rejects UPDATE and DELETE for a persisted decision", () => {
    database.exec(`
      INSERT INTO "PreMatchDecision"
        ("id", "fixtureId", "decidedAtUtc", "status", "reasonCode", "policyVersion", "inputHash", "selectedOddsSnapshotId")
        VALUES ('decision-1', 'fixture-1', '2026-08-01T17:30:00Z', 'SELECTED', 'EDGE_ACCEPTED', 'decision-v1', 'decision-input-hash', 'odds-1');
    `);

    expect(() =>
      database.exec(
        'UPDATE "PreMatchDecision" SET "reasonCode" = \'CHANGED\' WHERE "id" = \'decision-1\';',
      ),
    ).toThrow(/MARKET_V2_APPEND_ONLY: PreMatchDecision UPDATE rejected/);
    expect(() =>
      database.exec('DELETE FROM "PreMatchDecision" WHERE "id" = \'decision-1\';'),
    ).toThrow(/MARKET_V2_APPEND_ONLY: PreMatchDecision DELETE rejected/);
  });

  it("keeps the original outcome intact after an append-only correction", () => {
    database.exec(`
      INSERT INTO "Outcome"
        ("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "status", "sourceArtifactId", "contentHash")
        VALUES ('outcome-1', 'fixture-1', '2026-08-01T20:00:00Z', 1, 1, 'DRAW', 'PROVISIONAL', 'artifact-1', 'outcome-hash-1');
      INSERT INTO "Outcome"
        ("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "status", "sourceArtifactId", "supersedesOutcomeId", "contentHash")
        VALUES ('outcome-2', 'fixture-1', '2026-08-01T20:05:00Z', 2, 1, 'HOME', 'CORRECTED', 'artifact-1', 'outcome-1', 'outcome-hash-2');
    `);

    expect(
      database.prepare(
        'SELECT "homeScore", "awayScore", "status" FROM "Outcome" WHERE "id" = \'outcome-1\'',
      ).get(),
    ).toEqual({ homeScore: 1, awayScore: 1, status: "PROVISIONAL" });
    expect(
      database.prepare(
        'SELECT "supersedesOutcomeId" FROM "Outcome" WHERE "id" = \'outcome-2\'',
      ).get(),
    ).toEqual({ supersedesOutcomeId: "outcome-1" });

    for (const id of ["outcome-1", "outcome-2"]) {
      expect(() =>
        database.exec(`UPDATE "Outcome" SET "status" = 'CONFIRMED' WHERE "id" = '${id}';`),
      ).toThrow(/MARKET_V2_APPEND_ONLY: Outcome UPDATE rejected/);
      expect(() => database.exec(`DELETE FROM "Outcome" WHERE "id" = '${id}';`)).toThrow(
        /MARKET_V2_APPEND_ONLY: Outcome DELETE rejected/,
      );
    }
  });

  it("installs deterministic barriers for every protected table", () => {
    const triggers = database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = triggers.map(({ name }) => name);
    for (const table of [
      "SourceArtifact",
      "ForebetSnapshot",
      "OddsSnapshot",
      "MarketProbabilitySnapshot",
      "MarketProbabilityInput",
      "PreMatchDecision",
      "Outcome",
      "Settlement",
    ]) {
      expect(names).toContain(`market_v2_${table}_no_update`);
      expect(names).toContain(`market_v2_${table}_no_delete`);
    }
  });
});
