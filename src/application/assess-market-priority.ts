import Decimal from "decimal.js";
import type { PrismaClient } from "@prisma/client";
import candidateJsonSchema from "@/contracts/schemas/fixture-market-candidates.schema.json";
import decisionJsonSchema from "@/contracts/schemas/fixture-preferred-line-decisions.schema.json";
import policyJsonSchema from "@/contracts/schemas/market-priority-policy.schema.json";
import {
  fixtureMarketCandidatesDocumentSchema,
  fixturePreferredLineDecisionsDocumentSchema,
  marketPriorityPolicyDocumentSchema,
  type FixtureMarketCandidateContract,
  type FixturePreferredLineDecisionContract,
} from "@/contracts/market-priority";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import {
  HISTORICAL_DATASET_CODE,
  HISTORICAL_DATASET_VERSION,
  HISTORICAL_MANIFEST_HASH,
  HISTORICAL_REGISTRY_HASH,
} from "@/domain/historical-analysis/constants";
import {
  HISTORICAL_ANALYSIS_SPEC_HASH,
  MARKET_PRIORITY_ASSESSMENT_MODE,
  MARKET_PRIORITY_CANDIDATES_CONTRACT_VERSION,
  MARKET_PRIORITY_DECISIONS_CONTRACT_VERSION,
  MARKET_PRIORITY_DEVELOPMENT_WINDOW,
  MARKET_PRIORITY_ENGINE_VERSION,
  MARKET_PRIORITY_EXPORT_DIRECTORY,
  MARKET_PRIORITY_INDEPENDENT_VALIDATION_STATUS,
  MARKET_PRIORITY_POLICY_CODE,
  MARKET_PRIORITY_POLICY_CONTRACT_VERSION,
  MARKET_PRIORITY_POLICY_STATUS,
  MARKET_PRIORITY_POLICY_VERSION,
  PRICE_FIELDS,
  REQUIRED_PRICE_WARNING,
  type DoubleChanceLine,
  type MarketFamily,
  type MatchingQualityClass,
  type Ou25Side,
} from "@/domain/market-priority/constants";
import { marketPriorityPolicy, marketPriorityPolicyHash } from "@/domain/market-priority/policy";
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
import { preserveMarketPriorityExports } from "@/infrastructure/market-priority/export-store";
import { createOutcomeAccessGuard } from "@/infrastructure/market-priority/outcome-access-guard";

type MetricRow = Readonly<{
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

type FamilyDecision = Readonly<{
  id: string;
  matchDecisionId: string;
  family: MarketFamily;
  chosenCandidateId: string | null;
  reasonCode: string;
  alternatives: Array<{ candidateId: string; marketCode: string; finalPriorityScore: number; blocked: boolean }>;
  tieBreak: string[];
  blockers: string[];
  warnings: string[];
  priceStatus: "NOT_EVALUATED";
  availableOdds: null;
  marketValueStatus: "UNKNOWN";
  breakEvenComparisonStatus: "NOT_AVAILABLE";
}>;

const unique = (values: string[]) => [...new Set(values)];
const asNumber = (value: { toNumber(): number } | null | undefined) => value == null ? null : value.toNumber();
const asDate = (value: Date) => value.toISOString().slice(0, 10);
const deterministicId = (prefix: string, identity: unknown) => `${prefix}_${canonicalHash(identity).slice(0, 24)}`;
const matchingQuality = (stage: string | undefined): MatchingQualityClass => stage === "EXACT" ? "EXACT" : stage === "CONSERVATIVE" ? "CONSERVATIVE" : "APPROXIMATE";
const jsonArray = (value: string) => JSON.parse(value) as string[];

function assertAjv(schema: object, value: unknown, label: string) {
  const result = validateContract(schema, value);
  if (!result.valid) throw new Error(`${label}_AJV_INVALID:${JSON.stringify(result.errors)}`);
}

function ouStrength(minimum: number) {
  if (minimum >= 70) return "EXTREME_70" as const;
  if (minimum >= 65) return "STRONG_65" as const;
  if (minimum >= 60) return "MODERATE_60" as const;
  return "SIMPLE" as const;
}

function selectedForebetSide(observation: { suggestedSide: "OVER" | "UNDER"; probabilityOver25: { toNumber(): number } | null; probabilityUnder25: { toNumber(): number } | null }) {
  const side: Ou25Side = observation.suggestedSide === "OVER" ? "OVER_25" : "UNDER_25";
  const percent = observation.suggestedSide === "OVER" ? asNumber(observation.probabilityOver25) : asNumber(observation.probabilityUnder25);
  return { side, percent };
}

function selectedStatareaSide(overPercent: number | null) {
  if (overPercent === null || new Decimal(overPercent).eq(50)) return { side: null, percent: null };
  return new Decimal(overPercent).gt(50)
    ? { side: "OVER_25" as const, percent: overPercent }
    : { side: "UNDER_25" as const, percent: scoreNumber(new Decimal(100).minus(overPercent)) };
}

function forebetConfluence(observation: { suggestedSide: "OVER" | "UNDER"; predictedHomeGoals: number | null; predictedAwayGoals: number | null; averageGoals: { toNumber(): number } | null }) {
  if (observation.predictedHomeGoals === null || observation.predictedAwayGoals === null || observation.averageGoals === null) return null;
  const predictedTotal = observation.predictedHomeGoals + observation.predictedAwayGoals;
  const average = observation.averageGoals.toNumber();
  if (observation.suggestedSide === "OVER" && predictedTotal >= 3 && average >= 2.75) return "FOREBET_OVER_CONFLUENCE" as const;
  if (observation.suggestedSide === "UNDER" && predictedTotal <= 2 && average <= 2.25) return "FOREBET_UNDER_CONFLUENCE" as const;
  return null;
}

export async function assessMarketPriority(prisma: PrismaClient, request: { dataset: string; policyVersion: string }) {
  if (request.dataset !== HISTORICAL_DATASET_CODE || request.policyVersion !== MARKET_PRIORITY_POLICY_VERSION) throw new Error("MARKET_PRIORITY_REQUEST_NOT_ALLOWED");
  const guard = createOutcomeAccessGuard(prisma);
  const client = guard.client;

  const dataset = await client.historicalDataset.findUniqueOrThrow({ where: { code_version: { code: HISTORICAL_DATASET_CODE, version: HISTORICAL_DATASET_VERSION } } });
  const frozenState = await client.historicalDatasetState.findFirstOrThrow({ where: { datasetId: dataset.id, status: "FROZEN" }, orderBy: { createdAt: "desc" } });
  const registry = await client.semanticRegistry.findFirstOrThrow({ where: { registryHash: HISTORICAL_REGISTRY_HASH } });
  const historicalSpec = await client.historicalAnalysisSpec.findFirstOrThrow({ where: { code: "OU25-HISTORICAL-MARKET-ANALYSIS", version: "1.0.0", datasetId: dataset.id, status: "FROZEN_SPEC" } });
  if (frozenState.manifestHash !== HISTORICAL_MANIFEST_HASH || registry.registryHash !== HISTORICAL_REGISTRY_HASH || historicalSpec.specHash !== HISTORICAL_ANALYSIS_SPEC_HASH || historicalSpec.manifestHash !== HISTORICAL_MANIFEST_HASH || historicalSpec.registryHash !== HISTORICAL_REGISTRY_HASH || canonicalHash(JSON.parse(historicalSpec.canonicalSpecJson)) !== historicalSpec.specHash) throw new Error("MARKET_PRIORITY_POLICY_REFERENCE_MISMATCH");
  const historicalEvaluation = await client.historicalEvaluationRun.findFirstOrThrow({ where: { specId: historicalSpec.id, datasetId: dataset.id, manifestHash: HISTORICAL_MANIFEST_HASH, registryHash: HISTORICAL_REGISTRY_HASH, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
  const semanticAssessment = await client.semanticAssessmentRun.findFirstOrThrow({ where: { registryId: registry.id, datasetId: dataset.id, manifestHash: HISTORICAL_MANIFEST_HASH, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });

  const days = await client.historicalDatasetDay.findMany({ where: { datasetId: dataset.id }, orderBy: { sportsDate: "asc" } });
  if (days.length !== 21) throw new Error(`MARKET_PRIORITY_DATASET_DAY_COUNT_MISMATCH:${days.length}`);
  const runIds = days.map((day) => day.matchRunId);
  const matchRuns = await client.matchRun.findMany({ where: { id: { in: runIds }, runType: "HISTORICAL_DATASET", datasetId: dataset.id } });
  const decisions = await client.matchDecision.findMany({ where: { runId: { in: runIds }, status: "MATCHED" } });
  if (matchRuns.length !== 21 || decisions.length !== 98) throw new Error(`MARKET_PRIORITY_FIXTURE_REFERENCE_MISMATCH:${matchRuns.length}:${decisions.length}`);

  const selectedCandidateIds = decisions.flatMap((decision) => decision.selectedCandidateId ? [decision.selectedCandidateId] : []);
  const selectedMatchCandidates = await client.matchCandidate.findMany({ where: { id: { in: selectedCandidateIds } } });
  const observations = await client.forebetObservation.findMany({ where: { id: { in: decisions.flatMap((decision) => decision.forebetObservationId ? [decision.forebetObservationId] : []) } } });
  const statareaRows = await client.statareaRawRow.findMany({ where: { id: { in: decisions.flatMap((decision) => decision.statareaRowId ? [decision.statareaRowId] : []) } } });
  const projections = await client.statareaSemanticProjection.findMany({ where: { assessmentRunId: semanticAssessment.id, rawRowId: { in: statareaRows.map((row) => row.id) } } });
  const forebetSnapshots = await client.forebetCaptureSnapshot.findMany({ where: { id: { in: days.map((day) => day.forebetSnapshotId) } }, select: { id: true, contentHash: true } });
  const statareaSnapshots = await client.statareaCaptureSnapshot.findMany({ where: { id: { in: days.map((day) => day.statareaSnapshotId) } }, select: { id: true, contentHash: true } });

  const definitions = await client.patternDefinition.findMany({ where: { specId: historicalSpec.id } });
  if (definitions.length !== 19) throw new Error(`MARKET_PRIORITY_PATTERN_COUNT_MISMATCH:${definitions.length}`);
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition.code]));
  const aggregateRows = await client.patternEvaluation.findMany({
    where: { evaluationRunId: historicalEvaluation.id, partition: "VALIDATION", segment: "ALL" },
    select: { patternDefinitionId: true, side: true, evaluable: true, hitRate: true, wilsonLower: true, stabilityClass: true, maxCountryShare: true, maxCompetitionShare: true, warningsJson: true },
  });
  const metrics: MetricRow[] = aggregateRows.map((row) => ({
    patternCode: definitionById.get(row.patternDefinitionId) ?? "UNKNOWN",
    side: row.side,
    validationN: row.evaluable,
    validationHitRate: asNumber(row.hitRate),
    validationWilsonLower: asNumber(row.wilsonLower),
    stabilityClass: row.stabilityClass,
    maxCountryShare: asNumber(row.maxCountryShare),
    maxCompetitionShare: asNumber(row.maxCompetitionShare),
    warnings: jsonArray(row.warningsJson),
  }));
  const metricByKey = new Map(metrics.map((metric) => [`${metric.patternCode}|${metric.side}`, metric]));
  const metricFor = (patternCode: string, side: string) => metricByKey.get(`${patternCode}|${side}`) ?? null;
  const validationLift = (side: Ou25Side) => {
    const consensus = metricFor("OU25_CONSENSUS_SIMPLE", side)?.validationHitRate;
    const forebet = metricFor("FOREBET_OU25_CONTROL", side)?.validationHitRate;
    const statarea = metricFor("STATAREA_OU25_CONTROL", side)?.validationHitRate;
    if (consensus == null || forebet == null || statarea == null) return null;
    return scoreNumber(new Decimal(consensus).minus(Decimal.max(forebet, statarea)));
  };

  const dayByRun = new Map(days.map((day) => [day.matchRunId, day]));
  const runById = new Map(matchRuns.map((run) => [run.id, run]));
  const selectedById = new Map(selectedMatchCandidates.map((candidate) => [candidate.id, candidate]));
  const observationById = new Map(observations.map((observation) => [observation.id, observation]));
  const rowById = new Map(statareaRows.map((row) => [row.id, row]));
  const projectionByRow = new Map(projections.map((projection) => [projection.rawRowId, projection]));
  const forebetHashById = new Map(forebetSnapshots.map((snapshot) => [snapshot.id, snapshot.contentHash]));
  const statareaHashById = new Map(statareaSnapshots.map((snapshot) => [snapshot.id, snapshot.contentHash]));

  const assessmentId = deterministicId("mpa", { priorityPolicyHash: marketPriorityPolicyHash, historicalEvaluationRunId: historicalEvaluation.id, datasetId: dataset.id });
  const candidates: FixtureMarketCandidateContract[] = [];
  const familyDecisions: FamilyDecision[] = [];
  const finalDecisions: FixturePreferredLineDecisionContract[] = [];
  const finalTieBreak = ["finalPriorityScore", "historicalEvidenceScore", "dataQualityScore", "signalScore", "validationWilsonLower", "validationN"];

  const orderedDecisions = [...decisions].sort((left, right) => {
    const leftDate = dayByRun.get(left.runId)?.sportsDate.toISOString() ?? "";
    const rightDate = dayByRun.get(right.runId)?.sportsDate.toISOString() ?? "";
    return leftDate.localeCompare(rightDate) || left.id.localeCompare(right.id);
  });

  for (const decision of orderedDecisions) {
    const day = dayByRun.get(decision.runId);
    const run = runById.get(decision.runId);
    const selectedMatchCandidate = decision.selectedCandidateId ? selectedById.get(decision.selectedCandidateId) : undefined;
    const observation = decision.forebetObservationId ? observationById.get(decision.forebetObservationId) : undefined;
    const rawRow = decision.statareaRowId ? rowById.get(decision.statareaRowId) : undefined;
    const projection = rawRow ? projectionByRow.get(rawRow.id) : undefined;
    if (!day || !run || !observation || !rawRow) throw new Error(`MARKET_PRIORITY_MATCH_REFERENCE_MISSING:${decision.id}`);
    const matchQuality = matchingQuality(selectedMatchCandidate?.stage);
    const snapshotIntegrity = day.forebetSnapshotId === observation.snapshotId
      && day.statareaSnapshotId === rawRow.snapshotId
      && day.forebetSha256 === run.forebetSha256
      && day.statareaSha256 === run.statareaSha256
      && day.forebetSha256 === forebetHashById.get(day.forebetSnapshotId)
      && day.statareaSha256 === statareaHashById.get(day.statareaSnapshotId);
    const baseFixture = { homeTeam: observation.homeTeamRaw, awayTeam: observation.awayTeamRaw };
    const sportsDate = asDate(day.sportsDate);

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
      const metric = metricFor(configuration.historicalPatternCode, configuration.historicalSide);
      const aggregateMetric: AggregateHistoricalMetric = metric ? {
        validationN: metric.validationN,
        validationHitRate: metric.validationHitRate,
        validationWilsonLower: metric.validationWilsonLower,
        stabilityClass: metric.stabilityClass,
        maxCountryShare: metric.maxCountryShare,
        maxCompetitionShare: metric.maxCompetitionShare,
      } : { validationN: 0, validationHitRate: null, validationWilsonLower: null, stabilityClass: null, maxCountryShare: null, maxCompetitionShare: null };
      const historical = historicalEvidenceScore(aggregateMetric);
      const quality = dataQualityScore({ matchingQualityClass: matchQuality, requiredFieldsComplete: configuration.requiredFieldsComplete, semanticReady: configuration.semanticReady, snapshotIntegrityVerified: snapshotIntegrity });
      const blockers = unique([
        ...(!configuration.requiredFieldsComplete ? ["MISSING_REQUIRED_SOURCE_FIELD"] : []),
        ...(!configuration.semanticReady ? ["SEMANTICALLY_NOT_READY"] : []),
        ...(!selectedMatchCandidate ? ["MATCH_NOT_ELIGIBLE"] : []),
        ...(!snapshotIntegrity ? ["SNAPSHOT_INTEGRITY_FAILURE"] : []),
        ...(!metric ? ["HISTORICAL_METRIC_NOT_FOUND"] : []),
      ]);
      const priority = priorityScore({
        signalScore: configuration.signalScore,
        historicalEvidenceScore: historical.score,
        dataQualityScore: quality.score,
        validationN: aggregateMetric.validationN,
        stabilityClass: aggregateMetric.stabilityClass,
        maxCountryShare: aggregateMetric.maxCountryShare,
        maxCompetitionShare: aggregateMetric.maxCompetitionShare,
        family: configuration.family,
        validationLift: configuration.lift,
      });
      const warnings = unique([
        REQUIRED_PRICE_WARNING,
        "INDEPENDENT_VALIDATION_NOT_AVAILABLE",
        "PROSPECTIVE_VALIDATION_REQUIRED",
        ...(metric?.warnings ?? []),
        ...(configuration.confluenceCode ? ["FOREBET_CONFLUENCE_VALIDATION_DROP"] : []),
        ...(priority.highConcentration ? ["HIGH_COUNTRY_OR_COMPETITION_CONCENTRATION"] : []),
      ]);
      const candidate: FixtureMarketCandidateContract = {
        id: deterministicId("mpc", { assessmentId, matchDecisionId: decision.id, family: configuration.family, marketCode: configuration.marketCode }),
        matchDecisionId: decision.id,
        sportsDate,
        fixture: baseFixture,
        family: configuration.family,
        marketCode: configuration.marketCode,
        historicalPatternCode: configuration.historicalPatternCode,
        matchingQualityClass: matchQuality,
        strengthClass: configuration.strengthClass,
        confluenceCode: configuration.confluenceCode,
        sourceEvidence: configuration.sourceEvidence,
        signalDetails: configuration.signalDetails,
        historicalEvidence: {
          patternCode: configuration.historicalPatternCode,
          side: configuration.historicalSide,
          validationN: aggregateMetric.validationN,
          validationHitRate: metric?.validationHitRate ?? null,
          validationWilsonLower: metric?.validationWilsonLower ?? null,
          stabilityClass: metric?.stabilityClass as "STABLE_OR_IMPROVED" | "MODERATE_DROP" | "SEVERE_DROP" | null ?? null,
          validationHitRateComponent: historical.validationHitRateComponent,
          validationWilsonLowerComponent: historical.validationWilsonLowerComponent,
          sampleComponent: historical.sampleComponent,
          stabilityComponent: historical.stabilityComponent,
          uncappedScore: historical.uncappedScore,
          validationLift: configuration.lift,
          maxCountryShare: metric?.maxCountryShare ?? null,
          maxCompetitionShare: metric?.maxCompetitionShare ?? null,
        },
        dataQuality: {
          matchingComponent: quality.matchingComponent,
          completenessComponent: quality.completenessComponent,
          semanticReadinessComponent: quality.semanticReadinessComponent,
          integrityComponent: quality.integrityComponent,
        },
        signalScore: configuration.signalScore,
        historicalEvidenceScore: historical.score,
        dataQualityScore: quality.score,
        rawPriorityScore: priority.rawPriorityScore,
        finalPriorityScore: priority.finalPriorityScore,
        priorityClass: priority.priorityClass,
        blocked: blockers.length > 0,
        blockers: blockers as FixtureMarketCandidateContract["blockers"],
        caps: [...historical.caps, ...priority.caps],
        reasons: [
          `SIGNAL_FORMULA_${configuration.family}`,
          `FROZEN_AGGREGATE_METRIC_${configuration.historicalPatternCode}`,
          `MATCH_QUALITY_${matchQuality}`,
          "INDIVIDUAL_OUTCOMES_NOT_READ",
        ],
        warnings,
        ...PRICE_FIELDS,
      };
      candidates.push(candidate);
      return candidate;
    };

    const dcValues: Record<DoubleChanceLine, number | null> = {
      "1X": asNumber(projection?.sourceDoubleChance1XPercent),
      "X2": asNumber(projection?.sourceDoubleChanceX2Percent),
      "12": asNumber(projection?.sourceDoubleChance12Percent),
    };
    const dcCandidates = (["1X", "X2", "12"] as const).map((line) => {
      const otherLines = (["1X", "X2", "12"] as const).filter((candidateLine) => candidateLine !== line);
      const value = dcValues[line];
      const complete = value !== null && otherLines.every((other) => dcValues[other] !== null);
      const signal = complete ? doubleChanceSignalScore(value, [dcValues[otherLines[0]]!, dcValues[otherLines[1]]!]) : null;
      return makeCandidate({
        family: "DOUBLE_CHANCE",
        marketCode: line,
        historicalPatternCode: `DOUBLE_CHANCE_${line}`,
        historicalSide: line,
        signalScore: signal?.signalScore ?? 0,
        signalDetails: { percentComponent: signal?.percentComponent ?? null, lineMargin: signal?.lineMargin ?? null, marginComponent: signal?.marginComponent ?? null, minimumAgreementPercent: null, strengthComponent: null, sourceGap: null, balanceComponent: null, combinationDcScore: null, combinationOuScore: null },
        sourceEvidence: { doubleChanceSourcePercent: value, secondHighestDcPercent: complete ? Math.max(dcValues[otherLines[0]]!, dcValues[otherLines[1]]!) : null, forebetSuggestedSide: null, forebetSidePercent: null, statareaSidePercent: null, statareaSourceOver25Percent: asNumber(projection?.sourceOver25Percent) },
        requiredFieldsComplete: complete,
        semanticReady: projection?.doubleChanceSemanticReady === true,
        strengthClass: null,
        confluenceCode: null,
        lift: null,
      });
    });
    const dcSelection = selectStrictWinner(dcCandidates);
    const dcWinner = dcSelection.winner;
    const dcFamilyReason = dcSelection.tied ? "FAMILY_TIE_NO_AUTOMATIC_WINNER" : dcWinner ? "DOUBLE_CHANCE_FAMILY_WINNER_SELECTED" : "ALL_DOUBLE_CHANCE_CANDIDATES_BLOCKED";
    familyDecisions.push({
      id: deterministicId("mpf", { assessmentId, matchDecisionId: decision.id, family: "DOUBLE_CHANCE" }),
      matchDecisionId: decision.id,
      family: "DOUBLE_CHANCE",
      chosenCandidateId: dcWinner?.id ?? null,
      reasonCode: dcFamilyReason,
      alternatives: dcCandidates.map((candidate) => ({ candidateId: candidate.id, marketCode: candidate.marketCode, finalPriorityScore: candidate.finalPriorityScore, blocked: candidate.blocked })),
      tieBreak: finalTieBreak.slice(1),
      blockers: unique(dcCandidates.flatMap((candidate) => candidate.blockers)),
      warnings: unique([REQUIRED_PRICE_WARNING, ...dcCandidates.flatMap((candidate) => candidate.warnings)]),
      ...PRICE_FIELDS,
    });

    const forebetOu = selectedForebetSide(observation);
    const statareaOver = asNumber(projection?.sourceOver25Percent);
    const statareaOu = selectedStatareaSide(statareaOver);
    let ouCandidate: FixtureMarketCandidateContract | null = null;
    if (forebetOu.side === statareaOu.side && forebetOu.percent !== null && statareaOu.percent !== null) {
      const signal = ou25SignalScore(forebetOu.percent, statareaOu.percent);
      const confluence = forebetConfluence(observation);
      ouCandidate = makeCandidate({
        family: "OU25",
        marketCode: forebetOu.side,
        historicalPatternCode: "OU25_CONSENSUS_SIMPLE",
        historicalSide: forebetOu.side,
        signalScore: signal.signalScore,
        signalDetails: { percentComponent: null, lineMargin: null, marginComponent: null, minimumAgreementPercent: signal.minimumAgreementPercent, strengthComponent: signal.strengthComponent, sourceGap: signal.sourceGap, balanceComponent: signal.balanceComponent, combinationDcScore: null, combinationOuScore: null },
        sourceEvidence: { doubleChanceSourcePercent: null, secondHighestDcPercent: null, forebetSuggestedSide: observation.suggestedSide, forebetSidePercent: forebetOu.percent, statareaSidePercent: statareaOu.percent, statareaSourceOver25Percent: statareaOver },
        requiredFieldsComplete: true,
        semanticReady: projection?.ou25SemanticReady === true,
        strengthClass: ouStrength(signal.minimumAgreementPercent),
        confluenceCode: confluence,
        lift: validationLift(forebetOu.side),
      });
    }
    familyDecisions.push({
      id: deterministicId("mpf", { assessmentId, matchDecisionId: decision.id, family: "OU25" }),
      matchDecisionId: decision.id,
      family: "OU25",
      chosenCandidateId: ouCandidate?.blocked ? null : ouCandidate?.id ?? null,
      reasonCode: ouCandidate ? (ouCandidate.blocked ? "OU25_CANDIDATE_BLOCKED" : "OU25_CONSENSUS_CANDIDATE_CREATED") : "NO_OU_FAMILY_CANDIDATE",
      alternatives: ouCandidate ? [{ candidateId: ouCandidate.id, marketCode: ouCandidate.marketCode, finalPriorityScore: ouCandidate.finalPriorityScore, blocked: ouCandidate.blocked }] : [],
      tieBreak: [],
      blockers: ouCandidate?.blockers ?? [],
      warnings: unique([REQUIRED_PRICE_WARNING, ...(ouCandidate?.warnings ?? [])]),
      ...PRICE_FIELDS,
    });

    let combinationCandidate: FixtureMarketCandidateContract | null = null;
    if (dcWinner && ouCandidate && !ouCandidate.blocked) {
      const line = dcWinner.marketCode as DoubleChanceLine;
      const side = ouCandidate.marketCode as Ou25Side;
      combinationCandidate = makeCandidate({
        family: "SAME_MATCH_COMBINATION",
        marketCode: `${line} + ${side}`,
        historicalPatternCode: `COMBO_${line}_${side}`,
        historicalSide: `${line}+${side}`,
        signalScore: combinationSignalScore(dcWinner.signalScore, ouCandidate.signalScore),
        signalDetails: { percentComponent: null, lineMargin: null, marginComponent: null, minimumAgreementPercent: null, strengthComponent: null, sourceGap: null, balanceComponent: null, combinationDcScore: dcWinner.signalScore, combinationOuScore: ouCandidate.signalScore },
        sourceEvidence: { doubleChanceSourcePercent: dcWinner.sourceEvidence.doubleChanceSourcePercent, secondHighestDcPercent: dcWinner.sourceEvidence.secondHighestDcPercent, forebetSuggestedSide: ouCandidate.sourceEvidence.forebetSuggestedSide, forebetSidePercent: ouCandidate.sourceEvidence.forebetSidePercent, statareaSidePercent: ouCandidate.sourceEvidence.statareaSidePercent, statareaSourceOver25Percent: ouCandidate.sourceEvidence.statareaSourceOver25Percent },
        requiredFieldsComplete: true,
        semanticReady: projection?.doubleChanceSemanticReady === true && projection?.ou25SemanticReady === true,
        strengthClass: ouCandidate.strengthClass,
        confluenceCode: ouCandidate.confluenceCode,
        lift: null,
      });
    }
    familyDecisions.push({
      id: deterministicId("mpf", { assessmentId, matchDecisionId: decision.id, family: "SAME_MATCH_COMBINATION" }),
      matchDecisionId: decision.id,
      family: "SAME_MATCH_COMBINATION",
      chosenCandidateId: combinationCandidate?.blocked ? null : combinationCandidate?.id ?? null,
      reasonCode: combinationCandidate ? (combinationCandidate.blocked ? "SAME_MATCH_COMBINATION_BLOCKED" : "SAME_MATCH_COMBINATION_CREATED") : "COMBINATION_COMPONENTS_NOT_AVAILABLE",
      alternatives: combinationCandidate ? [{ candidateId: combinationCandidate.id, marketCode: combinationCandidate.marketCode, finalPriorityScore: combinationCandidate.finalPriorityScore, blocked: combinationCandidate.blocked }] : [],
      tieBreak: [],
      blockers: combinationCandidate?.blockers ?? [],
      warnings: unique([REQUIRED_PRICE_WARNING, ...(combinationCandidate?.warnings ?? [])]),
      ...PRICE_FIELDS,
    });

    const finalOptions = [dcWinner, ouCandidate?.blocked ? null : ouCandidate, combinationCandidate?.blocked ? null : combinationCandidate].filter((candidate): candidate is FixtureMarketCandidateContract => candidate !== null);
    const finalSelection = selectStrictWinner(finalOptions);
    const sortedOptions = [...finalOptions].sort((left, right) => {
      const selection = selectStrictWinner([left, right]);
      if (selection.tied) return 0;
      return selection.winner?.id === left.id ? -1 : 1;
    });
    const top = sortedOptions[0] ?? null;
    const second = sortedOptions[1] ?? null;
    const margin = top ? scoreNumber(new Decimal(top.finalPriorityScore).minus(second?.finalPriorityScore ?? 0)) : null;
    const relevantWarning = top?.warnings.some((warning) => ["FOREBET_CONFLUENCE_VALIDATION_DROP", "HIGH_COUNTRY_OR_COMPETITION_CONCENTRATION"].includes(warning)) ?? false;
    let selectionStatus: "PREFERRED" | "PROVISIONAL" | "NONE" = "NONE";
    let reasonCode = "NO_ELIGIBLE_CANDIDATE_AT_OR_ABOVE_65";
    if (finalSelection.tied) reasonCode = "FINAL_TIE";
    else if (finalSelection.winner && finalSelection.winner.finalPriorityScore >= 65) {
      if (finalSelection.winner.finalPriorityScore >= 75 && (margin ?? 0) >= 5 && !relevantWarning) {
        selectionStatus = "PREFERRED";
        reasonCode = "PREFERRED_SCORE_AND_MARGIN_MET";
      } else {
        selectionStatus = "PROVISIONAL";
        reasonCode = relevantWarning ? "PROVISIONAL_RELEVANT_WARNING" : (margin ?? 0) < 5 ? "PROVISIONAL_MARGIN_BELOW_5" : "PROVISIONAL_PRIORITY_THRESHOLD";
      }
    }
    const selected = selectionStatus === "NONE" ? null : finalSelection.winner;
    finalDecisions.push({
      id: deterministicId("mpd", { assessmentId, matchDecisionId: decision.id }),
      matchDecisionId: decision.id,
      selectionStatus,
      selectedCandidateId: selected?.id ?? null,
      selectedMarketCode: selected?.marketCode ?? null,
      selectedLineCount: selected ? 1 : 0,
      selectedCandidateBlocked: selected ? selected.blocked : null,
      topCandidateId: top?.id ?? null,
      topFinalPriorityScore: top?.finalPriorityScore ?? null,
      secondCandidateId: second?.id ?? null,
      marginToSecond: margin,
      reasonCode,
      reasons: selected ? [`SELECTED_${selected.family}`, `FINAL_SCORE_${selected.finalPriorityScore}`, `MARGIN_${margin}`] : [reasonCode],
      caps: selected?.caps ?? [],
      warnings: unique([REQUIRED_PRICE_WARNING, "INDEPENDENT_VALIDATION_NOT_AVAILABLE", "PROSPECTIVE_VALIDATION_REQUIRED", ...(selected?.warnings ?? [])]),
      ...PRICE_FIELDS,
    });
  }

  candidates.sort((left, right) => left.sportsDate.localeCompare(right.sportsDate) || left.matchDecisionId.localeCompare(right.matchDecisionId) || left.family.localeCompare(right.family) || left.marketCode.localeCompare(right.marketCode));
  familyDecisions.sort((left, right) => left.matchDecisionId.localeCompare(right.matchDecisionId) || left.family.localeCompare(right.family));
  finalDecisions.sort((left, right) => left.matchDecisionId.localeCompare(right.matchDecisionId));
  if (guard.getBlockedAccessAttempts() !== 0) throw new Error("MARKET_PRIORITY_OUTCOME_ACCESS_ATTEMPTED");

  const candidateSetHash = canonicalHash(candidates);
  const familyDecisionSetHash = canonicalHash(familyDecisions);
  const finalDecisionSetHash = canonicalHash(finalDecisions);
  const assessmentHash = canonicalHash({ priorityPolicyHash: marketPriorityPolicyHash, datasetId: dataset.id, historicalEvaluationRunId: historicalEvaluation.id, candidateSetHash, familyDecisionSetHash, finalDecisionSetHash });
  const policyDocument = { contractVersion: MARKET_PRIORITY_POLICY_CONTRACT_VERSION, priorityPolicyHash: marketPriorityPolicyHash, policy: marketPriorityPolicy };
  const candidateDocument = { contractVersion: MARKET_PRIORITY_CANDIDATES_CONTRACT_VERSION, priorityPolicyHash: marketPriorityPolicyHash, assessmentId, candidateSetHash, candidates };
  const decisionDocument = { contractVersion: MARKET_PRIORITY_DECISIONS_CONTRACT_VERSION, priorityPolicyHash: marketPriorityPolicyHash, assessmentId, decisionSetHash: finalDecisionSetHash, decisions: finalDecisions };
  marketPriorityPolicyDocumentSchema.parse(policyDocument);
  fixtureMarketCandidatesDocumentSchema.parse(candidateDocument);
  fixturePreferredLineDecisionsDocumentSchema.parse(decisionDocument);
  assertAjv(policyJsonSchema, policyDocument, "MARKET_PRIORITY_POLICY");
  assertAjv(candidateJsonSchema, candidateDocument, "MARKET_PRIORITY_CANDIDATES");
  assertAjv(decisionJsonSchema, decisionDocument, "MARKET_PRIORITY_DECISIONS");

  const selectionCounts = Object.fromEntries(["PREFERRED", "PROVISIONAL", "NONE"].map((status) => [status, finalDecisions.filter((decision) => decision.selectionStatus === status).length]));
  const classCounts = Object.fromEntries(["HIGH", "INTERESTING", "TRACK", "DO_NOT_PRIORITIZE"].map((priorityClass) => [priorityClass, candidates.filter((candidate) => candidate.priorityClass === priorityClass).length]));
  const familyCounts = Object.fromEntries(["DOUBLE_CHANCE", "OU25", "SAME_MATCH_COMBINATION"].map((family) => [family, candidates.filter((candidate) => candidate.family === family).length]));
  const blockedCount = candidates.filter((candidate) => candidate.blocked).length;
  const finalTieCount = finalDecisions.filter((decision) => decision.reasonCode === "FINAL_TIE").length;
  const familyTieCount = familyDecisions.filter((decision) => decision.reasonCode === "FAMILY_TIE_NO_AUTOMATIC_WINNER").length;
  const counts = { fixtures: decisions.length, candidates: candidates.length, familyCandidates: familyCounts, blockedCandidates: blockedCount, familyDecisions: familyDecisions.length, finalDecisions: finalDecisions.length, selections: selectionCounts, classes: classCounts, familyTies: familyTieCount, finalTies: finalTieCount, selectedLineMaximum: Math.max(...finalDecisions.map((decision) => decision.selectedLineCount)), priceEvaluated: 0, availableOdds: 0, marketValueEvaluated: 0 };
  const exportBundle = {
    "policy.json": policyDocument,
    "formulas.json": { priorityPolicyHash: marketPriorityPolicyHash, formulas: marketPriorityPolicy.formulas, families: marketPriorityPolicy.families },
    "caps.json": { priorityPolicyHash: marketPriorityPolicyHash, caps: marketPriorityPolicy.caps, classes: marketPriorityPolicy.classes, finalSelection: marketPriorityPolicy.finalSelection },
    "summary.json": { assessmentId, assessmentHash, priorityPolicyHash: marketPriorityPolicyHash, datasetId: dataset.id, historicalEvaluationRunId: historicalEvaluation.id, assessmentMode: MARKET_PRIORITY_ASSESSMENT_MODE, outcomeEvaluationEnabled: false, independentValidationStatus: MARKET_PRIORITY_INDEPENDENT_VALIDATION_STATUS, prospectiveValidationRequired: true, counts, networkRequests: 0, outcomeReads: 0 },
    "candidates.json": candidateDocument,
    "family-decisions.json": { priorityPolicyHash: marketPriorityPolicyHash, assessmentId, familyDecisionSetHash, decisions: familyDecisions },
    "final-decisions.json": decisionDocument,
    "preferred.json": { assessmentId, decisions: finalDecisions.filter((decision) => decision.selectionStatus === "PREFERRED") },
    "provisional.json": { assessmentId, decisions: finalDecisions.filter((decision) => decision.selectionStatus === "PROVISIONAL") },
    "none.json": { assessmentId, decisions: finalDecisions.filter((decision) => decision.selectionStatus === "NONE") },
    "double-chance-candidates.json": { assessmentId, candidates: candidates.filter((candidate) => candidate.family === "DOUBLE_CHANCE") },
    "ou25-candidates.json": { assessmentId, candidates: candidates.filter((candidate) => candidate.family === "OU25") },
    "same-match-combinations.json": { assessmentId, jointProbabilityCalculated: false, candidates: candidates.filter((candidate) => candidate.family === "SAME_MATCH_COMBINATION") },
    "blockers.json": { assessmentId, candidates: candidates.filter((candidate) => candidate.blocked).map((candidate) => ({ candidateId: candidate.id, blockers: candidate.blockers })) },
    "warnings.json": { assessmentId, candidates: candidates.filter((candidate) => candidate.warnings.length > 1).map((candidate) => ({ candidateId: candidate.id, warnings: candidate.warnings })) },
    "score-distribution.json": { assessmentId, bins: [{ code: "0_64_99", count: candidates.filter((candidate) => candidate.finalPriorityScore < 65).length }, { code: "65_74_99", count: candidates.filter((candidate) => candidate.finalPriorityScore >= 65 && candidate.finalPriorityScore < 75).length }, { code: "75_84_99", count: candidates.filter((candidate) => candidate.finalPriorityScore >= 75 && candidate.finalPriorityScore < 85).length }, { code: "85_100", count: candidates.filter((candidate) => candidate.finalPriorityScore >= 85).length }] },
    "class-distribution.json": { assessmentId, classes: classCounts },
    "audit.json": { assessmentId, assessmentHash, appendOnly: true, writeOnceExports: true, contracts: { ajv: true, zod: true, canonical: true }, guards: { networkRequests: 0, outcomeReads: 0 }, prohibitedOutputs: { selectionHitRate: 0, selectionWilson: 0, selectionBrier: 0, ranking: 0, multiMatchCombinations: 0, stake: 0, profit: 0 } },
  };
  const exports = await preserveMarketPriorityExports(exportBundle);

  let policyRecord = await client.marketPriorityPolicy.findUnique({ where: { code_version: { code: MARKET_PRIORITY_POLICY_CODE, version: MARKET_PRIORITY_POLICY_VERSION } } });
  let policyExecutionStatus: "CREATED" | "REUSED" = "REUSED";
  if (!policyRecord) {
    policyRecord = await client.marketPriorityPolicy.create({ data: {
      code: MARKET_PRIORITY_POLICY_CODE,
      version: MARKET_PRIORITY_POLICY_VERSION,
      status: MARKET_PRIORITY_POLICY_STATUS,
      datasetId: dataset.id,
      manifestHash: HISTORICAL_MANIFEST_HASH,
      semanticRegistryHash: HISTORICAL_REGISTRY_HASH,
      historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH,
      engineVersion: MARKET_PRIORITY_ENGINE_VERSION,
      developmentEvidenceWindow: MARKET_PRIORITY_DEVELOPMENT_WINDOW,
      independentValidationStatus: MARKET_PRIORITY_INDEPENDENT_VALIDATION_STATUS,
      prospectiveValidationRequired: true,
      priorityPolicyHash: marketPriorityPolicyHash,
      canonicalPolicyJson: canonicalJson(marketPriorityPolicy),
    } });
    policyExecutionStatus = "CREATED";
  } else if (policyRecord.priorityPolicyHash !== marketPriorityPolicyHash || canonicalHash(JSON.parse(policyRecord.canonicalPolicyJson)) !== marketPriorityPolicyHash || policyRecord.status !== MARKET_PRIORITY_POLICY_STATUS) throw new Error("MARKET_PRIORITY_FROZEN_POLICY_INTEGRITY_FAILURE");

  const existingRun = await client.marketPriorityAssessmentRun.findUnique({ where: { policyId_datasetId_historicalEvaluationRunId: { policyId: policyRecord.id, datasetId: dataset.id, historicalEvaluationRunId: historicalEvaluation.id } } });
  let executionStatus: "CREATED" | "REUSED";
  if (existingRun) {
    if (existingRun.id !== assessmentId || existingRun.assessmentHash !== assessmentHash || existingRun.candidateSetHash !== candidateSetHash || existingRun.familyDecisionSetHash !== familyDecisionSetHash || existingRun.finalDecisionSetHash !== finalDecisionSetHash) throw new Error("MARKET_PRIORITY_REPLAY_IDENTITY_MISMATCH");
    const [candidateCount, familyDecisionCount, finalDecisionCount] = await Promise.all([
      client.fixtureMarketCandidate.count({ where: { assessmentRunId: assessmentId } }),
      client.fixtureFamilyDecision.count({ where: { assessmentRunId: assessmentId } }),
      client.fixturePreferredLineDecision.count({ where: { assessmentRunId: assessmentId } }),
    ]);
    if (candidateCount !== candidates.length || familyDecisionCount !== familyDecisions.length || finalDecisionCount !== finalDecisions.length) throw new Error("MARKET_PRIORITY_REPLAY_ROW_COUNT_MISMATCH");
    await client.$transaction([
      client.marketPriorityAssessmentAttempt.create({ data: { policyId: policyRecord.id, assessmentRunId: assessmentId, status: "REUSED", contextJson: canonicalJson({ assessmentHash, candidateSetHash, familyDecisionSetHash, finalDecisionSetHash }), networkRequestCount: 0, outcomeReadCount: 0 } }),
      client.marketPriorityAuditEvent.create({ data: { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "ASSESSMENT_REUSED", contextJson: canonicalJson({ assessmentHash, writeOnceExports: true }) } }),
    ]);
    executionStatus = "REUSED";
  } else {
    await client.$transaction([
      client.marketPriorityAssessmentRun.create({ data: {
        id: assessmentId,
        policyId: policyRecord.id,
        datasetId: dataset.id,
        historicalEvaluationRunId: historicalEvaluation.id,
        engineVersion: MARKET_PRIORITY_ENGINE_VERSION,
        assessmentMode: MARKET_PRIORITY_ASSESSMENT_MODE,
        outcomeEvaluationEnabled: false,
        status: "COMPLETED",
        fixtureCount: decisions.length,
        candidateCount: candidates.length,
        familyDecisionCount: familyDecisions.length,
        finalDecisionCount: finalDecisions.length,
        candidateSetHash,
        familyDecisionSetHash,
        finalDecisionSetHash,
        assessmentHash,
        countsJson: canonicalJson(counts),
        warningsJson: canonicalJson(["INDEPENDENT_VALIDATION_NOT_AVAILABLE", "PROSPECTIVE_VALIDATION_REQUIRED", REQUIRED_PRICE_WARNING]),
        networkRequestCount: 0,
        outcomeReadCount: 0,
        exportPath: `var/exports/priority/${MARKET_PRIORITY_EXPORT_DIRECTORY}`,
      } }),
      client.fixtureMarketCandidate.createMany({ data: candidates.map((candidate) => ({
        id: candidate.id,
        assessmentRunId: assessmentId,
        matchDecisionId: candidate.matchDecisionId,
        sportsDate: new Date(`${candidate.sportsDate}T00:00:00.000Z`),
        homeTeam: candidate.fixture.homeTeam,
        awayTeam: candidate.fixture.awayTeam,
        family: candidate.family,
        marketCode: candidate.marketCode,
        historicalPatternCode: candidate.historicalPatternCode,
        matchingQualityClass: candidate.matchingQualityClass,
        strengthClass: candidate.strengthClass,
        confluenceCode: candidate.confluenceCode,
        sourceEvidenceJson: canonicalJson({ sourceEvidence: candidate.sourceEvidence, signalDetails: candidate.signalDetails, historicalEvidence: candidate.historicalEvidence, dataQuality: candidate.dataQuality }),
        signalScore: candidate.signalScore,
        historicalEvidenceScore: candidate.historicalEvidenceScore,
        dataQualityScore: candidate.dataQualityScore,
        rawPriorityScore: candidate.rawPriorityScore,
        finalPriorityScore: candidate.finalPriorityScore,
        priorityClass: candidate.priorityClass,
        validationN: candidate.historicalEvidence.validationN,
        validationHitRate: candidate.historicalEvidence.validationHitRate,
        validationWilsonLower: candidate.historicalEvidence.validationWilsonLower,
        stabilityClass: candidate.historicalEvidence.stabilityClass,
        validationLift: candidate.historicalEvidence.validationLift,
        maxCountryShare: candidate.historicalEvidence.maxCountryShare,
        maxCompetitionShare: candidate.historicalEvidence.maxCompetitionShare,
        blocked: candidate.blocked,
        blockersJson: canonicalJson(candidate.blockers),
        capsJson: canonicalJson(candidate.caps),
        reasonsJson: canonicalJson(candidate.reasons),
        warningsJson: canonicalJson(candidate.warnings),
        ...PRICE_FIELDS,
      })) }),
      client.fixtureFamilyDecision.createMany({ data: familyDecisions.map((decision) => ({ id: decision.id, assessmentRunId: assessmentId, matchDecisionId: decision.matchDecisionId, family: decision.family, chosenCandidateId: decision.chosenCandidateId, reasonCode: decision.reasonCode, alternativesJson: canonicalJson(decision.alternatives), tieBreakJson: canonicalJson(decision.tieBreak), blockersJson: canonicalJson(decision.blockers), warningsJson: canonicalJson(decision.warnings), ...PRICE_FIELDS })) }),
      client.fixturePreferredLineDecision.createMany({ data: finalDecisions.map((decision) => ({ id: decision.id, assessmentRunId: assessmentId, matchDecisionId: decision.matchDecisionId, selectionStatus: decision.selectionStatus, selectedCandidateId: decision.selectedCandidateId, selectedMarketCode: decision.selectedMarketCode, selectedLineCount: decision.selectedLineCount, topCandidateId: decision.topCandidateId, secondCandidateId: decision.secondCandidateId, marginToSecond: decision.marginToSecond, reasonCode: decision.reasonCode, reasonsJson: canonicalJson(decision.reasons), capsJson: canonicalJson(decision.caps), warningsJson: canonicalJson(decision.warnings), ...PRICE_FIELDS })) }),
      client.marketPriorityAssessmentAttempt.create({ data: { policyId: policyRecord.id, assessmentRunId: assessmentId, status: "CREATED", contextJson: canonicalJson({ assessmentHash, candidateSetHash, familyDecisionSetHash, finalDecisionSetHash }), networkRequestCount: 0, outcomeReadCount: 0 } }),
      client.marketPriorityAuditEvent.createMany({ data: [
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "POLICY_REFERENCES_VERIFIED", contextJson: canonicalJson({ manifestHash: HISTORICAL_MANIFEST_HASH, semanticRegistryHash: HISTORICAL_REGISTRY_HASH, historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "OUTCOME_ACCESS_GUARD_ENABLED", contextJson: canonicalJson({ outcomeReads: 0 }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "CANDIDATES_SCORED", contextJson: canonicalJson({ candidateSetHash, count: candidates.length }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "FAMILY_DECISIONS_CREATED", contextJson: canonicalJson({ familyDecisionSetHash, count: familyDecisions.length }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "FINAL_DECISIONS_CREATED", contextJson: canonicalJson({ finalDecisionSetHash, count: finalDecisions.length, selectedLineMaximum: counts.selectedLineMaximum }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "CONTRACTS_VALIDATED", contextJson: canonicalJson({ ajv: true, zod: true, canonical: true }) },
        { policyId: policyRecord.id, assessmentRunId: assessmentId, eventType: "ASSESSMENT_COMPLETED", contextJson: canonicalJson({ assessmentHash, networkRequests: 0, outcomeReads: 0 }) },
      ] }),
    ]);
    executionStatus = "CREATED";
  }

  return {
    executionStatus,
    policyExecutionStatus,
    policyId: policyRecord.id,
    policyCode: policyRecord.code,
    policyVersion: policyRecord.version,
    priorityPolicyHash: marketPriorityPolicyHash,
    assessmentId,
    assessmentHash,
    historicalEvaluationRunId: historicalEvaluation.id,
    candidateSetHash,
    familyDecisionSetHash,
    finalDecisionSetHash,
    counts,
    networkRequests: 0,
    outcomeReads: guard.getBlockedAccessAttempts(),
    exports,
  };
}
