export type DominanceCandidate = Readonly<{
  id: string;
  family: string;
  marketCode: string;
  signalScore: number;
  historicalEvidenceScore: number;
  dataQualityScore: number;
  finalPriorityScore: number;
  caps: ReadonlyArray<{ maximum: number }>;
}>;

export type DominanceDecision = Readonly<{
  selectedCandidateId: string | null;
  topCandidateId: string | null;
}>;

const round = (value: number) => Math.round(value * 1_000_000) / 1_000_000;
const distribution = (values: string[], key: string) => [...new Set(values)].sort().map((value) => ({ [key]: value, count: values.filter((entry) => entry === value).length }));
const average = (items: DominanceCandidate[], field: "signalScore" | "historicalEvidenceScore" | "dataQualityScore") => round(items.reduce((sum, item) => sum + item[field], 0) / items.length);
const correlation = (items: DominanceCandidate[], left: "signalScore" | "historicalEvidenceScore" | "dataQualityScore", right: "signalScore" | "historicalEvidenceScore" | "dataQualityScore") => {
  const leftAverage = average(items, left);
  const rightAverage = average(items, right);
  const numerator = items.reduce((sum, item) => sum + (item[left] - leftAverage) * (item[right] - rightAverage), 0);
  const leftSquares = items.reduce((sum, item) => sum + (item[left] - leftAverage) ** 2, 0);
  const rightSquares = items.reduce((sum, item) => sum + (item[right] - rightAverage) ** 2, 0);
  return leftSquares === 0 || rightSquares === 0 ? null : round(numerator / Math.sqrt(leftSquares * rightSquares));
};

export function buildB008DominanceDiagnostic(candidates: DominanceCandidate[], decisions: DominanceDecision[]) {
  const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
  const selected = decisions.flatMap((decision) => decision.selectedCandidateId ? [byId.get(decision.selectedCandidateId)] : []).filter((candidate): candidate is DominanceCandidate => Boolean(candidate));
  const tops = decisions.flatMap((decision) => decision.topCandidateId ? [byId.get(decision.topCandidateId)] : []).filter((candidate): candidate is DominanceCandidate => Boolean(candidate));
  const dc = candidates.filter((candidate) => candidate.family === "DOUBLE_CHANCE");
  const ou = candidates.filter((candidate) => candidate.family === "OU25");
  const combinations = candidates.filter((candidate) => candidate.family === "SAME_MATCH_COMBINATION");
  const componentAverages = (items: DominanceCandidate[]) => ({ signalScore: average(items, "signalScore"), historicalEvidenceScore: average(items, "historicalEvidenceScore"), dataQualityScore: average(items, "dataQualityScore") });
  const cap64 = (items: DominanceCandidate[]) => items.filter((candidate) => candidate.caps.some((cap) => cap.maximum === 64)).length;
  const at64 = (items: DominanceCandidate[]) => items.filter((candidate) => candidate.finalPriorityScore === 64).length;
  return {
    source: "B008_FROZEN_OFFLINE_ONLY" as const,
    outcomeReads: 0 as const,
    policyModified: false as const,
    selection: { selected: selected.length, fixtures: decisions.length, rate: round(selected.length / decisions.length), percentage: round(100 * selected.length / decisions.length) },
    candidateMarketDistribution: distribution(candidates.map((candidate) => candidate.marketCode), "market"),
    candidateFamilyDistribution: distribution(candidates.map((candidate) => candidate.family), "family"),
    selectedMarketDistribution: distribution(selected.map((candidate) => candidate.marketCode), "market"),
    selectedFamilyDistribution: distribution(selected.map((candidate) => candidate.family), "family"),
    componentAverages: {
      all: componentAverages(candidates),
      selected: componentAverages(selected),
      byFamily: ["DOUBLE_CHANCE", "OU25", "SAME_MATCH_COMBINATION"].map((family) => ({ family, ...componentAverages(candidates.filter((candidate) => candidate.family === family)) })),
    },
    dcStrictlyAbove65: { count: dc.filter((candidate) => candidate.finalPriorityScore > 65).length, total: dc.length, percentage: round(100 * dc.filter((candidate) => candidate.finalPriorityScore > 65).length / dc.length) },
    ou25Cap64: { capApplied: cap64(ou), landedExactlyAt64: at64(ou), total: ou.length, capAppliedPercentage: round(100 * cap64(ou) / ou.length), landedExactlyAt64Percentage: round(100 * at64(ou) / ou.length) },
    combinationCap64: { capApplied: cap64(combinations), landedExactlyAt64: at64(combinations), total: combinations.length, capAppliedPercentage: round(100 * cap64(combinations) / combinations.length), landedExactlyAt64Percentage: round(100 * at64(combinations) / combinations.length) },
    componentCorrelations: {
      signalVsHistorical: correlation(candidates, "signalScore", "historicalEvidenceScore"),
      signalVsDataQuality: correlation(candidates, "signalScore", "dataQualityScore"),
      historicalVsDataQuality: correlation(candidates, "historicalEvidenceScore", "dataQualityScore"),
    },
    dataQualityCounts: { score18: candidates.filter((candidate) => candidate.dataQualityScore === 18).length, score20: candidates.filter((candidate) => candidate.dataQualityScore === 20).length },
    selectedHistoricalContributionGreaterThanSignal: selected.filter((candidate) => candidate.historicalEvidenceScore > candidate.signalScore).length,
    sensitivity: [65, 70, 75, 80, 85].map((threshold) => {
      const count = tops.filter((candidate) => candidate.finalPriorityScore >= threshold).length;
      return { threshold, selected: count, fixtures: decisions.length, percentage: round(100 * count / decisions.length) };
    }),
    warnings: ["PRE_PRICE_POLICY_SELECTS_95_9_PERCENT_OF_FIXTURES", "FINAL_SELECTION_DOMINATED_BY_DOUBLE_CHANCE"],
  };
}
