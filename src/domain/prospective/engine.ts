import Decimal from "decimal.js";
import { canonicalHash } from "@/domain/canonical-hash";
import { fixtureMarketCandidateSchema, type FixtureMarketCandidateContract } from "@/contracts/market-priority";
import type { ProspectiveFixtureAssessment, QuoteRequest } from "@/contracts/prospective";
import {
  PRICE_FIELDS,
  REQUIRED_PRICE_WARNING,
  type DoubleChanceLine,
  type MarketFamily,
  type MatchingQualityClass,
  type Ou25Side,
} from "@/domain/market-priority/constants";
import {
  combinationSignalScore,
  dataQualityScore,
  doubleChanceSignalScore,
  historicalEvidenceScore,
  ou25SignalScore,
  priorityScore,
  scoreNumber,
  selectStrictWinner,
  type AggregateHistoricalMetric,
} from "@/domain/market-priority/scoring";
import { PROSPECTIVE_SPORTS_DATE } from "./constants";

export type ProspectiveAggregateMetric = Readonly<{
  patternCode: string;
  side: string;
  validationN: number;
  validationHitRate: number | null;
  validationWilsonLower: number | null;
  stabilityClass: string | null;
  maxCountryShare: number | null;
  maxCompetitionShare: number | null;
  warnings: string[];
}>;

export type ProspectiveFixtureInput = Readonly<{
  prospectiveRunId: string;
  matchDecisionId: string;
  frozenAt: string;
  fixtureIdentity: {
    forebetObservationId: string;
    statareaRowId: string;
    homeTeamRaw: string;
    awayTeamRaw: string;
    competitionRaw: string | null;
    countryRaw: string | null;
    scheduledKickoffRaw: string | null;
  };
  matchingQualityClass: MatchingQualityClass;
  snapshotIntegrityVerified: boolean;
  forebet: {
    suggestedSide: "OVER" | "UNDER";
    probabilityUnder25: number | null;
    probabilityOver25: number | null;
    predictedHomeGoals: number | null;
    predictedAwayGoals: number | null;
    averageGoals: number | null;
  };
  semantic: {
    sourceDoubleChance1XPercent: number | null;
    sourceDoubleChanceX2Percent: number | null;
    sourceDoubleChance12Percent: number | null;
    sourceOver25Percent: number | null;
    ou25SemanticReady: boolean;
    doubleChanceSemanticReady: boolean;
  };
  metricByKey: ReadonlyMap<string, ProspectiveAggregateMetric>;
}>;

export type ProspectiveFixtureOutput = Readonly<{
  candidates: FixtureMarketCandidateContract[];
  assessment: ProspectiveFixtureAssessment;
  quoteRequests: QuoteRequest[];
  familyWinners: { dc: string | null; ou25: string | null; combination: string | null };
}>;

const unique = (values: string[]) => [...new Set(values)];
const deterministicId = (prefix: string, identity: unknown) => `${prefix}_${canonicalHash(identity).slice(0, 24)}`;
const metricKey = (patternCode: string, side: string) => `${patternCode}|${side}`;
const emptySignalDetails = { percentComponent: null, lineMargin: null, marginComponent: null, minimumAgreementPercent: null, strengthComponent: null, sourceGap: null, balanceComponent: null, combinationDcScore: null, combinationOuScore: null };

function ouStrength(minimum: number) {
  if (minimum >= 70) return "EXTREME_70" as const;
  if (minimum >= 65) return "STRONG_65" as const;
  if (minimum >= 60) return "MODERATE_60" as const;
  return "SIMPLE" as const;
}

function forebetOu(forebet: ProspectiveFixtureInput["forebet"]) {
  return forebet.suggestedSide === "OVER"
    ? { side: "OVER_25" as const, percent: forebet.probabilityOver25 }
    : { side: "UNDER_25" as const, percent: forebet.probabilityUnder25 };
}

function statareaOu(overPercent: number | null) {
  if (overPercent === null || new Decimal(overPercent).eq(50)) return { side: null, percent: null };
  return new Decimal(overPercent).gt(50)
    ? { side: "OVER_25" as const, percent: overPercent }
    : { side: "UNDER_25" as const, percent: scoreNumber(new Decimal(100).minus(overPercent)) };
}

function confluence(forebet: ProspectiveFixtureInput["forebet"]) {
  if (forebet.predictedHomeGoals === null || forebet.predictedAwayGoals === null || forebet.averageGoals === null) return null;
  const total = forebet.predictedHomeGoals + forebet.predictedAwayGoals;
  if (forebet.suggestedSide === "OVER" && total >= 3 && forebet.averageGoals >= 2.75) return "FOREBET_OVER_CONFLUENCE" as const;
  if (forebet.suggestedSide === "UNDER" && total <= 2 && forebet.averageGoals <= 2.25) return "FOREBET_UNDER_CONFLUENCE" as const;
  return null;
}

function validationLift(metrics: ReadonlyMap<string, ProspectiveAggregateMetric>, side: Ou25Side) {
  const consensus = metrics.get(metricKey("OU25_CONSENSUS_SIMPLE", side))?.validationHitRate;
  const forebet = metrics.get(metricKey("FOREBET_OU25_CONTROL", side))?.validationHitRate;
  const statarea = metrics.get(metricKey("STATAREA_OU25_CONTROL", side))?.validationHitRate;
  if (consensus == null || forebet == null || statarea == null) return null;
  return scoreNumber(new Decimal(consensus).minus(Decimal.max(forebet, statarea)));
}

const preference = (candidate: FixtureMarketCandidateContract | null) => candidate ? ({ candidateId: candidate.id, family: candidate.family, marketCode: candidate.marketCode, score: candidate.finalPriorityScore, priorityClass: candidate.priorityClass }) : null;

export function buildProspectiveFixture(input: ProspectiveFixtureInput): ProspectiveFixtureOutput {
  const candidates: FixtureMarketCandidateContract[] = [];
  const makeCandidate = (configuration: {
    family: MarketFamily;
    marketCode: string;
    historicalPatternCode: string;
    historicalSide: string;
    signalScore: number;
    signalDetails: FixtureMarketCandidateContract["signalDetails"];
    sourceEvidence: FixtureMarketCandidateContract["sourceEvidence"];
    requiredFieldsComplete: boolean;
    semanticReady: boolean;
    strengthClass: FixtureMarketCandidateContract["strengthClass"];
    confluenceCode: FixtureMarketCandidateContract["confluenceCode"];
    lift: number | null;
  }) => {
    const metric = input.metricByKey.get(metricKey(configuration.historicalPatternCode, configuration.historicalSide)) ?? null;
    const aggregate: AggregateHistoricalMetric = metric ? { validationN: metric.validationN, validationHitRate: metric.validationHitRate, validationWilsonLower: metric.validationWilsonLower, stabilityClass: metric.stabilityClass, maxCountryShare: metric.maxCountryShare, maxCompetitionShare: metric.maxCompetitionShare } : { validationN: 0, validationHitRate: null, validationWilsonLower: null, stabilityClass: null, maxCountryShare: null, maxCompetitionShare: null };
    const historical = historicalEvidenceScore(aggregate);
    const quality = dataQualityScore({ matchingQualityClass: input.matchingQualityClass, requiredFieldsComplete: configuration.requiredFieldsComplete, semanticReady: configuration.semanticReady, snapshotIntegrityVerified: input.snapshotIntegrityVerified });
    const blockers = unique([
      ...(!configuration.requiredFieldsComplete ? ["MISSING_REQUIRED_SOURCE_FIELD"] : []),
      ...(!configuration.semanticReady ? ["SEMANTICALLY_NOT_READY"] : []),
      ...(!input.snapshotIntegrityVerified ? ["SNAPSHOT_INTEGRITY_FAILURE"] : []),
      ...(!metric ? ["HISTORICAL_METRIC_NOT_FOUND"] : []),
    ]);
    const priority = priorityScore({ signalScore: configuration.signalScore, historicalEvidenceScore: historical.score, dataQualityScore: quality.score, validationN: aggregate.validationN, stabilityClass: aggregate.stabilityClass, maxCountryShare: aggregate.maxCountryShare, maxCompetitionShare: aggregate.maxCompetitionShare, family: configuration.family, validationLift: configuration.lift });
    const candidate: FixtureMarketCandidateContract = {
      id: deterministicId("pc", { prospectiveRunId: input.prospectiveRunId, matchDecisionId: input.matchDecisionId, family: configuration.family, marketCode: configuration.marketCode }),
      matchDecisionId: input.matchDecisionId,
      sportsDate: PROSPECTIVE_SPORTS_DATE,
      fixture: { homeTeam: input.fixtureIdentity.homeTeamRaw, awayTeam: input.fixtureIdentity.awayTeamRaw },
      family: configuration.family,
      marketCode: configuration.marketCode,
      historicalPatternCode: configuration.historicalPatternCode,
      matchingQualityClass: input.matchingQualityClass,
      strengthClass: configuration.strengthClass,
      confluenceCode: configuration.confluenceCode,
      sourceEvidence: configuration.sourceEvidence,
      signalDetails: configuration.signalDetails,
      historicalEvidence: { patternCode: configuration.historicalPatternCode, side: configuration.historicalSide, validationN: aggregate.validationN, validationHitRate: metric?.validationHitRate ?? null, validationWilsonLower: metric?.validationWilsonLower ?? null, stabilityClass: (metric?.stabilityClass as "STABLE_OR_IMPROVED" | "MODERATE_DROP" | "SEVERE_DROP" | null | undefined) ?? null, validationHitRateComponent: historical.validationHitRateComponent, validationWilsonLowerComponent: historical.validationWilsonLowerComponent, sampleComponent: historical.sampleComponent, stabilityComponent: historical.stabilityComponent, uncappedScore: historical.uncappedScore, validationLift: configuration.lift, maxCountryShare: metric?.maxCountryShare ?? null, maxCompetitionShare: metric?.maxCompetitionShare ?? null },
      dataQuality: { matchingComponent: quality.matchingComponent, completenessComponent: quality.completenessComponent, semanticReadinessComponent: quality.semanticReadinessComponent, integrityComponent: quality.integrityComponent },
      signalScore: configuration.signalScore,
      historicalEvidenceScore: historical.score,
      dataQualityScore: quality.score,
      rawPriorityScore: priority.rawPriorityScore,
      finalPriorityScore: priority.finalPriorityScore,
      priorityClass: priority.priorityClass,
      blocked: blockers.length > 0,
      blockers: blockers as FixtureMarketCandidateContract["blockers"],
      caps: [...historical.caps, ...priority.caps],
      reasons: [`SIGNAL_FORMULA_${configuration.family}`, `FROZEN_AGGREGATE_METRIC_${configuration.historicalPatternCode}`, `MATCH_QUALITY_${input.matchingQualityClass}`, "INDIVIDUAL_OUTCOMES_NOT_READ"],
      warnings: unique([REQUIRED_PRICE_WARNING, "INDEPENDENT_VALIDATION_NOT_AVAILABLE", "PROSPECTIVE_VALIDATION_REQUIRED", "PRE_PRICE_PREFERENCE_MAY_CHANGE_WITH_ODDS", ...(metric?.warnings ?? []), ...(configuration.confluenceCode ? ["FOREBET_CONFLUENCE_VALIDATION_DROP"] : []), ...(priority.highConcentration ? ["HIGH_COUNTRY_OR_COMPETITION_CONCENTRATION"] : [])]),
      ...PRICE_FIELDS,
    };
    fixtureMarketCandidateSchema.parse(candidate);
    candidates.push(candidate);
    return candidate;
  };

  const dcValues: Record<DoubleChanceLine, number | null> = { "1X": input.semantic.sourceDoubleChance1XPercent, "X2": input.semantic.sourceDoubleChanceX2Percent, "12": input.semantic.sourceDoubleChance12Percent };
  const dcCandidates = (["1X", "X2", "12"] as const).map((line) => {
    const others = (["1X", "X2", "12"] as const).filter((candidateLine) => candidateLine !== line);
    const value = dcValues[line];
    const complete = value !== null && others.every((other) => dcValues[other] !== null);
    const signal = complete ? doubleChanceSignalScore(value, [dcValues[others[0]]!, dcValues[others[1]]!]) : null;
    return makeCandidate({ family: "DOUBLE_CHANCE", marketCode: line, historicalPatternCode: `DOUBLE_CHANCE_${line}`, historicalSide: line, signalScore: signal?.signalScore ?? 0, signalDetails: { ...emptySignalDetails, percentComponent: signal?.percentComponent ?? null, lineMargin: signal?.lineMargin ?? null, marginComponent: signal?.marginComponent ?? null }, sourceEvidence: { doubleChanceSourcePercent: value, secondHighestDcPercent: complete ? Math.max(dcValues[others[0]]!, dcValues[others[1]]!) : null, forebetSuggestedSide: null, forebetSidePercent: null, statareaSidePercent: null, statareaSourceOver25Percent: input.semantic.sourceOver25Percent }, requiredFieldsComplete: complete, semanticReady: input.semantic.doubleChanceSemanticReady, strengthClass: null, confluenceCode: null, lift: null });
  });
  const dcWinner = selectStrictWinner(dcCandidates).winner;

  const forebetSide = forebetOu(input.forebet);
  const statareaSide = statareaOu(input.semantic.sourceOver25Percent);
  let ouCandidate: FixtureMarketCandidateContract | null = null;
  if (forebetSide.side === statareaSide.side && forebetSide.percent !== null && statareaSide.percent !== null) {
    const signal = ou25SignalScore(forebetSide.percent, statareaSide.percent);
    ouCandidate = makeCandidate({ family: "OU25", marketCode: forebetSide.side, historicalPatternCode: "OU25_CONSENSUS_SIMPLE", historicalSide: forebetSide.side, signalScore: signal.signalScore, signalDetails: { ...emptySignalDetails, minimumAgreementPercent: signal.minimumAgreementPercent, strengthComponent: signal.strengthComponent, sourceGap: signal.sourceGap, balanceComponent: signal.balanceComponent }, sourceEvidence: { doubleChanceSourcePercent: null, secondHighestDcPercent: null, forebetSuggestedSide: input.forebet.suggestedSide, forebetSidePercent: forebetSide.percent, statareaSidePercent: statareaSide.percent, statareaSourceOver25Percent: input.semantic.sourceOver25Percent }, requiredFieldsComplete: true, semanticReady: input.semantic.ou25SemanticReady, strengthClass: ouStrength(signal.minimumAgreementPercent), confluenceCode: confluence(input.forebet), lift: validationLift(input.metricByKey, forebetSide.side) });
  }

  let combinationCandidate: FixtureMarketCandidateContract | null = null;
  if (dcWinner && ouCandidate && !ouCandidate.blocked) {
    const line = dcWinner.marketCode as DoubleChanceLine;
    const side = ouCandidate.marketCode as Ou25Side;
    combinationCandidate = makeCandidate({ family: "SAME_MATCH_COMBINATION", marketCode: `${line} + ${side}`, historicalPatternCode: `COMBO_${line}_${side}`, historicalSide: `${line}+${side}`, signalScore: combinationSignalScore(dcWinner.signalScore, ouCandidate.signalScore), signalDetails: { ...emptySignalDetails, combinationDcScore: dcWinner.signalScore, combinationOuScore: ouCandidate.signalScore }, sourceEvidence: { doubleChanceSourcePercent: dcWinner.sourceEvidence.doubleChanceSourcePercent, secondHighestDcPercent: dcWinner.sourceEvidence.secondHighestDcPercent, forebetSuggestedSide: ouCandidate.sourceEvidence.forebetSuggestedSide, forebetSidePercent: ouCandidate.sourceEvidence.forebetSidePercent, statareaSidePercent: ouCandidate.sourceEvidence.statareaSidePercent, statareaSourceOver25Percent: ouCandidate.sourceEvidence.statareaSourceOver25Percent }, requiredFieldsComplete: true, semanticReady: input.semantic.doubleChanceSemanticReady && input.semantic.ou25SemanticReady, strengthClass: ouCandidate.strengthClass, confluenceCode: ouCandidate.confluenceCode, lift: null });
  }

  const familyOptions = [dcWinner, ouCandidate?.blocked ? null : ouCandidate, combinationCandidate?.blocked ? null : combinationCandidate].filter((candidate): candidate is FixtureMarketCandidateContract => candidate !== null);
  const selection = selectStrictWinner(familyOptions);
  const sorted = [...familyOptions].sort((left, right) => {
    const pair = selectStrictWinner([left, right]);
    return pair.tied ? 0 : pair.winner?.id === left.id ? -1 : 1;
  });
  const top = sorted[0] ?? null;
  const second = sorted[1] ?? null;
  const margin = top ? scoreNumber(new Decimal(top.finalPriorityScore).minus(second?.finalPriorityScore ?? 0)) : null;
  const relevantWarning = top?.warnings.some((warning) => ["FOREBET_CONFLUENCE_VALIDATION_DROP", "HIGH_COUNTRY_OR_COMPETITION_CONCENTRATION"].includes(warning)) ?? false;
  let prePriceSelectionStatus: "PREFERRED" | "PROVISIONAL" | "NONE" = "NONE";
  if (!selection.tied && selection.winner && selection.winner.finalPriorityScore >= 65) {
    prePriceSelectionStatus = selection.winner.finalPriorityScore >= 75 && (margin ?? 0) >= 5 && !relevantWarning ? "PREFERRED" : "PROVISIONAL";
  }
  const prePricePreference = prePriceSelectionStatus === "NONE" ? null : selection.winner;
  const assessmentId = deterministicId("pfa", { prospectiveRunId: input.prospectiveRunId, matchDecisionId: input.matchDecisionId });
  const warnings = unique([REQUIRED_PRICE_WARNING, "PRE_PRICE_PREFERENCE_MAY_CHANGE_WITH_ODDS", ...(prePricePreference?.warnings ?? []), ...(selection.tied ? ["PRE_PRICE_FAMILY_TIE"] : [])]);
  const assessment: ProspectiveFixtureAssessment = {
    id: assessmentId,
    prospectiveRunId: input.prospectiveRunId,
    matchDecisionId: input.matchDecisionId,
    sportsDate: PROSPECTIVE_SPORTS_DATE,
    fixtureIdentity: input.fixtureIdentity,
    dcCandidateId: dcWinner?.blocked ? null : dcWinner?.id ?? null,
    ouCandidateId: ouCandidate?.blocked ? null : ouCandidate?.id ?? null,
    combinationCandidateId: combinationCandidate?.blocked ? null : combinationCandidate?.id ?? null,
    prePricePreference: preference(prePricePreference),
    prePriceSecondAlternative: preference(second),
    prePriceSelectionStatus,
    prePriceScoreMargin: margin,
    priceEvaluationStatus: "NOT_CAPTURED",
    decisionFrozenAt: input.frozenAt,
    warnings,
  };

  const quoteCandidates = [dcWinner?.blocked ? null : dcWinner, ouCandidate?.blocked ? null : ouCandidate, combinationCandidate?.blocked ? null : combinationCandidate].filter((candidate): candidate is FixtureMarketCandidateContract => candidate !== null);
  const quoteRequests: QuoteRequest[] = quoteCandidates.map((candidate) => ({
    id: deterministicId("qrp", { prospectiveRunId: input.prospectiveRunId, fixtureAssessmentId: assessmentId, family: candidate.family }),
    prospectiveRunId: input.prospectiveRunId,
    fixtureAssessmentId: assessmentId,
    matchDecisionId: input.matchDecisionId,
    sportsDate: PROSPECTIVE_SPORTS_DATE,
    fixtureIdentityRaw: input.fixtureIdentity,
    homeTeamRaw: input.fixtureIdentity.homeTeamRaw,
    awayTeamRaw: input.fixtureIdentity.awayTeamRaw,
    competitionRaw: input.fixtureIdentity.competitionRaw,
    countryRaw: input.fixtureIdentity.countryRaw,
    scheduledKickoffRaw: input.fixtureIdentity.scheduledKickoffRaw,
    family: candidate.family,
    internalMarketCode: candidate.marketCode,
    marketComponents: candidate.family === "SAME_MATCH_COMBINATION" ? candidate.marketCode.split(" + ") : [candidate.marketCode],
    prePricePriorityScore: candidate.finalPriorityScore,
    prePricePriorityClass: candidate.priorityClass,
    prePriceSelectionStatus,
    quoteRequired: true,
    bookmaker: "APOSTALA",
    bookmakerMarketCode: "UNRESOLVED",
    bookmakerMarketLabel: "UNRESOLVED",
    availableOdds: null,
    priceStatus: "NOT_CAPTURED",
    marketValueStatus: "UNKNOWN",
    warnings: unique(["QUOTE_PENDING", "BOOKMAKER_MARKET_MAPPING_UNRESOLVED", "PRE_PRICE_PREFERENCE_MAY_CHANGE_WITH_ODDS", ...candidate.warnings]),
  }));
  return { candidates, assessment, quoteRequests, familyWinners: { dc: assessment.dcCandidateId, ou25: assessment.ouCandidateId, combination: assessment.combinationCandidateId } };
}
