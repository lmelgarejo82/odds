import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  collectPrematch,
  type PrematchCaptureProviderPort,
  type PrematchTarget,
} from "@/application/market-v2/api-football/collect-prematch";
import {
  resolveOutcomes,
  type OutcomeTarget,
} from "@/application/market-v2/api-football/resolve-outcomes";
import { GovernedRequestExecutor } from "@/application/market-v2/api-football/governed-request-executor";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import type {
  RawEvidenceCandidate,
  RawEvidenceStore,
} from "@/application/market-v2/capture/raw-evidence-store";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";
import type { CaptureClock, CapturedFixture } from "@/domain/market-v2/capture/types";
import { OperationalRawEvidenceStore } from "@/infrastructure/market-v2/capture/operational-evidence-store";
import { ApiFootballClient, type ApiFootballFetch } from "./client";
import { buildApiFootballConfig } from "./config";
import {
  API_FOOTBALL_MAPPER_POLICY_VERSION,
  mapApiFootballFixture,
  mapApiFootballPrediction,
  mapApiFootballResult,
} from "./mappers";
import {
  ApiFootballProvider,
  type ApiFootballProviderMappers,
  type GovernedPredictionInput,
} from "./provider";
import {
  evaluateApiFootballRateLimitResponse,
  parseApiFootballRateLimits,
} from "./rate-limit-parser";
import { RequestBudget } from "./request-budget";
import { RunCircuitBreaker } from "./run-circuit-breaker";
import {
  PrismaApiFootballRepositories,
  PrismaProviderRequestAuditRepository,
  type ApiFootballAuditPrismaClient,
  type ApiFootballPrismaClient,
} from "@/infrastructure/market-v2/persistence/api-football-repositories";

const executeFile = promisify(execFile);
const TARGET_KEYS = Object.freeze([
  "awayName",
  "awayProviderTeamId",
  "canonicalFixtureId",
  "homeName",
  "homeProviderTeamId",
  "kickoffUtc",
  "providerCompetitionId",
  "providerFixtureId",
  "providerKey",
  "season",
  "sourceTimezone",
] as const);
const SAFE_CANONICAL_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;
const POSITIVE_EXTERNAL_ID = /^[1-9]\d*$/u;

export type ApiFootballRunnerCommand = "prematch" | "resolve";
export type ApiFootballRunnerMode = "DRY_RUN" | "NETWORK";

export type ApiFootballRunnerArguments = Readonly<{
  command: ApiFootballRunnerCommand;
  targetFile: string;
  databaseUrl: string;
  evidenceRoot: string;
  maxAttempts: number;
  dailyThreshold: number;
  mode: ApiFootballRunnerMode;
  prevalidatedBinding: boolean;
}>;

export type ApiFootballRunnerTarget = PrematchTarget & OutcomeTarget;

export type ApiFootballRuntimeDependencies = Readonly<{
  apiKeyProvider?: () => string | undefined;
  networkFetch?: ApiFootballFetch;
  networkClock?: CaptureClock;
  dryRunClockUtc?: string;
  dryRunOutcomeStatus?: "FT" | "NS";
  eventSink?: (event: "CLIENT" | "EVIDENCE" | "MAPPER") => void;
}>;

export type ApiFootballRunnerResult = Readonly<{
  complete: boolean;
  exitCode: 0 | 1;
  mode: ApiFootballRunnerMode;
  command: ApiFootballRunnerCommand;
  targetCount: number;
  targetResults: readonly string[];
  attemptsUsed: number;
  attemptsRemaining: number;
  circuitState: "CLOSED" | "OPEN";
  evidenceCreated: number;
  fixturesCreated: number;
  predictionsCreated: number;
  outcomesCreated: number;
  replayed: number;
  conflicts: number;
  auditRecords: number;
  databaseUrlRedacted: "file:<redacted>";
  evidenceRootRedacted: "<temporary>" | "<explicit>";
  networkUsed: boolean;
  networkCalls: number;
  credentialsRead: number;
  sharedBudgetAndBreaker: boolean;
  bindingMode: "DISCOVERY" | "PREVALIDATED";
  bindingValidated: boolean;
  fixtureDiscoveryCalls: number;
  predictionCalls: number;
  temporaryDatabasePath?: string;
  temporaryEvidenceRoot?: string;
  temporaryDatabaseRemoved: boolean;
  temporaryEvidenceRemoved: boolean;
}>;

export class ApiFootballRunnerError extends Error {
  readonly sanitizedCode: string;

  constructor(sanitizedCode: string) {
    super("API-Football runner failed");
    this.name = "ApiFootballRunnerError";
    this.sanitizedCode = sanitizedCode;
  }
}

interface RuntimePrismaClient {
  $disconnect(): Promise<void>;
  readonly team: {
    create(args: unknown): Promise<unknown>;
  };
  readonly fixture: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<Readonly<{
      id: string;
      kickoffAtUtc: Date;
      status: "SCHEDULED" | "POSTPONED" | "CANCELLED" | "STARTED" | "FINISHED" | "UNKNOWN";
      localTeamId: string;
      awayTeamId: string;
      competitionKey: string;
      localTeam: Readonly<{ id: string; displayName: string }>;
      awayTeam: Readonly<{ id: string; displayName: string }>;
    }> | null>;
    count(): Promise<number>;
  };
  readonly provider: {
    findUnique(args: unknown): Promise<Readonly<{ id: string }> | null>;
  };
  readonly providerFixtureIdentity: {
    create(args: unknown): Promise<unknown>;
    findUnique(args: unknown): Promise<Readonly<{
      id: string;
      providerId: string;
      providerFixtureId: string;
      fixtureId: string;
      providerCompetitionId: string | null;
      providerHomeTeamId: string | null;
      providerAwayTeamId: string | null;
      season: string | null;
      sourceDateRaw: string | null;
      sourceTimezone: string | null;
    }> | null>;
    findMany(args: unknown): Promise<readonly Readonly<{
      id: string;
      providerId: string;
      providerFixtureId: string;
      fixtureId: string;
      providerCompetitionId: string | null;
      providerHomeTeamId: string | null;
      providerAwayTeamId: string | null;
      season: string | null;
      round: string | null;
      sourceDateRaw: string | null;
      sourceTimestamp: string | null;
      sourceTimezone: string | null;
    }>[]>;
    count(): Promise<number>;
  };
  readonly predictionSnapshot: { count(): Promise<number> };
  readonly outcome: { count(): Promise<number> };
  readonly sourceArtifact: { count(): Promise<number> };
  readonly providerRequestAudit: { count(): Promise<number> };
}

type PrismaClientConstructor = new () => RuntimePrismaClient;

function fail(code: string): never {
  throw new ApiFootballRunnerError(code);
}

function exactKeys(value: Readonly<Record<string, unknown>>): boolean {
  const actual = Object.keys(value).sort();
  const expected = [...TARGET_KEYS].sort();
  return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}

function externalId(value: unknown): value is string {
  if (typeof value !== "string" || !POSITIVE_EXTERNAL_ID.test(value)) return false;
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0;
}

function parseTarget(value: unknown): ApiFootballRunnerTarget {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return fail("TARGET_INVALID");
  }
  const input = value as Readonly<Record<string, unknown>>;
  if (!exactKeys(input)) return fail("TARGET_FIELDS_INVALID");
  if (
    input.providerKey !== "api-football" ||
    typeof input.canonicalFixtureId !== "string" ||
    !SAFE_CANONICAL_ID.test(input.canonicalFixtureId) ||
    !externalId(input.providerFixtureId) ||
    !externalId(input.providerCompetitionId) ||
    typeof input.season !== "number" ||
    !Number.isSafeInteger(input.season) ||
    input.season < 1900 || input.season > 2200 ||
    !externalId(input.homeProviderTeamId) ||
    !externalId(input.awayProviderTeamId) ||
    input.homeProviderTeamId === input.awayProviderTeamId ||
    typeof input.homeName !== "string" || input.homeName.trim().length === 0 ||
    typeof input.awayName !== "string" || input.awayName.trim().length === 0 ||
    input.homeName.trim().normalize("NFC") === input.awayName.trim().normalize("NFC") ||
    typeof input.kickoffUtc !== "string" || !isNormalizedUtcTimestamp(input.kickoffUtc) ||
    input.sourceTimezone !== "UTC"
  ) {
    return fail("TARGET_INVALID");
  }
  return Object.freeze({
    providerKey: "api-football",
    canonicalFixtureId: input.canonicalFixtureId,
    providerFixtureId: input.providerFixtureId,
    providerCompetitionId: input.providerCompetitionId,
    season: String(input.season),
    homeProviderTeamId: input.homeProviderTeamId,
    homeName: input.homeName.trim(),
    awayProviderTeamId: input.awayProviderTeamId,
    awayName: input.awayName.trim(),
    kickoffUtc: new Date(input.kickoffUtc).toISOString(),
    sourceTimezone: "UTC",
  });
}

export function parseApiFootballTargets(document: unknown): readonly ApiFootballRunnerTarget[] {
  const values = Array.isArray(document) ? document : [document];
  if (values.length === 0 || values.length > 100) return fail("TARGET_COUNT_INVALID");
  const targets = values.map(parseTarget);
  const providerIds = new Set(targets.map((target) => target.providerFixtureId));
  const canonicalIds = new Set(targets.map((target) => target.canonicalFixtureId));
  if (providerIds.size !== targets.length || canonicalIds.size !== targets.length) {
    return fail("TARGET_DUPLICATE");
  }
  return Object.freeze(targets);
}

function integerArgument(raw: string | undefined, positive: boolean, code: string): number {
  if (raw === undefined || !/^\d+$/u.test(raw)) return fail(code);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || (positive ? value <= 0 : value < 0)) return fail(code);
  return value;
}

function validDatabaseUrl(value: string): boolean {
  return /^file:\/[^\u0000\r\n"']+$/u.test(value) && value.length > 6;
}

export function parseApiFootballRunnerArguments(argv: readonly string[]): ApiFootballRunnerArguments {
  const command = argv[0];
  if (command !== "prematch" && command !== "resolve") return fail("SUBCOMMAND_REQUIRED");
  const values = new Map<string, string>();
  let dryRun = false;
  let allowNetwork = false;
  let prevalidatedBinding = false;
  for (let index = 1; index < argv.length; index += 1) {
    const argument = argv[index];
    if (
      argument === "--dry-run" ||
      argument === "--allow-network" ||
      argument === "--prevalidated-binding"
    ) {
      if (argument === "--dry-run") dryRun = true;
      if (argument === "--allow-network") allowNetwork = true;
      if (argument === "--prevalidated-binding") prevalidatedBinding = true;
      continue;
    }
    if (!["--target", "--database-url", "--evidence-root", "--max-attempts", "--daily-threshold"].includes(argument)) {
      return fail("ARGUMENT_UNKNOWN");
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--") || values.has(argument)) {
      return fail("ARGUMENT_INVALID");
    }
    values.set(argument, value);
    index += 1;
  }
  if (dryRun === allowNetwork) return fail("EXPLICIT_MODE_REQUIRED");
  if (prevalidatedBinding && command !== "prematch") {
    return fail("PREVALIDATED_BINDING_PREMATCH_ONLY");
  }
  if (prevalidatedBinding && dryRun) return fail("PREVALIDATED_BINDING_REQUIRES_NETWORK_MODE");
  const targetFile = values.get("--target");
  const databaseUrl = values.get("--database-url");
  const evidenceRoot = values.get("--evidence-root");
  if (targetFile === undefined || targetFile.length === 0) return fail("TARGET_FILE_REQUIRED");
  if (databaseUrl === undefined || !validDatabaseUrl(databaseUrl)) return fail("DATABASE_URL_INVALID");
  if (evidenceRoot === undefined || !isAbsolute(evidenceRoot)) return fail("EVIDENCE_ROOT_INVALID");
  return Object.freeze({
    command,
    targetFile,
    databaseUrl,
    evidenceRoot: resolve(evidenceRoot),
    maxAttempts: integerArgument(values.get("--max-attempts"), true, "MAX_ATTEMPTS_INVALID"),
    dailyThreshold: integerArgument(values.get("--daily-threshold"), false, "DAILY_THRESHOLD_INVALID"),
    mode: dryRun ? "DRY_RUN" : "NETWORK",
    prevalidatedBinding,
  });
}

export async function loadApiFootballTargets(targetFile: string): Promise<readonly ApiFootballRunnerTarget[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(targetFile, "utf8")) as unknown;
  } catch {
    return fail("TARGET_FILE_INVALID");
  }
  return parseApiFootballTargets(parsed);
}

function stableToken(namespace: string, values: readonly string[]): string {
  return createHash("sha256").update([namespace, ...values].join("\u0000")).digest("hex");
}

function requestIdentity(input: Readonly<{
  runId: string;
  operation: string;
  providerFixtureId: string;
  ordinal: number;
}>): Readonly<{ requestKeyHash: string; correlationId: string }> {
  const hash = stableToken("api-football-runner", [
    input.runId,
    input.operation,
    input.providerFixtureId,
    String(input.ordinal),
  ]);
  return Object.freeze({ requestKeyHash: hash, correlationId: `r0-${hash.slice(0, 24)}` });
}

function prismaString(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"');
}

async function preparePrismaRuntime(
  runtimeRoot: string,
  databaseUrl: string,
  migrate: boolean,
): Promise<PrismaClientConstructor> {
  const repositoryRoot = process.cwd();
  const sourceSchemaPath = join(repositoryRoot, "prisma/market-v2/schema.prisma");
  const generatedRoot = join(runtimeRoot, "generated-client");
  const runtimeSchemaPath = join(runtimeRoot, "schema.prisma");
  const sourceSchema = await readFile(sourceSchemaPath, "utf8");
  const runtimeSchema = sourceSchema
    .replace(/output\s+=\s+"[^"]+"/u, `output   = "${prismaString(generatedRoot)}"`)
    .replace(/url\s+=\s+"[^"]+"/u, `url      = "${prismaString(databaseUrl)}"`);
  await writeFile(runtimeSchemaPath, runtimeSchema, { mode: 0o600 });
  const prismaExecutable = join(repositoryRoot, "node_modules/.bin/prisma");
  if (migrate) {
    try {
      const migrationsRoot = join(repositoryRoot, "prisma/market-v2/migrations");
      const entries = (await readdir(migrationsRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const entry of entries) {
        await executeFile(prismaExecutable, [
          "db",
          "execute",
          "--schema",
          runtimeSchemaPath,
          "--file",
          join(migrationsRoot, entry, "migration.sql"),
        ]);
      }
    } catch {
      return fail("TEMPORARY_DATABASE_PREPARATION_FAILED");
    }
  }
  try {
    await executeFile(prismaExecutable, ["generate", "--schema", runtimeSchemaPath]);
  } catch {
    return fail("PRISMA_CLIENT_PREPARATION_FAILED");
  }
  const loaded = createRequire(import.meta.url)(generatedRoot) as unknown;
  if (
    typeof loaded !== "object" || loaded === null ||
    !("PrismaClient" in loaded) || typeof loaded.PrismaClient !== "function"
  ) {
    return fail("PRISMA_CLIENT_UNAVAILABLE");
  }
  return loaded.PrismaClient as PrismaClientConstructor;
}

function syntheticFixture(target: ApiFootballRunnerTarget, status: "NS" | "FT") {
  const noScore = Object.freeze({ home: null, away: null });
  const finished = status === "FT";
  return {
    fixture: {
      id: Number(target.providerFixtureId),
      date: target.kickoffUtc,
      timestamp: Math.floor(Date.parse(target.kickoffUtc) / 1000),
      timezone: "UTC",
      status: { long: finished ? "Match Finished" : "Not Started", short: status },
    },
    league: {
      id: Number(target.providerCompetitionId),
      name: "Synthetic R0 League",
      country: "Synthetic Country",
      season: Number(target.season),
      round: "Synthetic Round",
    },
    teams: {
      home: { id: Number(target.homeProviderTeamId), name: target.homeName },
      away: { id: Number(target.awayProviderTeamId), name: target.awayName },
    },
    goals: finished ? { home: 2, away: 1 } : noScore,
    score: {
      halftime: finished ? { home: 1, away: 0 } : noScore,
      fulltime: finished ? { home: 2, away: 1 } : noScore,
      extratime: noScore,
      penalty: noScore,
    },
  };
}

function envelope(response: readonly unknown[], parameters: Readonly<Record<string, unknown>>) {
  return {
    get: "fixtures",
    parameters,
    errors: [],
    results: response.length,
    paging: { current: 1, total: 1 },
    response,
  };
}

function fakeFetch(
  targets: readonly ApiFootballRunnerTarget[],
  threshold: number,
  outcomeStatus: "FT" | "NS",
  eventSink?: ApiFootballRuntimeDependencies["eventSink"],
): ApiFootballFetch {
  return async (input) => {
    eventSink?.("CLIENT");
    const url = new URL(String(input));
    let body: unknown;
    const fixtureId = url.searchParams.get("id");
    const predictionId = url.searchParams.get("fixture");
    if (predictionId !== null) {
      const target = targets.find((candidate) => candidate.providerFixtureId === predictionId);
      if (target === undefined) return new Response("{}", { status: 404 });
      body = {
        get: "predictions",
        parameters: { fixture: predictionId },
        errors: [],
        results: 1,
        paging: { current: 1, total: 1 },
        response: [{
          predictions: {
            winner: { id: Number(target.homeProviderTeamId), name: target.homeName, comment: "Synthetic" },
            advice: "Synthetic R0 advice",
            under_over: "Synthetic R0 total",
            goals: { home: null, away: null },
            percent: { home: "45%", draw: "30%", away: "25%" },
          },
          teams: {
            home: { id: Number(target.homeProviderTeamId), name: target.homeName },
            away: { id: Number(target.awayProviderTeamId), name: target.awayName },
          },
        }],
      };
    } else if (fixtureId !== null) {
      const target = targets.find((candidate) => candidate.providerFixtureId === fixtureId);
      body = envelope(target === undefined ? [] : [syntheticFixture(target, outcomeStatus)], { id: fixtureId });
    } else {
      const date = url.searchParams.get("date");
      const rows = targets
        .filter((target) => target.kickoffUtc.slice(0, 10) === date)
        .map((target) => syntheticFixture(target, "NS"));
      body = envelope(rows, { date });
    }
    const remaining = Math.max(threshold + 100, 1_000);
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-ratelimit-requests-limit": String(remaining + 100),
        "x-ratelimit-requests-remaining": String(remaining),
        "x-ratelimit-limit": "100",
        "x-ratelimit-remaining": "99",
      },
    });
  };
}

export class SystemUtcCaptureClock implements CaptureClock {
  nowUtc(): string {
    return new Date().toISOString();
  }
}

function deterministicDryRunClock(
  command: ApiFootballRunnerCommand,
  targets: readonly ApiFootballRunnerTarget[],
  override?: string,
): Readonly<{ nowUtc(): string }> {
  if (override !== undefined) {
    if (!isNormalizedUtcTimestamp(override)) return fail("CLOCK_INVALID");
    return Object.freeze({ nowUtc: () => override });
  }
  const epochs = targets.map((target) => Date.parse(target.kickoffUtc));
  const base = command === "prematch" ? Math.min(...epochs) - 6 * 3_600_000 : Math.max(...epochs) + 6 * 3_600_000;
  const value = new Date(base).toISOString();
  return Object.freeze({ nowUtc: () => value });
}

export function createApiFootballRuntimeClock(
  args: Pick<ApiFootballRunnerArguments, "command" | "mode">,
  targets: readonly ApiFootballRunnerTarget[],
  dependencies: Pick<ApiFootballRuntimeDependencies, "networkClock" | "dryRunClockUtc"> = {},
): CaptureClock {
  return args.mode === "NETWORK"
    ? dependencies.networkClock ?? new SystemUtcCaptureClock()
    : deterministicDryRunClock(args.command, targets, dependencies.dryRunClockUtc);
}

async function seedDryRunFixtures(
  prisma: RuntimePrismaClient,
  persistence: PrismaApiFootballRepositories,
  command: ApiFootballRunnerCommand,
  targets: readonly ApiFootballRunnerTarget[],
): Promise<void> {
  for (const target of targets) {
    const marker = stableToken("dry-fixture", [target.canonicalFixtureId]).slice(0, 24);
    const localTeamId = `dry-home-${marker}`;
    const awayTeamId = `dry-away-${marker}`;
    await prisma.team.create({ data: { id: localTeamId, canonicalKey: localTeamId, displayName: target.homeName } });
    await prisma.team.create({ data: { id: awayTeamId, canonicalKey: awayTeamId, displayName: target.awayName } });
    await prisma.fixture.create({
      data: {
        id: target.canonicalFixtureId,
        localTeamId,
        awayTeamId,
        competitionKey: `api-football:${target.providerCompetitionId}`,
        kickoffAtUtc: new Date(target.kickoffUtc),
        status: command === "resolve" ? "FINISHED" : "SCHEDULED",
      },
    });
  }
  if (command !== "resolve") return;
  const provider = await persistence.ensureProvider();
  if (!provider.ok) return fail("DRY_RUN_PROVIDER_PREPARATION_FAILED");
  for (const target of targets) {
    await prisma.providerFixtureIdentity.create({
      data: {
        id: stableToken("dry-provider-fixture", [target.providerFixtureId]),
        providerId: provider.value.id,
        providerFixtureId: target.providerFixtureId,
        fixtureId: target.canonicalFixtureId,
        providerCompetitionId: target.providerCompetitionId,
        providerHomeTeamId: target.homeProviderTeamId,
        providerAwayTeamId: target.awayProviderTeamId,
        season: target.season,
        round: "Synthetic Round",
        sourceDateRaw: target.kickoffUtc,
        sourceTimestamp: String(Math.floor(Date.parse(target.kickoffUtc) / 1000)),
        sourceTimezone: "UTC",
      },
    });
  }
}

async function assertNetworkDatabase(
  prisma: RuntimePrismaClient,
  command: ApiFootballRunnerCommand,
  targets: readonly ApiFootballRunnerTarget[],
): Promise<void> {
  try {
    for (const target of targets) {
      const fixture = await prisma.fixture.findUnique({ where: { id: target.canonicalFixtureId } });
      if (fixture === null || fixture.kickoffAtUtc.toISOString() !== target.kickoffUtc) {
        return fail("CANONICAL_FIXTURE_BINDING_REQUIRED");
      }
      if (command === "resolve") {
        const provider = await prisma.provider.findUnique({ where: { stableKey: "api-football" } });
        if (provider === null) return fail("CANONICAL_FIXTURE_BINDING_REQUIRED");
        const identity = await prisma.providerFixtureIdentity.findUnique({
          where: { providerId_providerFixtureId: { providerId: provider.id, providerFixtureId: target.providerFixtureId } },
        });
        if (
          identity === null || identity.fixtureId !== target.canonicalFixtureId ||
          identity.providerCompetitionId !== target.providerCompetitionId ||
          identity.providerHomeTeamId !== target.homeProviderTeamId ||
          identity.providerAwayTeamId !== target.awayProviderTeamId ||
          identity.season !== target.season || identity.sourceTimezone !== "UTC" ||
          identity.sourceDateRaw === null || new Date(identity.sourceDateRaw).toISOString() !== target.kickoffUtc
        ) {
          return fail("CANONICAL_FIXTURE_BINDING_REQUIRED");
        }
      }
    }
  } catch (error) {
    if (error instanceof ApiFootballRunnerError) throw error;
    return fail("DATABASE_NOT_PREPARED");
  }
}

function normalizedName(value: string): string {
  return value.trim().normalize("NFC");
}

async function validatePrevalidatedBinding(
  prisma: RuntimePrismaClient,
  target: ApiFootballRunnerTarget,
  clock: CaptureClock,
): Promise<CapturedFixture> {
  const fixture = await prisma.fixture.findUnique({
    where: { id: target.canonicalFixtureId },
    include: { localTeam: true, awayTeam: true },
  });
  if (fixture === null) return fail("PREVALIDATED_FIXTURE_REQUIRED");
  const provider = await prisma.provider.findUnique({ where: { stableKey: "api-football" } });
  if (provider === null) return fail("PREVALIDATED_PROVIDER_REQUIRED");
  const identities = await prisma.providerFixtureIdentity.findMany({
    where: { fixtureId: target.canonicalFixtureId },
  });
  if (identities.length === 0) return fail("PREVALIDATED_IDENTITY_REQUIRED");
  if (identities.length !== 1) return fail("PREVALIDATED_IDENTITY_CONFLICT");
  const identity = identities[0];
  const providerIdentity = await prisma.providerFixtureIdentity.findUnique({
    where: {
      providerId_providerFixtureId: {
        providerId: provider.id,
        providerFixtureId: target.providerFixtureId,
      },
    },
  });
  if (providerIdentity === null || providerIdentity.id !== identity.id) {
    return fail("PREVALIDATED_IDENTITY_CONFLICT");
  }
  const sourceDateUtc = identity.sourceDateRaw === null ||
      !Number.isFinite(Date.parse(identity.sourceDateRaw))
    ? null
    : new Date(identity.sourceDateRaw).toISOString();
  if (
    identity.providerId !== provider.id ||
    identity.providerFixtureId !== target.providerFixtureId ||
    identity.fixtureId !== target.canonicalFixtureId ||
    identity.providerCompetitionId !== target.providerCompetitionId ||
    identity.season !== target.season ||
    identity.providerHomeTeamId !== target.homeProviderTeamId ||
    identity.providerAwayTeamId !== target.awayProviderTeamId ||
    sourceDateUtc !== target.kickoffUtc ||
    identity.sourceTimezone !== target.sourceTimezone ||
    fixture.kickoffAtUtc.toISOString() !== target.kickoffUtc ||
    fixture.status !== "SCHEDULED" ||
    fixture.localTeamId !== fixture.localTeam.id ||
    fixture.awayTeamId !== fixture.awayTeam.id ||
    fixture.localTeamId === fixture.awayTeamId ||
    normalizedName(fixture.localTeam.displayName) !== normalizedName(target.homeName) ||
    normalizedName(fixture.awayTeam.displayName) !== normalizedName(target.awayName)
  ) {
    return fail("PREVALIDATED_BINDING_MISMATCH");
  }
  const capturedAtUtc = clock.nowUtc();
  if (
    !isNormalizedUtcTimestamp(capturedAtUtc) ||
    Date.parse(capturedAtUtc) >= Date.parse(target.kickoffUtc)
  ) {
    return fail("PREVALIDATED_KICKOFF_NOT_FUTURE");
  }
  const noScore = Object.freeze({ home: null, away: null });
  return Object.freeze({
    providerKey: "api-football",
    providerFixtureId: target.providerFixtureId,
    capturedAtUtc,
    sourceDate: target.kickoffUtc,
    sourceTimestamp: identity.sourceTimestamp ?? String(Math.floor(Date.parse(target.kickoffUtc) / 1_000)),
    sourceTimezone: "UTC",
    rawStatusCode: "NS",
    competition: Object.freeze({
      providerCompetitionId: target.providerCompetitionId,
      name: fixture.competitionKey,
      country: "",
    }),
    season: target.season,
    round: identity.round ?? "",
    home: Object.freeze({ providerTeamId: target.homeProviderTeamId, name: target.homeName }),
    away: Object.freeze({ providerTeamId: target.awayProviderTeamId, name: target.awayName }),
    goals: noScore,
    score: Object.freeze({
      halftime: noScore,
      fulltime: noScore,
      extratime: noScore,
      penalty: noScore,
    }),
    canonicalStatus: "SCHEDULED",
    automaticUseBlocked: false,
  });
}

function prevalidatedPrematchProvider(
  provider: ApiFootballProvider,
  fixture: CapturedFixture,
  budget: RequestBudget,
  circuitBreaker: RunCircuitBreaker,
): PrematchCaptureProviderPort {
  return Object.freeze({
    async captureSelectedFixtureGoverned() {
      const budgetState = budget.inspect();
      const circuitState = circuitBreaker.inspect();
      return Object.freeze({
        ok: true as const,
        data: fixture,
        persistenceDisposition: "REPLAYED" as const,
        governanceStatus: "SUCCESS" as const,
        attemptsUsed: budgetState.startedAttempts,
        remainingBudget: budgetState.remainingAttempts,
        circuitState: circuitState.state,
        ...(circuitState.reason === undefined ? {} : { circuitReason: circuitState.reason }),
      });
    },
    capturePrematchPredictionGoverned(input: GovernedPredictionInput) {
      return provider.capturePrematchPredictionGoverned(input);
    },
  });
}

function mapperWithEvents(eventSink?: ApiFootballRuntimeDependencies["eventSink"]): ApiFootballProviderMappers {
  return Object.freeze({
    fixture(dto, context) {
      eventSink?.("MAPPER");
      return mapApiFootballFixture(dto, context);
    },
    prediction(dto, context) {
      eventSink?.("MAPPER");
      return mapApiFootballPrediction(dto, context);
    },
    result(dto, context) {
      eventSink?.("MAPPER");
      return mapApiFootballResult(dto, context);
    },
  });
}

function countReplay(targetResults: readonly string[]): number {
  return targetResults.filter((status) => status === "REPLAYED" || status === "RESOLVED_REPLAYED").length;
}

function countConflicts(targetResults: readonly string[]): number {
  return targetResults.filter((status) => status === "PERSISTENCE_CONFLICT").length;
}

export async function runApiFootball(
  args: ApiFootballRunnerArguments,
  targets: readonly ApiFootballRunnerTarget[],
  dependencies: ApiFootballRuntimeDependencies = {},
): Promise<ApiFootballRunnerResult> {
  if (targets.length === 0) return fail("TARGET_COUNT_INVALID");
  if (
    args.prevalidatedBinding &&
    (args.command !== "prematch" || args.mode !== "NETWORK")
  ) {
    return fail("PREVALIDATED_BINDING_PREMATCH_NETWORK_ONLY");
  }
  if (args.prevalidatedBinding && targets.length !== 1) {
    return fail("PREVALIDATED_TARGET_COUNT_INVALID");
  }
  if (args.prevalidatedBinding && args.maxAttempts !== 1) {
    return fail("PREVALIDATED_BUDGET_MUST_BE_ONE");
  }
  let credentialsRead = 0;
  let apiKey = "SYNTHETIC_DRY_RUN_KEY";
  if (args.mode === "NETWORK" && !args.prevalidatedBinding) {
    credentialsRead += 1;
    apiKey = dependencies.apiKeyProvider?.() ?? "";
    if (apiKey.length === 0) return fail("API_FOOTBALL_KEY_REQUIRED");
  }
  const runtimeRoot = await mkdtemp(join(process.cwd(), "node_modules/.ou25-api-football-r0-"));
  const temporaryDatabasePath = args.mode === "DRY_RUN" ? join(runtimeRoot, "market-v2.sqlite") : undefined;
  const temporaryEvidenceRoot = args.mode === "DRY_RUN" ? join(runtimeRoot, "evidence") : undefined;
  const databaseUrl = temporaryDatabasePath === undefined ? args.databaseUrl : `file:${temporaryDatabasePath}`;
  const evidenceRoot = temporaryEvidenceRoot ?? args.evidenceRoot;
  let prisma: RuntimePrismaClient | undefined;
  let networkCalls = 0;
  let fixtureDiscoveryCalls = 0;
  let predictionCalls = 0;
  let bindingValidated = false;
  let result: Omit<ApiFootballRunnerResult, "temporaryDatabaseRemoved" | "temporaryEvidenceRemoved"> | undefined;
  try {
    if (args.mode === "DRY_RUN") await mkdir(evidenceRoot, { mode: 0o700 });
    const PrismaClient = await preparePrismaRuntime(runtimeRoot, databaseUrl, args.mode === "DRY_RUN");
    prisma = new PrismaClient();
    const persistence = new PrismaApiFootballRepositories(
      prisma as unknown as ApiFootballPrismaClient,
    );
    const clock = createApiFootballRuntimeClock(args, targets, dependencies);
    let prevalidatedFixture: CapturedFixture | undefined;
    if (args.mode === "DRY_RUN") {
      await seedDryRunFixtures(prisma, persistence, args.command, targets);
    } else {
      await assertNetworkDatabase(prisma, args.command, targets);
      if (args.prevalidatedBinding) {
        prevalidatedFixture = await validatePrevalidatedBinding(prisma, targets[0], clock);
        bindingValidated = true;
      }
    }
    let operationalEvidence: OperationalRawEvidenceStore;
    try {
      operationalEvidence = new OperationalRawEvidenceStore(evidenceRoot);
      await operationalEvidence.initialize();
    } catch {
      return fail("EVIDENCE_ROOT_INVALID");
    }
    const evidenceStore: RawEvidenceStore = Object.freeze({
      async publish(candidate: RawEvidenceCandidate) {
        const published = await operationalEvidence.publish(candidate);
        if (published.ok) dependencies.eventSink?.("EVIDENCE");
        return published;
      },
    });
    if (args.mode === "NETWORK" && args.prevalidatedBinding) {
      credentialsRead += 1;
      apiKey = dependencies.apiKeyProvider?.() ?? "";
      if (apiKey.length === 0) return fail("API_FOOTBALL_KEY_REQUIRED");
    }
    const transport: ApiFootballFetch = args.mode === "DRY_RUN"
      ? fakeFetch(targets, args.dailyThreshold, dependencies.dryRunOutcomeStatus ?? "FT", dependencies.eventSink)
      : async (input, init) => {
          const url = new URL(String(input));
          const isFixtureDiscovery = url.pathname === "/fixtures" && url.searchParams.has("date");
          const isPrediction = url.pathname === "/predictions" && url.searchParams.has("fixture");
          if (args.prevalidatedBinding && !isPrediction) {
            throw new ApiFootballRunnerError("PREVALIDATED_ENDPOINT_BLOCKED");
          }
          networkCalls += 1;
          if (isFixtureDiscovery) fixtureDiscoveryCalls += 1;
          if (isPrediction) predictionCalls += 1;
          const fetchImpl = dependencies.networkFetch ?? globalThis.fetch;
          return fetchImpl(input, init);
        };
    const client = new ApiFootballClient({
      config: buildApiFootballConfig({ API_FOOTBALL_KEY: apiKey }),
      fetchImpl: transport,
      clock,
    });
    const provider = new ApiFootballProvider({
      client,
      rawEvidenceStore: evidenceStore,
      mappers: mapperWithEvents(dependencies.eventSink),
      persistence,
    });
    const budget = new RequestBudget(args.maxAttempts);
    const circuitBreaker = new RunCircuitBreaker(Math.max(2, args.maxAttempts));
    const prematchProvider = prevalidatedFixture === undefined
      ? provider
      : prevalidatedPrematchProvider(provider, prevalidatedFixture, budget, circuitBreaker);
    const executor = new GovernedRequestExecutor({
      budget,
      circuitBreaker,
      auditRepository: new PrismaProviderRequestAuditRepository(
        prisma as unknown as ApiFootballAuditPrismaClient,
      ),
      retryPolicy: new RetryPolicy({
        maxAttempts: args.maxAttempts,
        baseDelayMilliseconds: 0,
        maximumDelayMilliseconds: 0,
      }),
      sleeper: new FakeSleeper(),
      clock,
      rateLimits: {
        parse: parseApiFootballRateLimits,
        evaluateResponse: evaluateApiFootballRateLimitResponse,
      },
    }, {
      maxAttempts: args.maxAttempts,
      maxRetries: Math.max(0, args.maxAttempts - 1),
      dailySafetyThreshold: args.dailyThreshold,
      requireDailyRemaining: true,
      requireMinuteRemaining: true,
      maxConsecutiveRetryableFailures: Math.max(2, args.maxAttempts),
    });
    const sharedBudgetAndBreaker = executor.dependencies.budget === budget &&
      executor.dependencies.circuitBreaker === circuitBreaker;
    const countsBefore = Object.freeze({
      fixtures: await prisma.providerFixtureIdentity.count(),
      predictions: await prisma.predictionSnapshot.count(),
      outcomes: await prisma.outcome.count(),
      evidence: await prisma.sourceArtifact.count(),
      audits: await prisma.providerRequestAudit.count(),
    });
    const runId = stableToken("run", [args.command, ...targets.map((target) => target.providerFixtureId)]).slice(0, 32);
    const execute = async () => args.command === "prematch"
      ? collectPrematch({
          runId,
          targets,
          maxTargets: targets.length,
          budget,
          circuitBreaker,
          executor,
          provider: prematchProvider,
          requestIdentityFactory: requestIdentity,
          parserVersion: API_FOOTBALL_MAPPER_POLICY_VERSION,
          policyVersion: "api-football-r0-runner/1.0",
        })
      : resolveOutcomes({
          runId,
          targets,
          maxTargets: targets.length,
          budget,
          circuitBreaker,
          executor,
          provider,
          requestIdentityFactory: requestIdentity,
        });
    const first = await execute();
    const firstStatuses = first.targets.map((target) => target.status);
    const firstComplete = first.status === "COMPLETE";
    let finalStatuses = firstStatuses;
    if (args.mode === "DRY_RUN" && firstComplete) {
      const replay = await execute();
      finalStatuses = [...firstStatuses, ...replay.targets.map((target) => target.status)];
    }
    const successfulStatuses = args.command === "prematch"
      ? ["PREMATCH_CAPTURED", "REPLAYED"]
      : ["RESOLVED_CREATED", "RESOLVED_REPLAYED"];
    const complete = firstComplete && finalStatuses.slice(-targets.length)
      .every((status) => successfulStatuses.includes(status));
    const budgetState = budget.inspect();
    const circuitState = circuitBreaker.inspect();
    result = Object.freeze({
      complete,
      exitCode: complete ? 0 : 1,
      mode: args.mode,
      command: args.command,
      targetCount: targets.length,
      targetResults: Object.freeze(finalStatuses),
      attemptsUsed: budgetState.startedAttempts,
      attemptsRemaining: budgetState.remainingAttempts,
      circuitState: circuitState.state,
      evidenceCreated: await prisma.sourceArtifact.count() - countsBefore.evidence,
      fixturesCreated: await prisma.providerFixtureIdentity.count() - countsBefore.fixtures,
      predictionsCreated: await prisma.predictionSnapshot.count() - countsBefore.predictions,
      outcomesCreated: await prisma.outcome.count() - countsBefore.outcomes,
      replayed: countReplay(finalStatuses),
      conflicts: countConflicts(finalStatuses),
      auditRecords: await prisma.providerRequestAudit.count() - countsBefore.audits,
      databaseUrlRedacted: "file:<redacted>",
      evidenceRootRedacted: args.mode === "DRY_RUN" ? "<temporary>" : "<explicit>",
      networkUsed: networkCalls > 0,
      networkCalls,
      credentialsRead,
      sharedBudgetAndBreaker,
      bindingMode: args.prevalidatedBinding ? "PREVALIDATED" : "DISCOVERY",
      bindingValidated,
      fixtureDiscoveryCalls,
      predictionCalls,
      ...(temporaryDatabasePath === undefined ? {} : { temporaryDatabasePath }),
      ...(temporaryEvidenceRoot === undefined ? {} : { temporaryEvidenceRoot }),
    });
  } catch (error) {
    if (error instanceof ApiFootballRunnerError) throw error;
    return fail("RUNNER_EXECUTION_FAILED");
  } finally {
    await prisma?.$disconnect().catch(() => undefined);
    await rm(runtimeRoot, { recursive: true, force: true });
  }
  if (result === undefined) return fail("RUNNER_EXECUTION_FAILED");
  return Object.freeze({
    ...result,
    temporaryDatabaseRemoved: temporaryDatabasePath !== undefined,
    temporaryEvidenceRemoved: temporaryEvidenceRoot !== undefined,
  });
}
