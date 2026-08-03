import { createHash } from "node:crypto";
import {
  access,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiFootballRunnerError,
  createApiFootballRuntimeClock,
  parseApiFootballRunnerArguments,
  parseApiFootballTargets,
  runApiFootball,
  SystemUtcCaptureClock,
  type ApiFootballRunnerArguments,
  type ApiFootballRunnerTarget,
} from "@/infrastructure/market-v2/api-football/runtime";

const executeFile = promisify(execFile);
const repositoryRoot = "/home/yvaforma/odds/ou25-market-v2";
const stage16bPilotRoot = "/home/yvaforma/odds/runtime-pilots/api-football-runner-resolve-20260803T133508Z";
const secretMarker = "REAL_SECRET_MUST_NOT_BE_READ_OR_PRINTED";
const originalGlobalFetch = globalThis.fetch;
let unexpectedGlobalFetchCalls = 0;
let stage16bPilotDigest = "";

const targetDocument = Object.freeze({
  canonicalFixtureId: "canonical-runner-900001",
  providerKey: "api-football",
  providerFixtureId: "900001",
  providerCompetitionId: "910001",
  season: 2030,
  homeProviderTeamId: "920001",
  homeName: "Synthetic Home FC",
  awayProviderTeamId: "920002",
  awayName: "Synthetic Away FC",
  kickoffUtc: "2030-01-01T18:00:00Z",
  sourceTimezone: "UTC",
});

function targets(document: unknown = targetDocument): readonly ApiFootballRunnerTarget[] {
  return parseApiFootballTargets(document);
}

function args(
  command: "prematch" | "resolve",
  maxAttempts: number,
  mode: "DRY_RUN" | "NETWORK" = "DRY_RUN",
): ApiFootballRunnerArguments {
  return Object.freeze({
    command,
    targetFile: "/tmp/explicit-target.json",
    databaseUrl: "file:/tmp/explicit-market-v2.sqlite",
    evidenceRoot: "/tmp/explicit-evidence",
    maxAttempts,
    dailyThreshold: 20,
    mode,
    prevalidatedBinding: false,
  });
}

async function missing(path: string | undefined): Promise<boolean> {
  if (path === undefined) return false;
  try {
    await access(path);
    return false;
  } catch {
    return true;
  }
}

function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function treeDigest(root: string): Promise<string> {
  const rows: string[] = [];
  async function visit(path: string, relativePath: string): Promise<void> {
    const metadata = await lstat(path);
    rows.push(`${relativePath}\u0000${metadata.mode & 0o777}\u0000${metadata.size}`);
    if (metadata.isFile()) rows.push(sha256(await readFile(path)));
    if (metadata.isDirectory()) {
      const entries = (await readdir(path)).sort();
      for (const entry of entries) await visit(join(path, entry), join(relativePath, entry));
    }
  }
  await visit(root, ".");
  return sha256(rows.join("\n"));
}

async function runnerTemporaryRoots(): Promise<readonly string[]> {
  return (await readdir(join(repositoryRoot, "node_modules")))
    .filter((entry) => entry.startsWith(".ou25-api-football-r0-"))
    .sort();
}

type NetworkSandbox = Readonly<{
  root: string;
  databaseUrl: string;
  evidenceRoot: string;
}>;

type NetworkSeedOptions = Readonly<{
  fixture?: boolean;
  provider?: boolean;
  identity?: boolean;
  duplicateIdentity?: boolean;
  fixtureStatus?: "SCHEDULED" | "STARTED" | "FINISHED";
  fixtureKickoffUtc?: string;
  providerFixtureId?: string;
  providerCompetitionId?: string;
  season?: string;
  homeProviderTeamId?: string;
  awayProviderTeamId?: string;
  homeName?: string;
  awayName?: string;
  sourceDateRaw?: string;
  sourceTimezone?: string;
}>;

async function prepareNetworkSandbox(
  fixtureStatus: "SCHEDULED" | "FINISHED" = "FINISHED",
  options: NetworkSeedOptions = {},
): Promise<NetworkSandbox> {
  const root = await mkdtemp(join(repositoryRoot, "node_modules/.api-football-network-clock-test-"));
  const evidenceRoot = join(root, "evidence");
  const databasePath = join(root, "network.sqlite");
  const databaseUrl = `file:${databasePath}`;
  await mkdir(evidenceRoot, { mode: 0o700 });
  await cp(join(repositoryRoot, "prisma/market-v2/migrations"), join(root, "migrations"), {
    recursive: true,
  });
  const schemaPath = join(root, "schema.prisma");
  const seedPath = join(root, "seed.sql");
  const includeFixture = options.fixture ?? true;
  const includeProvider = options.provider ?? true;
  const includeIdentity = (options.identity ?? true) && includeFixture && includeProvider;
  const effectiveStatus = options.fixtureStatus ?? fixtureStatus;
  const fixtureKickoffUtc = options.fixtureKickoffUtc ?? "2030-01-01T18:00:00.000Z";
  await writeFile(schemaPath, `datasource db {\n  provider = "sqlite"\n  url = "${databaseUrl}"\n}\n`, { mode: 0o600 });
  await writeFile(seedPath, `
PRAGMA foreign_keys=ON;
INSERT INTO "Team" ("id", "canonicalKey", "displayName") VALUES ('network-home', 'network-home', '${options.homeName ?? "Synthetic Home FC"}');
INSERT INTO "Team" ("id", "canonicalKey", "displayName") VALUES ('network-away', 'network-away', '${options.awayName ?? "Synthetic Away FC"}');
${includeFixture ? `INSERT INTO "Fixture" ("id", "localTeamId", "awayTeamId", "competitionKey", "kickoffAtUtc", "status")
VALUES ('canonical-runner-900001', 'network-home', 'network-away', 'network-test:910001', '${fixtureKickoffUtc}', '${effectiveStatus}');` : ""}
${includeProvider ? `INSERT INTO "Provider" ("id", "stableKey", "displayName") VALUES ('network-provider', 'api-football', 'API-Football');` : ""}
${includeIdentity ? `INSERT INTO "ProviderFixtureIdentity" (
  "id", "providerId", "providerFixtureId", "fixtureId", "providerCompetitionId",
  "providerHomeTeamId", "providerAwayTeamId", "season", "sourceDateRaw", "sourceTimestamp", "sourceTimezone"
) VALUES (
  'network-binding', 'network-provider', '${options.providerFixtureId ?? "900001"}', 'canonical-runner-900001', '${options.providerCompetitionId ?? "910001"}',
  '${options.homeProviderTeamId ?? "920001"}', '${options.awayProviderTeamId ?? "920002"}', '${options.season ?? "2030"}', '${options.sourceDateRaw ?? "2030-01-01T18:00:00.000Z"}', '1893520800', '${options.sourceTimezone ?? "UTC"}'
);` : ""}
${options.duplicateIdentity && includeFixture ? `
INSERT INTO "Provider" ("id", "stableKey", "displayName")
VALUES ('conflict-provider', 'conflict-provider', 'Conflict Provider');
INSERT INTO "ProviderFixtureIdentity" (
  "id", "providerId", "providerFixtureId", "fixtureId", "providerCompetitionId",
  "providerHomeTeamId", "providerAwayTeamId", "season", "sourceDateRaw",
  "sourceTimestamp", "sourceTimezone"
) VALUES (
  'conflict-binding', 'conflict-provider', '999001', 'canonical-runner-900001',
  '910001', '920001', '920002', '2030', '2030-01-01T18:00:00.000Z',
  '1893520800', 'UTC'
);` : ""}
`, { mode: 0o600 });
  const prisma = join(repositoryRoot, "node_modules/.bin/prisma");
  await executeFile(prisma, ["migrate", "deploy", "--schema", schemaPath]);
  await executeFile(prisma, ["db", "execute", "--url", databaseUrl, "--file", seedPath]);
  return Object.freeze({ root, databaseUrl, evidenceRoot });
}

function prevalidatedArgs(sandbox: NetworkSandbox): ApiFootballRunnerArguments {
  return Object.freeze({
    ...args("prematch", 1, "NETWORK"),
    databaseUrl: sandbox.databaseUrl,
    evidenceRoot: sandbox.evidenceRoot,
    prevalidatedBinding: true,
  });
}

function syntheticNetworkOutcomeResponse(): Response {
  const body = {
    get: "fixtures",
    parameters: { id: "900001" },
    errors: [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: [{
      fixture: {
        id: 900001,
        date: "2030-01-01T18:00:00.000Z",
        timestamp: 1_893_520_800,
        timezone: "UTC",
        status: { long: "Match Finished", short: "FT" },
      },
      league: {
        id: 910001,
        name: "Synthetic R0 League",
        country: "Synthetic Country",
        season: 2030,
        round: "Synthetic Round",
      },
      teams: {
        home: { id: 920001, name: "Synthetic Home FC" },
        away: { id: 920002, name: "Synthetic Away FC" },
      },
      goals: { home: 2, away: 1 },
      score: {
        halftime: { home: 1, away: 0 },
        fulltime: { home: 2, away: 1 },
        extratime: { home: null, away: null },
        penalty: { home: null, away: null },
      },
    }],
  };
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-requests-limit": "100",
      "x-ratelimit-requests-remaining": "99",
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "9",
    },
  });
}

function syntheticNetworkPredictionResponse(): Response {
  return new Response(JSON.stringify({
    get: "predictions",
    parameters: { fixture: "900001" },
    errors: [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: [{
      predictions: {
        winner: { id: 920001, name: "Synthetic Home FC", comment: "Synthetic confidence" },
        advice: "Synthetic direct-prematch advice",
        under_over: "Synthetic total",
        goals: { home: null, away: null },
        percent: { home: "45%", draw: "30%", away: "25%" },
      },
      teams: {
        home: { id: 920001, name: "Synthetic Home FC" },
        away: { id: 920002, name: "Synthetic Away FC" },
      },
    }],
  }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-ratelimit-requests-limit": "100",
      "x-ratelimit-requests-remaining": "99",
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "9",
    },
  });
}

function runnerErrorCode(operation: () => unknown): string {
  try {
    operation();
    return "NO_ERROR";
  } catch (error) {
    return error instanceof ApiFootballRunnerError ? error.sanitizedCode : "UNEXPECTED";
  }
}

beforeAll(async () => {
  stage16bPilotDigest = await treeDigest(stage16bPilotRoot);
  globalThis.fetch = (async () => {
    unexpectedGlobalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_RUNNER_TEST");
  }) as typeof fetch;
});

afterAll(async () => {
  globalThis.fetch = originalGlobalFetch;
  expect(unexpectedGlobalFetchCalls).toBe(0);
  expect(await treeDigest(stage16bPilotRoot)).toBe(stage16bPilotDigest);
});

describe.sequential("API-Football R0 runner", () => {
  it("requires a subcommand, an explicit mode, and rejects unknown target fields before IO", () => {
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([]))).toBe("SUBCOMMAND_REQUIRED");
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
      "prematch",
      "--target", "/tmp/target.json",
      "--database-url", "file:/tmp/database.sqlite",
      "--evidence-root", "/tmp/evidence",
      "--max-attempts", "4",
      "--daily-threshold", "20",
    ]))).toBe("EXPLICIT_MODE_REQUIRED");
    let ioCalls = 0;
    expect(runnerErrorCode(() => {
      const invalid = { ...targetDocument, unexpected: (++ioCalls, "blocked") };
      parseApiFootballTargets(invalid);
    })).toBe("TARGET_FIELDS_INVALID");
    expect(ioCalls).toBe(1);
    expect(runnerErrorCode(() => parseApiFootballTargets({
      ...targetDocument,
      homeProviderTeamId: targetDocument.awayProviderTeamId,
    }))).toBe("TARGET_INVALID");
    for (const forbiddenFlag of ["--clock", "--captured-at"]) {
      expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
        "resolve",
        "--target", "/tmp/target.json",
        "--database-url", "file:/tmp/database.sqlite",
        "--evidence-root", "/tmp/evidence",
        "--max-attempts", "1",
        "--daily-threshold", "20",
        "--allow-network",
        forbiddenFlag, "2031-02-03T10:00:00.000Z",
      ]))).toBe("ARGUMENT_UNKNOWN");
    }
  });

  it("accepts prevalidated binding only for explicit NETWORK prematch", () => {
    const common = [
      "--target", "/tmp/target.json",
      "--database-url", "file:/tmp/database.sqlite",
      "--evidence-root", "/tmp/evidence",
      "--max-attempts", "1",
      "--daily-threshold", "20",
      "--prevalidated-binding",
    ] as const;
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
      "--prevalidated-binding",
      ...common.slice(0, -1),
      "--allow-network",
    ]))).toBe("SUBCOMMAND_REQUIRED");
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
      "resolve",
      ...common,
      "--allow-network",
    ]))).toBe("PREVALIDATED_BINDING_PREMATCH_ONLY");
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
      "prematch",
      ...common,
    ]))).toBe("EXPLICIT_MODE_REQUIRED");
    expect(runnerErrorCode(() => parseApiFootballRunnerArguments([
      "prematch",
      ...common,
      "--dry-run",
    ]))).toBe("PREVALIDATED_BINDING_REQUIRES_NETWORK_MODE");
    expect(parseApiFootballRunnerArguments([
      "prematch",
      ...common,
      "--allow-network",
    ])).toMatchObject({
      command: "prematch",
      mode: "NETWORK",
      prevalidatedBinding: true,
      maxAttempts: 1,
    });
  });

  it("requires exactly one governed attempt in prevalidated mode before credential or transport", async () => {
    let credentialsRead = 0;
    let transportCalls = 0;
    await expect(runApiFootball(Object.freeze({
      ...args("prematch", 2, "NETWORK"),
      prevalidatedBinding: true,
    }), targets(), {
      apiKeyProvider: () => {
        credentialsRead += 1;
        return secretMarker;
      },
      networkFetch: async () => {
        transportCalls += 1;
        return syntheticNetworkPredictionResponse();
      },
    })).rejects.toMatchObject({ sanitizedCode: "PREVALIDATED_BUDGET_MUST_BE_ONE" });
    expect(credentialsRead).toBe(0);
    expect(transportCalls).toBe(0);
  });

  it("separates deterministic DRY_RUN time from the system UTC NETWORK clock", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2040-04-05T06:07:08.000Z"));
      const systemClock = new SystemUtcCaptureClock();
      expect(systemClock.nowUtc()).toBe("2040-04-05T06:07:08.000Z");
      vi.advanceTimersByTime(7);
      expect(systemClock.nowUtc()).toBe("2040-04-05T06:07:08.007Z");
      const networkClock = createApiFootballRuntimeClock(
        { command: "resolve", mode: "NETWORK" },
        targets(),
      );
      expect(networkClock.nowUtc()).toBe("2040-04-05T06:07:08.007Z");
      expect(networkClock.nowUtc()).not.toBe(targets()[0].kickoffUtc);
      const firstDryRun = createApiFootballRuntimeClock(
        { command: "resolve", mode: "DRY_RUN" },
        targets(),
      );
      const secondDryRun = createApiFootballRuntimeClock(
        { command: "resolve", mode: "DRY_RUN" },
        targets(),
      );
      expect(firstDryRun.nowUtc()).toBe("2030-01-02T00:00:00.000Z");
      expect(secondDryRun.nowUtc()).toBe(firstDryRun.nowUtc());
      expect(firstDryRun.nowUtc()).not.toBe(systemClock.nowUtc());
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps network disabled by default and requires the sole allowed credential before transport", async () => {
    let transportCalls = 0;
    await expect(runApiFootball(args("prematch", 1, "NETWORK"), targets(), {
      apiKeyProvider: () => undefined,
      networkFetch: async () => {
        transportCalls += 1;
        throw new Error("NETWORK_MUST_NOT_RUN");
      },
    })).rejects.toMatchObject({ sanitizedCode: "API_FOOTBALL_KEY_REQUIRED" });
    expect(transportCalls).toBe(0);
  });

  it("uses one injected operational clock across fake NETWORK evidence, Outcome, and audit", async () => {
    const sandbox = await prepareNetworkSandbox();
    const operationalTimes = [
      "2031-02-03T10:00:00.000Z",
      "2031-02-03T10:00:01.000Z",
      "2031-02-03T10:00:02.000Z",
    ] as const;
    const clockReads: string[] = [];
    const networkClock = Object.freeze({
      nowUtc() {
        const value = operationalTimes[clockReads.length];
        if (value === undefined) throw new Error("UNEXPECTED_CLOCK_READ");
        clockReads.push(value);
        return value;
      },
    });
    let fakeFetchCalls = 0;
    const credential = vi.fn(() => "SYNTHETIC_NETWORK_TEST_KEY");
    try {
      const networkArgs: ApiFootballRunnerArguments = Object.freeze({
        ...args("resolve", 1, "NETWORK"),
        databaseUrl: sandbox.databaseUrl,
        evidenceRoot: sandbox.evidenceRoot,
      });
      const result = await runApiFootball(networkArgs, targets(), {
        apiKeyProvider: credential,
        networkClock,
        networkFetch: async () => {
          fakeFetchCalls += 1;
          return syntheticNetworkOutcomeResponse();
        },
      });
      expect(result).toMatchObject({
        complete: true,
        exitCode: 0,
        mode: "NETWORK",
        targetResults: ["RESOLVED_CREATED"],
        attemptsUsed: 1,
        attemptsRemaining: 0,
        outcomesCreated: 1,
        evidenceCreated: 1,
        auditRecords: 1,
        networkUsed: true,
        networkCalls: 1,
        credentialsRead: 1,
      });
      expect(fakeFetchCalls).toBe(1);
      expect(credential).toHaveBeenCalledTimes(1);
      expect(clockReads).toEqual(operationalTimes);
      const query = `
        const { DatabaseSync } = require("node:sqlite");
        const database = new DatabaseSync(process.argv[1], { readOnly: true });
        const iso = (value) => new Date(value).toISOString();
        const artifact = database.prepare("SELECT capturedAtUtc FROM SourceArtifact").get();
        const outcome = database.prepare("SELECT observedAtUtc FROM Outcome").get();
        const audit = database.prepare("SELECT startedAtUtc, finishedAtUtc FROM ProviderRequestAudit").get();
        process.stdout.write(JSON.stringify({
          evidence: iso(artifact.capturedAtUtc),
          outcome: iso(outcome.observedAtUtc),
          auditStarted: iso(audit.startedAtUtc),
          auditFinished: iso(audit.finishedAtUtc),
        }));
        database.close();
      `;
      const inspected = await executeFile(process.execPath, [
        "-e",
        query,
        sandbox.databaseUrl.slice("file:".length),
      ]);
      const timestamps = JSON.parse(inspected.stdout) as Readonly<Record<string, string>>;
      expect(timestamps).toEqual({
        evidence: operationalTimes[1],
        outcome: operationalTimes[1],
        auditStarted: operationalTimes[0],
        auditFinished: operationalTimes[2],
      });
      expect(Date.parse(timestamps.auditFinished)).toBeGreaterThanOrEqual(
        Date.parse(timestamps.auditStarted),
      );
      for (const timestamp of Object.values(timestamps)) {
        expect(timestamp).toMatch(/Z$/u);
        expect(timestamp).not.toBe(targets()[0].kickoffUtc);
        expect(timestamp).not.toBe("2030-01-02T00:00:00.000Z");
      }
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
    expect(await missing(sandbox.root)).toBe(true);
  }, 60_000);

  it("rejects every missing or conflicting local binding before credential and fetch", async () => {
    const cases = [
      {
        label: "canonical fixture missing",
        options: { fixture: false },
      },
      {
        label: "provider missing",
        options: { provider: false },
      },
      { label: "identity missing", options: { identity: false } },
      {
        label: "identity duplicated on fixture",
        options: { duplicateIdentity: true },
      },
      {
        label: "provider fixture differs",
        options: { providerFixtureId: "900009" },
      },
      {
        label: "competition differs",
        options: { providerCompetitionId: "910009" },
      },
      {
        label: "season differs",
        options: { season: "2031" },
      },
      {
        label: "home provider team differs",
        options: { homeProviderTeamId: "920009" },
      },
      {
        label: "away provider team differs",
        options: { awayProviderTeamId: "920009" },
      },
      {
        label: "home canonical team differs",
        options: { homeName: "Different Home" },
      },
      {
        label: "away canonical team differs",
        options: { awayName: "Different Away" },
      },
      {
        label: "kickoff differs",
        options: { fixtureKickoffUtc: "2030-01-01T19:00:00.000Z" },
      },
      {
        label: "source timezone differs",
        options: { sourceTimezone: "Europe/Berlin" },
      },
      {
        label: "source kickoff differs",
        options: { sourceDateRaw: "2030-01-01T19:00:00.000Z" },
      },
      {
        label: "fixture already started",
        options: { fixtureStatus: "STARTED" as const },
      },
    ] as const;
    for (const testCase of cases) {
      const sandbox = await prepareNetworkSandbox("SCHEDULED", testCase.options);
      let credentialReads = 0;
      let fetchCalls = 0;
      try {
        await expect(runApiFootball(prevalidatedArgs(sandbox), targets(), {
          apiKeyProvider: () => {
            credentialReads += 1;
            return secretMarker;
          },
          networkClock: Object.freeze({ nowUtc: () => "2029-12-31T12:00:00.000Z" }),
          networkFetch: async () => {
            fetchCalls += 1;
            return syntheticNetworkPredictionResponse();
          },
        }), testCase.label).rejects.toBeInstanceOf(ApiFootballRunnerError);
        expect(credentialReads, testCase.label).toBe(0);
        expect(fetchCalls, testCase.label).toBe(0);
      } finally {
        await rm(sandbox.root, { recursive: true, force: true });
      }
    }
  }, 300_000);

  it("demonstrates PREVALIDATED with FIXTURE_DISCOVERY_CALLS 0 and PREDICTION_CALLS 1", async () => {
    const sandbox = await prepareNetworkSandbox("SCHEDULED");
    expect(await runnerTemporaryRoots()).toEqual([]);
    const events: string[] = [];
    const requestedUrls: string[] = [];
    const credential = vi.fn(() => secretMarker);
    const dependencies = Object.freeze({
      apiKeyProvider: credential,
      networkClock: Object.freeze({ nowUtc: () => "2029-12-31T12:00:00.000Z" }),
      networkFetch: async (input: string | URL) => {
        events.push("CLIENT");
        requestedUrls.push(String(input));
        return syntheticNetworkPredictionResponse();
      },
      eventSink: (event: "CLIENT" | "EVIDENCE" | "MAPPER") => events.push(event),
    });
    try {
      const first = await runApiFootball(prevalidatedArgs(sandbox), targets(), dependencies);
      expect(first).toMatchObject({
        complete: true,
        exitCode: 0,
        targetResults: ["PREMATCH_CAPTURED"],
        attemptsUsed: 1,
        attemptsRemaining: 0,
        evidenceCreated: 1,
        fixturesCreated: 0,
        predictionsCreated: 1,
        outcomesCreated: 0,
        auditRecords: 1,
        networkCalls: 1,
        bindingMode: "PREVALIDATED",
        bindingValidated: true,
        fixtureDiscoveryCalls: 0,
        predictionCalls: 1,
      });
      expect(events).toEqual(["CLIENT", "EVIDENCE", "MAPPER"]);
      expect(requestedUrls).toHaveLength(1);
      const firstUrl = new URL(requestedUrls[0]);
      expect(firstUrl.origin).toBe("https://v3.football.api-sports.io");
      expect(firstUrl.pathname).toBe("/predictions");
      expect([...firstUrl.searchParams.entries()]).toEqual([["fixture", "900001"]]);
      expect(JSON.stringify(first)).not.toContain(secretMarker);

      events.length = 0;
      const replay = await runApiFootball(prevalidatedArgs(sandbox), targets(), dependencies);
      expect(replay).toMatchObject({
        complete: true,
        targetResults: ["REPLAYED"],
        evidenceCreated: 0,
        fixturesCreated: 0,
        predictionsCreated: 0,
        fixtureDiscoveryCalls: 0,
        predictionCalls: 1,
      });
      expect(events).toEqual(["CLIENT", "EVIDENCE", "MAPPER"]);
      expect(requestedUrls).toHaveLength(2);
      expect(credential).toHaveBeenCalledTimes(2);

      const inspection = await executeFile(process.execPath, [
        "-e",
        `
          const { DatabaseSync } = require("node:sqlite");
          const database = new DatabaseSync(process.argv[1], { readOnly: true });
          const count = (table) => database.prepare('SELECT COUNT(*) AS value FROM "' + table + '"').get().value;
          const selections = database.prepare('SELECT "selection" FROM "PredictionProbability" ORDER BY "selection"').all();
          process.stdout.write(JSON.stringify({
            bindings: count("ProviderFixtureIdentity"),
            snapshots: count("PredictionSnapshot"),
            probabilities: count("PredictionProbability"),
            outcomes: count("Outcome"),
            odds: count("OddsSnapshot"),
            selections: selections.map((row) => row.selection),
          }));
          database.close();
        `,
        sandbox.databaseUrl.slice("file:".length),
      ]);
      expect(JSON.parse(inspection.stdout)).toEqual({
        bindings: 1,
        snapshots: 1,
        probabilities: 3,
        outcomes: 0,
        odds: 0,
        selections: ["AWAY", "DRAW", "HOME"],
      });
    } finally {
      await rm(sandbox.root, { recursive: true, force: true });
    }
    expect(await missing(sandbox.root)).toBe(true);
    expect(await runnerTemporaryRoots()).toEqual([]);
  }, 60_000);

  it("runs PREMATCH through client, evidence, mapper and Prisma with shared governance and replay", async () => {
    const packageLockBefore = await readFile(`${repositoryRoot}/package-lock.json`, "utf8");
    const events: string[] = [];
    const credential = vi.fn(() => secretMarker);
    const originalFetch = globalThis.fetch;
    let globalFetchCalls = 0;
    globalThis.fetch = (async () => {
      globalFetchCalls += 1;
      throw new Error("GLOBAL_FETCH_FORBIDDEN");
    }) as typeof fetch;
    try {
      const result = await runApiFootball(args("prematch", 4), targets(), {
        apiKeyProvider: credential,
        eventSink: (event) => events.push(event),
      });
      expect(result).toMatchObject({
        complete: true,
        exitCode: 0,
        mode: "DRY_RUN",
        targetCount: 1,
        targetResults: ["PREMATCH_CAPTURED", "REPLAYED"],
        attemptsUsed: 4,
        attemptsRemaining: 0,
        circuitState: "CLOSED",
        fixturesCreated: 1,
        predictionsCreated: 1,
        outcomesCreated: 0,
        replayed: 1,
        conflicts: 0,
        auditRecords: 4,
        networkUsed: false,
        networkCalls: 0,
        credentialsRead: 0,
        sharedBudgetAndBreaker: true,
        temporaryDatabaseRemoved: true,
        temporaryEvidenceRemoved: true,
      });
      expect(result.evidenceCreated).toBe(2);
      expect(events.indexOf("EVIDENCE")).toBeGreaterThan(events.indexOf("CLIENT"));
      expect(events.indexOf("MAPPER")).toBeGreaterThan(events.indexOf("EVIDENCE"));
      expect(credential).not.toHaveBeenCalled();
      expect(globalFetchCalls).toBe(0);
      expect(await missing(result.temporaryDatabasePath)).toBe(true);
      expect(await missing(result.temporaryEvidenceRoot)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(secretMarker);
    } finally {
      globalThis.fetch = originalFetch;
    }
    const packageLockAfter = await readFile(`${repositoryRoot}/package-lock.json`, "utf8");
    expect(sha256(packageLockAfter)).toBe(sha256(packageLockBefore));
  }, 60_000);

  it("runs OUTCOME, persists terminal FT once, and replays without duplication", async () => {
    const result = await runApiFootball(args("resolve", 2), targets());
    expect(result).toMatchObject({
      complete: true,
      targetResults: ["RESOLVED_CREATED", "RESOLVED_REPLAYED"],
      attemptsUsed: 2,
      fixturesCreated: 0,
      predictionsCreated: 0,
      outcomesCreated: 1,
      replayed: 1,
      auditRecords: 2,
      networkCalls: 0,
      temporaryDatabaseRemoved: true,
      temporaryEvidenceRemoved: true,
    });
    expect(await missing(result.temporaryDatabasePath)).toBe(true);
    expect(await missing(result.temporaryEvidenceRoot)).toBe(true);
  }, 60_000);

  it("blocks a post-kickoff prediction after fixture capture", async () => {
    const result = await runApiFootball(args("prematch", 4), targets(), {
      dryRunClockUtc: "2030-01-01T19:00:00.000Z",
    });
    expect(result).toMatchObject({
      complete: false,
      exitCode: 1,
      targetResults: ["KICKOFF_NOT_FUTURE"],
      predictionsCreated: 0,
      outcomesCreated: 0,
      networkCalls: 0,
    });
  }, 60_000);

  it("rejects a non-terminal result without creating an Outcome", async () => {
    const result = await runApiFootball(args("resolve", 2), targets(), {
      dryRunOutcomeStatus: "NS",
    });
    expect(result).toMatchObject({
      complete: false,
      exitCode: 1,
      targetResults: ["PENDING_NOT_TERMINAL"],
      outcomesCreated: 0,
      networkCalls: 0,
    });
  }, 60_000);

  it("contains no scheduler, polling, arbitrary API, or The Odds API path and leaves legacy untouched", async () => {
    const runtimeSource = await readFile(
      `${repositoryRoot}/src/infrastructure/market-v2/api-football/runtime.ts`,
      "utf8",
    );
    const runnerSource = await readFile(
      `${repositoryRoot}/scripts/market-v2-api-football.ts`,
      "utf8",
    );
    const source = `${runtimeSource}\n${runnerSource}`;
    expect(source).not.toMatch(/setInterval|scheduler|polling|THE_ODDS_API|the-odds-api/iu);
    expect(source).not.toContain("providers.env");
    expect(source).not.toContain("prisma/dev.db");
    expect(source).not.toContain("2026-08-01T12:45:00.000Z");
    expect(source).not.toContain("--captured-at");
    expect(source).not.toContain("--clock");
    expect(runnerSource).toContain('["BINDING_MODE", result.bindingMode]');
    expect(runnerSource).toContain('["BINDING_VALIDATED", result.bindingValidated]');
    expect(runnerSource).toContain('["FIXTURE_DISCOVERY_CALLS", result.fixtureDiscoveryCalls]');
    expect(runnerSource).toContain('["PREDICTION_CALLS", result.predictionCalls]');
    expect(runtimeSource).not.toContain("Date.now");
    expect(runtimeSource).toContain("return new Date().toISOString()");
    expect(runtimeSource).toMatch(
      /args\.mode === "NETWORK"[\s\S]*dependencies\.networkClock \?\? new SystemUtcCaptureClock\(\)/u,
    );
    expect(runtimeSource).toMatch(
      /args\.mode === "NETWORK"[\s\S]*deterministicDryRunClock/u,
    );
    const clientConstruction = runtimeSource.slice(
      runtimeSource.indexOf("const clock = createApiFootballRuntimeClock"),
      runtimeSource.indexOf("const provider = new ApiFootballProvider"),
    );
    expect(clientConstruction).not.toContain("kickoffUtc");
    expect(clientConstruction).not.toContain("providerInternalTimestamp");
    expect(source).not.toContain("ou25-consensus-lab");
  });
});
