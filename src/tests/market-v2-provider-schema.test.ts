import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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

const repositoryRoot = process.cwd();
const schemaPath = resolve(repositoryRoot, "prisma/market-v2/schema.prisma");
const prismaCliPath = resolve(repositoryRoot, "node_modules/prisma/build/index.js");
const migrationsRoot = resolve(repositoryRoot, "prisma/market-v2/migrations");
const migrationDirectories = readdirSync(migrationsRoot)
  .filter((name) => /^\d{14}_.+/.test(name))
  .sort();
const providerMigrationDirectory = migrationDirectories.find((name) =>
  name.endsWith("_add_provider_prediction_models"),
);
if (providerMigrationDirectory === undefined) {
  throw new Error("provider prediction migration is missing");
}
const migrationSources = migrationDirectories.map((directory) =>
  readFileSync(resolve(migrationsRoot, directory, "migration.sql"), "utf8"),
);
const providerMigrationSource = readFileSync(
  resolve(migrationsRoot, providerMigrationDirectory, "migration.sql"),
  "utf8",
);
const schemaSource = readFileSync(schemaPath, "utf8");
const temporaryDirectories: string[] = [];

let database: TestDatabase | null = null;
let temporaryDirectory = "";
let temporaryDatabasePath = "";

function currentDatabase(): TestDatabase {
  if (database === null) throw new Error("temporary database is not initialized");
  return database;
}

function insertSyntheticFoundation(): void {
  currentDatabase().exec(`
    INSERT INTO "ImportBatch"
      ("id", "sourceType", "startedAtUtc", "status", "policyVersion")
      VALUES ('synthetic-batch-1', 'SYNTHETIC_PROVIDER', '2030-01-01T10:00:00Z', 'STARTED', 'synthetic-policy/1.0');
    INSERT INTO "SourceArtifact"
      ("id", "importBatchId", "sourceName", "sourceReference", "sha256", "capturedAtUtc")
      VALUES ('synthetic-artifact-1', 'synthetic-batch-1', 'SYNTHETIC_PROVIDER', 'synthetic:artifact:1', 'synthetic-hash-1', '2030-01-01T10:00:00Z');
    INSERT INTO "Team" ("id", "canonicalKey", "displayName") VALUES
      ('synthetic-team-home', 'synthetic-home', 'Synthetic Home FC'),
      ('synthetic-team-away', 'synthetic-away', 'Synthetic Away FC');
    INSERT INTO "Fixture"
      ("id", "localTeamId", "awayTeamId", "competitionKey", "kickoffAtUtc", "status", "sourceArtifactId")
      VALUES ('synthetic-fixture-1', 'synthetic-team-home', 'synthetic-team-away', 'synthetic-competition', '2030-01-01T18:00:00Z', 'SCHEDULED', 'synthetic-artifact-1');
    INSERT INTO "Provider" ("id", "stableKey", "displayName")
      VALUES ('synthetic-provider-1', 'synthetic-provider', 'Synthetic Provider');
    INSERT INTO "ProviderFixtureIdentity"
      ("id", "providerId", "providerFixtureId", "fixtureId", "providerCompetitionId", "providerHomeTeamId", "providerAwayTeamId", "season", "round", "sourceDateRaw", "sourceTimestamp", "sourceTimezone")
      VALUES ('synthetic-identity-1', 'synthetic-provider-1', 'SYNTHETIC_EXTERNAL_FIXTURE_1', 'synthetic-fixture-1', 'SYNTHETIC_COMP_1', 'SYNTHETIC_HOME_1', 'SYNTHETIC_AWAY_1', '2030', 'Synthetic Round 1', '2030-01-01T18:00:00+00:00', '1893520800', 'UTC');
    INSERT INTO "PredictionSnapshot"
      ("id", "providerFixtureIdentityId", "sourceArtifactId", "importBatchId", "capturedAtUtc", "predictionCapturedBeforeKickoff", "predictedWinnerProviderTeamId", "predictedWinnerName", "winnerComment", "advice", "underOverRaw", "probabilityTotalRaw", "contentHash", "parserVersion", "policyVersion")
      VALUES ('synthetic-prediction-1', 'synthetic-identity-1', 'synthetic-artifact-1', 'synthetic-batch-1', '2030-01-01T12:00:00Z', 1, 'SYNTHETIC_HOME_1', 'Synthetic Home FC', 'Synthetic metadata comment', 'Synthetic metadata advice', 'Synthetic under-over metadata', '100%', 'synthetic-prediction-hash-1', 'synthetic-parser/1.0', 'synthetic-policy/1.0');
    INSERT INTO "PredictionProbability"
      ("predictionSnapshotId", "selection", "rawPercentage", "normalizedProbability") VALUES
      ('synthetic-prediction-1', 'HOME', '45%', 0.45),
      ('synthetic-prediction-1', 'DRAW', '30%', 0.30),
      ('synthetic-prediction-1', 'AWAY', '25%', 0.25);
    INSERT INTO "ProviderRequestAudit"
      ("id", "providerId", "importBatchId", "endpointKey", "requestKeyHash", "correlationId", "attemptNumber", "startedAtUtc", "finishedAtUtc", "httpStatus", "classification", "dailyLimit", "dailyRemaining")
      VALUES ('synthetic-audit-1', 'synthetic-provider-1', 'synthetic-batch-1', 'fixtures-by-id', 'synthetic-request-hash-1', 'synthetic-correlation-1', 1, '2030-01-01T10:00:00Z', '2030-01-01T10:00:01Z', 200, 'SUCCESS', 100, 99);
  `);
}

function tableColumns(table: string): Array<{ name: string; type: string; pk: number }> {
  return currentDatabase().prepare(`PRAGMA table_info("${table}")`).all() as Array<{
    name: string;
    type: string;
    pk: number;
  }>;
}

function foreignKeyTables(table: string): string[] {
  return (
    currentDatabase().prepare(`PRAGMA foreign_key_list("${table}")`).all() as Array<{
      table: string;
    }>
  )
    .map((row) => row.table)
    .sort();
}

function indexNames(table: string): string[] {
  return (
    currentDatabase().prepare(`PRAGMA index_list("${table}")`).all() as Array<{
      name: string;
    }>
  ).map((row) => row.name);
}

beforeAll(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "ou25-market-v2-provider-schema-"));
  temporaryDirectories.push(temporaryDirectory);
  temporaryDatabasePath = join(temporaryDirectory, "provider-schema-test.sqlite");
  database = new DatabaseSync(temporaryDatabasePath);
  currentDatabase().exec("PRAGMA foreign_keys = ON;");
  for (const migrationSource of migrationSources) currentDatabase().exec(migrationSource);
  insertSyntheticFoundation();
});

afterAll(() => {
  database?.close();
  database = null;
  rmSync(temporaryDirectory, { recursive: true, force: true });
  expect(temporaryDirectories.every((directory) => !existsSync(directory))).toBe(true);
});

describe("Market V2 provider schema and migration", () => {
  // Prisma CLI may exceed Vitest's generic timeout on shared hosts; keep its child process bounded.
  it("validates the Prisma schema without generating a client", () => {
    const validation = spawnSync(
      process.execPath,
      [prismaCliPath, "validate", "--schema", schemaPath],
      {
        cwd: repositoryRoot,
        encoding: "utf8",
        timeout: 15_000,
        env: {
          NODE_ENV: "test",
          NO_UPDATE_NOTIFIER: "1",
          PRISMA_HIDE_UPDATE_MESSAGE: "1",
        },
      },
    );
    expect(validation.status).toBe(0);
  }, 20_000);

  it("applies all ordered Market V2 migrations to an empty temporary database", () => {
    expect(migrationDirectories.at(-1)).toBe(providerMigrationDirectory);
    expect(
      currentDatabase().prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'").get(),
    ).toMatchObject({ count: expect.any(Number) });
  });

  it("creates the five provider and prediction concepts", () => {
    const tables = (
      currentDatabase()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
    for (const table of [
      "Provider",
      "ProviderFixtureIdentity",
      "PredictionSnapshot",
      "PredictionProbability",
      "ProviderRequestAudit",
    ]) {
      expect(tables).toContain(table);
    }
  });

  it("adds only nullable semantic outcome columns", () => {
    const columns = tableColumns("Outcome").map((column) => column.name);
    for (const column of [
      "providerTerminalStatusRaw",
      "result1X2Scope",
      "regulationHomeScore",
      "regulationAwayScore",
      "extraTimeHomeScore",
      "extraTimeAwayScore",
      "penaltyHomeScore",
      "penaltyAwayScore",
      "shootoutWinner",
    ]) {
      expect(columns).toContain(column);
    }
  });

  it("installs the expected foreign keys", () => {
    expect(foreignKeyTables("ProviderFixtureIdentity")).toEqual(["Fixture", "Provider"]);
    expect(foreignKeyTables("PredictionSnapshot")).toEqual([
      "ImportBatch",
      "ProviderFixtureIdentity",
      "SourceArtifact",
    ]);
    expect(foreignKeyTables("PredictionProbability")).toEqual(["PredictionSnapshot"]);
    expect(foreignKeyTables("ProviderRequestAudit")).toEqual(["ImportBatch", "Provider"]);
  });

  it("installs the required unique indexes", () => {
    expect(indexNames("Provider")).toContain("Provider_stableKey_key");
    expect(indexNames("ProviderFixtureIdentity")).toContain(
      "ProviderFixtureIdentity_providerId_providerFixtureId_key",
    );
    expect(indexNames("PredictionSnapshot")).toContain(
      "PredictionSnapshot_providerFixtureIdentityId_capturedAtUtc_key",
    );
    expect(indexNames("ProviderRequestAudit")).toContain(
      "ProviderRequestAudit_requestKeyHash_attemptNumber_key",
    );
  });

  it("rejects a duplicate provider stableKey", () => {
    expect(() =>
      currentDatabase().exec(
        'INSERT INTO "Provider" ("id", "stableKey", "displayName") VALUES (\'synthetic-provider-2\', \'synthetic-provider\', \'Duplicate\');',
      ),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a duplicate provider and providerFixtureId pair", () => {
    expect(() =>
      currentDatabase().exec(`
        INSERT INTO "ProviderFixtureIdentity"
          ("id", "providerId", "providerFixtureId", "fixtureId")
          VALUES ('synthetic-identity-2', 'synthetic-provider-1', 'SYNTHETIC_EXTERNAL_FIXTURE_1', 'synthetic-fixture-1');
      `),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a duplicate identity and capturedAtUtc pair", () => {
    expect(() =>
      currentDatabase().exec(`
        INSERT INTO "PredictionSnapshot"
          ("id", "providerFixtureIdentityId", "sourceArtifactId", "capturedAtUtc", "predictionCapturedBeforeKickoff", "probabilityTotalRaw", "contentHash", "parserVersion", "policyVersion")
          VALUES ('synthetic-prediction-2', 'synthetic-identity-1', 'synthetic-artifact-1', '2030-01-01T12:00:00Z', 1, '100%', 'synthetic-prediction-hash-2', 'synthetic-parser/1.0', 'synthetic-policy/1.0');
      `),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a duplicate selection within a prediction snapshot", () => {
    expect(() =>
      currentDatabase().exec(`
        INSERT INTO "PredictionProbability"
          ("predictionSnapshotId", "selection", "rawPercentage", "normalizedProbability")
          VALUES ('synthetic-prediction-1', 'HOME', '46%', 0.46);
      `),
    ).toThrow(/UNIQUE constraint failed/);
  });

  it("rejects a duplicate request hash and attempt number", () => {
    expect(() =>
      currentDatabase().exec(`
        INSERT INTO "ProviderRequestAudit"
          ("id", "providerId", "endpointKey", "requestKeyHash", "correlationId", "attemptNumber", "startedAtUtc", "classification")
          VALUES ('synthetic-audit-2', 'synthetic-provider-1', 'fixtures-by-id', 'synthetic-request-hash-1', 'synthetic-correlation-2', 1, '2030-01-01T10:01:00Z', 'SUCCESS');
      `),
    ).toThrow(/UNIQUE constraint failed/);
  });
});

describe("Market V2 provider append-only barriers", () => {
  it.each([
    ["ProviderFixtureIdentity", "providerFixtureId", "SYNTHETIC_CHANGED", "synthetic-identity-1"],
    ["PredictionSnapshot", "contentHash", "synthetic-changed", "synthetic-prediction-1"],
    ["ProviderRequestAudit", "classification", "INVALID_RESPONSE", "synthetic-audit-1"],
  ] as const)("rejects UPDATE on %s", (table, column, value, id) => {
    expect(() =>
      currentDatabase().exec(
        `UPDATE "${table}" SET "${column}" = '${value}' WHERE "id" = '${id}';`,
      ),
    ).toThrow(new RegExp(`MARKET_V2_APPEND_ONLY: ${table} UPDATE rejected`));
  });

  it.each([
    ["ProviderFixtureIdentity", "synthetic-identity-1"],
    ["PredictionSnapshot", "synthetic-prediction-1"],
    ["ProviderRequestAudit", "synthetic-audit-1"],
  ] as const)("rejects DELETE on %s", (table, id) => {
    expect(() => currentDatabase().exec(`DELETE FROM "${table}" WHERE "id" = '${id}';`)).toThrow(
      new RegExp(`MARKET_V2_APPEND_ONLY: ${table} DELETE rejected`),
    );
  });

  it("rejects UPDATE on PredictionProbability", () => {
    expect(() =>
      currentDatabase().exec(`
        UPDATE "PredictionProbability" SET "rawPercentage" = '46%'
        WHERE "predictionSnapshotId" = 'synthetic-prediction-1' AND "selection" = 'HOME';
      `),
    ).toThrow(/MARKET_V2_APPEND_ONLY: PredictionProbability UPDATE rejected/);
  });

  it("rejects DELETE on PredictionProbability", () => {
    expect(() =>
      currentDatabase().exec(`
        DELETE FROM "PredictionProbability"
        WHERE "predictionSnapshotId" = 'synthetic-prediction-1' AND "selection" = 'HOME';
      `),
    ).toThrow(/MARKET_V2_APPEND_ONLY: PredictionProbability DELETE rejected/);
  });

  it("retains every pre-existing append-only trigger", () => {
    const names = (
      currentDatabase()
        .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger' ORDER BY name")
        .all() as Array<{ name: string }>
    ).map((row) => row.name);
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

describe("Market V2 provider schema semantics", () => {
  it("stores normalizedProbability as an exact decimal rather than Float", () => {
    const column = tableColumns("PredictionProbability").find(
      (candidate) => candidate.name === "normalizedProbability",
    );
    expect(column?.type).toBe("DECIMAL");
    expect(schemaSource).toContain("normalizedProbability Decimal");
    expect(schemaSource).not.toMatch(/normalizedProbability\s+Float/);
  });

  it("keeps provider predictions separate from MarketProbabilitySnapshot", () => {
    expect(foreignKeyTables("PredictionSnapshot")).not.toContain("MarketProbabilitySnapshot");
    expect(foreignKeyTables("PredictionProbability")).not.toContain(
      "MarketProbabilitySnapshot",
    );
  });

  it("keeps outcome and odds fields out of PredictionSnapshot", () => {
    const columns = tableColumns("PredictionSnapshot").map((column) => column.name);
    for (const forbidden of [
      "outcomeId",
      "result1X2",
      "oddsSnapshotId",
      "decimalOdds",
      "bookmakerId",
      "settlementId",
      "roi",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("keeps secrets, raw bodies, and full headers out of ProviderRequestAudit", () => {
    const columns = tableColumns("ProviderRequestAudit").map((column) =>
      column.name.toLowerCase(),
    );
    for (const forbidden of [
      "apikey",
      "token",
      "authorization",
      "cookie",
      "bodyraw",
      "responseraw",
      "headers",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("stores regulation, extra time, penalties, and shootout winner separately", () => {
    currentDatabase().exec(`
      INSERT INTO "Outcome"
        ("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "providerTerminalStatusRaw", "result1X2Scope", "regulationHomeScore", "regulationAwayScore", "extraTimeHomeScore", "extraTimeAwayScore", "penaltyHomeScore", "penaltyAwayScore", "shootoutWinner", "status", "sourceArtifactId", "contentHash")
        VALUES ('synthetic-outcome-pen', 'synthetic-fixture-1', '2030-01-01T21:00:00Z', 1, 1, 'DRAW', 'PEN', 'REGULATION_TIME', 1, 1, 1, 1, 5, 4, 'HOME', 'CONFIRMED', 'synthetic-artifact-1', 'synthetic-outcome-hash-pen');
    `);
    expect(
      currentDatabase()
        .prepare(`
          SELECT "result1X2", "regulationHomeScore", "regulationAwayScore",
                 "extraTimeHomeScore", "extraTimeAwayScore",
                 "penaltyHomeScore", "penaltyAwayScore", "shootoutWinner"
          FROM "Outcome" WHERE "id" = 'synthetic-outcome-pen'
        `)
        .get(),
    ).toEqual({
      result1X2: "DRAW",
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      extraTimeHomeScore: 1,
      extraTimeAwayScore: 1,
      penaltyHomeScore: 5,
      penaltyAwayScore: 4,
      shootoutWinner: "HOME",
    });
  });

  it("does not overwrite regulation result1X2 with shootoutWinner", () => {
    currentDatabase().exec(`
      INSERT INTO "Outcome"
        ("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "result1X2Scope", "regulationHomeScore", "regulationAwayScore", "penaltyHomeScore", "penaltyAwayScore", "shootoutWinner", "status", "sourceArtifactId", "contentHash")
        VALUES ('synthetic-outcome-separate', 'synthetic-fixture-1', '2030-01-01T21:00:00Z', 1, 1, 'DRAW', 'REGULATION_TIME', 1, 1, 5, 4, 'HOME', 'CONFIRMED', 'synthetic-artifact-1', 'synthetic-outcome-hash-separate');
    `);
    expect(
      currentDatabase()
        .prepare(
          'SELECT "result1X2", "shootoutWinner" FROM "Outcome" WHERE "id" = \'synthetic-outcome-separate\'',
        )
        .get(),
    ).toEqual({ result1X2: "DRAW", shootoutWinner: "HOME" });
  });

  it("stores providerFixtureId as TEXT distinct from canonical Fixture.id", () => {
    const providerFixtureId = tableColumns("ProviderFixtureIdentity").find(
      (column) => column.name === "providerFixtureId",
    );
    expect(providerFixtureId?.type).toBe("TEXT");
    expect(
      currentDatabase()
        .prepare(
          'SELECT "providerFixtureId", "fixtureId" FROM "ProviderFixtureIdentity" WHERE "id" = \'synthetic-identity-1\'',
        )
        .get(),
    ).toEqual({
      providerFixtureId: "SYNTHETIC_EXTERNAL_FIXTURE_1",
      fixtureId: "synthetic-fixture-1",
    });
  });

  it("preserves SourceArtifact and ImportBatch relationships", () => {
    expect(foreignKeyTables("SourceArtifact")).toContain("ImportBatch");
    expect(foreignKeyTables("PredictionSnapshot")).toEqual(
      expect.arrayContaining(["SourceArtifact", "ImportBatch"]),
    );
    expect(foreignKeyTables("ProviderRequestAudit")).toContain("ImportBatch");
  });

  it("contains no legacy schema or database operation", () => {
    expect(providerMigrationSource).not.toMatch(/dev\.db|DATABASE_URL|ou25-consensus-lab/i);
    expect(providerMigrationSource).not.toMatch(/DROP TABLE|DROP TRIGGER/);
  });

  it("uses only a new SQLite path below the test temporary directory", () => {
    expect(temporaryDatabasePath.startsWith(`${temporaryDirectory}/`)).toBe(true);
    expect(temporaryDatabasePath).not.toContain("var/market-v2");
    expect(temporaryDatabasePath).not.toContain("prisma/dev.db");
  });
});
