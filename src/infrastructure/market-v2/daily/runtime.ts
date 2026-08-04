import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { ApiFootballClient } from "@/infrastructure/market-v2/api-football/client";
import { buildApiFootballConfig } from "@/infrastructure/market-v2/api-football/config";
import { OperationalRawEvidenceStore } from "@/infrastructure/market-v2/capture/operational-evidence-store";
import { TheOddsApiClient, TheOddsApiError, type OddsApiEvent } from "@/infrastructure/market-v2/the-odds-api/client";
import { evaluateMarkets, filterFixture, sportsDateD1, type DailyPrediction, type DiscoveredFixture, type MarketQuote } from "@/domain/market-v2/daily-analysis";
import type { ApiFootballFixtureDto, ApiFootballPredictionDto } from "@/infrastructure/market-v2/api-football/contracts";
import type { RawEvidenceDescriptor } from "@/application/market-v2/capture/raw-evidence-store";
import { AUTOMATIC_DAILY_RANKING_POLICY, AUTOMATIC_ODDS_MATCHING_POLICY, matchAutomaticFixture, scoreAutomaticReview, selectAutomaticReview, type AutomaticCategory } from "@/domain/market-v2/automatic-review-v1";
import { mapPriceableOdds } from "@/domain/market-v2/odds-market-mapping";
import { ODDS_ACQUISITION_POLICY, selectOddsAcquisition } from "@/domain/market-v2/odds-acquisition";

export type DailyArguments = Readonly<{ sportsDate: string; databaseUrl: string; evidenceRoot: string; maxFixtures: number; deepCandidates: number; top: number; mode: "full" | "provisional"; dryRun: boolean; allowNetwork: boolean }>;
export type DailyRunResult = Readonly<{ runId: string; runMode: "MODEL_ONLY_PROVISIONAL" | "FULL"; fixturesDiscovered: number; fixturesEligible: number; fixturesDeepAnalyzed: number; fixturesExcluded: number; recommendations: number; valueDetected: number; modelReview: number; strong: number; interesting: number; watch: number; pass: number; historicalCalibrationAvailable: boolean; oddsAvailable: boolean; oddsResponseReceived:boolean;oddsEventsReceived:number;oddsFixturesMatched:number;oddsMarketsMatched:number;usableOddsAvailable:boolean;marketEvaluationsCreated:number; marketValueCalculated: boolean; topRecommendation: string; apiFootballBudget: number; apiFootballRequests: number; oddsBudget: number; oddsRequests: number; networkUsed: boolean; replayed: boolean }>;

export class DailyRuntimeError extends Error { constructor(readonly code: string) { super(code); this.name = "DailyRuntimeError"; } }
function fail(code: string): never { throw new DailyRuntimeError(code); }
export type DailyFailurePhase="DISCOVERY_FAILED"|"PREDICTION_FAILED"|"ODDS_CAPTURE_FAILED"|"ODDS_MATCHING_FAILED"|"PERSISTENCE_FAILED"|"RANKING_FAILED"|"CONFIGURATION_FAILED";
export function classifyDailyFailure(error:unknown):DailyFailurePhase{const code=error instanceof DailyRuntimeError?error.code:"";if(/FIXTURE_DISCOVERY|FIXTURE_EVIDENCE/.test(code))return "DISCOVERY_FAILED";if(/PREDICTION|API_FOOTBALL_BUDGET/.test(code))return "PREDICTION_FAILED";if(/ODDS.*MATCH/.test(code))return "ODDS_MATCHING_FAILED";if(/ODDS/.test(code))return "ODDS_CAPTURE_FAILED";if(/DATABASE|PERSIST/.test(code))return "PERSISTENCE_FAILED";if(/ARGUMENT|MODE|KEY|CONFIGURATION|EXECUTION/.test(code))return "CONFIGURATION_FAILED";return "RANKING_FAILED"}
const int = (value: string | undefined, code: string) => { if (!value || !/^\d+$/u.test(value) || Number(value) < 1) fail(code); return Number(value); };
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/u.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;

export function parseDailyArguments(argv: readonly string[], now = new Date()): DailyArguments {
  const values = new Map<string, string>(); let dryRun = false; let allowNetwork = false;
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (key === "--dry-run" || key === "--allow-network") { if (key === "--dry-run") dryRun = true; else allowNetwork = true; continue; }
    if (!["--sports-date", "--database-url", "--evidence-root", "--max-fixtures", "--deep-candidates", "--top", "--mode"].includes(key)) fail("ARGUMENT_UNKNOWN");
    const value = argv[++i]; if (!value || value.startsWith("--") || values.has(key)) fail("ARGUMENT_INVALID"); values.set(key, value);
  }
  if (dryRun === allowNetwork) fail("EXPLICIT_EXECUTION_MODE_REQUIRED");
  const sportsDate = values.get("--sports-date") ?? sportsDateD1(now);
  const mode = values.get("--mode") ?? "provisional";
  if (!validDate(sportsDate)) fail("SPORTS_DATE_INVALID");
  if (mode !== "full" && mode !== "provisional") fail("MODE_INVALID");
  const databaseUrl = values.get("--database-url"); const evidenceRoot = values.get("--evidence-root");
  if (!databaseUrl?.startsWith("file:/")) fail("DATABASE_URL_INVALID");
  if (!evidenceRoot?.startsWith("/")) fail("EVIDENCE_ROOT_INVALID");
  const maxFixtures = int(values.get("--max-fixtures"), "MAX_FIXTURES_INVALID");
  const deepCandidates = int(values.get("--deep-candidates"), "DEEP_CANDIDATES_INVALID");
  const top = int(values.get("--top"), "TOP_INVALID");
  if (deepCandidates > maxFixtures || top > deepCandidates) fail("BUDGET_RELATION_INVALID");
  return Object.freeze({ sportsDate, databaseUrl: databaseUrl as string, evidenceRoot: evidenceRoot as string, maxFixtures, deepCandidates, top, mode: mode as "full" | "provisional", dryRun, allowNetwork });
}

function token(namespace: string, ...parts: readonly string[]): string { return createHash("sha256").update([namespace, ...parts].join("\0")).digest("hex"); }
const nowClock = { nowUtc: () => new Date().toISOString() };

function syntheticFixtures(date: string): readonly DiscoveredFixture[] {
  return Object.freeze([
    { providerFixtureId: "900001", providerCompetitionId: "100", providerHomeTeamId: "1", providerAwayTeamId: "2", sportsDate: date, kickoffAtUtc: `${date}T18:00:00.000Z`, sourceTimezone: "UTC", status: "NS", season: 2026, round: "Regular Season - 1", competitionName: "Liga Demostración", country: "Paraguay", homeName: "Guaraní Norte", awayName: "Sol del Este" },
    { providerFixtureId: "900002", providerCompetitionId: "100", providerHomeTeamId: "3", providerAwayTeamId: "4", sportsDate: date, kickoffAtUtc: `${date}T20:00:00.000Z`, sourceTimezone: "UTC", status: "NS", season: 2026, round: "Regular Season - 1", competitionName: "Liga Demostración", country: "Paraguay", homeName: "Libertad Azul", awayName: "Nacional Sur" },
    { providerFixtureId: "900003", providerCompetitionId: "101", providerHomeTeamId: "5", providerAwayTeamId: "6", sportsDate: date, kickoffAtUtc: `${date}T21:00:00.000Z`, sourceTimezone: "UTC", status: "NS", season: 2026, round: "Friendly", competitionName: "International Friendly", country: "World", homeName: "Equipo Uno", awayName: "Equipo Dos" },
  ]);
}

function syntheticPrediction(index: number): DailyPrediction { return Object.freeze(index === 0 ? { home: .45, draw: .45, away: .10, contextualAgreement: .72, contradictory: false, rawSignals: { source: "synthetic", case: "tie" } } : { home: .58, draw: .24, away: .18, over25: .56, under25: .44, contextualAgreement: .8, contradictory: false, rawSignals: { source: "synthetic" } }); }

function mapFixture(value: ApiFootballFixtureDto, sportsDate: string): DiscoveredFixture { return Object.freeze({ providerFixtureId: String(value.fixture.id), providerCompetitionId: String(value.league.id), providerHomeTeamId: String(value.teams.home.id), providerAwayTeamId: String(value.teams.away.id), sportsDate, kickoffAtUtc: new Date(value.fixture.date).toISOString(), sourceTimezone: String(value.fixture.timezone), status: String(value.fixture.status.short), season: Number(value.league.season), round: String(value.league.round), competitionName: String(value.league.name), country: String(value.league.country), homeName: String(value.teams.home.name), awayName: String(value.teams.away.name) }); }
function percent(value: string): number { return Number(value.replace("%", "")) / 100; }
function mapPrediction(value: ApiFootballPredictionDto, rawSignals: Readonly<Record<string, unknown>>): DailyPrediction { const p = value.predictions.percent; const home = percent(p.home), draw = percent(p.draw), away = percent(p.away); const sum = home + draw + away; if (sum <= 0) fail("PREDICTION_PERCENT_INVALID"); return Object.freeze({ home: home / sum, draw: draw / sum, away: away / sum, winner: value.predictions.winner?.name ?? null, advice: value.predictions.advice ?? null, contextualAgreement: value.predictions.winner?.name ? .8 : .55, contradictory: false, rawSignals }); }

type AuditEntry = Readonly<{ providerKey: "api-football" | "the-odds-api"; endpointKey: string; startedAtUtc: string; finishedAtUtc: string; httpStatus: number | null; classification: string; sanitizedErrorCode?:string }>;
type Evaluation = ReturnType<typeof evaluateMarkets>[number];
type Scored = ReturnType<typeof scoreAutomaticReview>;
type RankedItem = Readonly<{ fixture: DiscoveredFixture; prediction: DailyPrediction; evaluation: Evaluation & Readonly<{ modelProbability: number }>; scored: Scored; category: AutomaticCategory; score: number; edge: number | null; kickoffAtUtc: string; fixtureId: string }>;
type SummaryItem = Readonly<{ fixture: Readonly<{ homeName: string; awayName: string }>; evaluation: Readonly<{ market: string; edge?: number | null }>; category?: AutomaticCategory; scored: Readonly<{ classification?: string; category?: AutomaticCategory }> }>;

function extractQuotes(fixtures: readonly DiscoveredFixture[], events: readonly OddsApiEvent[]):Readonly<{quotes:Map<string,MarketQuote[]>;diagnostics:readonly unknown[];fixturesMatched:number;marketsMatched:number}> {
  const result = new Map<string, MarketQuote[]>();
  const diagnostics:unknown[]=[];const matchedMarkets=new Set<string>();let fixturesMatched=0;
  for (const fixture of fixtures) {
    const diagnosis=matchAutomaticFixture({fixtureId:fixture.providerFixtureId,homeName:fixture.homeName,awayName:fixture.awayName,kickoffAtUtc:fixture.kickoffAtUtc,competitionName:fixture.competitionName,country:fixture.country},events.map((event)=>({id:event.id,homeName:event.home_team,awayName:event.away_team,kickoffAtUtc:event.commence_time,sportKey:typeof event.sport_key==="string"?event.sport_key:undefined,sportTitle:event.sport_title})));diagnostics.push({fixtureId:fixture.providerFixtureId,...diagnosis});
    const event=diagnosis.matchedEventId?events.find((candidate)=>candidate.id===diagnosis.matchedEventId):undefined;
    if (!event) continue; fixturesMatched+=1; const mapped=mapPriceableOdds(event); const quotes=[...mapped.quotes]; for(const market of mapped.matchedMarkets)matchedMarkets.add(`${fixture.providerFixtureId}:${market}`);
    if (quotes.length) result.set(fixture.providerFixtureId, quotes);
  } return {quotes:result,diagnostics,fixturesMatched,marketsMatched:matchedMarkets.size};
}

export async function runDaily(args: DailyArguments, deps: Readonly<{ fetchImpl?: typeof fetch; apiFootballKey?: () => string | undefined; oddsApiKey?: () => string | undefined; now?: () => Date }> = {}): Promise<DailyRunResult> {
  const historicalAvailable = false;
  if (args.mode === "full" && !historicalAvailable) fail("FULL_MODE_REQUIRES_VALIDATED_HISTORY");
  const started = (deps.now?.() ?? new Date()).toISOString(); const apiBudget = 1 + args.deepCandidates; const oddsBudget = ODDS_ACQUISITION_POLICY.maximumRequestsPerRun;
  let apiRequests = 0, oddsRequests = 0; const evidence: RawEvidenceDescriptor[] = []; const audits: AuditEntry[] = []; let fixtures: readonly DiscoveredFixture[]; const predictions = new Map<string, DailyPrediction>(); const evidenceStore = args.dryRun ? null : new OperationalRawEvidenceStore(args.evidenceRoot);
  if (evidenceStore) await evidenceStore.initialize();
  if (args.dryRun) fixtures = syntheticFixtures(args.sportsDate);
  else {
    const key = deps.apiFootballKey?.(); if (!key) fail("API_FOOTBALL_KEY_REQUIRED");
    const client = new ApiFootballClient({ config: buildApiFootballConfig({ API_FOOTBALL_KEY: key }), fetchImpl: deps.fetchImpl ?? fetch, clock: nowClock });
    const before = new Date().toISOString(); apiRequests += 1; const response = await client.listFixtures({ date: args.sportsDate, timezone: "UTC" });
    audits.push({ providerKey: "api-football", endpointKey: "fixtures-by-date", startedAtUtc: before, finishedAtUtc: new Date().toISOString(), httpStatus: response.ok ? response.metadata.httpStatus : response.error.httpStatus ?? null, classification: response.ok ? "SUCCESS" : response.error.classification });
    if (!response.ok) fail(`FIXTURE_DISCOVERY_${response.error.classification}`);
    if (!response.evidenceCandidate) fail("FIXTURE_EVIDENCE_MISSING");
    const published = await evidenceStore!.publish({ providerKey: "api-football", endpointKey: "fixtures-by-date", capturedAtUtc: response.evidenceCandidate.capturedAtUtc, mediaType: response.evidenceCandidate.mediaType, bytes: response.evidenceCandidate.rawBytes, sourceReference: `daily:${args.sportsDate}:fixtures` });
    if (!published.ok) fail("FIXTURE_EVIDENCE_FAILED");
    evidence.push(published.descriptor);
    fixtures = response.payload.response.slice(0, args.maxFixtures).map((row) => mapFixture(row, args.sportsDate));
  }
  const now = deps.now?.() ?? new Date(); const filtered = fixtures.map((fixture) => ({ fixture, filter: filterFixture(fixture, now) })); const eligible = filtered.filter((item) => item.filter.eligible).slice(0, args.maxFixtures); const deep = eligible.slice(0, args.deepCandidates);
  const oddsAcquisition = selectOddsAcquisition(deep.map((item) => item.fixture));
  if (args.dryRun) deep.forEach((item, index) => predictions.set(item.fixture.providerFixtureId, syntheticPrediction(index)));
  else {
    const key = deps.apiFootballKey?.(); if (!key) fail("API_FOOTBALL_KEY_REQUIRED"); const client = new ApiFootballClient({ config: buildApiFootballConfig({ API_FOOTBALL_KEY: key }), fetchImpl: deps.fetchImpl ?? fetch, clock: nowClock });
    for (const item of deep) {
      if (apiRequests >= apiBudget) fail("API_FOOTBALL_BUDGET_EXHAUSTED"); const before = new Date().toISOString(); apiRequests += 1; const response = await client.getPrediction(item.fixture.providerFixtureId);
      audits.push({ providerKey: "api-football", endpointKey: "prediction-by-fixture", startedAtUtc: before, finishedAtUtc: new Date().toISOString(), httpStatus: response.ok ? response.metadata.httpStatus : response.error.httpStatus ?? null, classification: response.ok ? "SUCCESS" : response.error.classification });
      if (!response.ok || !response.evidenceCandidate) continue;
      const published = await evidenceStore!.publish({ providerKey: "api-football", endpointKey: "prediction-by-fixture", capturedAtUtc: response.evidenceCandidate.capturedAtUtc, mediaType: response.evidenceCandidate.mediaType, bytes: response.evidenceCandidate.rawBytes, sourceReference: `daily:${args.sportsDate}:prediction:${item.fixture.providerFixtureId}` });
      if (!published.ok) continue; evidence.push(published.descriptor); const parsedRaw: unknown = JSON.parse(new TextDecoder().decode(response.evidenceCandidate.rawBytes)); const raw = typeof parsedRaw === "object" && parsedRaw !== null && !Array.isArray(parsedRaw) ? parsedRaw as Readonly<Record<string, unknown>> : {}; if (response.payload.response[0]) predictions.set(item.fixture.providerFixtureId, mapPrediction(response.payload.response[0], raw));
    }
  }
  const quotesByFixture = new Map<string, MarketQuote[]>();let oddsResponseReceived=false,oddsCaptureSucceeded=false,oddsEventsReceived=0,oddsFixturesMatched=0,oddsMarketsMatched=0;let oddsDiagnostics:readonly unknown[]=[...oddsAcquisition.diagnostics];
  if (!args.dryRun) {
    const oddsKey = deps.oddsApiKey?.();
    if (oddsKey && oddsAcquisition.requests.length > 0) {
      const client = new TheOddsApiClient({ apiKey: oddsKey, fetchImpl: deps.fetchImpl ?? fetch, clock: nowClock });
      const capturedEvents: OddsApiEvent[] = [];
      for (const request of oddsAcquisition.requests) {
        if (oddsRequests >= oddsBudget) break;
        const startedAtUtc = new Date().toISOString(); oddsRequests += 1;
        try {
          const response = await client.bySport(request); oddsResponseReceived = true;
          const published = await evidenceStore!.publish({ providerKey: "the-odds-api", endpointKey: "odds-by-sport", capturedAtUtc: response.capturedAtUtc, mediaType: "application/json", bytes: response.rawBytes, sourceReference: `daily:${args.sportsDate}:odds:${request.sportKey}` });
          if (!published.ok) throw new TheOddsApiError("ODDS_EVIDENCE_FAILED", true, response.httpStatus);
          evidence.push(published.descriptor); capturedEvents.push(...response.events); oddsEventsReceived += response.events.length; oddsCaptureSucceeded = true;
          audits.push({ providerKey: "the-odds-api", endpointKey: `odds-by-sport:${request.sportKey}`, startedAtUtc, finishedAtUtc: new Date().toISOString(), httpStatus: response.httpStatus, classification: "SUCCESS" });
        } catch (error) {
          const known = error instanceof TheOddsApiError ? error : null; const sanitizedErrorCode = known?.sanitizedCode ?? "ODDS_NETWORK_FAILURE";
          oddsResponseReceived = oddsResponseReceived || (known?.responseReceived ?? false);
          oddsDiagnostics = [...oddsDiagnostics, { sportKey: request.sportKey, fixtureIds: request.fixtureIds, code: sanitizedErrorCode }];
          audits.push({ providerKey: "the-odds-api", endpointKey: `odds-by-sport:${request.sportKey}`, startedAtUtc, finishedAtUtc: new Date().toISOString(), httpStatus: known?.httpStatus ?? null, classification: sanitizedErrorCode === "ODDS_COMPETITION_NOT_COVERED" ? "NOT_COVERED" : "UNAVAILABLE", sanitizedErrorCode });
        }
      }
      if (capturedEvents.length > 0) { const extracted=extractQuotes(deep.map((d) => d.fixture), capturedEvents);oddsFixturesMatched=extracted.fixturesMatched;oddsMarketsMatched=extracted.marketsMatched;oddsDiagnostics=[...oddsDiagnostics,...extracted.diagnostics];for (const [id, quotes] of extracted.quotes) quotesByFixture.set(id, quotes); }
    }
  }
  const rankedInput: RankedItem[] = []; const evaluationsByFixture = new Map<string, readonly Evaluation[]>();
  for (const item of deep) { const prediction = predictions.get(item.fixture.providerFixtureId); if (!prediction) continue; const probabilities = [prediction.home, prediction.draw, prediction.away].sort((a,b)=>b-a); const margin = probabilities[0] - probabilities[1]; const evaluations = evaluateMarkets(prediction, quotesByFixture.get(item.fixture.providerFixtureId) ?? []); evaluationsByFixture.set(item.fixture.providerFixtureId, evaluations); for (const evaluation of evaluations) { if (evaluation.modelProbability === null) continue; const narrowed = { ...evaluation, modelProbability: evaluation.modelProbability }; const scored = scoreAutomaticReview({ market: evaluation.market, modelProbability: evaluation.modelProbability, topMargin: ["HOME","DRAW","AWAY"].includes(evaluation.market) ? margin : .1, dataQuality: item.filter.quality, contextualAgreement: prediction.contextualAgreement, contradictory: prediction.contradictory, edge: evaluation.edge, expectedValue: evaluation.expectedValue, dispersion: evaluation.dispersion }); rankedInput.push({ fixture: item.fixture, prediction, evaluation: narrowed, scored, category:scored.category, score: scored.total, edge:evaluation.edge, kickoffAtUtc: item.fixture.kickoffAtUtc, fixtureId: item.fixture.providerFixtureId }); } }
  const marketEvaluationCount = [...evaluationsByFixture.values()].reduce((total, evaluations) => total + evaluations.length, 0);
  const categoryPriority:Record<AutomaticCategory,number>={VALUE_DETECTED:0,MODEL_REVIEW:1,WATCH:2,PASS:3};
  const orderedMarkets=[...rankedInput].sort((a,b)=>categoryPriority[a.category]-categoryPriority[b.category]||b.score-a.score||b.evaluation.modelProbability-a.evaluation.modelProbability||a.evaluation.market.localeCompare(b.evaluation.market)); const perFixture = new Map<string, RankedItem>(); for (const value of orderedMarkets) if (!perFixture.has(value.fixtureId)) perFixture.set(value.fixtureId, value); const selected=selectAutomaticReview([...perFixture.values()]);const ranked=[...selected.primary.slice(0,args.top),...selected.watch,...selected.discarded];
  if (args.dryRun) return summary(`dry-${token("daily", args.sportsDate).slice(0,16)}`, fixtures.length, eligible.length, predictions.size, filtered.filter((x)=>!x.filter.eligible).length, ranked, apiBudget, 0, oddsBudget, 0, false, false, false);
  const runIdentity = token("daily-run", args.sportsDate, ...evidence.map((e) => e.contentHash).sort(), AUTOMATIC_DAILY_RANKING_POLICY.version); const runId = `daily-${runIdentity.slice(0, 32)}`; const prisma = new PrismaClient({ datasourceUrl: args.databaseUrl });
  try { const existing = await prisma.dailyAnalysisRun.findUnique({ where: { id: runId }, include: { candidates: { include: { fixture: { include: { homeTeam: true, awayTeam: true } }, recommendations: true } } } }); if (existing) { const previous=existing.candidates.flatMap((c)=>c.recommendations.map((r)=>({ category:r.automaticCategory as AutomaticCategory,scored:{category:r.automaticCategory as AutomaticCategory}, fixture:{homeName:c.fixture.homeTeam.displayName,awayName:c.fixture.awayTeam.displayName}, evaluation:{market:r.market,edge:null} }))); return summary(runId, existing.fixturesDiscovered, existing.fixturesEligible, existing.fixturesDeepAnalyzed, existing.fixturesExcluded, previous, existing.apiFootballBudget, existing.apiFootballRequests, existing.oddsBudget, existing.oddsRequests, true, true, existing.oddsAvailable,{response:existing.oddsResponseReceived,events:existing.oddsEventsReceived,fixtures:existing.oddsFixturesMatched,markets:existing.oddsMarketsMatched,usable:existing.usableOddsAvailable,evaluations:existing.marketEvaluationsCreated}); }
    await prisma.$transaction(async (tx) => {
      for (const provider of [{ id: "provider-api-football", stableKey: "api-football", displayName: "API-Football" }, { id: "provider-the-odds-api", stableKey: "the-odds-api", displayName: "The Odds API" }]) if (!await tx.provider.findUnique({where:{id:provider.id}})) await tx.provider.create({data:provider});
      for (const item of filtered) { const f=item.fixture; const homeId=`team-${token("team",String(f.providerHomeTeamId)).slice(0,24)}`, awayId=`team-${token("team",String(f.providerAwayTeamId)).slice(0,24)}`, fixtureId=`fixture-${token("fixture",f.providerFixtureId).slice(0,24)}`; if(!await tx.team.findUnique({where:{id:homeId}})) await tx.team.create({data:{id:homeId,canonicalKey:`api-football:${f.providerHomeTeamId}`,displayName:f.homeName}}); if(!await tx.team.findUnique({where:{id:awayId}})) await tx.team.create({data:{id:awayId,canonicalKey:`api-football:${f.providerAwayTeamId}`,displayName:f.awayName}}); if(!await tx.fixture.findUnique({where:{id:fixtureId}})) await tx.fixture.create({data:{id:fixtureId,sportsDate:f.sportsDate,homeTeamId:homeId,awayTeamId:awayId,competitionKey:`api-football:${f.providerCompetitionId}`,competitionName:f.competitionName,country:f.country,season:f.season,round:f.round,kickoffAtUtc:new Date(f.kickoffAtUtc),status:f.status,sourceTimezone:f.sourceTimezone}}); const pfiId=`pfi-${token("pfi",f.providerFixtureId).slice(0,24)}`; if(!await tx.providerFixtureIdentity.findUnique({where:{id:pfiId}})) await tx.providerFixtureIdentity.create({data:{id:pfiId,providerId:"provider-api-football",providerFixtureId:f.providerFixtureId,fixtureId,providerCompetitionId:f.providerCompetitionId,providerHomeTeamId:f.providerHomeTeamId,providerAwayTeamId:f.providerAwayTeamId,season:f.season,sourceDateRaw:f.kickoffAtUtc,sourceTimezone:f.sourceTimezone}}); }
      await tx.dailyAnalysisRun.create({ data: { id:runId,sportsDate:args.sportsDate,mode:"MODEL_ONLY_PROVISIONAL",status:"COMPLETED",scoringPolicyVersion:AUTOMATIC_DAILY_RANKING_POLICY.version,selectionPolicyVersion:AUTOMATIC_DAILY_RANKING_POLICY.version,matcherVersion:AUTOMATIC_ODDS_MATCHING_POLICY.version,startedAtUtc:new Date(started),completedAtUtc:new Date(),historicalCalibrationAvailable:false,historicalDatasetFound:false,historicalMarketsCalibrated:0,oddsAvailable:oddsResponseReceived,oddsResponseReceived,oddsEventsReceived,oddsFixturesMatched,oddsMarketsMatched,usableOddsAvailable:quotesByFixture.size>0,usableOddsCount:[...quotesByFixture.values()].flat().length,marketEvaluationsCreated:marketEvaluationCount,oddsDiagnosticsJson:JSON.stringify(oddsDiagnostics),marketValueCalculated:ranked.some((r)=>r.evaluation.edge!==null),fixturesMatchedExact:oddsDiagnostics.filter((value)=>typeof value==="object"&&value!==null&&(value as {method?:string}).method==="EXACT_NORMALIZED").length,fixturesMatchedAlias:oddsDiagnostics.filter((value)=>typeof value==="object"&&value!==null&&(value as {method?:string}).method==="UNIQUE_HIGH_CONFIDENCE").length,fixturesUnmatched:Math.max(0,deep.length-oddsFixturesMatched),fixturesAmbiguous:oddsDiagnostics.filter((value)=>JSON.stringify(value).includes("AMBIGUOUS_EVENT")).length,fixturesDiscovered:fixtures.length,fixturesEligible:eligible.length,fixturesDeepAnalyzed:predictions.size,fixturesExcluded:filtered.filter((x)=>!x.filter.eligible).length,recommendations:ranked.length,apiFootballBudget:apiBudget,apiFootballRequests:apiRequests,oddsBudget,oddsRequests,warningsJson:JSON.stringify(["AUTOMATIC_REVIEW_V1","CALIBRATION_BOOTSTRAP",...oddsAcquisition.diagnostics.filter((item)=>item.status!=="COVERED").map((item)=>`${item.status}:${item.fixtureId}`),...(oddsCaptureSucceeded?quotesByFixture.size?[]:["ODDS_RESPONSE_WITHOUT_USABLE_MATCH"]:oddsAcquisition.requests.length>0?["ODDS_CAPTURE_FAILED"]:[])]) } });
      for (const [ordinal, item] of filtered.entries()) {
        const f = item.fixture; const fixtureId = `fixture-${token("fixture", f.providerFixtureId).slice(0, 24)}`;
        if (!item.filter.eligible) { await tx.dailyExclusion.create({ data: { id: `exc-${token(runId, f.providerFixtureId).slice(0, 24)}`, runId, providerFixtureId: f.providerFixtureId, fixtureLabel: `${f.homeName} — ${f.awayName}`, reasonCode: item.filter.reasonCode, detailsJson: "{}" } }); continue; }
        const candidateId = `cand-${token(runId, f.providerFixtureId).slice(0, 24)}`, pred = predictions.get(f.providerFixtureId);
        await tx.dailyFixtureCandidate.create({ data: { id: candidateId, runId, fixtureId, eligible: true, deepAnalyzed: Boolean(pred), discoveryOrdinal: ordinal + 1, dataQuality: item.filter.quality, predictionJson: pred ? JSON.stringify(pred) : null, reasonsJson: JSON.stringify([item.filter.reasonCode]), warningsJson: JSON.stringify(pred ? [] : ["PREDICTION_UNAVAILABLE"]) } });
        for (const evaluation of evaluationsByFixture.get(f.providerFixtureId) ?? []) {
          const evalId = `eval-${token(candidateId, evaluation.market).slice(0, 24)}`;
          await tx.dailyMarketEvaluation.create({ data: { id: evalId, candidateId, market: evaluation.market, evaluationStatus: evaluation.status, modelProbability: evaluation.modelProbability, fairOdds: evaluation.fairOdds, bestMarketOdds: evaluation.bestMarketOdds, marketImpliedProbability: evaluation.bestMarketOdds === null ? null : 1 / evaluation.bestMarketOdds, noVigProbability: evaluation.noVigProbability, marketMargin: evaluation.marketMargin, edge: evaluation.edge, expectedValue: evaluation.expectedValue, bookmakerDispersion: evaluation.dispersion, bookmakerCount: evaluation.bookmakerCount, consensusOdds: evaluation.consensusOdds, historicalSample: 0, calibrationStatus: "BOOTSTRAP", offeredOddsStatus: evaluation.bestMarketOdds === null ? "SIN_COTIZACION_DIRECTA" : "OFFERED_ODDS_AVAILABLE", matchingJson: JSON.stringify(oddsDiagnostics.find((value) => typeof value === "object" && value !== null && (value as { fixtureId?: string }).fixtureId === f.providerFixtureId) ?? {}), reasonsJson: "[]", warningsJson: JSON.stringify(evaluation.warnings) } });
          const selectedIndex = ranked.findIndex((value) => value.fixtureId === f.providerFixtureId && value.evaluation.market === evaluation.market); if (selectedIndex < 0) continue;
          const selected = ranked[selectedIndex], [m, h, v, c, q] = selected.scored.components;
          await tx.dailyRecommendation.create({ data: { id: `rec-${token(evalId).slice(0, 24)}`, candidateId, marketEvaluationId: evalId, rank: selectedIndex + 1, market: evaluation.market, recommendationStatus: selected.category === "PASS" ? "DISCARDED" : "PENDING_REVIEW", classification: selected.category, automaticCategory: selected.category, reviewStatus: "PENDING_REVIEW", scoreTotal: selected.scored.total, modelConfidenceScore: m, historicalCalibrationScore: h, marketValueScore: v, contextualAgreementScore: c, dataQualityScore: q, penaltiesTotal: m + h + v + c + q - selected.scored.total, explanationJson: JSON.stringify([selected.category, "Revisión automática explicable"]), risksJson: JSON.stringify(selected.scored.risks), modelSuggestedMarket: evaluation.market, bestPricedMarket: evaluation.bestMarketOdds === null ? null : evaluation.market } });
        }
      }
      for(const [i,e] of evidence.entries()) await tx.dailyRawEvidence.create({data:{id:`ev-${token(runId,e.contentHash,String(i)).slice(0,24)}`,runId,providerKey:e.providerKey,endpointKey:e.endpointKey,capturedAtUtc:new Date(e.capturedAtUtc),contentHash:e.contentHash,byteLength:e.byteLength,mediaType:e.mediaType,storageReference:e.storageReference}});
      for(const [i,a] of audits.entries()) await tx.dailyProviderRequestAudit.create({data:{id:`audit-${token(runId,String(i),a.endpointKey).slice(0,24)}`,runId,providerId:a.providerKey==="api-football"?"provider-api-football":"provider-the-odds-api",endpointKey:a.endpointKey,attemptNumber:i+1,startedAtUtc:new Date(a.startedAtUtc),finishedAtUtc:new Date(a.finishedAtUtc),httpStatus:a.httpStatus,classification:a.classification,sanitizedErrorCode:a.sanitizedErrorCode}});
    }); return summary(runId,fixtures.length,eligible.length,predictions.size,filtered.filter((x)=>!x.filter.eligible).length,ranked,apiBudget,apiRequests,oddsBudget,oddsRequests,true,false,oddsResponseReceived,{response:oddsResponseReceived,events:oddsEventsReceived,fixtures:oddsFixturesMatched,markets:oddsMarketsMatched,usable:quotesByFixture.size>0,evaluations:marketEvaluationCount});
  } finally { await prisma.$disconnect(); }
}

function summary(runId:string,discovered:number,eligible:number,deep:number,excluded:number,ranked:readonly SummaryItem[],apiBudget:number,apiRequests:number,oddsBudget:number,oddsRequests:number,networkUsed:boolean,replayed:boolean,oddsAvailable:boolean,metrics:Readonly<{response:boolean;events:number;fixtures:number;markets:number;usable:boolean;evaluations:number}>={response:false,events:0,fixtures:0,markets:0,usable:false,evaluations:0}):DailyRunResult { const count=(c:string)=>ranked.filter((r)=>(r.category??r.scored.category??r.scored.classification)===c).length; const top=ranked.find((r)=>["VALUE_DETECTED","MODEL_REVIEW"].includes(r.category??r.scored.category??"")); return Object.freeze({runId,runMode:"MODEL_ONLY_PROVISIONAL",fixturesDiscovered:discovered,fixturesEligible:eligible,fixturesDeepAnalyzed:deep,fixturesExcluded:excluded,recommendations:ranked.length,valueDetected:count("VALUE_DETECTED"),modelReview:count("MODEL_REVIEW"),strong:0,interesting:0,watch:count("WATCH"),pass:count("PASS"),historicalCalibrationAvailable:false,oddsAvailable,oddsResponseReceived:metrics.response,oddsEventsReceived:metrics.events,oddsFixturesMatched:metrics.fixtures,oddsMarketsMatched:metrics.markets,usableOddsAvailable:metrics.usable,marketEvaluationsCreated:metrics.evaluations,marketValueCalculated:ranked.some((r)=>r.evaluation.edge!=null),topRecommendation:top?`${top.fixture.homeName} — ${top.fixture.awayName} · ${top.evaluation.market}`:"NONE",apiFootballBudget:apiBudget,apiFootballRequests:apiRequests,oddsBudget,oddsRequests,networkUsed,replayed}); }
