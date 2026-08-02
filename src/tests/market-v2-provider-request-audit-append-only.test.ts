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
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { ProviderRequestAuditRecord } from "@/domain/market-v2/audit/provider-request-audit-repository";
import {
  PrismaProviderRequestAuditRepository,
  type ApiFootballAuditPrismaClient,
  type PrismaProviderRequestAuditRow,
  type PrismaProviderRow,
} from "@/infrastructure/market-v2/persistence/api-football-repositories";

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
const originalFetch = globalThis.fetch;
const temporaryRoots: string[] = [];
const temporaryDatabasePaths: string[] = [];
let fetchCalls = 0;

class SqliteAuditPrismaAdapter implements ApiFootballAuditPrismaClient {
  constructor(readonly database: TestDatabase) {}

  readonly provider = {
    findUnique: async ({ where }: { where: { stableKey: string } }) =>
      (this.database.prepare(
        'SELECT "id", "stableKey", "displayName" FROM "Provider" WHERE "stableKey" = ?',
      ).get(where.stableKey) as PrismaProviderRow | undefined) ?? null,
    create: async ({ data }: { data: { id: string; stableKey: string; displayName: string } }) => {
      this.database.prepare(
        'INSERT INTO "Provider" ("id", "stableKey", "displayName") VALUES (?, ?, ?)',
      ).run(data.id, data.stableKey, data.displayName);
      return data;
    },
  };

  readonly providerRequestAudit = {
    findUnique: async ({ where }: { where: {
      requestKeyHash_attemptNumber: { requestKeyHash: string; attemptNumber: number };
    } }) => {
      const key = where.requestKeyHash_attemptNumber;
      return (this.database.prepare(
        'SELECT "id", "providerId", "importBatchId", "endpointKey", "requestKeyHash", "correlationId", "attemptNumber", "startedAtUtc", "finishedAtUtc", "httpStatus", "classification", "sanitizedErrorCode", "dailyLimit", "dailyRemaining", "minuteLimit", "minuteRemaining" FROM "ProviderRequestAudit" WHERE "requestKeyHash" = ? AND "attemptNumber" = ?',
      ).get(key.requestKeyHash, key.attemptNumber) as PrismaProviderRequestAuditRow | undefined) ?? null;
    },
    create: async ({ data }: { data: {
      id: string;
      providerId: string;
      importBatchId: string | null;
      endpointKey: string;
      requestKeyHash: string;
      correlationId: string;
      attemptNumber: number;
      startedAtUtc: Date;
      finishedAtUtc: Date | null;
      httpStatus: number | null;
      classification: ProviderRequestAuditRecord["classification"];
      sanitizedErrorCode: string | null;
      dailyLimit: number | null;
      dailyRemaining: number | null;
      minuteLimit: number | null;
      minuteRemaining: number | null;
    } }) => {
      this.database.prepare(
        'INSERT INTO "ProviderRequestAudit" ("id", "providerId", "importBatchId", "endpointKey", "requestKeyHash", "correlationId", "attemptNumber", "startedAtUtc", "finishedAtUtc", "httpStatus", "classification", "sanitizedErrorCode", "dailyLimit", "dailyRemaining", "minuteLimit", "minuteRemaining") VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      ).run(
        data.id,
        data.providerId,
        data.importBatchId,
        data.endpointKey,
        data.requestKeyHash,
        data.correlationId,
        data.attemptNumber,
        data.startedAtUtc.toISOString(),
        data.finishedAtUtc?.toISOString() ?? null,
        data.httpStatus,
        data.classification,
        data.sanitizedErrorCode,
        data.dailyLimit,
        data.dailyRemaining,
        data.minuteLimit,
        data.minuteRemaining,
      );
      return Object.freeze({
        ...data,
        startedAtUtc: data.startedAtUtc.toISOString(),
        finishedAtUtc: data.finishedAtUtc?.toISOString() ?? null,
      });
    },
  };
}

let temporaryRoot = "";
let databasePath = "";
let database: TestDatabase;
let repository: PrismaProviderRequestAuditRepository;

function audit(overrides: Partial<ProviderRequestAuditRecord> = {}): ProviderRequestAuditRecord {
  return Object.freeze({
    providerKey: "api-football",
    importBatchId: null,
    endpointKey: "prediction-by-fixture",
    requestKeyHash: "b".repeat(64),
    correlationId: "synthetic-audit-correlation",
    attemptNumber: 1,
    startedAtUtc: "2030-01-01T00:00:00.000Z",
    finishedAtUtc: "2030-01-01T00:00:01.000Z",
    httpStatus: 200,
    classification: "SUCCESS",
    sanitizedErrorCode: null,
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null,
    ...overrides,
  });
}

beforeAll(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_AUDIT_APPEND_ONLY_TEST");
  }) as typeof fetch;
});

beforeEach(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), "ou25-market-v2-request-audit-"));
  temporaryRoots.push(temporaryRoot);
  databasePath = join(temporaryRoot, "temporary-request-audit.sqlite");
  temporaryDatabasePaths.push(databasePath);
  database = new DatabaseSync(databasePath);
  database.exec("PRAGMA foreign_keys = ON;");
  for (const migration of migrationSources) database.exec(migration);
  repository = new PrismaProviderRequestAuditRepository(
    new SqliteAuditPrismaAdapter(database),
  );
});

afterEach(() => {
  database.close();
  for (const suffix of ["", "-journal", "-wal", "-shm"]) {
    rmSync(`${databasePath}${suffix}`, { force: true });
  }
  rmSync(temporaryRoot, { recursive: true, force: true });
  expect(existsSync(temporaryRoot)).toBe(false);
  expect(["", "-journal", "-wal", "-shm"].every(
    (suffix) => !existsSync(`${databasePath}${suffix}`),
  )).toBe(true);
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(fetchCalls).toBe(0);
  expect(temporaryRoots.every((root) => !existsSync(root))).toBe(true);
  expect(temporaryDatabasePaths.every((path) =>
    ["", "-journal", "-wal", "-shm"].every((suffix) => !existsSync(`${path}${suffix}`))))
    .toBe(true);
});

describe("ProviderRequestAudit structural Prisma persistence", () => {
  it("creates the stable provider, inserts one audit, and exactly replays it", async () => {
    const first = await repository.append(audit());
    const replay = await repository.append(audit());
    expect(first).toEqual({ ok: true, disposition: "CREATED" });
    expect(replay).toEqual({ ok: true, disposition: "REPLAYED" });
    expect(database.prepare(
      'SELECT "stableKey", "displayName" FROM "Provider"',
    ).get()).toEqual({ stableKey: "api-football", displayName: "API-Football" });
    expect(database.prepare('SELECT COUNT(*) AS count FROM "ProviderRequestAudit"').get())
      .toEqual({ count: 1 });
  });

  it("conflicts on different content at the same request attempt", async () => {
    await repository.append(audit());
    const result = await repository.append(audit({ correlationId: "other-correlation" }));
    expect(result).toMatchObject({
      ok: false,
      disposition: "CONFLICT",
      error: { retryable: false, sanitizedCode: "PROVIDER_REQUEST_AUDIT_CONFLICT" },
    });
    expect(JSON.stringify(result)).not.toContain("other-correlation");
  });

  it("appends a different attempt number under the same request key", async () => {
    expect((await repository.append(audit())).disposition).toBe("CREATED");
    expect((await repository.append(audit({ attemptNumber: 2 }))).disposition).toBe("CREATED");
    expect(database.prepare('SELECT COUNT(*) AS count FROM "ProviderRequestAudit"').get())
      .toEqual({ count: 2 });
  });

  it("preserves null limits, logical endpoint, and valid classification", async () => {
    await repository.append(audit({ classification: "INVALID_RESPONSE", httpStatus: null }));
    expect(database.prepare(
      'SELECT "endpointKey", "classification", "httpStatus", "dailyLimit", "dailyRemaining", "minuteLimit", "minuteRemaining" FROM "ProviderRequestAudit"',
    ).get()).toEqual({
      endpointKey: "prediction-by-fixture",
      classification: "INVALID_RESPONSE",
      httpStatus: null,
      dailyLimit: null,
      dailyRemaining: null,
      minuteLimit: null,
      minuteRemaining: null,
    });
  });

  it("preserves numeric limits and optional ImportBatch relation", async () => {
    database.exec(`
      INSERT INTO "ImportBatch"
        ("id", "sourceType", "startedAtUtc", "status", "policyVersion")
      VALUES
        ('synthetic-import-batch', 'SYNTHETIC_API_FOOTBALL',
         '2030-01-01T00:00:00.000Z', 'STARTED', 'synthetic-policy/1.0');
    `);
    await repository.append(audit({
      importBatchId: "synthetic-import-batch",
      dailyLimit: 250,
      dailyRemaining: 42,
      minuteLimit: 60,
      minuteRemaining: 12,
    }));
    expect(database.prepare(
      'SELECT "importBatchId", "dailyLimit", "dailyRemaining", "minuteLimit", "minuteRemaining" FROM "ProviderRequestAudit"',
    ).get()).toEqual({
      importBatchId: "synthetic-import-batch",
      dailyLimit: 250,
      dailyRemaining: 42,
      minuteLimit: 60,
      minuteRemaining: 12,
    });
  });

  it("enforces database uniqueness independently of repository replay", async () => {
    await repository.append(audit());
    expect(() => database.prepare(
      'INSERT INTO "ProviderRequestAudit" ("id", "providerId", "endpointKey", "requestKeyHash", "correlationId", "attemptNumber", "startedAtUtc", "classification") VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      "synthetic-duplicate-id",
      "provider:api-football",
      "prediction-by-fixture",
      "b".repeat(64),
      "synthetic-duplicate-correlation",
      1,
      "2030-01-01T00:00:02.000Z",
      "SUCCESS",
    )).toThrow(/UNIQUE constraint failed/u);
  });

  it("rejects UPDATE and DELETE through append-only triggers", async () => {
    await repository.append(audit());
    expect(() => database.exec(
      'UPDATE "ProviderRequestAudit" SET "classification" = \'PERMANENT_FAILURE\'',
    )).toThrow(/MARKET_V2_APPEND_ONLY: ProviderRequestAudit UPDATE rejected/u);
    expect(() => database.exec('DELETE FROM "ProviderRequestAudit"'))
      .toThrow(/MARKET_V2_APPEND_ONLY: ProviderRequestAudit DELETE rejected/u);
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
  });

  it("has no secret, body, response, or full-header columns", () => {
    const columns = (database.prepare('PRAGMA table_info("ProviderRequestAudit")').all() as
      Array<{ name: string }>).map(({ name }) => name.toLowerCase());
    for (const forbidden of [
      "apikey",
      "api_key",
      "token",
      "authorization",
      "cookie",
      "body",
      "response",
      "headers",
      "url",
    ]) {
      expect(columns).not.toContain(forbidden);
    }
  });

  it("returns only a sanitized failure for invalid public input", async () => {
    const result = await repository.append(audit({ endpointKey: "https://invalid.example/path" }));
    expect(result).toMatchObject({
      ok: false,
      disposition: "FAILED",
      error: {
        classification: "FAILED",
        retryable: false,
        sanitizedCode: "PROVIDER_REQUEST_AUDIT_INVALID",
      },
    });
    expect(JSON.stringify(result)).not.toContain("invalid.example");
    expect(fetchCalls).toBe(0);
  });
});
