import { createRequire } from "node:module";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import type {
  RawEvidenceCandidate,
  RawEvidenceDescriptor,
} from "@/application/market-v2/capture/raw-evidence-store";
import {
  OperationalRawEvidenceStore,
} from "@/infrastructure/market-v2/capture/operational-evidence-store";
import {
  PrismaApiFootballRepositories,
  type ApiFootballPrismaClient,
  type PrismaOutcomeRow,
  type PrismaPredictionProbabilityRow,
  type PrismaPredictionSnapshotRow,
  type PrismaProviderFixtureIdentityRow,
  type PrismaProviderRow,
  type PrismaSourceArtifactRow,
} from "@/infrastructure/market-v2/persistence/api-football-repositories";
import {
  mapApiFootballFixture,
  mapApiFootballPrediction,
  mapApiFootballResult,
} from "@/infrastructure/market-v2/api-football/mappers";
import {
  buildSyntheticFixtureFtHome,
  buildSyntheticFixtureNs,
  buildSyntheticFixturePen,
  buildSyntheticPrediction,
} from "@/tests/fixtures/api-football";

type Statement = Readonly<{
  get(...parameters: unknown[]): unknown;
  all(...parameters: unknown[]): unknown[];
  run(...parameters: unknown[]): Readonly<{ changes: number | bigint }>;
}>;
type TestDatabase = Readonly<{
  exec(sql: string): void;
  prepare(sql: string): Statement;
  close(): void;
}>;
type DatabaseConstructor = new (path: string) => TestDatabase;

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: DatabaseConstructor;
};
const migrationsRoot = resolve(process.cwd(), "prisma/market-v2/migrations");
const migrationSources = readdirSync(migrationsRoot)
  .filter((name) => /^\d{14}_.+/u.test(name))
  .sort()
  .map((name) => readFileSync(resolve(migrationsRoot, name, "migration.sql"), "utf8"));
const temporaryRoots: string[] = [];

function iso(value: Date): string {
  return value.toISOString();
}

class SqlitePrismaAdapter implements ApiFootballPrismaClient {
  failProbabilitySelection: "HOME" | "DRAW" | "AWAY" | null = null;

  constructor(readonly database: TestDatabase) {}

  readonly provider = {
    findUnique: async ({ where }: { where: { stableKey: string } }) =>
      this.get<PrismaProviderRow>(
        'SELECT "id", "stableKey", "displayName" FROM "Provider" WHERE "stableKey" = ?',
        where.stableKey,
      ),
    create: async ({ data }: { data: { id: string; stableKey: string; displayName: string } }) => {
      this.database.prepare(
        'INSERT INTO "Provider" ("id", "stableKey", "displayName") VALUES (?, ?, ?)',
      ).run(data.id, data.stableKey, data.displayName);
      return data;
    },
  };

  readonly sourceArtifact = {
    findFirst: async ({ where }: { where: { sourceName: string; sourceReference: string } }) =>
      this.get<PrismaSourceArtifactRow>(
        'SELECT "id", "sourceName", "sourceReference", "sha256", "capturedAtUtc", "mediaType", "byteSize" FROM "SourceArtifact" WHERE "sourceName" = ? AND "sourceReference" = ? ORDER BY "createdAtUtc" LIMIT 1',
        where.sourceName,
        where.sourceReference,
      ),
    create: async ({ data }: { data: {
      id: string;
      sourceName: string;
      sourceReference: string;
      sha256: string;
      capturedAtUtc: Date;
      mediaType: string;
      byteSize: bigint;
    } }) => {
      this.database.prepare(
        'INSERT INTO "SourceArtifact" ("id", "sourceName", "sourceReference", "sha256", "capturedAtUtc", "mediaType", "byteSize") VALUES (?, ?, ?, ?, ?, ?, ?)',
      ).run(
        data.id,
        data.sourceName,
        data.sourceReference,
        data.sha256,
        iso(data.capturedAtUtc),
        data.mediaType,
        Number(data.byteSize),
      );
      return { ...data, capturedAtUtc: iso(data.capturedAtUtc), byteSize: data.byteSize };
    },
  };

  readonly providerFixtureIdentity = {
    findUnique: async ({ where }: { where: {
      providerId_providerFixtureId: { providerId: string; providerFixtureId: string };
    } }) => this.get<PrismaProviderFixtureIdentityRow>(
      'SELECT "id", "providerId", "providerFixtureId", "fixtureId", "providerCompetitionId", "providerHomeTeamId", "providerAwayTeamId", "season", "round", "sourceDateRaw", "sourceTimestamp", "sourceTimezone" FROM "ProviderFixtureIdentity" WHERE "providerId" = ? AND "providerFixtureId" = ?',
      where.providerId_providerFixtureId.providerId,
      where.providerId_providerFixtureId.providerFixtureId,
    ),
    create: async ({ data }: { data: {
      id: string;
      providerId: string;
      providerFixtureId: string;
      fixtureId: string;
      providerCompetitionId: string;
      providerHomeTeamId: string;
      providerAwayTeamId: string;
      season: string;
      round: string;
      sourceDateRaw: string;
      sourceTimestamp: string;
      sourceTimezone: string;
    } }) => {
      this.database.prepare(
        'INSERT INTO "ProviderFixtureIdentity" ("id", "providerId", "providerFixtureId", "fixtureId", "providerCompetitionId", "providerHomeTeamId", "providerAwayTeamId", "season", "round", "sourceDateRaw", "sourceTimestamp", "sourceTimezone") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        data.id,
        data.providerId,
        data.providerFixtureId,
        data.fixtureId,
        data.providerCompetitionId,
        data.providerHomeTeamId,
        data.providerAwayTeamId,
        data.season,
        data.round,
        data.sourceDateRaw,
        data.sourceTimestamp,
        data.sourceTimezone,
      );
      return data;
    },
  };

  readonly predictionSnapshot = {
    findUnique: async ({ where }: { where: {
      providerFixtureIdentityId_capturedAtUtc: {
        providerFixtureIdentityId: string;
        capturedAtUtc: Date;
      };
    } }) => {
      const key = where.providerFixtureIdentityId_capturedAtUtc;
      const row = this.get<Omit<PrismaPredictionSnapshotRow, "probabilities">>(
        'SELECT "id", "providerFixtureIdentityId", "sourceArtifactId", "capturedAtUtc", "predictionCapturedBeforeKickoff", "predictedWinnerProviderTeamId", "predictedWinnerName", "winnerComment", "advice", "underOverRaw", "providerInternalTimestampRaw", "probabilityTotalRaw", "contentHash", "parserVersion", "policyVersion" FROM "PredictionSnapshot" WHERE "providerFixtureIdentityId" = ? AND "capturedAtUtc" = ?',
        key.providerFixtureIdentityId,
        iso(key.capturedAtUtc),
      );
      return row === null ? null : this.withProbabilities(row);
    },
    findMany: async ({ where, orderBy, take }: {
      where: { providerFixtureIdentityId: string; capturedAtUtc?: { lt: Date } };
      orderBy: { capturedAtUtc: "asc" | "desc" };
      take?: number;
    }) => {
      const direction = orderBy.capturedAtUtc === "desc" ? "DESC" : "ASC";
      const before = where.capturedAtUtc?.lt;
      const sql = `SELECT "id", "providerFixtureIdentityId", "sourceArtifactId", "capturedAtUtc", "predictionCapturedBeforeKickoff", "predictedWinnerProviderTeamId", "predictedWinnerName", "winnerComment", "advice", "underOverRaw", "providerInternalTimestampRaw", "probabilityTotalRaw", "contentHash", "parserVersion", "policyVersion" FROM "PredictionSnapshot" WHERE "providerFixtureIdentityId" = ?${before === undefined ? "" : ' AND "capturedAtUtc" < ?'} ORDER BY "capturedAtUtc" ${direction}${take === undefined ? "" : ` LIMIT ${take}`}`;
      const rows = this.database.prepare(sql).all(
        where.providerFixtureIdentityId,
        ...(before === undefined ? [] : [iso(before)]),
      ) as Array<Omit<PrismaPredictionSnapshotRow, "probabilities">>;
      return rows.map((row) => this.withProbabilities(row));
    },
    create: async ({ data }: { data: {
      id: string;
      providerFixtureIdentityId: string;
      sourceArtifactId: string;
      capturedAtUtc: Date;
      predictionCapturedBeforeKickoff: boolean;
      predictedWinnerProviderTeamId: string | null;
      predictedWinnerName: string | null;
      winnerComment: string | null;
      advice: string | null;
      underOverRaw: string | null;
      providerInternalTimestampRaw: string | null;
      probabilityTotalRaw: string;
      contentHash: string;
      parserVersion: string;
      policyVersion: string;
    } }) => {
      this.database.prepare(
        'INSERT INTO "PredictionSnapshot" ("id", "providerFixtureIdentityId", "sourceArtifactId", "capturedAtUtc", "predictionCapturedBeforeKickoff", "predictedWinnerProviderTeamId", "predictedWinnerName", "winnerComment", "advice", "underOverRaw", "providerInternalTimestampRaw", "probabilityTotalRaw", "contentHash", "parserVersion", "policyVersion") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        data.id,
        data.providerFixtureIdentityId,
        data.sourceArtifactId,
        iso(data.capturedAtUtc),
        data.predictionCapturedBeforeKickoff ? 1 : 0,
        data.predictedWinnerProviderTeamId,
        data.predictedWinnerName,
        data.winnerComment,
        data.advice,
        data.underOverRaw,
        data.providerInternalTimestampRaw,
        data.probabilityTotalRaw,
        data.contentHash,
        data.parserVersion,
        data.policyVersion,
      );
      return { ...data, capturedAtUtc: iso(data.capturedAtUtc) };
    },
  };

  readonly predictionProbability = {
    create: async ({ data }: { data: {
      predictionSnapshotId: string;
      selection: "HOME" | "DRAW" | "AWAY";
      rawPercentage: string;
      normalizedProbability: string;
    } }) => {
      if (data.selection === this.failProbabilitySelection) {
        throw new Error("SYNTHETIC_PROBABILITY_FAILURE");
      }
      this.database.prepare(
        'INSERT INTO "PredictionProbability" ("predictionSnapshotId", "selection", "rawPercentage", "normalizedProbability") VALUES (?, ?, ?, ?)',
      ).run(
        data.predictionSnapshotId,
        data.selection,
        data.rawPercentage,
        data.normalizedProbability,
      );
      return data;
    },
  };

  readonly outcome = {
    findFirst: async ({ where }: { where: {
      fixtureId: string;
      contentHash?: string;
      observedAtUtc?: Date;
    } }) => {
      const conditions = ['"fixtureId" = ?'];
      const parameters: unknown[] = [where.fixtureId];
      if (where.contentHash !== undefined) {
        conditions.push('"contentHash" = ?');
        parameters.push(where.contentHash);
      }
      if (where.observedAtUtc !== undefined) {
        conditions.push('"observedAtUtc" = ?');
        parameters.push(iso(where.observedAtUtc));
      }
      return this.get<PrismaOutcomeRow>(
        `SELECT "id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "providerTerminalStatusRaw", "result1X2Scope", "regulationHomeScore", "regulationAwayScore", "extraTimeHomeScore", "extraTimeAwayScore", "penaltyHomeScore", "penaltyAwayScore", "shootoutWinner", "status", "sourceArtifactId", "supersedesOutcomeId", "contentHash" FROM "Outcome" WHERE ${conditions.join(" AND ")} ORDER BY "createdAtUtc" LIMIT 1`,
        ...parameters,
      );
    },
    create: async ({ data }: { data: {
      id: string;
      fixtureId: string;
      observedAtUtc: Date;
      homeScore: number;
      awayScore: number;
      result1X2: "HOME" | "DRAW" | "AWAY";
      providerTerminalStatusRaw: string;
      result1X2Scope: "REGULATION_TIME";
      regulationHomeScore: number;
      regulationAwayScore: number;
      extraTimeHomeScore: number | null;
      extraTimeAwayScore: number | null;
      penaltyHomeScore: number | null;
      penaltyAwayScore: number | null;
      shootoutWinner: "HOME" | "AWAY" | null;
      status: "CONFIRMED";
      sourceArtifactId: string;
      contentHash: string;
    } }) => {
      this.database.prepare(
        'INSERT INTO "Outcome" ("id", "fixtureId", "observedAtUtc", "homeScore", "awayScore", "result1X2", "providerTerminalStatusRaw", "result1X2Scope", "regulationHomeScore", "regulationAwayScore", "extraTimeHomeScore", "extraTimeAwayScore", "penaltyHomeScore", "penaltyAwayScore", "shootoutWinner", "status", "sourceArtifactId", "contentHash") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        data.id,
        data.fixtureId,
        iso(data.observedAtUtc),
        data.homeScore,
        data.awayScore,
        data.result1X2,
        data.providerTerminalStatusRaw,
        data.result1X2Scope,
        data.regulationHomeScore,
        data.regulationAwayScore,
        data.extraTimeHomeScore,
        data.extraTimeAwayScore,
        data.penaltyHomeScore,
        data.penaltyAwayScore,
        data.shootoutWinner,
        data.status,
        data.sourceArtifactId,
        data.contentHash,
      );
      return { ...data, observedAtUtc: iso(data.observedAtUtc), supersedesOutcomeId: null };
    },
  };

  async $transaction<T>(operation: (transaction: ApiFootballPrismaClient) => Promise<T>): Promise<T> {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = await operation(this);
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }

  get<T>(sql: string, ...parameters: unknown[]): T | null {
    return (this.database.prepare(sql).get(...parameters) as T | undefined) ?? null;
  }

  withProbabilities(
    row: Omit<PrismaPredictionSnapshotRow, "probabilities">,
  ): PrismaPredictionSnapshotRow {
    const probabilities = this.database.prepare(
      'SELECT "predictionSnapshotId", "selection", "rawPercentage", CAST("normalizedProbability" AS TEXT) AS "normalizedProbability" FROM "PredictionProbability" WHERE "predictionSnapshotId" = ? ORDER BY CASE "selection" WHEN \'HOME\' THEN 1 WHEN \'DRAW\' THEN 2 ELSE 3 END',
    ).all(row.id) as PrismaPredictionProbabilityRow[];
    return Object.freeze({
      ...row,
      predictionCapturedBeforeKickoff: Boolean(row.predictionCapturedBeforeKickoff),
      probabilities: Object.freeze(probabilities),
    });
  }
}

let temporaryRoot = "";
let databasePath = "";
let database: TestDatabase;
let adapter: SqlitePrismaAdapter;
let repositories: PrismaApiFootballRepositories;

function descriptor(marker: string, capturedAtUtc = "2030-01-01T17:00:00.000Z"): RawEvidenceDescriptor {
  const contentHash = marker.repeat(64).slice(0, 64);
  return Object.freeze({
    providerKey: "api-football",
    endpointKey: "prediction-by-fixture",
    capturedAtUtc,
    mediaType: "application/json",
    contentHash,
    byteLength: 128,
    storageReference: `sha256/${contentHash.slice(0, 2)}/${contentHash}.bin`,
    sourceReference: `api-football:synthetic:${marker}:${capturedAtUtc}`,
  });
}

function mappedFixture() {
  const result = mapApiFootballFixture(buildSyntheticFixtureNs(), {
    capturedAtUtc: "2030-01-01T17:00:00.000Z",
    providerKey: "api-football",
  });
  if (!result.ok) throw new Error(result.error.classification);
  return result.data;
}

function mappedPrediction(
  evidence: RawEvidenceDescriptor,
  capturedAtUtc = evidence.capturedAtUtc,
  providerInternalTimestamp: string | null = null,
) {
  const result = mapApiFootballPrediction(buildSyntheticPrediction(), {
    capturedAtUtc,
    requestedProviderFixtureId: "900001",
    expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
    expectedHomeProviderTeamId: "920001",
    expectedHomeName: "Synthetic Home FC",
    expectedAwayProviderTeamId: "920002",
    expectedAwayName: "Synthetic Away FC",
    contentHash: evidence.contentHash,
    parserVersion: "synthetic-parser/1.0",
    policyVersion: "synthetic-policy/1.0",
  });
  if (!result.ok) throw new Error(result.error.classification);
  return Object.freeze({ ...result.data, providerInternalTimestamp });
}

function mappedOutcome(
  kind: "FT" | "PEN",
  capturedAtUtc: string,
) {
  const fixture = kind === "FT" ? buildSyntheticFixtureFtHome() : buildSyntheticFixturePen();
  const result = mapApiFootballResult(fixture, {
    capturedAtUtc,
    requestedProviderFixtureId: String(fixture.fixture.id),
    expectedLeagueProviderId: String(fixture.league.id),
    expectedSeason: fixture.league.season,
    expectedHomeProviderTeamId: String(fixture.teams.home.id),
    expectedHomeName: fixture.teams.home.name,
    expectedAwayProviderTeamId: String(fixture.teams.away.id),
    expectedAwayName: fixture.teams.away.name,
    expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
  });
  if (!result.ok) throw new Error(result.error.classification);
  return result.data;
}

async function createBinding(evidence = descriptor("a")) {
  return repositories.persistFixtureCapture({
    fixture: mappedFixture(),
    canonicalFixtureId: "canonical-fixture-1",
    evidence,
  });
}

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "ou25-market-v2-api-football-"));
  temporaryRoots.push(temporaryRoot);
  databasePath = join(temporaryRoot, "temporary-market-v2.sqlite");
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrationSources) database.exec(migration);
  database.exec(`
    INSERT INTO "Team" ("id", "canonicalKey", "displayName") VALUES
      ('team-home', 'synthetic-home', 'Synthetic Home FC'),
      ('team-away', 'synthetic-away', 'Synthetic Away FC');
    INSERT INTO "Fixture"
      ("id", "localTeamId", "awayTeamId", "competitionKey", "kickoffAtUtc", "status") VALUES
      ('canonical-fixture-1', 'team-home', 'team-away', 'synthetic-competition', '2030-01-01T18:00:00.000Z', 'SCHEDULED'),
      ('canonical-fixture-2', 'team-home', 'team-away', 'synthetic-competition', '2030-01-01T18:00:00.000Z', 'SCHEDULED');
  `);
  adapter = new SqlitePrismaAdapter(database);
  repositories = new PrismaApiFootballRepositories(adapter);
});

afterEach(() => {
  database.close();
  rmSync(temporaryRoot, { recursive: true, force: true });
  expect(existsSync(temporaryRoot)).toBe(false);
});

afterAll(() => {
  expect(temporaryRoots.every((root) => !existsSync(root))).toBe(true);
});

describe("Prisma API-Football provider and raw artifact persistence", () => {
  it("creates and exactly replays the stable provider", async () => {
    const first = await repositories.ensureProvider();
    const replay = await repositories.ensureProvider();
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    expect(database.prepare('SELECT COUNT(*) AS count FROM "Provider"').get()).toEqual({ count: 1 });
  });

  it("reports an incompatible stable provider as a conflict", async () => {
    database.exec(
      'INSERT INTO "Provider" ("id", "stableKey", "displayName") VALUES (\'wrong\', \'api-football\', \'Wrong Display\')',
    );
    expect(await repositories.ensureProvider()).toMatchObject({
      ok: false,
      disposition: "CONFLICT",
    });
  });

  it("registers and replays SourceArtifact metadata without raw bytes", async () => {
    const evidence = descriptor("b");
    const first = await repositories.registerSourceArtifact(evidence);
    const replay = await repositories.registerSourceArtifact(evidence);
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    const columns = database.prepare('PRAGMA table_info("SourceArtifact")').all() as Array<{ name: string }>;
    expect(columns.map(({ name }) => name)).not.toContain("bytes");
    expect(JSON.stringify(database.prepare('SELECT * FROM "SourceArtifact"').all())).not.toContain(
      "SYNTHETIC_RAW_BODY",
    );
  });
});

describe("Prisma API-Football explicit fixture identity binding", () => {
  it("creates and exactly replays a String external identity", async () => {
    const first = await createBinding();
    const replay = await createBinding();
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    expect(
      database.prepare(
        'SELECT "providerFixtureId", "fixtureId" FROM "ProviderFixtureIdentity"',
      ).get(),
    ).toEqual({ providerFixtureId: "900001", fixtureId: "canonical-fixture-1" });
  });

  it("conflicts instead of remapping one external identity to another fixture", async () => {
    await createBinding();
    const conflict = await repositories.persistFixtureCapture({
      fixture: mappedFixture(),
      canonicalFixtureId: "canonical-fixture-2",
      evidence: descriptor("a"),
    });
    expect(conflict).toMatchObject({ ok: false, disposition: "CONFLICT" });
    expect(database.prepare('SELECT "fixtureId" FROM "ProviderFixtureIdentity"').get()).toEqual({
      fixtureId: "canonical-fixture-1",
    });
  });
});

describe("Prisma API-Football prediction transaction", () => {
  it("atomically inserts one snapshot and exactly HOME, DRAW, AWAY decimals", async () => {
    await createBinding();
    const evidence = descriptor("c");
    const result = await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(evidence),
      evidence,
    });
    expect(result.ok && result.disposition).toBe("CREATED");
    const probabilities = database.prepare(
      'SELECT "selection", CAST("normalizedProbability" AS TEXT) AS value FROM "PredictionProbability" ORDER BY CASE "selection" WHEN \'HOME\' THEN 1 WHEN \'DRAW\' THEN 2 ELSE 3 END',
    ).all();
    expect(probabilities).toEqual([
      { selection: "HOME", value: "0.45" },
      { selection: "DRAW", value: "0.3" },
      { selection: "AWAY", value: "0.25" },
    ]);
  });

  it("replays exactly and conflicts at the same capture time with other content", async () => {
    await createBinding();
    const firstEvidence = descriptor("c");
    const snapshot = mappedPrediction(firstEvidence);
    const first = await repositories.persistPredictionCapture({ snapshot, evidence: firstEvidence });
    const replay = await repositories.persistPredictionCapture({ snapshot, evidence: firstEvidence });
    const otherEvidence = descriptor("d");
    const conflict = await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(otherEvidence, snapshot.capturedAtUtc),
      evidence: otherEvidence,
    });
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    expect(conflict).toMatchObject({ ok: false, disposition: "CONFLICT" });
    expect(database.prepare('SELECT COUNT(*) AS count FROM "PredictionSnapshot"').get()).toEqual({ count: 1 });
  });

  it("creates another capturedAtUtc and selects latest strictly before kickoff", async () => {
    await createBinding();
    const earlyEvidence = descriptor("c", "2030-01-01T17:00:00.000Z");
    const laterEvidence = descriptor("d", "2030-01-01T17:30:00.000Z");
    const kickoffEvidence = descriptor("e", "2030-01-01T18:00:00.000Z");
    await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(earlyEvidence, earlyEvidence.capturedAtUtc, "2099-01-01T00:00:00Z"),
      evidence: earlyEvidence,
    });
    await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(laterEvidence, laterEvidence.capturedAtUtc, "1900-01-01T00:00:00Z"),
      evidence: laterEvidence,
    });
    await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(kickoffEvidence, kickoffEvidence.capturedAtUtc),
      evidence: kickoffEvidence,
    });
    const latest = await repositories.findLatestPredictionBeforeKickoff(
      "900001",
      "2030-01-01T18:00:00.000Z",
    );
    expect(latest?.capturedAtUtc).toBe("2030-01-01T17:30:00.000Z");
    expect(latest?.providerInternalTimestamp).toBe("1900-01-01T00:00:00Z");
    expect(await repositories.listPredictions("900001")).toHaveLength(3);
  });

  it("creates another timestamp while replaying the same physical raw artifact", async () => {
    await createBinding();
    const firstEvidence = descriptor("c", "2030-01-01T17:00:00.000Z");
    const laterEvidence = descriptor("c", "2030-01-01T17:30:00.000Z");
    const first = await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(firstEvidence),
      evidence: firstEvidence,
    });
    const later = await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(laterEvidence),
      evidence: laterEvidence,
    });
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(later.ok && later.disposition).toBe("CREATED");
    expect(database.prepare('SELECT COUNT(*) AS count FROM "PredictionSnapshot"').get()).toEqual({ count: 2 });
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM "SourceArtifact" WHERE "sha256" = ?',
    ).get(firstEvidence.contentHash)).toEqual({ count: 1 });
  });

  it("rolls back snapshot, probabilities, and artifact if one probability fails", async () => {
    await createBinding();
    adapter.failProbabilitySelection = "AWAY";
    const evidence = descriptor("f");
    const result = await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(evidence),
      evidence,
    });
    expect(result).toMatchObject({ ok: false, disposition: "FAILED" });
    expect(database.prepare('SELECT COUNT(*) AS count FROM "PredictionSnapshot"').get()).toEqual({ count: 0 });
    expect(database.prepare('SELECT COUNT(*) AS count FROM "PredictionProbability"').get()).toEqual({ count: 0 });
    expect(database.prepare(
      'SELECT COUNT(*) AS count FROM "SourceArtifact" WHERE "sha256" = ?',
    ).get(evidence.contentHash)).toEqual({ count: 0 });
  });
});

describe("Prisma API-Football outcome append-only semantics", () => {
  it("inserts FT and exactly replays it", async () => {
    const evidence = descriptor("g", "2030-01-02T12:00:00.000Z");
    const resolution = mappedOutcome("FT", evidence.capturedAtUtc);
    const first = await repositories.persistOutcomeCapture({
      resolution,
      canonicalFixtureId: "canonical-fixture-1",
      evidence,
    });
    const replay = await repositories.persistOutcomeCapture({
      resolution,
      canonicalFixtureId: "canonical-fixture-1",
      evidence,
    });
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    expect(database.prepare('SELECT COUNT(*) AS count FROM "Outcome"').get()).toEqual({ count: 1 });
  });

  it("keeps PEN regulation DRAW and shootout winner separate", async () => {
    const evidence = descriptor("h", "2030-01-02T13:00:00.000Z");
    await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("PEN", evidence.capturedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence,
    });
    expect(database.prepare(
      'SELECT "result1X2", "shootoutWinner", "regulationHomeScore", "regulationAwayScore" FROM "Outcome"',
    ).get()).toEqual({
      result1X2: "DRAW",
      shootoutWinner: "HOME",
      regulationHomeScore: 1,
      regulationAwayScore: 1,
    });
  });

  it("appends a later version without changing the previous outcome", async () => {
    const firstEvidence = descriptor("g", "2030-01-02T12:00:00.000Z");
    const laterEvidence = descriptor("h", "2030-01-02T13:00:00.000Z");
    await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("FT", firstEvidence.capturedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence: firstEvidence,
    });
    await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("PEN", laterEvidence.capturedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence: laterEvidence,
    });
    expect(database.prepare(
      'SELECT "result1X2", "providerTerminalStatusRaw" FROM "Outcome" ORDER BY "observedAtUtc"',
    ).all()).toEqual([
      { result1X2: "HOME", providerTerminalStatusRaw: "FT" },
      { result1X2: "DRAW", providerTerminalStatusRaw: "PEN" },
    ]);
  });

  it("reports different content at the same observation time as a conflict", async () => {
    const observedAtUtc = "2030-01-02T12:00:00.000Z";
    const firstEvidence = descriptor("g", observedAtUtc);
    const otherEvidence = descriptor("h", observedAtUtc);
    await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("FT", observedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence: firstEvidence,
    });
    const conflict = await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("PEN", observedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence: otherEvidence,
    });
    expect(conflict).toMatchObject({ ok: false, disposition: "CONFLICT" });
    expect(database.prepare('SELECT COUNT(*) AS count FROM "Outcome"').get()).toEqual({ count: 1 });
  });
});

describe("Market V2 API-Football append-only triggers and security", () => {
  it("rejects mutation of provider identities, prediction rows, artifacts, and outcomes", async () => {
    await createBinding();
    const predictionEvidence = descriptor("c");
    await repositories.persistPredictionCapture({
      snapshot: mappedPrediction(predictionEvidence),
      evidence: predictionEvidence,
    });
    const outcomeEvidence = descriptor("g", "2030-01-02T12:00:00.000Z");
    await repositories.persistOutcomeCapture({
      resolution: mappedOutcome("FT", outcomeEvidence.capturedAtUtc),
      canonicalFixtureId: "canonical-fixture-1",
      evidence: outcomeEvidence,
    });
    const cases = [
      ['UPDATE "ProviderFixtureIdentity" SET "fixtureId" = \'canonical-fixture-2\'', "ProviderFixtureIdentity UPDATE"],
      ['DELETE FROM "ProviderFixtureIdentity"', "ProviderFixtureIdentity DELETE"],
      ['UPDATE "PredictionSnapshot" SET "contentHash" = \'changed\'', "PredictionSnapshot UPDATE"],
      ['DELETE FROM "PredictionSnapshot"', "PredictionSnapshot DELETE"],
      ['UPDATE "PredictionProbability" SET "rawPercentage" = \'0%\'', "PredictionProbability UPDATE"],
      ['DELETE FROM "PredictionProbability"', "PredictionProbability DELETE"],
      ['UPDATE "SourceArtifact" SET "sha256" = \'changed\'', "SourceArtifact UPDATE"],
      ['DELETE FROM "SourceArtifact"', "SourceArtifact DELETE"],
      ['UPDATE "Outcome" SET "status" = \'VOID\'', "Outcome UPDATE"],
      ['DELETE FROM "Outcome"', "Outcome DELETE"],
    ] as const;
    for (const [sql, message] of cases) {
      expect(() => database.exec(sql)).toThrow(new RegExp(`MARKET_V2_APPEND_ONLY: ${message}`));
    }
  });

  it("stores no credential, authorization, cookie, or raw body material", async () => {
    await createBinding();
    const evidence = descriptor("c");
    await repositories.persistPredictionCapture({ snapshot: mappedPrediction(evidence), evidence });
    const rows = [
      ...database.prepare('SELECT * FROM "Provider"').all(),
      ...database.prepare('SELECT * FROM "SourceArtifact"').all(),
      ...database.prepare('SELECT * FROM "ProviderFixtureIdentity"').all(),
      ...database.prepare('SELECT * FROM "PredictionSnapshot"').all(),
      ...database.prepare('SELECT * FROM "PredictionProbability"').all(),
    ];
    const serialized = JSON.stringify(rows, (_key, value) =>
      typeof value === "bigint" ? value.toString() : value,
    );
    expect(serialized).not.toContain("API_FOOTBALL_KEY");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("Cookie");
    expect(serialized).not.toContain("SYNTHETIC_RAW_BODY");
    expect("update" in repositories).toBe(false);
    expect("delete" in repositories).toBe(false);
  });
});

describe("Operational raw evidence store", () => {
  function evidenceCandidate(bytes = new TextEncoder().encode("SYNTHETIC_RAW_EVIDENCE")):
    RawEvidenceCandidate {
    return Object.freeze({
      providerKey: "api-football",
      endpointKey: "prediction-by-fixture",
      capturedAtUtc: "2030-01-01T17:00:00.000Z",
      mediaType: "application/json",
      bytes,
      sourceReference: "api-football:prediction-by-fixture:synthetic",
    });
  }

  it("publishes content-addressed bytes atomically with private permissions and replay", async () => {
    const evidenceRoot = join(temporaryRoot, "evidence");
    mkdirSync(evidenceRoot, { mode: 0o700 });
    const store = new OperationalRawEvidenceStore(evidenceRoot);
    await store.initialize();
    const candidate = evidenceCandidate();
    const first = await store.publish(candidate);
    const replay = await store.publish(candidate);
    expect(first.ok && first.disposition).toBe("CREATED");
    expect(replay.ok && replay.disposition).toBe("REPLAYED");
    if (!first.ok) throw new Error(first.error.sanitizedCode);
    expect(first.descriptor.storageReference).not.toMatch(/^\//u);
    expect(first.descriptor.contentHash).toMatch(/^[0-9a-f]{64}$/u);
    const artifactPath = resolve(evidenceRoot, first.descriptor.storageReference);
    expect(readFileSync(artifactPath)).toEqual(Buffer.from(candidate.bytes));
    expect(statSync(artifactPath).mode & 0o777).toBe(0o400);
    expect(statSync(join(evidenceRoot, "sha256")).mode & 0o777).toBe(0o700);
    expect(readdirSync(join(evidenceRoot, ".temporary"))).toEqual([]);

    const reopened = new OperationalRawEvidenceStore(evidenceRoot);
    await reopened.initialize();
    expect((await reopened.publish(candidate)).ok).toBe(true);
  });

  it("never overwrites an occupied content address and returns a sanitized conflict", async () => {
    const evidenceRoot = join(temporaryRoot, "evidence-conflict");
    mkdirSync(evidenceRoot, { mode: 0o700 });
    const store = new OperationalRawEvidenceStore(evidenceRoot);
    await store.initialize();
    const candidate = evidenceCandidate();
    const first = await store.publish(candidate);
    if (!first.ok) throw new Error(first.error.sanitizedCode);
    const artifactPath = resolve(evidenceRoot, first.descriptor.storageReference);
    chmodSync(artifactPath, 0o600);
    writeFileSync(artifactPath, "CORRUPTED_SYNTHETIC_CONTENT");
    const conflict = await store.publish(candidate);
    expect(conflict).toMatchObject({ ok: false, disposition: "CONFLICT" });
    expect(readFileSync(artifactPath, "utf8")).toBe("CORRUPTED_SYNTHETIC_CONTENT");
    expect(JSON.stringify(conflict)).not.toContain("SYNTHETIC_RAW_EVIDENCE");
    expect(JSON.stringify(conflict)).not.toContain(evidenceRoot);
  });

  it("blocks root and content component symlinks", async () => {
    const actualRoot = join(temporaryRoot, "actual-evidence");
    const linkedRoot = join(temporaryRoot, "linked-evidence");
    mkdirSync(actualRoot, { mode: 0o700 });
    symlinkSync(actualRoot, linkedRoot);
    await expect(new OperationalRawEvidenceStore(linkedRoot).initialize()).rejects.toThrow(
      /initialization failed/u,
    );

    const safeRoot = join(temporaryRoot, "safe-evidence");
    mkdirSync(safeRoot, { mode: 0o700 });
    const store = new OperationalRawEvidenceStore(safeRoot);
    await store.initialize();
    const candidate = evidenceCandidate();
    const hash = createRequire(import.meta.url)("node:crypto").createHash("sha256")
      .update(candidate.bytes)
      .digest("hex") as string;
    const external = join(temporaryRoot, "external-component");
    mkdirSync(external, { mode: 0o700 });
    symlinkSync(external, join(safeRoot, "sha256", hash.slice(0, 2)));
    expect(await store.publish(candidate)).toMatchObject({ ok: false, disposition: "FAILED" });
  });

  it("rejects traversal-like references and cleans failed staging", async () => {
    const evidenceRoot = join(temporaryRoot, "evidence-traversal");
    mkdirSync(evidenceRoot, { mode: 0o700 });
    const store = new OperationalRawEvidenceStore(evidenceRoot);
    await store.initialize();
    const traversal = await store.publish({
      ...evidenceCandidate(),
      sourceReference: "../forbidden",
    });
    expect(traversal).toMatchObject({ ok: false, disposition: "FAILED" });

    const temporaryDirectory = join(evidenceRoot, ".temporary");
    rmSync(temporaryDirectory, { recursive: true, force: true });
    symlinkSync(temporaryRoot, temporaryDirectory);
    const failed = await store.publish(evidenceCandidate(new TextEncoder().encode("OTHER_BODY")));
    expect(failed).toMatchObject({ ok: false, disposition: "FAILED" });
    expect(readdirSync(temporaryRoot).filter((name) => name.endsWith(".tmp"))).toEqual([]);
    expect("update" in store).toBe(false);
    expect("delete" in store).toBe(false);
    expect(lstatSync(temporaryDirectory).isSymbolicLink()).toBe(true);
  });
});
