import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ApiFootballClient } from "@/infrastructure/market-v2/api-football/client";
import { buildApiFootballConfig } from "@/infrastructure/market-v2/api-football/config";
import { mapApiFootballResult } from "@/infrastructure/market-v2/api-football/mappers";
import { OperationalRawEvidenceStore } from "@/infrastructure/market-v2/capture/operational-evidence-store";

export type SettlementArguments = Readonly<{
  databaseUrl: string;
  evidenceRoot: string;
  maxFixtures: number;
  budget: number;
  dryRun: boolean;
  allowNetwork: boolean;
}>;

export type SettlementResult = Readonly<{
  runId: string;
  mode: "DRY_RUN" | "NETWORK";
  eligibleFixtures: number;
  requestsBudget: number;
  requestsMade: number;
  evidenceCreated: number;
  outcomesCreated: number;
  pendingFixtures: number;
  warnings: readonly string[];
  networkUsed: boolean;
}>;

export class SettlementError extends Error {
  constructor(readonly code: string) { super(code); this.name = "SettlementError"; }
}

const fail = (code: string): never => { throw new SettlementError(code); };
const positiveInt = (value: string | undefined, code: string): number => {
  if (!value || !/^\d+$/u.test(value) || Number(value) < 1) fail(code);
  return Number(value);
};

export function parseSettlementArguments(argv: readonly string[]): SettlementArguments {
  const values = new Map<string, string>();
  let dryRun = false, allowNetwork = false;
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (key === "--dry-run" || key === "--allow-network") {
      if (key === "--dry-run") dryRun = true; else allowNetwork = true;
      continue;
    }
    if (!["--database-url", "--evidence-root", "--max-fixtures", "--budget"].includes(key)) fail("ARGUMENT_UNKNOWN");
    const value = argv[++index];
    if (!value || value.startsWith("--") || values.has(key)) fail("ARGUMENT_INVALID");
    values.set(key, value);
  }
  if (dryRun === allowNetwork) fail("EXPLICIT_EXECUTION_MODE_REQUIRED");
  const databaseUrl = values.get("--database-url"), evidenceRoot = values.get("--evidence-root");
  if (!databaseUrl?.startsWith("file:/")) fail("DATABASE_URL_INVALID");
  if (!evidenceRoot?.startsWith("/")) fail("EVIDENCE_ROOT_INVALID");
  const maxFixtures = positiveInt(values.get("--max-fixtures"), "MAX_FIXTURES_INVALID");
  const budget = positiveInt(values.get("--budget"), "BUDGET_INVALID");
  if (maxFixtures > 20 || budget > maxFixtures) fail("BUDGET_RELATION_INVALID");
  return Object.freeze({ databaseUrl: databaseUrl as string, evidenceRoot: evidenceRoot as string, maxFixtures, budget, dryRun, allowNetwork });
}

const digest = (...parts: readonly string[]): string => createHash("sha256").update(parts.join("\0")).digest("hex");

export async function settlePending(
  args: SettlementArguments,
  deps: Readonly<{ apiFootballKey?: () => string | undefined; fetchImpl?: typeof fetch; now?: () => Date }> = {},
): Promise<SettlementResult> {
  const now = deps.now?.() ?? new Date();
  const cutoff = new Date(now.valueOf() - 3 * 60 * 60_000);
  const db = new PrismaClient({ datasourceUrl: args.databaseUrl });
  try {
    const fixtures = await db.fixture.findMany({
      where: {
        kickoffAtUtc: { lte: cutoff },
        candidates: { some: { recommendations: { some: {} } } },
        dailyOutcomes: { none: {} },
        providerIdentities: { some: { providerId: "provider-api-football" } },
      },
      include: {
        homeTeam: true,
        awayTeam: true,
        providerIdentities: { where: { providerId: "provider-api-football" }, take: 1 },
      },
      orderBy: [{ kickoffAtUtc: "asc" }, { id: "asc" }],
      take: args.maxFixtures,
    });
    const runId = `${args.dryRun ? "settle-dry" : "settle"}-${digest(now.toISOString(), ...fixtures.map((x) => x.id)).slice(0, 32)}`;
    if (args.dryRun) return Object.freeze({ runId, mode: "DRY_RUN", eligibleFixtures: fixtures.length, requestsBudget: args.budget, requestsMade: 0, evidenceCreated: 0, outcomesCreated: 0, pendingFixtures: fixtures.length, warnings: [], networkUsed: false });

    const key = deps.apiFootballKey?.();
    if (!key) fail("API_FOOTBALL_KEY_REQUIRED");
    const store = new OperationalRawEvidenceStore(args.evidenceRoot);
    await store.initialize();
    const client = new ApiFootballClient({ config: buildApiFootballConfig({ API_FOOTBALL_KEY: key }), fetchImpl: deps.fetchImpl ?? fetch, clock: { nowUtc: () => (deps.now?.() ?? new Date()).toISOString() } });
    const evidenceRows: Array<{ id: string; fixtureId: string; descriptor: { providerKey: string; endpointKey: string; capturedAtUtc: string; contentHash: string; byteLength: number; mediaType: string; storageReference: string } }> = [];
    const outcomeRows: Array<{ id: string; fixtureId: string; sourceEvidenceId: string; providerFixtureId: string; observedAtUtc: string; providerTerminalStatus: string; result1X2: string; regulationHomeScore: number; regulationAwayScore: number }> = [];
    const warnings: string[] = [];
    let requestsMade = 0, pendingFixtures = 0;
    for (const fixture of fixtures.slice(0, args.budget)) {
      const identity = fixture.providerIdentities[0];
      if (!identity) { warnings.push(`IDENTITY_MISSING:${fixture.id}`); continue; }
      requestsMade += 1;
      const response = await client.getFixtureResult(identity.providerFixtureId);
      if (!response.ok || !response.evidenceCandidate) { warnings.push(`RESULT_CAPTURE_FAILED:${fixture.id}`); continue; }
      const published = await store.publish({ providerKey: "api-football", endpointKey: "fixture-result-by-id", capturedAtUtc: response.evidenceCandidate.capturedAtUtc, mediaType: response.evidenceCandidate.mediaType, bytes: response.evidenceCandidate.rawBytes, sourceReference: `settle:${runId}:${identity.providerFixtureId}` });
      if (!published.ok) throw new SettlementError("SETTLEMENT_EVIDENCE_FAILED");
      const descriptor = published.descriptor;
      const sourceEvidenceId = `sev-${digest(runId, fixture.id, descriptor.contentHash).slice(0, 24)}`;
      evidenceRows.push({ id: sourceEvidenceId, fixtureId: fixture.id, descriptor });
      const dto = response.payload.response[0];
      if (!dto) { warnings.push(`RESULT_EMPTY:${fixture.id}`); pendingFixtures += 1; continue; }
      const mapped = mapApiFootballResult(dto, {
        capturedAtUtc: descriptor.capturedAtUtc,
        requestedProviderFixtureId: identity.providerFixtureId,
        expectedLeagueProviderId: identity.providerCompetitionId,
        expectedSeason: identity.season,
        expectedHomeProviderTeamId: identity.providerHomeTeamId,
        expectedHomeName: fixture.homeTeam.displayName,
        expectedAwayProviderTeamId: identity.providerAwayTeamId,
        expectedAwayName: fixture.awayTeam.displayName,
        expectedKickoffUtc: fixture.kickoffAtUtc.toISOString(),
      });
      if (!mapped.ok) {
        if (mapped.error.classification === "RESULT_NOT_TERMINAL") pendingFixtures += 1;
        else warnings.push(`${mapped.error.classification}:${fixture.id}`);
        continue;
      }
      outcomeRows.push({
        id: `out-${digest(fixture.id, descriptor.contentHash).slice(0, 24)}`,
        fixtureId: fixture.id,
        sourceEvidenceId,
        providerFixtureId: mapped.data.providerFixtureId,
        observedAtUtc: mapped.data.capturedAtUtc,
        providerTerminalStatus: mapped.data.providerTerminalStatusRaw,
        result1X2: mapped.data.result1X2,
        regulationHomeScore: mapped.data.regulationHomeScore,
        regulationAwayScore: mapped.data.regulationAwayScore,
      });
    }
    pendingFixtures += Math.max(0, fixtures.length - Math.min(fixtures.length, args.budget));
    await db.$transaction(async (tx) => {
      await tx.dailySettlementRun.create({ data: { id: runId, mode: "NETWORK", status: "COMPLETED", startedAtUtc: now, completedAtUtc: deps.now?.() ?? new Date(), eligibleFixtures: fixtures.length, requestsBudget: args.budget, requestsMade, evidenceCreated: evidenceRows.length, outcomesCreated: outcomeRows.length, pendingFixtures, warningsJson: JSON.stringify(warnings) } });
      for (const row of evidenceRows) await tx.dailySettlementEvidence.create({ data: { id: row.id, settlementRunId: runId, fixtureId: row.fixtureId, providerKey: row.descriptor.providerKey, endpointKey: row.descriptor.endpointKey, capturedAtUtc: new Date(row.descriptor.capturedAtUtc), contentHash: row.descriptor.contentHash, byteLength: row.descriptor.byteLength, mediaType: row.descriptor.mediaType, storageReference: row.descriptor.storageReference } });
      for (const row of outcomeRows) await tx.dailyOutcome.create({ data: { ...row, settlementRunId: runId, observedAtUtc: new Date(row.observedAtUtc) } });
    });
    return Object.freeze({ runId, mode: "NETWORK", eligibleFixtures: fixtures.length, requestsBudget: args.budget, requestsMade, evidenceCreated: evidenceRows.length, outcomesCreated: outcomeRows.length, pendingFixtures, warnings: Object.freeze(warnings), networkUsed: requestsMade > 0 });
  } finally {
    await db.$disconnect();
  }
}
