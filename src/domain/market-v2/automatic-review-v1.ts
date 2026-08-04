import type { DailyMarket } from "./daily-analysis";

export const AUTOMATIC_ODDS_MATCHING_POLICY = Object.freeze({
  version: "odds-matching/automatic-v1",
  kickoffToleranceMinutes: 20,
  minimumTeamSimilarity: 0.72,
  orientation: "DIRECT" as const,
});

export const AUTOMATIC_DAILY_RANKING_POLICY = Object.freeze({
  version: "daily-ranking/automatic-v1",
  weights: Object.freeze({
    modelConfidence: 25,
    historicalCalibration: 25,
    marketValue: 25,
    contextualAgreement: 15,
    dataQuality: 10,
  }),
  thresholds: Object.freeze({ value: 55, modelReview: 45, watch: 35 }),
  maximumPrimary: 5,
  maximumValue: 3,
});

export type AutomaticCategory = "VALUE_DETECTED" | "MODEL_REVIEW" | "WATCH" | "PASS";
export type AutomaticMatchMethod = "EXACT_NORMALIZED" | "UNIQUE_HIGH_CONFIDENCE" | "REJECTED";

export type AutomaticFixture = Readonly<{
  fixtureId: string;
  homeName: string;
  awayName: string;
  kickoffAtUtc: string;
  competitionName?: string;
  country?: string;
}>;

export type AutomaticOddsEvent = Readonly<{
  id: string;
  homeName: string;
  awayName: string;
  kickoffAtUtc: string;
  sportKey?: string;
  sportTitle?: string;
}>;

export type AutomaticMatchResult = Readonly<{
  method: AutomaticMatchMethod;
  confidence: number;
  matchedEventId: string | null;
  matcherVersion: string;
  namesCompared: Readonly<{
    canonicalHome: string;
    providerHome: string | null;
    canonicalAway: string;
    providerAway: string | null;
  }>;
  kickoffDeltaSeconds: number | null;
  competitionCountryEvidence: readonly string[];
  warnings: readonly string[];
}>;

const noise = new Set(["fc", "cf", "sc", "club", "ca", "cd"]);
const equivalences: Readonly<Record<string, string>> = Object.freeze({
  women: "w",
  femenino: "w",
  atletico: "atletico",
  deportes: "deportivo",
  deportiva: "deportivo",
  deportivas: "deportivo",
  sde: "santiago",
  pr: "paranaense",
});

export function normalizeAutomaticTeamName(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim()
    .split(/\s+/u)
    .filter((token) => token && !noise.has(token))
    .map((token) => equivalences[token] ?? token)
    .join(" ");
}

function tokenSimilarity(left: string, right: string): number {
  const a = new Set(normalizeAutomaticTeamName(left).split(" ").filter(Boolean));
  const b = new Set(normalizeAutomaticTeamName(right).split(" ").filter(Boolean));
  if (a.size === 0 || b.size === 0) return 0;
  if ([...a].join(" ") === [...b].join(" ")) return 1;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  const containment = intersection / Math.min(a.size, b.size);
  const jaccard = intersection / union;
  return Math.min(0.99, 0.65 * containment + 0.35 * jaccard);
}

function contextEvidence(fixture: AutomaticFixture, event: AutomaticOddsEvent): readonly string[] {
  const evidence: string[] = [];
  const sportKey = event.sportKey?.toLowerCase() ?? "";
  if (sportKey.startsWith("soccer_")) evidence.push("SPORT_KEY_SOCCER");
  const providerContext = normalizeAutomaticTeamName(`${event.sportKey ?? ""} ${event.sportTitle ?? ""}`);
  const country = normalizeAutomaticTeamName(fixture.country ?? "");
  if (country && providerContext.split(" ").includes(country)) evidence.push("COUNTRY_COHERENT");
  const competitionTokens = normalizeAutomaticTeamName(fixture.competitionName ?? "").split(" ").filter((x) => x.length > 3);
  if (competitionTokens.some((token) => providerContext.split(" ").includes(token))) evidence.push("COMPETITION_COHERENT");
  return Object.freeze(evidence);
}

export function matchAutomaticFixture(
  fixture: AutomaticFixture,
  events: readonly AutomaticOddsEvent[],
): AutomaticMatchResult {
  const base = {
    matcherVersion: AUTOMATIC_ODDS_MATCHING_POLICY.version,
    namesCompared: {
      canonicalHome: fixture.homeName,
      providerHome: null,
      canonicalAway: fixture.awayName,
      providerAway: null,
    },
  };
  const within = events.filter((event) => {
    const delta = Math.abs(Date.parse(event.kickoffAtUtc) - Date.parse(fixture.kickoffAtUtc));
    return Number.isFinite(delta) && delta <= AUTOMATIC_ODDS_MATCHING_POLICY.kickoffToleranceMinutes * 60_000;
  });
  const candidates = within.map((event) => {
    const home = tokenSimilarity(fixture.homeName, event.homeName);
    const away = tokenSimilarity(fixture.awayName, event.awayName);
    const reverseHome = tokenSimilarity(fixture.homeName, event.awayName);
    const reverseAway = tokenSimilarity(fixture.awayName, event.homeName);
    const evidence = contextEvidence(fixture, event);
    const exact = normalizeAutomaticTeamName(fixture.homeName) === normalizeAutomaticTeamName(event.homeName) && normalizeAutomaticTeamName(fixture.awayName) === normalizeAutomaticTeamName(event.awayName);
    const high = home >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity && away >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity && evidence.length > 0;
    const reversed = reverseHome >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity && reverseAway >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity;
    return { event, home, away, evidence, exact, high, reversed };
  });
  const viable = candidates.filter((candidate) => !candidate.reversed && (candidate.exact || candidate.high));
  if (viable.length === 1) {
    const selected = viable[0];
    const delta = Math.abs(Date.parse(selected.event.kickoffAtUtc) - Date.parse(fixture.kickoffAtUtc)) / 1000;
    return Object.freeze({
      ...base,
      method: selected.exact ? "EXACT_NORMALIZED" : "UNIQUE_HIGH_CONFIDENCE",
      confidence: selected.exact ? 1 : Math.min(selected.home, selected.away),
      matchedEventId: selected.event.id,
      namesCompared: {
        canonicalHome: fixture.homeName,
        providerHome: selected.event.homeName,
        canonicalAway: fixture.awayName,
        providerAway: selected.event.awayName,
      },
      kickoffDeltaSeconds: delta,
      competitionCountryEvidence: selected.evidence,
      warnings: [],
    });
  }
  const warning = within.length === 0 ? "KICKOFF_OUTSIDE_TOLERANCE" : candidates.some((x) => x.reversed) ? "ORIENTATION_REVERSED" : viable.length > 1 ? "AMBIGUOUS_EVENT" : candidates.some((x) => x.home >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity || x.away >= AUTOMATIC_ODDS_MATCHING_POLICY.minimumTeamSimilarity) ? "ONLY_ONE_TEAM_MATCHED" : "TEAM_SIMILARITY_INSUFFICIENT";
  return Object.freeze({ ...base, method: "REJECTED", confidence: 0, matchedEventId: null, kickoffDeltaSeconds: null, competitionCountryEvidence: [], warnings: [warning] });
}

export type AutomaticScoreInput = Readonly<{
  market: DailyMarket;
  modelProbability: number;
  topMargin: number;
  dataQuality: number;
  contextualAgreement: number;
  contradictory: boolean;
  edge: number | null;
  expectedValue: number | null;
  dispersion: number | null;
  historicalPoints?: number;
}>;

export function scoreAutomaticReview(input: AutomaticScoreInput): Readonly<{
  total: number;
  category: AutomaticCategory;
  components: readonly [number, number, number, number, number];
  risks: readonly string[];
}> {
  const model = Math.min(25, Math.max(0, (input.modelProbability - 0.30) / 0.50 * 25));
  const history = Math.min(25, Math.max(0, input.historicalPoints ?? 0));
  const market = input.edge !== null && input.expectedValue !== null && input.edge > 0 && input.expectedValue > 0 ? Math.min(25, input.edge / 0.12 * 25) : 0;
  const context = Math.max(0, Math.min(1, input.contextualAgreement)) * 15;
  const quality = Math.max(0, Math.min(1, input.dataQuality)) * 10;
  const risks: string[] = [];
  let penalty = 0;
  if (input.topMargin === 0) { risks.push("TIED_TOP"); penalty += 12; }
  else if (input.topMargin < 0.05) { risks.push("SMALL_MODEL_MARGIN"); penalty += 6; }
  if (input.contradictory) { risks.push("CONTRADICTORY_SIGNALS"); penalty += 12; }
  if (input.dispersion !== null && input.dispersion > 0.12) { risks.push("HIGH_PRICE_DISPERSION"); penalty += 8; }
  if (input.edge === null || input.expectedValue === null) risks.push("SIN_COTIZACION_DIRECTA");
  if ((input.historicalPoints ?? 0) === 0) risks.push("CALIBRATION_BOOTSTRAP");
  const total = Math.max(0, Math.min(100, model + history + market + context + quality - penalty));
  const riskBlocked = input.topMargin === 0 || input.contradictory || input.dataQuality < 0.5;
  const pricedValue = input.edge !== null && input.edge >= 0.025 && input.expectedValue !== null && input.expectedValue > 0 && input.dataQuality >= 0.7 && input.topMargin >= 0.05 && !input.contradictory;
  const modelReview = input.edge === null && input.expectedValue === null && input.modelProbability >= 0.48 && input.contextualAgreement >= 0.65 && input.dataQuality >= 0.7 && input.topMargin >= 0.05 && !input.contradictory;
  const category: AutomaticCategory = !riskBlocked && total >= 55 && pricedValue ? "VALUE_DETECTED" : !riskBlocked && total >= 45 && modelReview ? "MODEL_REVIEW" : !riskBlocked && total >= 35 ? "WATCH" : "PASS";
  return Object.freeze({ total, category, components: [model, history, market, context, quality] as const, risks: Object.freeze(risks) });
}

export function selectAutomaticReview<T extends Readonly<{ category: AutomaticCategory; score: number; edge: number | null; kickoffAtUtc: string; fixtureId: string }>>(values: readonly T[]): Readonly<{ primary: readonly T[]; watch: readonly T[]; discarded: readonly T[] }> {
  const ordered = [...values].sort((a, b) => {
    const priority: Record<AutomaticCategory, number> = { VALUE_DETECTED: 0, MODEL_REVIEW: 1, WATCH: 2, PASS: 3 };
    return priority[a.category] - priority[b.category] || b.score - a.score || (b.edge ?? -Infinity) - (a.edge ?? -Infinity) || a.kickoffAtUtc.localeCompare(b.kickoffAtUtc) || a.fixtureId.localeCompare(b.fixtureId);
  });
  const value = ordered.filter((x) => x.category === "VALUE_DETECTED").slice(0, AUTOMATIC_DAILY_RANKING_POLICY.maximumValue);
  const model = ordered.filter((x) => x.category === "MODEL_REVIEW");
  const primary = [...value, ...model].slice(0, AUTOMATIC_DAILY_RANKING_POLICY.maximumPrimary);
  return Object.freeze({ primary: Object.freeze(primary), watch: Object.freeze(ordered.filter((x) => x.category === "WATCH")), discarded: Object.freeze(ordered.filter((x) => x.category === "PASS")) });
}

export type CalibrationObservation = Readonly<{ market: DailyMarket; probability: number; hit: boolean; predictionCapturedAtUtc: string; kickoffAtUtc: string; outcomeObservedAtUtc: string }>;
export function calculateProspectiveCalibration(observations: readonly CalibrationObservation[]): Readonly<{ status: "BOOTSTRAP" | "EARLY_CALIBRATION" | "VALIDATED"; sample: number; hits: number; misses: number; hitRate: number | null; brier: number | null; wilsonLower95: number | null; wilsonUpper95: number | null; historicalPoints: number }> {
  const safe = observations.filter((x) => Number.isFinite(x.probability) && x.probability >= 0 && x.probability <= 1 && Date.parse(x.predictionCapturedAtUtc) < Date.parse(x.kickoffAtUtc) && Date.parse(x.outcomeObservedAtUtc) > Date.parse(x.kickoffAtUtc));
  const sample = safe.length, hits = safe.filter((x) => x.hit).length, misses = sample - hits;
  if (sample === 0) return Object.freeze({ status: "BOOTSTRAP", sample, hits, misses, hitRate: null, brier: null, wilsonLower95: null, wilsonUpper95: null, historicalPoints: 0 });
  const hitRate = hits / sample;
  const brier = safe.reduce((sum, x) => sum + (x.probability - (x.hit ? 1 : 0)) ** 2, 0) / sample;
  const z = 1.959963984540054;
  const denominator = 1 + z * z / sample;
  const center = (hitRate + z * z / (2 * sample)) / denominator;
  const half = z * Math.sqrt((hitRate * (1 - hitRate) + z * z / (4 * sample)) / sample) / denominator;
  const status = sample < 30 ? "BOOTSTRAP" : sample < 100 ? "EARLY_CALIBRATION" : "VALIDATED";
  const historicalPoints = status === "BOOTSTRAP" ? 0 : status === "EARLY_CALIBRATION" ? Math.min(10, sample / 10) : 25;
  return Object.freeze({ status, sample, hits, misses, hitRate, brier, wilsonLower95: Math.max(0, center - half), wilsonUpper95: Math.min(1, center + half), historicalPoints });
}
