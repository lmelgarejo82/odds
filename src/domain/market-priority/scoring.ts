import Decimal from "decimal.js";
import type { MarketFamily, MatchingQualityClass, PriorityClass } from "./constants";

const ZERO = new Decimal(0);
const round = (value: Decimal.Value) => new Decimal(value).toDecimalPlaces(6, Decimal.ROUND_HALF_UP);
const clamp = (value: Decimal.Value, minimum: Decimal.Value, maximum: Decimal.Value) => Decimal.min(maximum, Decimal.max(minimum, value));
export const scoreNumber = (value: Decimal.Value) => round(value).toNumber();

export function doubleChanceSignalScore(sourcePercent: Decimal.Value, otherSourcePercents: [Decimal.Value, Decimal.Value]) {
  const p = new Decimal(sourcePercent);
  const secondHighest = Decimal.max(...otherSourcePercents.map((value) => new Decimal(value)));
  const percentComponent = new Decimal(30).mul(clamp(p.minus(50).div(40), 0, 1));
  const lineMargin = p.minus(secondHighest);
  const marginComponent = new Decimal(10).mul(clamp(lineMargin.div(20), 0, 1));
  return {
    percentComponent: scoreNumber(percentComponent),
    lineMargin: scoreNumber(lineMargin),
    marginComponent: scoreNumber(marginComponent),
    signalScore: scoreNumber(percentComponent.plus(marginComponent)),
  };
}

export function ou25SignalScore(forebetSidePercent: Decimal.Value, statareaSidePercent: Decimal.Value) {
  const forebet = new Decimal(forebetSidePercent);
  const statarea = new Decimal(statareaSidePercent);
  const minimumAgreementPercent = Decimal.min(forebet, statarea);
  const strengthComponent = new Decimal(32).mul(clamp(minimumAgreementPercent.minus(50).div(25), 0, 1));
  const sourceGap = forebet.minus(statarea).abs();
  const balanceComponent = new Decimal(8).mul(new Decimal(1).minus(clamp(sourceGap.div(20), 0, 1)));
  return {
    minimumAgreementPercent: scoreNumber(minimumAgreementPercent),
    strengthComponent: scoreNumber(strengthComponent),
    sourceGap: scoreNumber(sourceGap),
    balanceComponent: scoreNumber(balanceComponent),
    signalScore: scoreNumber(strengthComponent.plus(balanceComponent)),
  };
}

export function combinationSignalScore(doubleChanceScore: Decimal.Value, ou25Score: Decimal.Value) {
  return scoreNumber(Decimal.min(doubleChanceScore, ou25Score));
}

export type AggregateHistoricalMetric = Readonly<{
  validationN: number;
  validationHitRate: Decimal.Value | null;
  validationWilsonLower: Decimal.Value | null;
  stabilityClass: string | null;
  maxCountryShare: Decimal.Value | null;
  maxCompetitionShare: Decimal.Value | null;
}>;

export type AppliedCap = Readonly<{ code: string; maximum: number; before: number; after: number }>;

export function historicalEvidenceScore(metric: AggregateHistoricalMetric) {
  const hitRate = metric.validationHitRate === null ? ZERO : new Decimal(metric.validationHitRate);
  const wilson = metric.validationWilsonLower === null ? ZERO : new Decimal(metric.validationWilsonLower);
  const validationHitRateComponent = new Decimal(12).mul(hitRate);
  const validationWilsonLowerComponent = new Decimal(12).mul(wilson);
  const sampleComponent = metric.validationN < 10 ? 0 : metric.validationN < 30 ? 4 : 8;
  const stabilityComponent = metric.stabilityClass === "STABLE_OR_IMPROVED" ? 8 : metric.stabilityClass === "MODERATE_DROP" ? 4 : 0;
  const uncapped = round(validationHitRateComponent.plus(validationWilsonLowerComponent).plus(sampleComponent).plus(stabilityComponent));
  const capDefinitions: Array<[boolean, string, number]> = [
    [metric.validationN === 0, "HISTORICAL_VALIDATION_N_ZERO", 0],
    [metric.validationN > 0 && metric.validationN < 10, "HISTORICAL_VALIDATION_N_LT_10", 20],
    [metric.validationN >= 10 && metric.validationN < 30, "HISTORICAL_VALIDATION_N_10_29", 28],
    [metric.stabilityClass === "SEVERE_DROP", "HISTORICAL_SEVERE_DROP", 18],
    [metric.stabilityClass === "MODERATE_DROP", "HISTORICAL_MODERATE_DROP", 30],
  ];
  let capped = uncapped;
  const caps: AppliedCap[] = [];
  for (const [applies, code, maximum] of capDefinitions) {
    if (!applies) continue;
    const before = capped;
    capped = Decimal.min(capped, maximum);
    caps.push({ code, maximum, before: scoreNumber(before), after: scoreNumber(capped) });
  }
  return {
    validationHitRateComponent: scoreNumber(validationHitRateComponent),
    validationWilsonLowerComponent: scoreNumber(validationWilsonLowerComponent),
    sampleComponent,
    stabilityComponent,
    uncappedScore: scoreNumber(uncapped),
    score: scoreNumber(capped),
    caps,
  };
}

export function dataQualityScore(input: { matchingQualityClass: MatchingQualityClass; requiredFieldsComplete: boolean; semanticReady: boolean; snapshotIntegrityVerified: boolean }) {
  const matchingComponent = input.matchingQualityClass === "EXACT" ? 8 : input.matchingQualityClass === "CONSERVATIVE" ? 6 : 3;
  const completenessComponent = input.requiredFieldsComplete ? 6 : 0;
  const semanticReadinessComponent = input.semanticReady ? 4 : 0;
  const integrityComponent = input.snapshotIntegrityVerified ? 2 : 0;
  return {
    matchingComponent,
    completenessComponent,
    semanticReadinessComponent,
    integrityComponent,
    score: matchingComponent + completenessComponent + semanticReadinessComponent + integrityComponent,
  };
}

export function priorityClass(score: Decimal.Value): PriorityClass {
  const value = new Decimal(score);
  if (value.gte(85)) return "HIGH";
  if (value.gte(75)) return "INTERESTING";
  if (value.gte(65)) return "TRACK";
  return "DO_NOT_PRIORITIZE";
}

export function priorityScore(input: {
  signalScore: Decimal.Value;
  historicalEvidenceScore: Decimal.Value;
  dataQualityScore: Decimal.Value;
  validationN: number;
  stabilityClass: string | null;
  maxCountryShare: Decimal.Value | null;
  maxCompetitionShare: Decimal.Value | null;
  family: MarketFamily;
  validationLift: Decimal.Value | null;
}) {
  const raw = round(new Decimal(input.signalScore).plus(input.historicalEvidenceScore).plus(input.dataQualityScore));
  const highConcentration = (input.maxCountryShare !== null && new Decimal(input.maxCountryShare).gt("0.50")) || (input.maxCompetitionShare !== null && new Decimal(input.maxCompetitionShare).gt("0.40"));
  const capDefinitions: Array<[boolean, string, number]> = [
    [new Decimal(input.dataQualityScore).lt(14), "DATA_QUALITY_BELOW_14", 64],
    [input.validationN < 10, "VALIDATION_N_BELOW_10", 64],
    [input.stabilityClass === "SEVERE_DROP", "SEVERE_VALIDATION_DROP", 64],
    [input.stabilityClass === "MODERATE_DROP", "MODERATE_VALIDATION_DROP", 74],
    [highConcentration, "HIGH_COUNTRY_OR_COMPETITION_CONCENTRATION", 84],
    [input.family === "OU25" && input.validationLift !== null && new Decimal(input.validationLift).lte(0), "OU25_NON_POSITIVE_VALIDATION_LIFT", 84],
  ];
  let final = raw;
  const caps: AppliedCap[] = [];
  for (const [applies, code, maximum] of capDefinitions) {
    if (!applies) continue;
    const before = final;
    final = Decimal.min(final, maximum);
    caps.push({ code, maximum, before: scoreNumber(before), after: scoreNumber(final) });
  }
  const roundedFinal = scoreNumber(final);
  return { rawPriorityScore: scoreNumber(raw), finalPriorityScore: roundedFinal, priorityClass: priorityClass(roundedFinal), caps, highConcentration };
}

export type ComparableCandidate = Readonly<{
  id: string;
  finalPriorityScore: number;
  historicalEvidenceScore: number;
  dataQualityScore: number;
  signalScore: number;
  validationWilsonLower?: number | null;
  validationN?: number;
  historicalEvidence?: Readonly<{ validationWilsonLower: number | null; validationN: number }>;
  blocked: boolean;
}>;

const compareNumber = (left: number | null, right: number | null) => new Decimal(right ?? -1).comparedTo(left ?? -1);

export function compareCandidates(left: ComparableCandidate, right: ComparableCandidate) {
  return compareNumber(left.finalPriorityScore, right.finalPriorityScore)
    || compareNumber(left.historicalEvidenceScore, right.historicalEvidenceScore)
    || compareNumber(left.dataQualityScore, right.dataQualityScore)
    || compareNumber(left.signalScore, right.signalScore)
    || compareNumber(left.validationWilsonLower ?? left.historicalEvidence?.validationWilsonLower ?? null, right.validationWilsonLower ?? right.historicalEvidence?.validationWilsonLower ?? null)
    || compareNumber(left.validationN ?? left.historicalEvidence?.validationN ?? 0, right.validationN ?? right.historicalEvidence?.validationN ?? 0);
}

export function selectStrictWinner<T extends ComparableCandidate>(candidates: T[]) {
  const eligible = candidates.filter((candidate) => !candidate.blocked).sort(compareCandidates);
  if (!eligible.length) return { winner: null, runnerUp: null, tied: false };
  const winner = eligible[0];
  const runnerUp = eligible[1] ?? null;
  const tied = runnerUp !== null && compareCandidates(winner, runnerUp) === 0;
  return { winner: tied ? null : winner, runnerUp, tied };
}
