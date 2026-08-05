import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { evaluateMarkets, type DailyPrediction, type DiscoveredFixture, type MarketQuote } from "@/domain/market-v2/daily-analysis";
import { normalizeAutomaticTeamName } from "@/domain/market-v2/automatic-review-v1";
import { OperationalRawEvidenceStore } from "@/infrastructure/market-v2/capture/operational-evidence-store";
import { classifyOddsProviderFailure, TheOddsApiClient, TheOddsApiError, THE_ODDS_API_POLICY_VERSION, type OddsApiEvent, type OddsApiEventIdentity, type OddsProviderErrorClassification } from "@/infrastructure/market-v2/the-odds-api/client";

const CAPABILITY_POLICY_VERSION = "odds-capability/1.0.0";
const TARGET_RUN = "daily-ae36c26ae6504ae5a5db8b1504e7b9f6";
const values = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const databaseUrl = values.get("--database-url"), evidenceRoot = values.get("--evidence-root"), sportKey = values.get("--sport-key"), from = values.get("--commence-time-from"), to = values.get("--commence-time-to");
if (!databaseUrl?.startsWith("file:/") || !evidenceRoot?.startsWith("/") || !/^soccer_[a-z0-9_]+$/u.test(sportKey ?? "") || !from || !to || !process.argv.includes("--allow-network")) throw new Error("ARGUMENT_INVALID");
const apiKey = process.env.THE_ODDS_API_KEY; if (!apiKey) throw new Error("THE_ODDS_API_KEY_REQUIRED");
const reuseLatestCatalog = process.argv.includes("--reuse-latest-catalog");
const safeDatabaseUrl = databaseUrl as string, safeEvidenceRoot = evidenceRoot as string, safeSportKey = sportKey as string, safeFrom = from as string, safeTo = to as string, safeApiKey = apiKey as string;
const db = new PrismaClient({ datasourceUrl: safeDatabaseUrl }); const store = new OperationalRawEvidenceStore(safeEvidenceRoot);
const token = (...parts: string[]) => createHash("sha256").update(parts.join("\u0000")).digest("hex").slice(0, 24);

async function publish(endpointKey: "odds-sports-catalog" | "odds-sport-events" | "odds-by-sport" | "odds-provider-error", capturedAtUtc: string, bytes: Uint8Array, sourceReference: string) {
  const result = await store.publish({ providerKey: "the-odds-api", endpointKey, capturedAtUtc, mediaType: "application/json", bytes, sourceReference });
  if (!result.ok) throw new Error(result.error.sanitizedCode); return result.descriptor;
}

async function publishError(error: unknown, sourceReference: string) {
  if (!(error instanceof TheOddsApiError) || !error.providerFailure) throw error;
  const descriptor = await publish("odds-provider-error", error.providerFailure.capturedAtUtc, error.providerFailure.evidenceBytes, sourceReference);
  return { descriptor, failure: error.providerFailure, classification: classifyOddsProviderFailure(error.providerFailure) } as const;
}

function strictMatch(fixture: DiscoveredFixture, event: OddsApiEventIdentity): boolean {
  return normalizeAutomaticTeamName(fixture.homeName) === normalizeAutomaticTeamName(event.home_team)
    && normalizeAutomaticTeamName(fixture.awayName) === normalizeAutomaticTeamName(event.away_team)
    && Math.abs(Date.parse(fixture.kickoffAtUtc) - Date.parse(event.commence_time)) <= 20 * 60_000;
}

function quotes(event: OddsApiEvent): MarketQuote[] {
  const result: MarketQuote[] = [];
  for (const bookmaker of event.bookmakers) for (const market of bookmaker.markets) if (market.key === "h2h") for (const outcome of market.outcomes) {
    const canonical = outcome.name === event.home_team ? "HOME" : outcome.name === event.away_team ? "AWAY" : /^draw$/iu.test(outcome.name) ? "DRAW" : null;
    if (canonical && Number.isFinite(outcome.price) && outcome.price > 1) result.push({ market: canonical, bookmaker: bookmaker.key, odds: outcome.price });
  }
  return result;
}

async function main() {
  await store.initialize();
  const clock = { nowUtc: () => new Date().toISOString() }; const client = new TheOddsApiClient({ apiKey: safeApiKey, fetchImpl: globalThis.fetch, clock });
  let catalogHttp: number | "NOT_EXECUTED" = "NOT_EXECUTED", eventsHttp: number | "NOT_EXECUTED" = "NOT_EXECUTED", h2hHttp: number | "NOT_EXECUTED" = "NOT_EXECUTED";
  let catalogCost = 0, eventsCost = 0, oddsCost = 0, sportStatus: "ACTIVE_SUPPORTED" | "INACTIVE_SUPPORTED" | "KEY_NOT_PRESENT" = "KEY_NOT_PRESENT";
  let events: readonly OddsApiEventIdentity[] = [], h2hEvents: readonly OddsApiEvent[] = [], targetMatched = 0, providerErrorCode: string | null = null, rootCause: OddsProviderErrorClassification | "NONE" | "NO_BOOKMAKER_EVENTS_IN_WINDOW" = "NONE";
  let h2hCapability: "SUPPORTED" | "UNSUPPORTED" | "TEMPORARILY_EMPTY" | "UNKNOWN" = "UNKNOWN";
  let catalogReference = "", eventsReference: string | null = null, h2hReference: string | null = null, lastReference = "", lastValidatedAt = clock.nowUtc();

  const fixtures = await db.dailyFixtureCandidate.findMany({ where: { runId: TARGET_RUN, deepAnalyzed: true }, orderBy: { discoveryOrdinal: "asc" }, include: { fixture: { include: { homeTeam: true, awayTeam: true, providerIdentities: { where: { providerId: "provider-api-football" } } } } } });
  const targetFixtures: DiscoveredFixture[] = fixtures.filter(({ fixture }) => fixture.competitionName === "UEFA Champions League Women").map(({ fixture }) => ({ providerFixtureId: fixture.providerIdentities[0]?.providerFixtureId ?? fixture.id, providerCompetitionId: fixture.competitionKey, providerHomeTeamId: fixture.homeTeamId, providerAwayTeamId: fixture.awayTeamId, sportsDate: fixture.sportsDate, kickoffAtUtc: fixture.kickoffAtUtc.toISOString(), sourceTimezone: fixture.sourceTimezone, status: fixture.status, season: fixture.season, round: fixture.round, competitionName: fixture.competitionName, country: fixture.country, homeName: fixture.homeTeam.displayName, awayName: fixture.awayTeam.displayName }));

  if (reuseLatestCatalog) {
    const snapshot = await db.oddsSportCatalogSnapshot.findFirst({ where: { provider: "the-odds-api" }, orderBy: { capturedAtUtc: "desc" }, include: { entries: { where: { key: safeSportKey } } } });
    if (!snapshot) throw new Error("VALID_CATALOG_SNAPSHOT_REQUIRED"); const entry = snapshot.entries[0]; catalogHttp = 200; catalogReference = snapshot.evidenceReference; lastReference = catalogReference; lastValidatedAt = snapshot.capturedAtUtc.toISOString(); sportStatus = entry ? entry.active ? "ACTIVE_SUPPORTED" : "INACTIVE_SUPPORTED" : "KEY_NOT_PRESENT";
  } else {
    let catalog;
    try { catalog = await client.sportsCatalog(); }
    catch (error) { const preserved = await publishError(error, `odds-capability:${safeSportKey}:catalog:error`); console.log(`SPORTS_CATALOG_HTTP ${preserved.failure.httpStatus}`); console.log(`PROVIDER_ERROR_CODE ${preserved.failure.providerErrorCode ?? "NONE"}`); console.log(`ROOT_CAUSE ${preserved.classification}`); throw new Error("SPORTS_CATALOG_FAILED_AFTER_EVIDENCE"); }
    catalogHttp = catalog.httpStatus; catalogCost = catalog.quota.last ?? 0;
    const catalogEvidence = await publish("odds-sports-catalog", catalog.capturedAtUtc, catalog.rawBytes, `odds-capability:${safeSportKey}:catalog`); catalogReference = catalogEvidence.storageReference; lastReference = catalogReference; lastValidatedAt = catalog.capturedAtUtc;
    const entry = catalog.sports.find((item) => item.key === safeSportKey); sportStatus = entry ? entry.active ? "ACTIVE_SUPPORTED" : "INACTIVE_SUPPORTED" : "KEY_NOT_PRESENT";
    const snapshotId = `odds-catalog-${token(catalogEvidence.contentHash, catalog.capturedAtUtc)}`;
    await db.$transaction(async (tx) => {
      if (!await tx.oddsSportCatalogSnapshot.findFirst({ where: { contentHash: catalogEvidence.contentHash, capturedAtUtc: new Date(catalog.capturedAtUtc) } })) {
        await tx.oddsSportCatalogSnapshot.create({ data: { id: snapshotId, provider: "the-odds-api", capturedAtUtc: new Date(catalog.capturedAtUtc), contentHash: catalogEvidence.contentHash, byteLength: catalogEvidence.byteLength, evidenceReference: catalogReference, policyVersion: THE_ODDS_API_POLICY_VERSION } });
        for (const item of catalog.sports) await tx.oddsSportCatalogEntry.create({ data: { id: `odds-sport-${token(snapshotId, item.key)}`, snapshotId, key: item.key, group: item.group, title: item.title, description: item.description, active: item.active, hasOutrights: item.has_outrights, capturedAtUtc: new Date(catalog.capturedAtUtc), evidenceReference: catalogReference } });
      }
    });
  }

  if (sportStatus !== "KEY_NOT_PRESENT") {
    try {
      const result = await client.eventsBySport({ sportKey: safeSportKey, commenceTimeFrom: safeFrom, commenceTimeTo: safeTo }); eventsHttp = result.httpStatus; eventsCost = result.quota.last ?? 0; events = result.events;
      const descriptor = await publish("odds-sport-events", result.capturedAtUtc, result.rawBytes, `odds-capability:${safeSportKey}:events`); eventsReference = descriptor.storageReference; lastReference = eventsReference; lastValidatedAt = result.capturedAtUtc;
      targetMatched = targetFixtures.filter((fixture) => events.some((event) => strictMatch(fixture, event))).length;
      for (const event of events) console.log(`EVENT ${JSON.stringify({ id: event.id, home: event.home_team, away: event.away_team, kickoffAtUtc: event.commence_time, matchedFixtureIds: targetFixtures.filter((fixture) => strictMatch(fixture, event)).map((fixture) => fixture.providerFixtureId) })}`);
      try {
        const resultOdds = await client.bySport({ sportKey: safeSportKey, commenceTimeFrom: safeFrom, commenceTimeTo: safeTo, regions: ["eu"], markets: ["h2h"] }); h2hHttp = resultOdds.httpStatus; oddsCost = resultOdds.quota.last ?? 0; h2hEvents = resultOdds.events;
        const descriptorOdds = await publish("odds-by-sport", resultOdds.capturedAtUtc, resultOdds.rawBytes, `odds-capability:${safeSportKey}:h2h`); h2hReference = descriptorOdds.storageReference; lastReference = h2hReference; lastValidatedAt = resultOdds.capturedAtUtc;
        h2hCapability = h2hEvents.length ? "SUPPORTED" : "TEMPORARILY_EMPTY"; if (!h2hEvents.length) rootCause = "NO_BOOKMAKER_EVENTS_IN_WINDOW";
        for (const fixture of targetFixtures) {
          const event = h2hEvents.find((candidate) => strictMatch(fixture, candidate)); const candidate = fixtures.find((value) => value.fixture.providerIdentities[0]?.providerFixtureId === fixture.providerFixtureId); if (!event || !candidate?.predictionJson) continue;
          const evaluations = evaluateMarkets(JSON.parse(candidate.predictionJson) as DailyPrediction, quotes(event)).filter((value) => ["HOME", "DRAW", "AWAY"].includes(value.market));
          console.log(`VALUE ${JSON.stringify({ fixtureId: fixture.providerFixtureId, eventId: event.id, evaluations: evaluations.map(({ market, modelProbability, fairOdds, noVigProbability, edge, expectedValue }) => ({ market, modelProbability, fairOdds, noVigProbability, edge, expectedValue })) })}`);
        }
      } catch (error) {
        const preserved = await publishError(error, `odds-capability:${safeSportKey}:h2h:error`); h2hHttp = preserved.failure.httpStatus; oddsCost = preserved.failure.quota.last ?? 0; providerErrorCode = preserved.failure.providerErrorCode; rootCause = preserved.classification; h2hReference = preserved.descriptor.storageReference; lastReference = h2hReference; lastValidatedAt = preserved.failure.capturedAtUtc; h2hCapability = preserved.classification === "INVALID_MARKET" ? "UNSUPPORTED" : "UNKNOWN";
      }
    } catch (error) {
      const preserved = await publishError(error, `odds-capability:${safeSportKey}:events:error`); eventsHttp = preserved.failure.httpStatus; eventsCost = preserved.failure.quota.last ?? 0; providerErrorCode = preserved.failure.providerErrorCode; rootCause = preserved.classification; eventsReference = preserved.descriptor.storageReference; lastReference = eventsReference; lastValidatedAt = preserved.failure.capturedAtUtc;
    }
  }

  await db.oddsSportCapability.create({ data: { id: `odds-cap-${token(safeSportKey, lastValidatedAt, lastReference)}`, provider: "the-odds-api", sportKey: safeSportKey, catalogActive: sportStatus === "ACTIVE_SUPPORTED", eventsEndpointValidated: eventsHttp === 200, h2hStatus: h2hCapability, totalsStatus: "UNKNOWN", regionsValidatedJson: JSON.stringify(h2hHttp === 200 ? ["eu"] : []), lastHttpStatus: h2hHttp !== "NOT_EXECUTED" ? h2hHttp : eventsHttp !== "NOT_EXECUTED" ? eventsHttp : catalogHttp, lastProviderErrorCode: providerErrorCode, lastValidatedAt: new Date(lastValidatedAt), evidenceReference: lastReference, catalogEvidenceReference: catalogReference, eventsEvidenceReference: eventsReference, h2hEvidenceReference: h2hReference, policyVersion: CAPABILITY_POLICY_VERSION } });
  for (const [key, value] of Object.entries({ SPORTS_CATALOG_HTTP: catalogHttp, SPORTS_CATALOG_QUOTA_COST: catalogCost, SPORT_KEY: safeSportKey, SPORT_KEY_STATUS: sportStatus, EVENTS_HTTP: eventsHttp, EVENTS_QUOTA_COST: eventsCost, EVENTS_RECEIVED: events.length, TARGET_EVENTS_MATCHED: targetMatched, H2H_ODDS_REQUESTS: h2hHttp === "NOT_EXECUTED" ? 0 : 1, H2H_ODDS_HTTP: h2hHttp, H2H_EVENTS_RECEIVED: h2hEvents.length, PROVIDER_ERROR_CODE: providerErrorCode ?? "NONE", ROOT_CAUSE: rootCause, H2H_CAPABILITY: h2hCapability, TOTALS_CAPABILITY: "UNKNOWN", API_FOOTBALL_REQUESTS: 0, ODDS_USAGE_COST: oddsCost })) console.log(`${key} ${value}`);
}

main().catch((error) => { console.error(error instanceof Error ? error.message : "UNKNOWN_ERROR"); process.exitCode = 1; }).finally(async () => { await db.$disconnect(); });
