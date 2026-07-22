import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { PrismaClient } from "@prisma/client";
import Decimal from "decimal.js";
import fixtureOutcomesJsonSchema from "@/contracts/schemas/fixture-outcomes.schema.json";
import patternEvaluationJsonSchema from "@/contracts/schemas/historical-pattern-evaluation.schema.json";
import { fixtureOutcomesSchema, patternEvaluationSchema } from "@/contracts/historical-outcomes";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import {
  FIXTURE_OUTCOMES_CONTRACT_VERSION,
  FOREBET_RESULT_EXTRACTOR_VERSION,
  HISTORICAL_ANALYSIS_CODE,
  HISTORICAL_ANALYSIS_VERSION,
  HISTORICAL_DATASET_CODE,
  HISTORICAL_DATASET_VERSION,
  HISTORICAL_ENGINE_VERSION,
  HISTORICAL_MANIFEST_HASH,
  HISTORICAL_REGISTRY_HASH,
  PATTERN_EVALUATION_CONTRACT_VERSION,
  STATAREA_RESULT_EXTRACTOR_VERSION,
  type HistoricalPatternCode,
} from "@/domain/historical-analysis/constants";
import { extractForebetResult, extractStatareaLegacyResult } from "@/domain/historical-analysis/extractors";
import { calibrationBucket, calculateMetrics, consensusLift, stabilityClass, type EvaluationCase } from "@/domain/historical-analysis/metrics";
import { reconcileSourceOutcomes, type Ou25Outcome, type Result1X2, type SourceOutcomeEvidence } from "@/domain/historical-analysis/outcomes";
import { favoriteSegment, isDoubleChanceHit, isOuHit, isSameMatchCombinationHit, predictedGoalDifferenceSegment, selectForebetConfluence, selectForebetOu, selectOuConsensus, selectPreferredDoubleChance, selectStatareaOu } from "@/domain/historical-analysis/patterns";
import { HISTORICAL_ANALYSIS_SPEC_HASH, historicalAnalysisSpec } from "@/domain/historical-analysis/spec";
import { preserveHistoricalExports } from "@/infrastructure/historical-analysis/export-store";

type Partition = "DISCOVERY" | "VALIDATION";
type JoinedPrediction = {
  decisionId: string; partition: Partition; sportsDate: string; country: string | null; competition: string | null;
  forebet: { suggestedSide: "OVER" | "UNDER"; probabilityOver25: Decimal | null; probabilityUnder25: Decimal | null; predictedHomeGoals: number | null; predictedAwayGoals: number | null; averageGoals: Decimal | null };
  statarea: { home: Decimal; draw: Decimal; away: Decimal; over25: Decimal; oneX: Decimal; x2: Decimal; twelve: Decimal };
};
type PatternCase = EvaluationCase & { patternCode: HistoricalPatternCode; side: string; partition: Partition; segments: string[]; principal: boolean };

const extractorVersionsJson = canonicalJson({ forebet: FOREBET_RESULT_EXTRACTOR_VERSION, statareaLegacy: STATAREA_RESULT_EXTRACTOR_VERSION });
const dateOnly = (date: Date) => date.toISOString().slice(0, 10);
const numberOrNull = (value: Decimal | null) => value?.toNumber() ?? null;

function extractionCounts(evidences: SourceOutcomeEvidence[], statuses: string[]) {
  const count = (status: string) => statuses.filter((value) => value === status).length;
  return {
    matched: 98,
    evidenceTotal: evidences.length,
    forebetParsed: evidences.filter((value) => value.source === "FOREBET" && value.parseStatus === "PARSED").length,
    statareaParsed: evidences.filter((value) => value.source === "STATAREA" && value.parseStatus === "PARSED").length,
    agreed: count("AGREED"), forebetOnly: count("FOREBET_ONLY"), statareaOnly: count("STATAREA_ONLY"), conflict: count("CONFLICT"), missing: count("MISSING"), unsupported: count("UNSUPPORTED"),
  };
}

async function createOrReuseExtraction(prisma: PrismaClient, specId: string, datasetId: string) {
  const existing = await prisma.outcomeExtractionRun.findFirst({ where: { specId, datasetId, manifestHash: HISTORICAL_MANIFEST_HASH, extractorVersionsJson } });
  if (existing) {
    await prisma.$transaction([
      prisma.outcomeExtractionAttempt.create({ data: { specId, extractionRunId: existing.id, status: "REUSED", contextJson: canonicalJson({ extractorVersionsJson, networkRequests: 0 }) } }),
      prisma.historicalAnalysisAuditEvent.create({ data: { specId, extractionRunId: existing.id, eventType: "REPLAY_REUSED", contextJson: canonicalJson({ layer: "EXTRACTION", networkRequests: 0 }) } }),
    ]);
    return { run: existing, status: "REUSED" as const };
  }

  const decisions = await prisma.matchDecision.findMany({
    where: { status: "MATCHED", run: { datasetId, runType: "HISTORICAL_DATASET" } },
    select: { id: true, forebetObservationId: true, statareaRowId: true, selectedCandidateId: true, run: { select: { sportDate: true } } },
    orderBy: { createdAt: "asc" },
  });
  if (decisions.length !== 98 || decisions.some((decision) => !decision.forebetObservationId || !decision.statareaRowId)) throw new Error(`HISTORICAL_MATCHED_INPUT_MISMATCH:${decisions.length}`);
  const forebetIds = decisions.map((decision) => decision.forebetObservationId!);
  const statareaIds = decisions.map((decision) => decision.statareaRowId!);
  const candidateIds = decisions.flatMap((decision) => decision.selectedCandidateId ? [decision.selectedCandidateId] : []);
  const [forebetRows, statareaRows, candidates] = await Promise.all([
    prisma.forebetObservation.findMany({ where: { id: { in: forebetIds } }, include: { snapshot: true } }),
    prisma.statareaRawRow.findMany({ where: { id: { in: statareaIds } }, include: { snapshot: { include: { profile: true } } } }),
    prisma.matchCandidate.findMany({ where: { id: { in: candidateIds } }, select: { id: true, orientation: true } }),
  ]);
  if (forebetRows.length !== 98 || statareaRows.length !== 98 || statareaRows.some((row) => row.snapshot.profile?.sourcePresentation !== "LEGACY_OFFICIAL")) throw new Error("HISTORICAL_EXTRACTION_SOURCE_MISMATCH");
  const forebetById = new Map(forebetRows.map((row) => [row.id, row]));
  const statareaById = new Map(statareaRows.map((row) => [row.id, row]));
  const orientationById = new Map(candidates.map((candidate) => [candidate.id, candidate.orientation]));
  const evidenceBodies = new Map<string, string>();
  for (const row of forebetRows) if (!evidenceBodies.has(row.snapshot.evidencePath)) evidenceBodies.set(row.snapshot.evidencePath, await readFile(resolve(process.cwd(), row.snapshot.evidencePath), "utf8"));
  for (const row of statareaRows) if (!evidenceBodies.has(row.snapshot.evidencePath)) evidenceBodies.set(row.snapshot.evidencePath, await readFile(resolve(process.cwd(), row.snapshot.evidencePath), "utf8"));

  const evidenceInputs: Array<{ id: string; evidence: SourceOutcomeEvidence }> = [];
  const fixtureInputs: Array<{ id: string; decisionId: string; partition: Partition; forebetEvidenceId: string; statareaEvidenceId: string; reconciliationStatus: string; outcome: ReturnType<typeof reconcileSourceOutcomes>["outcome"]; warnings: string[] }> = [];
  for (const decision of decisions) {
    const forebet = forebetById.get(decision.forebetObservationId!)!;
    const statarea = statareaById.get(decision.statareaRowId!)!;
    const sportsDate = dateOnly(decision.run.sportDate);
    const forebetEvidence = extractForebetResult(evidenceBodies.get(forebet.snapshot.evidencePath)!, { snapshotId: forebet.snapshotId, sourceRecordId: forebet.id, sportsDate, homeTeamRaw: forebet.homeTeamRaw, awayTeamRaw: forebet.awayTeamRaw, kickoffRaw: forebet.kickoffRaw });
    const statareaEvidence = extractStatareaLegacyResult(evidenceBodies.get(statarea.snapshot.evidencePath)!, { snapshotId: statarea.snapshotId, sourceRecordId: statarea.id, sportsDate, homeTeamRaw: statarea.homeTeamRaw, awayTeamRaw: statarea.awayTeamRaw, kickoffRaw: statarea.kickoffRaw });
    const forebetEvidenceId = randomUUID(); const statareaEvidenceId = randomUUID();
    evidenceInputs.push({ id: forebetEvidenceId, evidence: forebetEvidence }, { id: statareaEvidenceId, evidence: statareaEvidence });
    const reconciled = reconcileSourceOutcomes({ forebet: forebetEvidence, statarea: statareaEvidence, directOrientation: decision.selectedCandidateId ? orientationById.get(decision.selectedCandidateId) === "DIRECT" : false, sameSportsDate: forebetEvidence.sportsDate === statareaEvidence.sportsDate });
    fixtureInputs.push({ id: randomUUID(), decisionId: decision.id, partition: sportsDate <= "2026-07-14" ? "DISCOVERY" : "VALIDATION", forebetEvidenceId, statareaEvidenceId, reconciliationStatus: reconciled.reconciliationStatus, outcome: reconciled.outcome, warnings: reconciled.reconciliationStatus === "AGREED" ? [] : [`OUTCOME_${reconciled.reconciliationStatus}`] });
  }
  const counts = extractionCounts(evidenceInputs.map((item) => item.evidence), fixtureInputs.map((item) => item.reconciliationStatus));
  const run = await prisma.$transaction(async (transaction) => {
    const created = await transaction.outcomeExtractionRun.create({ data: { specId, datasetId, manifestHash: HISTORICAL_MANIFEST_HASH, extractorVersionsJson, status: "COMPLETED", countsJson: canonicalJson(counts), warningsJson: canonicalJson(counts.agreed === 98 ? [] : ["PRINCIPAL_SAMPLE_REDUCED"]) } });
    await transaction.outcomeEvidence.createMany({ data: evidenceInputs.map(({ id, evidence }) => ({ id, extractionRunId: created.id, source: evidence.source, snapshotId: evidence.snapshotId, sourceRecordId: evidence.sourceRecordId, sportsDate: new Date(`${evidence.sportsDate}T00:00:00.000Z`), rawResult: evidence.rawResult, rawHtResult: evidence.rawHtResult, homeGoals: evidence.homeGoals, awayGoals: evidence.awayGoals, parseStatus: evidence.parseStatus, reasonCode: evidence.reasonCode, warningsJson: canonicalJson(evidence.warnings), extractorVersion: evidence.extractorVersion, evidenceHash: evidence.evidenceHash })) });
    await transaction.fixtureOutcome.createMany({ data: fixtureInputs.map((item) => ({ id: item.id, extractionRunId: created.id, matchDecisionId: item.decisionId, forebetOutcomeEvidenceId: item.forebetEvidenceId, statareaOutcomeEvidenceId: item.statareaEvidenceId, reconciliationStatus: item.reconciliationStatus, homeGoals: item.outcome?.homeGoals ?? null, awayGoals: item.outcome?.awayGoals ?? null, totalGoals: item.outcome?.totalGoals ?? null, result1X2: item.outcome?.result1X2 ?? null, ou25Outcome: item.outcome?.ou25Outcome ?? null, doubleChance1XOutcome: item.outcome?.doubleChance1XOutcome ?? null, doubleChanceX2Outcome: item.outcome?.doubleChanceX2Outcome ?? null, doubleChance12Outcome: item.outcome?.doubleChance12Outcome ?? null, partition: item.partition, warningsJson: canonicalJson(item.warnings) })) });
    await transaction.outcomeExtractionAttempt.create({ data: { specId, extractionRunId: created.id, status: "CREATED", contextJson: canonicalJson({ counts, networkRequests: 0 }) } });
    const auditRows = [
      { eventType: "EXTRACTION_STARTED", context: { matched: 98, extractorVersionsJson } },
      ...evidenceInputs.map(({ evidence }) => ({ eventType: "OUTCOME_EVIDENCE_CREATED", context: { source: evidence.source, sourceRecordId: evidence.sourceRecordId, parseStatus: evidence.parseStatus, evidenceHash: evidence.evidenceHash } })),
      ...fixtureInputs.map((item) => ({ eventType: item.reconciliationStatus === "CONFLICT" ? "OUTCOME_CONFLICT_DETECTED" : "OUTCOME_RECONCILED", context: { matchDecisionId: item.decisionId, reconciliationStatus: item.reconciliationStatus } })),
      ...fixtureInputs.filter((item) => item.outcome).map((item) => ({ eventType: "CANONICAL_OUTCOME_DERIVED", context: { matchDecisionId: item.decisionId, reconciliationStatus: item.reconciliationStatus } })),
    ];
    await transaction.historicalAnalysisAuditEvent.createMany({ data: auditRows.map((item) => ({ specId, extractionRunId: created.id, eventType: item.eventType, contextJson: canonicalJson(item.context) })) });
    return created;
  }, { timeout: 30_000 });
  return { run, status: "CREATED" as const };
}

function buildPatternCases(predictions: JoinedPrediction[], outcomes: Map<string, { reconciliationStatus: string; result1X2: string | null; ou25Outcome: string | null }>) {
  const cases: PatternCase[] = [];
  const push = (prediction: JoinedPrediction, principal: boolean, patternCode: HistoricalPatternCode, side: string, hit: boolean, sourcePercent: Decimal | null) => {
    const favorite = favoriteSegment(prediction.statarea);
    const goalGap = predictedGoalDifferenceSegment(prediction.forebet.predictedHomeGoals, prediction.forebet.predictedAwayGoals);
    const segments = [favorite.segment, `FAVORITE_${favorite.favoriteSide}`, ...(goalGap ? [`PREDICTED_GOAL_DIFFERENCE_${goalGap}`] : []), ...(favorite.segment === "STRONG_FAVORITE" ? [`STRONG_FAVORITE+${side}`] : []), ...(favorite.segment === "BALANCED" ? [`BALANCED+${side}`] : [])];
    cases.push({ patternCode, side, partition: prediction.partition, principal, hit, sourcePercent, country: prediction.country, competition: prediction.competition, sportsDate: prediction.sportsDate, segments });
  };
  for (const prediction of predictions) {
    const storedOutcome = outcomes.get(prediction.decisionId);
    if (!storedOutcome?.result1X2 || !storedOutcome.ou25Outcome) continue;
    const result = storedOutcome.result1X2 as Result1X2; const ouOutcome = storedOutcome.ou25Outcome as Ou25Outcome;
    const principal = storedOutcome.reconciliationStatus === "AGREED";
    const sensitivity = storedOutcome.reconciliationStatus === "FOREBET_ONLY" || storedOutcome.reconciliationStatus === "STATAREA_ONLY";
    if (!principal && !sensitivity) continue;
    const f = selectForebetOu(prediction.forebet); const s = selectStatareaOu(prediction.statarea.over25);
    push(prediction, principal, "FOREBET_OU25_CONTROL", f.side, isOuHit(f.side, ouOutcome), f.sourcePercent);
    if (s.side) push(prediction, principal, "STATAREA_OU25_CONTROL", s.side, isOuHit(s.side, ouOutcome), s.sourcePercent);
    for (const [threshold, code] of [[0, "OU25_CONSENSUS_SIMPLE"], [60, "OU25_CONSENSUS_60"], [65, "OU25_CONSENSUS_65"], [70, "OU25_CONSENSUS_70"]] as const) {
      const consensus = selectOuConsensus(f, s, threshold); if (consensus) push(prediction, principal, code, consensus.side, isOuHit(consensus.side, ouOutcome), null);
    }
    const confluence = selectForebetConfluence(prediction.forebet); if (confluence) push(prediction, principal, confluence.code, confluence.side, isOuHit(confluence.side, ouOutcome), f.sourcePercent);
    const dcValues = { "1X": prediction.statarea.oneX, X2: prediction.statarea.x2, "12": prediction.statarea.twelve };
    for (const line of ["1X", "X2", "12"] as const) push(prediction, principal, `DOUBLE_CHANCE_${line}` as HistoricalPatternCode, line, isDoubleChanceHit(line, result), dcValues[line]);
    const preferred = selectPreferredDoubleChance(dcValues); if (preferred) push(prediction, principal, "PREFERRED_DOUBLE_CHANCE", preferred.line, isDoubleChanceHit(preferred.line, result), null);
    const simple = selectOuConsensus(f, s, 0);
    if (simple) {
      for (const line of ["1X", "X2", "12"] as const) {
        const suffix = simple.side === "OVER_25" ? "OVER_25" : "UNDER_25";
        push(prediction, principal, `COMBO_${line}_${suffix}` as HistoricalPatternCode, `${line}+${simple.side}`, isSameMatchCombinationHit(line, simple.side, result, ouOutcome), null);
      }
      if (preferred) push(prediction, principal, "PREFERRED_DC_PLUS_CONSENSUS_OU", `${preferred.line}+${simple.side}`, isSameMatchCombinationHit(preferred.line, simple.side, result, ouOutcome), null);
    }
  }
  return cases;
}

const fixedSides: Record<HistoricalPatternCode, string[]> = {
  FOREBET_OU25_CONTROL: ["OVER_25", "UNDER_25"], STATAREA_OU25_CONTROL: ["OVER_25", "UNDER_25"], OU25_CONSENSUS_SIMPLE: ["OVER_25", "UNDER_25"], OU25_CONSENSUS_60: ["OVER_25", "UNDER_25"], OU25_CONSENSUS_65: ["OVER_25", "UNDER_25"], OU25_CONSENSUS_70: ["OVER_25", "UNDER_25"], FOREBET_OVER_CONFLUENCE: ["OVER_25"], FOREBET_UNDER_CONFLUENCE: ["UNDER_25"], DOUBLE_CHANCE_1X: ["1X"], DOUBLE_CHANCE_X2: ["X2"], DOUBLE_CHANCE_12: ["12"], PREFERRED_DOUBLE_CHANCE: ["1X", "X2", "12"], COMBO_1X_OVER_25: ["1X+OVER_25"], COMBO_1X_UNDER_25: ["1X+UNDER_25"], COMBO_X2_OVER_25: ["X2+OVER_25"], COMBO_X2_UNDER_25: ["X2+UNDER_25"], COMBO_12_OVER_25: ["12+OVER_25"], COMBO_12_UNDER_25: ["12+UNDER_25"], PREFERRED_DC_PLUS_CONSENSUS_OU: ["1X+OVER_25", "1X+UNDER_25", "X2+OVER_25", "X2+UNDER_25", "12+OVER_25", "12+UNDER_25"],
};

async function createOrReuseEvaluation(prisma: PrismaClient, specId: string, datasetId: string, extractionRunId: string) {
  const existing = await prisma.historicalEvaluationRun.findFirst({ where: { specId, extractionRunId, engineVersion: HISTORICAL_ENGINE_VERSION } });
  if (existing) {
    await prisma.$transaction([
      prisma.historicalEvaluationAttempt.create({ data: { specId, extractionRunId, evaluationRunId: existing.id, status: "REUSED", contextJson: canonicalJson({ engineVersion: HISTORICAL_ENGINE_VERSION, networkRequests: 0 }) } }),
      prisma.historicalAnalysisAuditEvent.create({ data: { specId, extractionRunId, evaluationRunId: existing.id, eventType: "REPLAY_REUSED", contextJson: canonicalJson({ layer: "EVALUATION", networkRequests: 0 }) } }),
    ]);
    return { run: existing, status: "REUSED" as const };
  }
  const [fixtureOutcomes, decisions, registry] = await Promise.all([
    prisma.fixtureOutcome.findMany({ where: { extractionRunId } }),
    prisma.matchDecision.findMany({ where: { status: "MATCHED", run: { datasetId, runType: "HISTORICAL_DATASET" } }, select: { id: true, forebetObservationId: true, statareaRowId: true, run: { select: { sportDate: true } } } }),
    prisma.semanticRegistry.findFirstOrThrow({ where: { registryHash: HISTORICAL_REGISTRY_HASH } }),
  ]);
  const forebetIds = decisions.map((value) => value.forebetObservationId!); const statareaIds = decisions.map((value) => value.statareaRowId!);
  const [forebetRows, statareaRows, assessment] = await Promise.all([
    prisma.forebetObservation.findMany({ where: { id: { in: forebetIds } } }),
    prisma.statareaRawRow.findMany({ where: { id: { in: statareaIds } } }),
    prisma.semanticAssessmentRun.findFirstOrThrow({ where: { registryId: registry.id, datasetId, manifestHash: HISTORICAL_MANIFEST_HASH }, orderBy: { createdAt: "desc" } }),
  ]);
  const projections = await prisma.statareaSemanticProjection.findMany({ where: { assessmentRunId: assessment.id, rawRowId: { in: statareaIds } } });
  const fMap = new Map(forebetRows.map((value) => [value.id, value])); const sMap = new Map(statareaRows.map((value) => [value.id, value])); const pMap = new Map(projections.map((value) => [value.rawRowId, value]));
  const predictions: JoinedPrediction[] = decisions.map((decision) => {
    const f = fMap.get(decision.forebetObservationId!)!; const s = sMap.get(decision.statareaRowId!)!; const p = pMap.get(decision.statareaRowId!)!; const sportsDate = dateOnly(decision.run.sportDate);
    if (!p?.ou25SemanticReady || !p.doubleChanceSemanticReady || !p.sourceHomeWinPercent || !p.sourceDrawPercent || !p.sourceAwayWinPercent || !p.sourceOver25Percent || !p.sourceDoubleChance1XPercent || !p.sourceDoubleChanceX2Percent || !p.sourceDoubleChance12Percent) throw new Error(`HISTORICAL_SEMANTIC_PROJECTION_NOT_READY:${decision.id}`);
    return { decisionId: decision.id, partition: sportsDate <= "2026-07-14" ? "DISCOVERY" : "VALIDATION", sportsDate, country: f.countryRaw ?? s.countryRaw, competition: f.competitionRaw ?? s.competitionRaw, forebet: { suggestedSide: f.suggestedSide, probabilityOver25: f.probabilityOver25, probabilityUnder25: f.probabilityUnder25, predictedHomeGoals: f.predictedHomeGoals, predictedAwayGoals: f.predictedAwayGoals, averageGoals: f.averageGoals }, statarea: { home: p.sourceHomeWinPercent, draw: p.sourceDrawPercent, away: p.sourceAwayWinPercent, over25: p.sourceOver25Percent, oneX: p.sourceDoubleChance1XPercent, x2: p.sourceDoubleChanceX2Percent, twelve: p.sourceDoubleChance12Percent } };
  });
  const outcomeMap = new Map(fixtureOutcomes.map((value) => [value.matchDecisionId, value]));
  const cases = buildPatternCases(predictions, outcomeMap);
  const definitions = await prisma.patternDefinition.findMany({ where: { specId } }); const definitionByCode = new Map(definitions.map((value) => [value.code, value]));
  const principalCounts = { DISCOVERY: fixtureOutcomes.filter((value) => value.partition === "DISCOVERY" && value.reconciliationStatus === "AGREED").length, VALIDATION: fixtureOutcomes.filter((value) => value.partition === "VALIDATION" && value.reconciliationStatus === "AGREED").length };
  const metrics: Array<{ id: string; patternCode: HistoricalPatternCode; patternDefinitionId: string; partition: string; segment: string; side: string; values: ReturnType<typeof calculateMetrics>; stability: string | null; details: Record<string, unknown> }> = [];
  for (const patternCode of Object.keys(fixedSides) as HistoricalPatternCode[]) for (const side of fixedSides[patternCode]) {
    for (const partition of ["DISCOVERY", "VALIDATION", "ALL_DESCRIPTIVE"] as const) {
      const baseCases = cases.filter((item) => item.principal && item.patternCode === patternCode && item.side === side && (partition === "ALL_DESCRIPTIVE" || item.partition === partition));
      const total = partition === "ALL_DESCRIPTIVE" ? principalCounts.DISCOVERY + principalCounts.VALIDATION : principalCounts[partition];
      const values = calculateMetrics(baseCases, total);
      const discoveryCases = cases.filter((item) => item.principal && item.patternCode === patternCode && item.side === side && item.partition === "DISCOVERY");
      const validationCases = cases.filter((item) => item.principal && item.patternCode === patternCode && item.side === side && item.partition === "VALIDATION");
      const discoveryRate = calculateMetrics(discoveryCases).hitRate; const validationRate = calculateMetrics(validationCases).hitRate;
      metrics.push({ id: randomUUID(), patternCode, patternDefinitionId: definitionByCode.get(patternCode)!.id, partition, segment: "ALL", side, values, stability: partition === "VALIDATION" ? stabilityClass(discoveryRate, validationRate) : null, details: { discoveryHitRate: numberOrNull(discoveryRate), validationHitRate: numberOrNull(validationRate), validationMinusDiscovery: discoveryRate && validationRate ? validationRate.minus(discoveryRate).toNumber() : null } });
      const observedSegments = [...new Set(baseCases.flatMap((item) => item.segments))];
      for (const segment of observedSegments) metrics.push({ id: randomUUID(), patternCode, patternDefinitionId: definitionByCode.get(patternCode)!.id, partition, segment, side, values: calculateMetrics(baseCases.filter((item) => item.segments.includes(segment)), total), stability: null, details: {} });
    }
    const sensitivity = cases.filter((item) => !item.principal && item.patternCode === patternCode && item.side === side);
    metrics.push({ id: randomUUID(), patternCode, patternDefinitionId: definitionByCode.get(patternCode)!.id, partition: "ALL_DESCRIPTIVE", segment: "SENSITIVITY_SOURCE_ONLY", side, values: calculateMetrics(sensitivity, sensitivity.length), stability: null, details: { separatedFromPrincipal: true } });
  }
  const calibration: Array<{ id: string; patternDefinitionId: string; patternCode: HistoricalPatternCode; partition: string; side: string; lower: Decimal; upper: Decimal; count: number; average: Decimal | null; observed: Decimal | null; difference: Decimal | null; warnings: string[] }> = [];
  for (const metric of metrics.filter((value) => value.segment === "ALL")) {
    const published = cases.filter((item) => item.principal && item.patternCode === metric.patternCode && item.side === metric.side && item.sourcePercent !== null && (metric.partition === "ALL_DESCRIPTIVE" || item.partition === metric.partition));
    if (!published.length) continue;
    for (const band of historicalAnalysisSpec.calibrationBands) {
      const items = published.filter((item) => calibrationBucket(item.sourcePercent!).code === band.code);
      const average = items.length ? items.reduce((sum, item) => sum.plus(item.sourcePercent!), new Decimal(0)).div(items.length) : null;
      const observed = items.length ? new Decimal(items.filter((item) => item.hit).length).div(items.length) : null;
      calibration.push({ id: randomUUID(), patternDefinitionId: metric.patternDefinitionId, patternCode: metric.patternCode, partition: metric.partition, side: metric.side, lower: new Decimal(band.lower), upper: new Decimal(band.upper), count: items.length, average, observed, difference: average && observed ? average.div(100).minus(observed) : null, warnings: items.length < 10 ? ["INSUFFICIENT_SAMPLE"] : items.length < 30 ? ["SMALL_SAMPLE"] : [] });
    }
  }
  const counts = { principalOutcomes: principalCounts.DISCOVERY + principalCounts.VALIDATION, discoveryOutcomes: principalCounts.DISCOVERY, validationOutcomes: principalCounts.VALIDATION, patternEvaluations: metrics.length, calibrationBuckets: calibration.length, signalCases: cases.filter((item) => item.principal).length, sensitivityCases: cases.filter((item) => !item.principal).length };
  const run = await prisma.$transaction(async (transaction) => {
    const created = await transaction.historicalEvaluationRun.create({ data: { specId, extractionRunId, datasetId, manifestHash: HISTORICAL_MANIFEST_HASH, registryHash: HISTORICAL_REGISTRY_HASH, engineVersion: HISTORICAL_ENGINE_VERSION, status: "COMPLETED", countsJson: canonicalJson(counts), warningsJson: canonicalJson([]) } });
    await transaction.patternEvaluation.createMany({ data: metrics.map((item) => ({ id: item.id, evaluationRunId: created.id, patternDefinitionId: item.patternDefinitionId, partition: item.partition, segment: item.segment, side: item.side, total: item.values.total, evaluable: item.values.evaluable, hits: item.values.hits, misses: item.values.misses, hitRate: item.values.hitRate, wilsonLower: item.values.wilsonLower, wilsonUpper: item.values.wilsonUpper, brierScore: item.values.brierScore, theoreticalBreakEvenOdds: item.values.theoreticalBreakEvenOdds, retainedSampleRate: item.values.retainedSampleRate, maxCountryShare: item.values.maxCountryShare, maxCompetitionShare: item.values.maxCompetitionShare, maxHitStreak: item.values.maxHitStreak, maxMissStreak: item.values.maxMissStreak, sampleClass: item.values.sampleClass, stabilityClass: item.stability, warningsJson: canonicalJson(item.values.warnings), detailsJson: canonicalJson(item.details) })) });
    await transaction.calibrationBucket.createMany({ data: calibration.map((item) => ({ id: item.id, evaluationRunId: created.id, patternDefinitionId: item.patternDefinitionId, partition: item.partition, side: item.side, lowerBound: item.lower, upperBound: item.upper, count: item.count, averageSourcePercent: item.average, observedFrequency: item.observed, calibrationDifference: item.difference, warningsJson: canonicalJson(item.warnings) })) });
    await transaction.historicalEvaluationAttempt.create({ data: { specId, extractionRunId, evaluationRunId: created.id, status: "CREATED", contextJson: canonicalJson({ counts, networkRequests: 0 }) } });
    await transaction.historicalAnalysisAuditEvent.createMany({ data: [
      { specId, extractionRunId, evaluationRunId: created.id, eventType: "EVALUATION_STARTED", contextJson: canonicalJson({ engineVersion: HISTORICAL_ENGINE_VERSION }) },
      ...metrics.filter((item) => item.segment === "ALL").map((item) => ({ specId, extractionRunId, evaluationRunId: created.id, eventType: "PATTERN_EVALUATED", contextJson: canonicalJson({ patternCode: item.patternCode, partition: item.partition, side: item.side, evaluable: item.values.evaluable }) })),
      { specId, extractionRunId, evaluationRunId: created.id, eventType: "CALIBRATION_GENERATED", contextJson: canonicalJson({ buckets: calibration.length }) },
      { specId, extractionRunId, evaluationRunId: created.id, eventType: "VALIDATION_EVALUATED", contextJson: canonicalJson({ outcomes: principalCounts.VALIDATION, patternsFrozen: true }) },
    ] });
    return created;
  }, { timeout: 30_000 });
  return { run, status: "CREATED" as const };
}

async function generateExports(prisma: PrismaClient, specId: string, extractionRunId: string, evaluationRunId: string) {
  const [fixtureRows, evidenceRows, metricRows, calibrationRows, definitions, auditRows] = await Promise.all([
    prisma.fixtureOutcome.findMany({ where: { extractionRunId }, orderBy: [{ partition: "asc" }, { matchDecisionId: "asc" }] }),
    prisma.outcomeEvidence.findMany({ where: { extractionRunId }, orderBy: [{ source: "asc" }, { sportsDate: "asc" }, { sourceRecordId: "asc" }] }),
    prisma.patternEvaluation.findMany({ where: { evaluationRunId }, orderBy: [{ partition: "asc" }, { patternDefinitionId: "asc" }, { side: "asc" }, { segment: "asc" }] }),
    prisma.calibrationBucket.findMany({ where: { evaluationRunId }, orderBy: [{ partition: "asc" }, { patternDefinitionId: "asc" }, { side: "asc" }, { lowerBound: "asc" }] }),
    prisma.patternDefinition.findMany({ where: { specId } }),
    prisma.historicalAnalysisAuditEvent.findMany({ where: { OR: [{ specId }, { extractionRunId }, { evaluationRunId }] }, orderBy: { createdAt: "asc" } }),
  ]);
  const definitionById = new Map(definitions.map((value) => [value.id, value]));
  const countStatus = (status: string) => fixtureRows.filter((row) => row.reconciliationStatus === status).length;
  const outcomeCounts = { total: 98 as const, agreed: countStatus("AGREED"), forebetOnly: countStatus("FOREBET_ONLY"), statareaOnly: countStatus("STATAREA_ONLY"), conflict: countStatus("CONFLICT"), missing: countStatus("MISSING"), unsupported: countStatus("UNSUPPORTED") };
  const outcomeContract = {
    contractVersion: FIXTURE_OUTCOMES_CONTRACT_VERSION,
    spec: { code: HISTORICAL_ANALYSIS_CODE, version: HISTORICAL_ANALYSIS_VERSION, specHash: HISTORICAL_ANALYSIS_SPEC_HASH },
    dataset: { code: HISTORICAL_DATASET_CODE, manifestHash: HISTORICAL_MANIFEST_HASH, registryHash: HISTORICAL_REGISTRY_HASH }, extractionRunId, counts: outcomeCounts,
    outcomes: fixtureRows.map((row) => ({ matchDecisionId: row.matchDecisionId, partition: row.partition, reconciliationStatus: row.reconciliationStatus, forebetEvidenceId: row.forebetOutcomeEvidenceId, statareaEvidenceId: row.statareaOutcomeEvidenceId, homeGoals: row.homeGoals, awayGoals: row.awayGoals, totalGoals: row.totalGoals, result1X2: row.result1X2, ou25Outcome: row.ou25Outcome, doubleChance1XOutcome: row.doubleChance1XOutcome, doubleChanceX2Outcome: row.doubleChanceX2Outcome, doubleChance12Outcome: row.doubleChance12Outcome, warnings: JSON.parse(row.warningsJson) as string[] })), warnings: outcomeCounts.agreed === 98 ? [] : ["PRINCIPAL_SAMPLE_REDUCED"],
  };
  fixtureOutcomesSchema.parse(outcomeContract); const outcomeAjv = validateContract(fixtureOutcomesJsonSchema, outcomeContract); if (!outcomeAjv.valid) throw new Error(`FIXTURE_OUTCOMES_AJV_INVALID:${JSON.stringify(outcomeAjv.errors)}`);
  const metricExport = (partition: "DISCOVERY" | "VALIDATION" | "ALL_DESCRIPTIVE") => {
    const contract = { contractVersion: PATTERN_EVALUATION_CONTRACT_VERSION, specHash: HISTORICAL_ANALYSIS_SPEC_HASH, evaluationRunId, partition, evaluations: metricRows.filter((row) => row.partition === partition && row.segment === "ALL").map((row) => ({ patternCode: definitionById.get(row.patternDefinitionId)!.code, side: row.side, segment: row.segment, total: row.total, evaluable: row.evaluable, hits: row.hits, misses: row.misses, hitRate: numberOrNull(row.hitRate), wilsonLower: numberOrNull(row.wilsonLower), wilsonUpper: numberOrNull(row.wilsonUpper), brierScore: numberOrNull(row.brierScore), theoreticalBreakEvenOdds: numberOrNull(row.theoreticalBreakEvenOdds), sampleClass: row.sampleClass, warnings: JSON.parse(row.warningsJson) as string[] })), disclaimer: "La cuota teórica no representa rentabilidad real ni cuota de valor." as const };
    patternEvaluationSchema.parse(contract); const ajv = validateContract(patternEvaluationJsonSchema, contract); if (!ajv.valid) throw new Error(`PATTERN_EVALUATION_AJV_INVALID:${JSON.stringify(ajv.errors)}`); return contract;
  };
  const discovery = metricExport("DISCOVERY"); const validation = metricExport("VALIDATION"); const all = metricExport("ALL_DESCRIPTIVE");
  const rowsWithCode = metricRows.map((row) => ({ ...row, patternCode: definitionById.get(row.patternDefinitionId)!.code, warnings: JSON.parse(row.warningsJson) as string[], details: JSON.parse(row.detailsJson) as Record<string, unknown> }));
  const simple = (row: typeof rowsWithCode[number]) => ({ patternCode: row.patternCode, partition: row.partition, segment: row.segment, side: row.side, total: row.total, evaluable: row.evaluable, hits: row.hits, misses: row.misses, hitRate: numberOrNull(row.hitRate), wilsonLower: numberOrNull(row.wilsonLower), wilsonUpper: numberOrNull(row.wilsonUpper), brierScore: numberOrNull(row.brierScore), theoreticalBreakEvenOdds: numberOrNull(row.theoreticalBreakEvenOdds), retainedSampleRate: numberOrNull(row.retainedSampleRate), maxCountryShare: numberOrNull(row.maxCountryShare), maxCompetitionShare: numberOrNull(row.maxCompetitionShare), maxHitStreak: row.maxHitStreak, maxMissStreak: row.maxMissStreak, sampleClass: row.sampleClass, stabilityClass: row.stabilityClass, warnings: row.warnings, details: row.details });
  const allSimple = rowsWithCode.map(simple); const base = rowsWithCode.filter((row) => row.segment === "ALL").map(simple);
  const discoveryControl = rowsWithCode.filter((row) => row.partition === "DISCOVERY" && row.segment === "ALL"); const validationControl = rowsWithCode.filter((row) => row.partition === "VALIDATION" && row.segment === "ALL");
  const lift = ["OVER_25", "UNDER_25"].map((side) => {
    const rate = (rows: typeof rowsWithCode, code: string) => rows.find((row) => row.patternCode === code && row.side === side)?.hitRate ?? null;
    return { side, discovery: numberOrNull(consensusLift(rate(discoveryControl, "OU25_CONSENSUS_SIMPLE"), rate(discoveryControl, "FOREBET_OU25_CONTROL"), rate(discoveryControl, "STATAREA_OU25_CONTROL"))), validation: numberOrNull(consensusLift(rate(validationControl, "OU25_CONSENSUS_SIMPLE"), rate(validationControl, "FOREBET_OU25_CONTROL"), rate(validationControl, "STATAREA_OU25_CONTROL"))) };
  });
  const calibration = calibrationRows.map((row) => ({ patternCode: definitionById.get(row.patternDefinitionId)!.code, partition: row.partition, side: row.side, lowerBound: row.lowerBound.toNumber(), upperBound: row.upperBound.toNumber(), count: row.count, averageSourcePercent: numberOrNull(row.averageSourcePercent), observedFrequency: numberOrNull(row.observedFrequency), calibrationDifference: numberOrNull(row.calibrationDifference), warnings: JSON.parse(row.warningsJson) as string[] }));
  const stableAuditRows = auditRows.filter((row) => !["EXPORT_GENERATED", "REPLAY_REUSED", "SPEC_REUSED"].includes(row.eventType));
  const bundle = {
    "analysis-spec.json": historicalAnalysisSpec,
    "outcome-evidence-summary.json": { contractVersion: "outcome-evidence-summary/1.0", extractionRunId, total: evidenceRows.length, bySource: { FOREBET: evidenceRows.filter((row) => row.source === "FOREBET").length, STATAREA: evidenceRows.filter((row) => row.source === "STATAREA").length }, byParseStatus: Object.fromEntries(["PARSED", "MISSING", "UNSUPPORTED"].map((status) => [status, evidenceRows.filter((row) => row.parseStatus === status).length])), extractorVersions: [FOREBET_RESULT_EXTRACTOR_VERSION, STATAREA_RESULT_EXTRACTOR_VERSION], networkRequests: 0 },
    "outcome-conflicts.json": { extractionRunId, outcomes: outcomeContract.outcomes.filter((row) => row.reconciliationStatus === "CONFLICT") },
    "fixture-outcomes.json": outcomeContract,
    "ou25-source-controls.json": { evaluationRunId, metrics: base.filter((row) => ["FOREBET_OU25_CONTROL", "STATAREA_OU25_CONTROL"].includes(row.patternCode)) },
    "ou25-consensus.json": { evaluationRunId, metrics: base.filter((row) => row.patternCode.startsWith("OU25_CONSENSUS")), lift },
    "forebet-confluences.json": { evaluationRunId, metrics: base.filter((row) => row.patternCode.startsWith("FOREBET_") && row.patternCode.endsWith("CONFLUENCE")) },
    "double-chance-lines.json": { evaluationRunId, metrics: base.filter((row) => row.patternCode.startsWith("DOUBLE_CHANCE_")) },
    "preferred-double-chance.json": { evaluationRunId, metrics: base.filter((row) => row.patternCode === "PREFERRED_DOUBLE_CHANCE") },
    "same-match-combinations.json": { evaluationRunId, metrics: base.filter((row) => row.patternCode.startsWith("COMBO_") || row.patternCode === "PREFERRED_DC_PLUS_CONSENSUS_OU"), jointProbabilitiesCalculated: false },
    "favorite-segments.json": { evaluationRunId, metrics: allSimple.filter((row) => row.segment.includes("FAVORITE") || row.segment.includes("BALANCED")) },
    "discovery-metrics.json": discovery,
    "validation-metrics.json": validation,
    "discovery-validation-comparison.json": { evaluationRunId, lift, comparisons: base.filter((row) => row.partition === "VALIDATION").map((row) => ({ patternCode: row.patternCode, side: row.side, stabilityClass: row.stabilityClass, details: row.details })) },
    "calibration.json": { evaluationRunId, buckets: calibration },
    "brier.json": { evaluationRunId, metrics: base.filter((row) => row.brierScore !== null).map((row) => ({ patternCode: row.patternCode, partition: row.partition, side: row.side, brierScore: row.brierScore })) },
    "wilson.json": { evaluationRunId, metrics: base.map((row) => ({ patternCode: row.patternCode, partition: row.partition, side: row.side, lower: row.wilsonLower, upper: row.wilsonUpper })) },
    "concentration.json": { evaluationRunId, metrics: base.map((row) => ({ patternCode: row.patternCode, partition: row.partition, side: row.side, country: row.maxCountryShare, competition: row.maxCompetitionShare, warnings: row.warnings.filter((warning) => warning.includes("CONCENTRATION")) })) },
    "streaks.json": { evaluationRunId, metrics: base.map((row) => ({ patternCode: row.patternCode, partition: row.partition, side: row.side, hit: row.maxHitStreak, miss: row.maxMissStreak })) },
    "warnings.json": { evaluationRunId, warnings: base.filter((row) => row.warnings.length).map((row) => ({ patternCode: row.patternCode, partition: row.partition, side: row.side, warnings: row.warnings })) },
    "audit-summary.json": { specHash: HISTORICAL_ANALYSIS_SPEC_HASH, extractionRunId, evaluationRunId, events: Object.fromEntries([...new Set(stableAuditRows.map((row) => row.eventType))].map((eventType) => [eventType, stableAuditRows.filter((row) => row.eventType === eventType).length])), contracts: { ajv: true, zod: true, canonical: true }, networkRequests: 0, prohibitedOutputs: { score: 0, ranking: 0, recommendations: 0, stake: 0, multiMatchParlays: 0 } },
  };
  const exports = await preserveHistoricalExports(bundle);
  const created = exports.files.filter((file) => file.status === "CREATED");
  if (created.length) await prisma.historicalAnalysisAuditEvent.createMany({ data: created.map((file) => ({ specId, extractionRunId, evaluationRunId, eventType: "EXPORT_GENERATED", contextJson: canonicalJson({ file: file.file, bytes: file.bytes, writeOnce: true }) })) });
  return { exports, outcomeContract, discovery, validation, all, calibration, lift };
}

export async function evaluateHistoricalMarkets(prisma: PrismaClient, request: { dataset: string; specVersion: string }) {
  if (request.dataset !== HISTORICAL_DATASET_CODE || request.specVersion !== HISTORICAL_ANALYSIS_VERSION) throw new Error("HISTORICAL_EVALUATION_REQUEST_NOT_ALLOWED");
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({ where: { code_version: { code: HISTORICAL_DATASET_CODE, version: HISTORICAL_DATASET_VERSION } } });
  await prisma.historicalDatasetState.findFirstOrThrow({ where: { datasetId: dataset.id, status: "FROZEN", manifestHash: HISTORICAL_MANIFEST_HASH }, orderBy: { createdAt: "desc" } });
  await prisma.semanticRegistry.findFirstOrThrow({ where: { registryHash: HISTORICAL_REGISTRY_HASH } });
  const spec = await prisma.historicalAnalysisSpec.findFirstOrThrow({ where: { code: HISTORICAL_ANALYSIS_CODE, version: request.specVersion, datasetId: dataset.id, status: "FROZEN_SPEC" } });
  if (spec.specHash !== HISTORICAL_ANALYSIS_SPEC_HASH || spec.manifestHash !== HISTORICAL_MANIFEST_HASH || spec.registryHash !== HISTORICAL_REGISTRY_HASH || canonicalHash(JSON.parse(spec.canonicalSpecJson)) !== spec.specHash) throw new Error("HISTORICAL_FROZEN_SPEC_INTEGRITY_FAILURE");
  const extraction = await createOrReuseExtraction(prisma, spec.id, dataset.id);
  const evaluation = await createOrReuseEvaluation(prisma, spec.id, dataset.id, extraction.run.id);
  const exports = await generateExports(prisma, spec.id, extraction.run.id, evaluation.run.id);
  return { executionStatus: extraction.status === "REUSED" && evaluation.status === "REUSED" ? "REUSED" as const : "CREATED" as const, specId: spec.id, specHash: spec.specHash, extractionRunId: extraction.run.id, extractionStatus: extraction.status, evaluationRunId: evaluation.run.id, evaluationStatus: evaluation.status, extractionCounts: JSON.parse(extraction.run.countsJson), evaluationCounts: JSON.parse(evaluation.run.countsJson), exports: exports.exports, networkRequests: 0 };
}
