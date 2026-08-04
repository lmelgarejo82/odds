export const DAILY_TIME_ZONE = "America/Asuncion" as const;
export const DAILY_LOCALE = "es-PY" as const;
export const DAILY_SCORING_POLICY = Object.freeze({
  version: "daily-ranking/1.1.0",
  weights: Object.freeze({ modelConfidence: 25, historicalCalibration: 25, marketValue: 25, contextualAgreement: 15, dataQuality: 10 }),
  thresholds: Object.freeze({ minimumTopMargin: 0.05, minimumEdge: 0.025, minimumQuality: 0.7, highDispersion: 0.12, sufficientHistoricalSample: 100 }),
  penalties: Object.freeze({ tiedTop: 8, smallMargin: 5, missingHistory: 4, missingOdds: 4, highDispersion: 8, incompleteData: 8, contradictorySignals: 7, lowCoverageCompetition: 6, staleData: 5 }),
  provisionalCaps: Object.freeze({ missingBoth: 59.999, missingOne: 69.999 }),
  classes: Object.freeze({ strong: 80, interesting: 70, watch: 60 }),
});

export type DailyMarket = "HOME" | "DRAW" | "AWAY" | "1X" | "X2" | "12" | "OVER_15" | "UNDER_15" | "OVER_25" | "UNDER_25";
export type DailyClass = "STRONG" | "INTERESTING" | "WATCH" | "PASS";

export type DiscoveredFixture = Readonly<{
  providerFixtureId: string; providerCompetitionId: string; providerHomeTeamId: string; providerAwayTeamId: string;
  sportsDate: string; kickoffAtUtc: string; sourceTimezone: string; status: string; season: number; round: string;
  competitionName: string; country: string; homeName: string; awayName: string;
}>;

export type DailyPrediction = Readonly<{
  home: number; draw: number; away: number; over15?: number; under15?: number; over25?: number; under25?: number;
  winner?: string | null; advice?: string | null; contextualAgreement: number; contradictory: boolean; rawSignals: Readonly<Record<string, unknown>>;
}>;

export type MarketQuote = Readonly<{ market: DailyMarket; bookmaker: string; odds: number }>;

export type HistoricalCalibration = Readonly<{ market: DailyMarket; partition: "DISCOVERY" | "VALIDATION"; sampleSize: number; hitRate: number; brierScore: number; wilsonLower: number; wilsonUpper: number; datasetVersion: string; semanticMarket: DailyMarket }>;

export function assessHistoricalCalibration(records: readonly HistoricalCalibration[], market: DailyMarket): Readonly<{ available: boolean; status: string; sampleSize: number; record?: HistoricalCalibration }> {
  const compatible=records.filter((record)=>record.market===market&&record.semanticMarket===market);
  const discovery=compatible.find((record)=>record.partition==="DISCOVERY"); const validation=compatible.find((record)=>record.partition==="VALIDATION");
  if(!discovery||!validation) return {available:false,status:"MISSING_PARTITION",sampleSize:validation?.sampleSize??0};
  if(validation.sampleSize<DAILY_SCORING_POLICY.thresholds.sufficientHistoricalSample) return {available:false,status:"INSUFFICIENT_SAMPLE",sampleSize:validation.sampleSize};
  if(![validation.hitRate,validation.brierScore,validation.wilsonLower,validation.wilsonUpper].every(Number.isFinite)) return {available:false,status:"RESULTS_INCOMPLETE",sampleSize:validation.sampleSize};
  return {available:true,status:"VALIDATED",sampleSize:validation.sampleSize,record:validation};
}

export function sportsDateD1(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: DAILY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localMidnight = new Date(`${values.year}-${values.month}-${values.day}T00:00:00.000Z`);
  localMidnight.setUTCDate(localMidnight.getUTCDate() + 1);
  return localMidnight.toISOString().slice(0, 10);
}

export function sportsDateInAsuncion(value: Date | string): string | null {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function filterFixture(fixture: DiscoveredFixture, nowUtc: Date): Readonly<{ eligible: boolean; reasonCode: string; quality: number }> {
  if (fixture.status !== "NS") return { eligible: false, reasonCode: "STATUS_NOT_NS", quality: 0 };
  if (!Number.isFinite(Date.parse(fixture.kickoffAtUtc))) return { eligible: false, reasonCode: "KICKOFF_INVALID", quality: 0 };
  if (sportsDateInAsuncion(fixture.kickoffAtUtc) !== fixture.sportsDate) return { eligible: false, reasonCode: "LOCAL_SPORTS_DATE_MISMATCH", quality: 0 };
  if (Date.parse(fixture.kickoffAtUtc) <= nowUtc.valueOf()) return { eligible: false, reasonCode: "KICKOFF_NOT_FUTURE", quality: 0 };
  if (!/^\d+$/u.test(fixture.providerFixtureId) || !/^\d+$/u.test(fixture.providerCompetitionId) || !/^\d+$/u.test(fixture.providerHomeTeamId) || !/^\d+$/u.test(fixture.providerAwayTeamId)) return { eligible: false, reasonCode: "IDENTITY_INCOMPLETE", quality: 0 };
  if (fixture.providerHomeTeamId === fixture.providerAwayTeamId || normalizeName(fixture.homeName) === normalizeName(fixture.awayName)) return { eligible: false, reasonCode: "SAME_TEAM", quality: 0 };
  if (!fixture.competitionName.trim() || !Number.isSafeInteger(fixture.season)) return { eligible: false, reasonCode: "COMPETITION_INCOMPLETE", quality: 0 };
  if (!fixture.sourceTimezone.trim()) return { eligible: false, reasonCode: "TIMEZONE_INVALID", quality: 0 };
  if (/friendly|amistoso/i.test(`${fixture.competitionName} ${fixture.round}`)) return { eligible: false, reasonCode: "FRIENDLY_EXCLUDED", quality: 0.25 };
  const lowCoverage = /youth|u1[5-9]|women friendly|reserve/i.test(`${fixture.competitionName} ${fixture.round}`);
  return { eligible: !lowCoverage, reasonCode: lowCoverage ? "LOW_COVERAGE_CATEGORY" : "ELIGIBLE", quality: lowCoverage ? 0.4 : 1 };
}

export function normalizeName(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/gu, "").toLowerCase().replace(/\b(fc|cf|sc|afc|club)\b/gu, " ").replace(/[^a-z0-9]+/gu, " ").trim();
}

export function deterministicFixtureMatch(fixture: DiscoveredFixture, event: Readonly<{ homeName: string; awayName: string; kickoffAtUtc: string }>): boolean {
  return normalizeName(fixture.homeName) === normalizeName(event.homeName) && normalizeName(fixture.awayName) === normalizeName(event.awayName) && Math.abs(Date.parse(fixture.kickoffAtUtc) - Date.parse(event.kickoffAtUtc)) <= 15 * 60_000;
}

export function noVig(odds: readonly number[]): readonly number[] {
  if (odds.length < 2 || odds.some((value) => !Number.isFinite(value) || value <= 1)) throw new Error("ODDS_INVALID");
  const implied = odds.map((value) => 1 / value);
  const margin = implied.reduce((sum, value) => sum + value, 0);
  return implied.map((value) => value / margin);
}

export function evaluateMarkets(prediction: DailyPrediction, quotes: readonly MarketQuote[]): readonly Readonly<{
  market: DailyMarket; modelProbability: number | null; fairOdds: number | null; bestMarketOdds: number | null; consensusOdds: number | null; bookmakerCount: number; noVigProbability: number | null; marketMargin: number | null; edge: number | null; expectedValue: number | null; dispersion: number | null; status: string; warnings: readonly string[];
}>[] {
  const probabilities: Record<DailyMarket, number | undefined> = {
    HOME: prediction.home, DRAW: prediction.draw, AWAY: prediction.away,
    "1X": prediction.home + prediction.draw, X2: prediction.draw + prediction.away, "12": prediction.home + prediction.away,
    OVER_15: prediction.over15, UNDER_15: prediction.under15,
    OVER_25: prediction.over25, UNDER_25: prediction.under25,
  };
  const bestByMarket = new Map<DailyMarket, number>();
  for (const market of Object.keys(probabilities) as DailyMarket[]) { const available=quotes.filter((quote)=>quote.market===market&&quote.odds>1); if(available.length) bestByMarket.set(market,Math.max(...available.map((quote)=>quote.odds))); }
  const noVigByMarket = new Map<DailyMarket, number>(); const marginByMarket = new Map<DailyMarket, number>();
  for (const family of [["HOME","DRAW","AWAY"],["1X","X2","12"],["OVER_15","UNDER_15"],["OVER_25","UNDER_25"]] as const) { const odds=family.map((market)=>bestByMarket.get(market)); if(odds.every((value): value is number=>value!==undefined)){ const implied=odds.map((value)=>1/value); const margin=implied.reduce((a,b)=>a+b,0); family.forEach((market,index)=>{noVigByMarket.set(market,implied[index]/margin);marginByMarket.set(market,margin-1);}); } }
  return (Object.keys(probabilities) as DailyMarket[]).map((market) => {
    const probability = probabilities[market];
    const available = quotes.filter((quote) => quote.market === market && quote.odds > 1);
    const best = bestByMarket.get(market) ?? null;
    const implied = noVigByMarket.get(market) ?? null;
    const dispersion = available.length < 2 ? null : (Math.max(...available.map((quote) => quote.odds)) - Math.min(...available.map((quote) => quote.odds))) / Math.min(...available.map((quote) => quote.odds));
    if (probability === undefined || probability <= 0 || probability >= 1) return { market, modelProbability: null, fairOdds: null, bestMarketOdds: best, consensusOdds: available.length?available.reduce((sum,quote)=>sum+quote.odds,0)/available.length:null, bookmakerCount: new Set(available.map((quote)=>quote.bookmaker)).size, noVigProbability: implied, marketMargin: marginByMarket.get(market) ?? null, edge: null, expectedValue: null, dispersion, status: best === null ? "MODEL_UNAVAILABLE" : "PRICE_ONLY", warnings: ["NO_MODEL_PROBABILITY"] };
    return { market, modelProbability: probability, fairOdds: 1 / probability, bestMarketOdds: best, consensusOdds: available.length?available.reduce((sum,quote)=>sum+quote.odds,0)/available.length:null, bookmakerCount:new Set(available.map((quote)=>quote.bookmaker)).size, noVigProbability: implied, marketMargin: marginByMarket.get(market) ?? null, edge: implied === null ? null : probability - implied, expectedValue: best === null ? null : probability * best - 1, dispersion, status: best === null ? "MODEL_ONLY" : implied === null ? "PRICE_INCOMPLETE" : "PRICED", warnings: best === null ? ["Cuota no disponible"] : implied === null ? ["Mercado incompleto; no-vig no calculable"] : [] };
  });
}

export function scoreEvaluation(input: Readonly<{ market: DailyMarket; probability: number; topMargin: number; dataQuality: number; contextualAgreement: number; contradictory: boolean; historicalSample: number; edge: number | null; expectedValue: number | null; dispersion: number | null }>): Readonly<{ total: number; classification: DailyClass; components: readonly number[]; penalties: readonly string[]; status: string }> {
  const policy = DAILY_SCORING_POLICY;
  const model = Math.min(policy.weights.modelConfidence, Math.max(0, (input.probability - 0.33) / 0.47 * policy.weights.modelConfidence));
  const historical = input.historicalSample >= policy.thresholds.sufficientHistoricalSample ? policy.weights.historicalCalibration : 0;
  const market = input.edge !== null && input.expectedValue !== null && input.edge > 0 && input.expectedValue > 0 ? Math.min(policy.weights.marketValue, input.edge / 0.12 * policy.weights.marketValue) : 0;
  const contextual = Math.max(0, Math.min(1, input.contextualAgreement)) * policy.weights.contextualAgreement;
  const quality = Math.max(0, Math.min(1, input.dataQuality)) * policy.weights.dataQuality;
  const penalties: string[] = [];
  let deduction = 0;
  if (input.topMargin === 0) { penalties.push("TIED_TOP"); deduction += policy.penalties.tiedTop; }
  else if (input.topMargin < policy.thresholds.minimumTopMargin) { penalties.push("SMALL_MARGIN"); deduction += policy.penalties.smallMargin; }
  if (input.historicalSample < policy.thresholds.sufficientHistoricalSample) { penalties.push("MISSING_HISTORY"); deduction += policy.penalties.missingHistory; }
  if (input.edge === null || input.expectedValue === null) { penalties.push("MISSING_ODDS"); deduction += policy.penalties.missingOdds; }
  if (input.dispersion !== null && input.dispersion > policy.thresholds.highDispersion) { penalties.push("HIGH_DISPERSION"); deduction += policy.penalties.highDispersion; }
  if (input.contradictory) { penalties.push("CONTRADICTORY_SIGNALS"); deduction += policy.penalties.contradictorySignals; }
  const rawTotal = Math.max(0, Math.min(100, model + historical + market + contextual + quality - deduction));
  const historyMissing=input.historicalSample<policy.thresholds.sufficientHistoricalSample; const oddsMissing=input.edge===null||input.expectedValue===null;
  const cap=historyMissing&&oddsMissing?policy.provisionalCaps.missingBoth:historyMissing||oddsMissing?policy.provisionalCaps.missingOne:100;
  const total=Math.min(rawTotal,cap);
  const classification: DailyClass = total >= policy.classes.strong ? "STRONG" : total >= policy.classes.interesting ? "INTERESTING" : total >= policy.classes.watch ? "WATCH" : "PASS";
  const full = input.historicalSample >= policy.thresholds.sufficientHistoricalSample && input.edge !== null && input.edge >= policy.thresholds.minimumEdge && input.expectedValue !== null && input.expectedValue > 0 && input.dataQuality >= policy.thresholds.minimumQuality && !input.contradictory;
  return { total, classification, components: [model, historical, market, contextual, quality], penalties, status: full ? "FULL" : "MODEL_ONLY" };
}

export function rankDeterministically<T extends Readonly<{ score: number; kickoffAtUtc: string; fixtureId: string }>>(values: readonly T[]): readonly T[] {
  return [...values].sort((a, b) => b.score - a.score || a.kickoffAtUtc.localeCompare(b.kickoffAtUtc) || a.fixtureId.localeCompare(b.fixtureId));
}
