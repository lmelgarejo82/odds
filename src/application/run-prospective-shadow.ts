import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import type { ForebetHttpResponse } from "@/infrastructure/forebet/http-client";
import type { LegacyStatareaHttpResponse } from "@/infrastructure/statarea/legacy-http-client";
import { captureForebetOu25 } from "@/application/capture-forebet";
import { captureLegacyStatarea } from "@/application/capture-statarea-legacy";
import {
  prospectiveFixtureAssessmentDocumentSchema,
  prospectiveShadowRunDocumentSchema,
  quoteRequestPlanDocumentSchema,
  type ProspectiveFixtureAssessment,
  type ProspectiveFixtureAssessmentDocument,
  type ProspectiveShadowRunDocument,
  type QuoteRequest,
  type QuoteRequestPlanDocument,
} from "@/contracts/prospective";
import runJsonSchema from "@/contracts/schemas/prospective-shadow-run.schema.json";
import assessmentJsonSchema from "@/contracts/schemas/prospective-fixture-assessment.schema.json";
import quoteJsonSchema from "@/contracts/schemas/quote-request-plan.schema.json";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import { HISTORICAL_DATASET_CODE, HISTORICAL_DATASET_VERSION, HISTORICAL_MANIFEST_HASH, HISTORICAL_REGISTRY_HASH } from "@/domain/historical-analysis/constants";
import { HISTORICAL_ANALYSIS_SPEC_HASH, MARKET_PRIORITY_POLICY_CODE, MARKET_PRIORITY_POLICY_STATUS, MARKET_PRIORITY_POLICY_VERSION } from "@/domain/market-priority/constants";
import { marketPriorityPolicy, marketPriorityPolicyHash } from "@/domain/market-priority/policy";
import { buildB008DominanceDiagnostic } from "@/domain/prospective/dominance-diagnostic";
import { buildProspectiveFixture, type ProspectiveAggregateMetric } from "@/domain/prospective/engine";
import {
  PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION,
  PROSPECTIVE_EXPORT_ROOT,
  PROSPECTIVE_MODE,
  PROSPECTIVE_RUN_CONTRACT_VERSION,
  PROSPECTIVE_SPORTS_DATE,
  PROSPECTIVE_STATUS,
  PROSPECTIVE_WARNINGS,
  QUOTE_REQUEST_PLAN_CONTRACT_VERSION,
  assertFrozenBeforeSportsDate,
  validateProspectiveDate,
} from "@/domain/prospective/constants";
import { projectProspectiveSemanticRow } from "@/domain/prospective/semantic-projection";
import { MATCH_CONFIGURATION, MATCH_CONFIGURATION_HASH, MATCHER_VERSION, NORMALIZER_VERSION } from "@/domain/reconciliation/configuration";
import { reconcileIdentities } from "@/domain/reconciliation/matcher";
import { FOREBET_PARSER_VERSION } from "@/domain/forebet/constants";
import { STATAREA_LEGACY_PARSER_VERSION } from "@/domain/statarea/legacy-constants";
import { withMarketPriorityOfflineGuard } from "@/infrastructure/market-priority/offline-guard";
import { createOutcomeAccessGuard } from "@/infrastructure/market-priority/outcome-access-guard";
import { preserveProspectiveExports } from "@/infrastructure/prospective/export-store";

type Dependencies = Readonly<{
  prisma: PrismaClient;
  now?: () => Date;
  forebetFetcher?: (date: string) => Promise<ForebetHttpResponse>;
  statareaFetcher?: (date: string) => Promise<LegacyStatareaHttpResponse>;
}>;
type ProspectiveCounts = ProspectiveShadowRunDocument["run"]["counts"];

const dateValue = (date: string) => new Date(`${date}T00:00:00.000Z`);
const numberOrNull = (value: { toNumber(): number } | null | undefined) => value == null ? null : value.toNumber();
const deterministicId = (prefix: string, identity: unknown) => `${prefix}_${canonicalHash(identity).slice(0, 24)}`;
const identitySelect = { id: true, homeTeamRaw: true, awayTeamRaw: true, competitionRaw: true, countryRaw: true, categoryRaw: true } as const;

function assertAjv(schema: object, value: unknown, label: string) {
  const result = validateContract(schema, value);
  if (!result.valid) throw new Error(`${label}_AJV_INVALID:${JSON.stringify(result.errors)}`);
}

function matchingQuality(stage: string | undefined) {
  return stage === "EXACT" ? "EXACT" as const : stage === "CONSERVATIVE" ? "CONSERVATIVE" as const : "APPROXIMATE" as const;
}

async function fixedForebet(prisma: PrismaClient) {
  const attempt = await prisma.forebetCaptureAttempt.findFirst({ where: { requestedDate: dateValue(PROSPECTIVE_SPORTS_DATE), status: { in: ["SUCCEEDED", "PARTIAL", "REUSED"] }, snapshotId: { not: null } }, orderBy: { capturedAt: "asc" }, include: { snapshot: true } });
  return attempt?.snapshot ? { snapshot: attempt.snapshot, attempt } : null;
}

async function fixedLegacyStatarea(prisma: PrismaClient) {
  const profile = await prisma.statareaSnapshotProfile.findFirst({ where: { sourcePresentation: "LEGACY_OFFICIAL", parserVersion: STATAREA_LEGACY_PARSER_VERSION, snapshot: { requestedDate: dateValue(PROSPECTIVE_SPORTS_DATE) } }, include: { snapshot: true }, orderBy: { createdAt: "asc" } });
  if (!profile) return null;
  const attempt = await prisma.statareaCaptureAttempt.findFirst({ where: { snapshotId: profile.snapshotId, status: { in: ["SUCCEEDED", "PARTIAL", "REUSED"] } }, orderBy: { capturedAt: "asc" } });
  if (!attempt) throw new Error("PROSPECTIVE_STATAREA_SNAPSHOT_WITHOUT_VALID_ATTEMPT");
  return { snapshot: profile.snapshot, profile, attempt };
}

async function captureOrReuseSources(dependencies: Dependencies) {
  const { prisma } = dependencies;
  let networkRequests = 0;
  let forebet = await fixedForebet(prisma);
  if (!forebet) {
    networkRequests++;
    await captureForebetOu25(PROSPECTIVE_SPORTS_DATE, { prisma, fetcher: dependencies.forebetFetcher });
    forebet = await fixedForebet(prisma);
  }
  if (!forebet || forebet.snapshot.validRows < 1 || forebet.snapshot.parserVersion !== FOREBET_PARSER_VERSION) throw new Error("PROSPECTIVE_FOREBET_VALID_CAPTURE_REQUIRED");
  let statarea = await fixedLegacyStatarea(prisma);
  if (!statarea) {
    networkRequests++;
    await captureLegacyStatarea(PROSPECTIVE_SPORTS_DATE, { prisma, fetcher: dependencies.statareaFetcher });
    statarea = await fixedLegacyStatarea(prisma);
  }
  if (!statarea || statarea.snapshot.validRows < 1 || statarea.profile.sourcePresentation !== "LEGACY_OFFICIAL" || statarea.profile.parserVersion !== STATAREA_LEGACY_PARSER_VERSION || statarea.profile.requestedUrl !== `https://old.statarea.com/predictions/${PROSPECTIVE_SPORTS_DATE}` || statarea.profile.finalUrl !== statarea.profile.requestedUrl) throw new Error("PROSPECTIVE_STATAREA_LEGACY_VALID_CAPTURE_REQUIRED");
  return { forebet, statarea, networkRequests };
}

async function createOrReuseProspectiveMatchRun(prisma: PrismaClient, forebet: { id: string; contentHash: string }, statarea: { id: string; contentHash: string }) {
  const identity = { sportDate: dateValue(PROSPECTIVE_SPORTS_DATE), forebetSnapshotId: forebet.id, statareaSnapshotId: statarea.id, matcherVersion: MATCHER_VERSION, normalizerVersion: NORMALIZER_VERSION, configurationHash: MATCH_CONFIGURATION_HASH, runType: "PROSPECTIVE_SHADOW" as const };
  const existing = await prisma.matchRun.findUnique({ where: { sportDate_forebetSnapshotId_statareaSnapshotId_matcherVersion_normalizerVersion_configurationHash_runType: identity } });
  if (existing) {
    if (existing.matchedCount < 1) throw new Error("PROSPECTIVE_MATCHED_COUNT_ZERO");
    await prisma.matchRunAttempt.create({ data: { runId: existing.id, status: "REUSED" } });
    return { run: existing, executionStatus: "REUSED" as const };
  }
  const [forebetRows, statareaRows] = await Promise.all([
    prisma.forebetObservation.findMany({ where: { snapshotId: forebet.id }, select: identitySelect, orderBy: { id: "asc" } }),
    prisma.statareaRawRow.findMany({ where: { snapshotId: statarea.id }, select: identitySelect, orderBy: { id: "asc" } }),
  ]);
  const result = reconcileIdentities(forebetRows, statareaRows);
  const count = (status: string) => result.decisions.filter((decision) => decision.status === status).length;
  if (count("MATCHED") < 1) throw new Error("PROSPECTIVE_MATCHED_COUNT_ZERO");
  const runId = deterministicId("pmr", identity);
  const candidateIds = new Map(result.candidates.map((candidate) => [candidate.key, deterministicId("pmc", { runId, key: candidate.key })]));
  const selectedStages = result.decisions.filter((decision) => decision.status === "MATCHED").map((decision) => result.candidates.find((candidate) => candidate.key === decision.candidateKey)?.stage);
  await prisma.$transaction(async (transaction) => {
    await transaction.matchRun.create({ data: { id: runId, ...identity, datasetId: null, forebetSha256: forebet.contentHash, statareaSha256: statarea.contentHash, configurationJson: canonicalJson(MATCH_CONFIGURATION), status: "COMPLETED", forebetInputCount: forebetRows.length, statareaInputCount: statareaRows.length, matchedCount: count("MATCHED"), ambiguousCount: count("AMBIGUOUS"), onlyForebetCount: count("ONLY_FOREBET"), onlyStatareaCount: count("ONLY_STATAREA"), conflictCount: count("CONFLICT"), exactCount: selectedStages.filter((stage) => stage === "EXACT").length, conservativeCount: selectedStages.filter((stage) => stage === "CONSERVATIVE").length, approximateCount: selectedStages.filter((stage) => stage === "APPROXIMATE").length, warningsJson: canonicalJson([]), exportPath: `${PROSPECTIVE_EXPORT_ROOT}/match-summary.json` } });
    if (result.candidates.length) await transaction.matchCandidate.createMany({ data: result.candidates.map((candidate) => ({ id: candidateIds.get(candidate.key)!, runId, forebetObservationId: candidate.forebetId, statareaRowId: candidate.statareaId, orientation: candidate.orientation, homeScore: candidate.homeScore, awayScore: candidate.awayScore, competitionEvidence: candidate.competitionEvidence, countryEvidence: candidate.countryEvidence, categoryEvidence: candidate.categoryEvidence, aggregateScore: candidate.aggregateScore, marginToSecond: candidate.marginToSecond, stage: candidate.stage, evidenceJson: canonicalJson(candidate.evidence), rejectionReasonsJson: canonicalJson(candidate.rejectionReasons), rank: candidate.rank })) });
    await transaction.matchDecision.createMany({ data: result.decisions.map((decision) => ({ id: deterministicId("pmd", { runId, forebetId: decision.forebetId, statareaId: decision.statareaId, status: decision.status }), runId, status: decision.status, forebetObservationId: decision.forebetId, statareaRowId: decision.statareaId, selectedCandidateId: decision.candidateKey ? candidateIds.get(decision.candidateKey) ?? null : null, reasonCode: decision.reasonCode, reasonsJson: canonicalJson(decision.reasons), warningsJson: canonicalJson(decision.warnings), confidenceClass: decision.confidenceClass })) });
    await transaction.matchRunAttempt.create({ data: { runId, status: "CREATED" } });
    await transaction.matchAuditEvent.create({ data: { runId, eventType: "PROSPECTIVE_MATCHING_COMPLETED", detailsJson: canonicalJson({ sportsDate: PROSPECTIVE_SPORTS_DATE, matcherVersion: MATCHER_VERSION, normalizerVersion: NORMALIZER_VERSION, configurationHash: MATCH_CONFIGURATION_HASH, matched: count("MATCHED"), aliases: 0, forcedMatches: 0 }) } });
  });
  return { run: await prisma.matchRun.findUniqueOrThrow({ where: { id: runId } }), executionStatus: "CREATED" as const };
}

async function frozenReferences(prisma: PrismaClient) {
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({ where: { code_version: { code: HISTORICAL_DATASET_CODE, version: HISTORICAL_DATASET_VERSION } } });
  const state = await prisma.historicalDatasetState.findFirstOrThrow({ where: { datasetId: dataset.id, status: "FROZEN" }, orderBy: { createdAt: "desc" } });
  const registry = await prisma.semanticRegistry.findFirstOrThrow({ where: { registryHash: HISTORICAL_REGISTRY_HASH } });
  const spec = await prisma.historicalAnalysisSpec.findFirstOrThrow({ where: { datasetId: dataset.id, specHash: HISTORICAL_ANALYSIS_SPEC_HASH, status: "FROZEN_SPEC" } });
  const policy = await prisma.marketPriorityPolicy.findUniqueOrThrow({ where: { code_version: { code: MARKET_PRIORITY_POLICY_CODE, version: MARKET_PRIORITY_POLICY_VERSION } } });
  if (state.manifestHash !== HISTORICAL_MANIFEST_HASH || registry.registryHash !== HISTORICAL_REGISTRY_HASH || spec.specHash !== HISTORICAL_ANALYSIS_SPEC_HASH || policy.status !== MARKET_PRIORITY_POLICY_STATUS || policy.priorityPolicyHash !== marketPriorityPolicyHash || canonicalHash(JSON.parse(policy.canonicalPolicyJson)) !== marketPriorityPolicyHash || canonicalHash(marketPriorityPolicy) !== marketPriorityPolicyHash) throw new Error("PROSPECTIVE_FROZEN_REFERENCE_MISMATCH");
  const evaluation = await prisma.historicalEvaluationRun.findFirstOrThrow({ where: { specId: spec.id, datasetId: dataset.id, manifestHash: HISTORICAL_MANIFEST_HASH, registryHash: HISTORICAL_REGISTRY_HASH, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
  const definitions = await prisma.patternDefinition.findMany({ where: { specId: spec.id } });
  const codeById = new Map(definitions.map((definition) => [definition.id, definition.code]));
  const rows = await prisma.patternEvaluation.findMany({ where: { evaluationRunId: evaluation.id, partition: "VALIDATION", segment: "ALL" } });
  const metrics: ProspectiveAggregateMetric[] = rows.map((row) => ({ patternCode: codeById.get(row.patternDefinitionId) ?? "UNKNOWN", side: row.side, validationN: row.evaluable, validationHitRate: numberOrNull(row.hitRate), validationWilsonLower: numberOrNull(row.wilsonLower), stabilityClass: row.stabilityClass, maxCountryShare: numberOrNull(row.maxCountryShare), maxCompetitionShare: numberOrNull(row.maxCompetitionShare), warnings: JSON.parse(row.warningsJson) as string[] }));
  return { dataset, registry, spec, policy, evaluation, metricByKey: new Map(metrics.map((metric) => [`${metric.patternCode}|${metric.side}`, metric])) };
}

async function dominanceDiagnostic(prisma: PrismaClient) {
  const assessment = await prisma.marketPriorityAssessmentRun.findFirstOrThrow({ where: { policy: { priorityPolicyHash: marketPriorityPolicyHash }, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
  const [candidates, decisions] = await Promise.all([
    prisma.fixtureMarketCandidate.findMany({ where: { assessmentRunId: assessment.id } }),
    prisma.fixturePreferredLineDecision.findMany({ where: { assessmentRunId: assessment.id } }),
  ]);
  return buildB008DominanceDiagnostic(candidates.map((candidate) => ({ id: candidate.id, family: candidate.family, marketCode: candidate.marketCode, signalScore: candidate.signalScore.toNumber(), historicalEvidenceScore: candidate.historicalEvidenceScore.toNumber(), dataQualityScore: candidate.dataQualityScore.toNumber(), finalPriorityScore: candidate.finalPriorityScore.toNumber(), caps: JSON.parse(candidate.capsJson) as Array<{ maximum: number }> })), decisions.map((decision) => ({ selectedCandidateId: decision.selectedCandidateId, topCandidateId: decision.topCandidateId })));
}

async function sourceCaptureSummary(prisma: PrismaClient, run: { forebetSnapshotId: string; statareaSnapshotId: string }) {
  const [forebet, statarea, profile, forebetAttempt, statareaAttempt] = await Promise.all([
    prisma.forebetCaptureSnapshot.findUniqueOrThrow({ where: { id: run.forebetSnapshotId } }),
    prisma.statareaCaptureSnapshot.findUniqueOrThrow({ where: { id: run.statareaSnapshotId } }),
    prisma.statareaSnapshotProfile.findUniqueOrThrow({ where: { snapshotId: run.statareaSnapshotId } }),
    prisma.forebetCaptureAttempt.findFirstOrThrow({ where: { snapshotId: run.forebetSnapshotId }, orderBy: { capturedAt: "asc" } }),
    prisma.statareaCaptureAttempt.findFirstOrThrow({ where: { snapshotId: run.statareaSnapshotId }, orderBy: { capturedAt: "asc" } }),
  ]);
  return {
    sportsDate: PROSPECTIVE_SPORTS_DATE,
    resultsPersisted: false,
    forebet: { source: "FOREBET", status: "FIXED_CAPTURE", snapshotId: forebet.id, requestedUrl: forebetAttempt.requestedUrl, finalUrl: forebetAttempt.finalUrl, httpStatus: forebetAttempt.httpStatus, contentType: forebetAttempt.contentType, capturedAt: forebetAttempt.capturedAt.toISOString(), byteSize: forebetAttempt.byteSize, sha256: forebet.contentHash, evidencePath: forebet.evidencePath, parserVersion: forebet.parserVersion, rowsFound: forebet.rowsFound, validRows: forebet.validRows, rejectedRows: forebet.rejectedRows, warnings: forebet.warningCount },
    statarea: { source: "STATAREA", sourcePresentation: profile.sourcePresentation, status: "FIXED_CAPTURE", snapshotId: statarea.id, requestedUrl: statareaAttempt.requestedUrl, finalUrl: statareaAttempt.finalUrl, httpStatus: statareaAttempt.httpStatus, contentType: statareaAttempt.contentType, capturedAt: statareaAttempt.capturedAt.toISOString(), byteSize: statareaAttempt.byteSize, sha256: statarea.contentHash, evidencePath: statarea.evidencePath, parserVersion: statarea.parserVersion, rowsFound: statarea.rowsFound, validRows: statarea.validRows, rejectedRows: statarea.rejectedRows, warnings: statarea.warningCount, fallbackUsed: false, resultsPersisted: false },
  };
}

async function buildExportBundle(prisma: PrismaClient, runId: string) {
  const run = await prisma.prospectiveShadowRun.findUniqueOrThrow({ where: { id: runId }, include: { semanticProjections: true, candidates: true, fixtureAssessments: true, quoteRequests: true } });
  const [forebetSnapshot, statareaSnapshot, profile, matchRun, diagnostic, captures] = await Promise.all([
    prisma.forebetCaptureSnapshot.findUniqueOrThrow({ where: { id: run.forebetSnapshotId } }),
    prisma.statareaCaptureSnapshot.findUniqueOrThrow({ where: { id: run.statareaSnapshotId } }),
    prisma.statareaSnapshotProfile.findUniqueOrThrow({ where: { snapshotId: run.statareaSnapshotId } }),
    prisma.matchRun.findUniqueOrThrow({ where: { id: run.matchRunId } }),
    dominanceDiagnostic(prisma),
    sourceCaptureSummary(prisma, run),
  ]);
  const runWithoutHash = {
    id: run.id,
    sportsDate: PROSPECTIVE_SPORTS_DATE as typeof PROSPECTIVE_SPORTS_DATE,
    mode: PROSPECTIVE_MODE as typeof PROSPECTIVE_MODE,
    status: "FROZEN" as const,
    forebetSnapshot: { id: forebetSnapshot.id, sha256: forebetSnapshot.contentHash, parserVersion: forebetSnapshot.parserVersion },
    statareaSnapshot: { id: statareaSnapshot.id, sha256: statareaSnapshot.contentHash, parserVersion: statareaSnapshot.parserVersion, sourcePresentation: "LEGACY_OFFICIAL" as const },
    matchRunId: run.matchRunId,
    matcherVersion: run.matcherVersion as "ou25-fixture-matcher/1.0.0",
    normalizerVersion: run.normalizerVersion as "ou25-identity-normalizer/1.0.0",
    matcherConfigurationHash: run.matcherConfigurationHash,
    registry: { code: "STATAREA-LEGACY-SEMANTIC-REGISTRY" as const, version: "1.0.0" as const, hash: run.registryHash },
    policy: { code: "OU25-MARKET-PRIORITY-POLICY" as const, version: "1.0.0" as const, hash: run.priorityPolicyHash, historicalAnalysisSpecHash: run.historicalAnalysisSpecHash },
    outcomeEvaluationEnabled: false as const,
    priceEvaluationEnabled: false as const,
    frozenBeforeOutcome: true as const,
    frozenAt: run.frozenAt.toISOString(),
    fixtureCount: run.fixtureCount,
    counts: JSON.parse(run.countsJson) as ProspectiveCounts,
    warnings: JSON.parse(run.warningsJson) as string[],
    networkRequestsAtFreeze: run.networkRequestCount,
    outcomeReads: 0 as const,
    quoteCaptures: 0 as const,
  };
  const runDocument: ProspectiveShadowRunDocument = { contractVersion: PROSPECTIVE_RUN_CONTRACT_VERSION, run: { ...runWithoutHash, runHash: canonicalHash(runWithoutHash) } };
  if (runDocument.run.runHash !== run.runHash) throw new Error("PROSPECTIVE_STORED_RUN_HASH_MISMATCH");
  const assessments = run.fixtureAssessments.map((assessment) => JSON.parse(assessment.contractJson) as ProspectiveFixtureAssessment).sort((left, right) => left.matchDecisionId.localeCompare(right.matchDecisionId));
  const assessmentDocument: ProspectiveFixtureAssessmentDocument = { contractVersion: PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION, prospectiveRunId: run.id, assessmentSetHash: canonicalHash(assessments), assessments };
  const requests: QuoteRequest[] = run.quoteRequests.map((request): QuoteRequest => ({ id: request.id, prospectiveRunId: request.prospectiveRunId, fixtureAssessmentId: request.fixtureAssessmentId, matchDecisionId: request.matchDecisionId, sportsDate: PROSPECTIVE_SPORTS_DATE, fixtureIdentityRaw: JSON.parse(request.fixtureIdentityRawJson), homeTeamRaw: request.homeTeamRaw, awayTeamRaw: request.awayTeamRaw, competitionRaw: request.competitionRaw, countryRaw: request.countryRaw, scheduledKickoffRaw: request.scheduledKickoffRaw, family: request.family as QuoteRequest["family"], internalMarketCode: request.internalMarketCode, marketComponents: JSON.parse(request.componentsJson) as string[], prePricePriorityScore: request.prePricePriorityScore.toNumber(), prePricePriorityClass: request.prePricePriorityClass as QuoteRequest["prePricePriorityClass"], prePriceSelectionStatus: request.prePriceSelectionStatus as QuoteRequest["prePriceSelectionStatus"], quoteRequired: true, bookmaker: "APOSTALA", bookmakerMarketCode: "UNRESOLVED", bookmakerMarketLabel: "UNRESOLVED", availableOdds: null, priceStatus: "NOT_CAPTURED", marketValueStatus: "UNKNOWN", warnings: JSON.parse(request.warningsJson) as string[] })).sort((left, right) => left.fixtureAssessmentId.localeCompare(right.fixtureAssessmentId) || left.family.localeCompare(right.family));
  const quoteDocument: QuoteRequestPlanDocument = { contractVersion: QUOTE_REQUEST_PLAN_CONTRACT_VERSION, prospectiveRunId: run.id, sportsDate: PROSPECTIVE_SPORTS_DATE, frozenAt: run.frozenAt.toISOString(), quotePlanHash: canonicalHash(requests), requests };
  prospectiveShadowRunDocumentSchema.parse(runDocument);
  prospectiveFixtureAssessmentDocumentSchema.parse(assessmentDocument);
  quoteRequestPlanDocumentSchema.parse(quoteDocument);
  assertAjv(runJsonSchema, runDocument, "PROSPECTIVE_RUN");
  assertAjv(assessmentJsonSchema, assessmentDocument, "PROSPECTIVE_ASSESSMENTS");
  assertAjv(quoteJsonSchema, quoteDocument, "QUOTE_PLAN");
  const candidates = run.candidates.map((candidate) => JSON.parse(candidate.payloadJson)).sort((left, right) => String(left.matchDecisionId).localeCompare(String(right.matchDecisionId)) || String(left.family).localeCompare(String(right.family)) || String(left.marketCode).localeCompare(String(right.marketCode)));
  const counts = JSON.parse(run.countsJson) as Record<string, unknown>;
  return {
    bundle: {
      "prospective-run.json": runDocument,
      "source-capture-summary.json": captures,
      "match-summary.json": { prospectiveRunId: run.id, matchRunId: matchRun.id, sportsDate: PROSPECTIVE_SPORTS_DATE, matcherVersion: matchRun.matcherVersion, normalizerVersion: matchRun.normalizerVersion, configurationHash: matchRun.configurationHash, sourceSnapshots: { forebet: matchRun.forebetSnapshotId, statarea: matchRun.statareaSnapshotId }, counts: { forebetInput: matchRun.forebetInputCount, statareaInput: matchRun.statareaInputCount, matched: matchRun.matchedCount, ambiguous: matchRun.ambiguousCount, onlyForebet: matchRun.onlyForebetCount, onlyStatarea: matchRun.onlyStatareaCount, conflict: matchRun.conflictCount, exact: matchRun.exactCount, conservative: matchRun.conservativeCount, approximate: matchRun.approximateCount }, forcedMatches: 0, aliases: 0 },
      "semantic-readiness.json": { prospectiveRunId: run.id, registry: { code: "STATAREA-LEGACY-SEMANTIC-REGISTRY", version: "1.0.0", hash: run.registryHash }, sourcePresentation: profile.sourcePresentation, rowsProjected: run.semanticProjections.length, ou25Ready: run.semanticProjections.filter((projection) => projection.ou25SemanticReady).length, doubleChanceReady: run.semanticProjections.filter((projection) => projection.doubleChanceSemanticReady).length, bothReady: run.semanticProjections.filter((projection) => projection.ou25SemanticReady && projection.doubleChanceSemanticReady).length, resultsUsed: 0 },
      "prospective-candidates.json": { prospectiveRunId: run.id, candidateSetHash: canonicalHash(candidates), candidates },
      "pre-price-decisions.json": assessmentDocument,
      "quote-request-plan.json": quoteDocument,
      "quote-request-plan-dc.json": { prospectiveRunId: run.id, requests: requests.filter((request) => request.family === "DOUBLE_CHANCE") },
      "quote-request-plan-ou25.json": { prospectiveRunId: run.id, requests: requests.filter((request) => request.family === "OU25") },
      "quote-request-plan-combinations.json": { prospectiveRunId: run.id, sameMatchOnly: true, requests: requests.filter((request) => request.family === "SAME_MATCH_COMBINATION") },
      "no-quote-required.json": { prospectiveRunId: run.id, fixtureAssessmentIds: assessments.filter((assessment) => !requests.some((request) => request.fixtureAssessmentId === assessment.id)).map((assessment) => assessment.id) },
      "warnings.json": { prospectiveRunId: run.id, warnings: JSON.parse(run.warningsJson), fixtureWarnings: assessments.filter((assessment) => assessment.warnings.length).map((assessment) => ({ fixtureAssessmentId: assessment.id, warnings: assessment.warnings })) },
      "audit-summary.json": { prospectiveRunId: run.id, appendOnly: true, writeOnceExports: true, contracts: { ajv: true, zod: true, canonical: true }, frozenBeforeOutcome: true, outcomeReads: 0, quoteCaptures: 0, apostalaAccesses: 0, rankingRows: 0, bets: 0, multiMatchCombinations: 0, counts },
      "b008-dominance-diagnostic.json": diagnostic,
    },
    runDocument,
    assessmentDocument,
    quoteDocument,
    counts,
  };
}

async function reuseProspectiveRun(prisma: PrismaClient, runId: string) {
  await prisma.$transaction([
    prisma.prospectiveShadowAttempt.create({ data: { prospectiveRunId: runId, status: "REUSED", networkRequestCount: 0, outcomeReadCount: 0, quoteCaptureCount: 0, contextJson: canonicalJson({ sportsDate: PROSPECTIVE_SPORTS_DATE, snapshotsReused: true, matchRunReused: true, frozenRunReused: true }) } }),
    prisma.prospectiveAuditEvent.create({ data: { prospectiveRunId: runId, eventType: "PROSPECTIVE_RUN_REUSED", contextJson: canonicalJson({ sportsDate: PROSPECTIVE_SPORTS_DATE, networkRequests: 0, outcomeReads: 0, quoteCaptures: 0, exportsWriteOnce: true }) } }),
  ]);
  const built = await buildExportBundle(prisma, runId);
  const exports = await preserveProspectiveExports(built.bundle);
  return { executionStatus: "REUSED" as const, prospectiveRunId: runId, ...built, exports, networkRequests: 0, outcomeReads: 0, quoteCaptures: 0 };
}

export async function runProspectiveShadow(date: string, dependencies: Dependencies) {
  validateProspectiveDate(date);
  const captures = await captureOrReuseSources(dependencies);
  return withMarketPriorityOfflineGuard(async () => {
    const guard = createOutcomeAccessGuard(dependencies.prisma);
    const prisma = guard.client;
    const match = await createOrReuseProspectiveMatchRun(prisma, captures.forebet.snapshot, captures.statarea.snapshot);
    const existing = await prisma.prospectiveShadowRun.findUnique({ where: { sportsDate_forebetSnapshotId_statareaSnapshotId_matcherVersion_normalizerVersion_matcherConfigurationHash_registryHash_priorityPolicyHash_mode: { sportsDate: dateValue(PROSPECTIVE_SPORTS_DATE), forebetSnapshotId: captures.forebet.snapshot.id, statareaSnapshotId: captures.statarea.snapshot.id, matcherVersion: MATCHER_VERSION, normalizerVersion: NORMALIZER_VERSION, matcherConfigurationHash: MATCH_CONFIGURATION_HASH, registryHash: HISTORICAL_REGISTRY_HASH, priorityPolicyHash: marketPriorityPolicyHash, mode: PROSPECTIVE_MODE } } });
    if (existing) {
      if (existing.matchRunId !== match.run.id || existing.frozenBeforeOutcome !== true || existing.outcomeEvaluationEnabled || existing.priceEvaluationEnabled) throw new Error("PROSPECTIVE_REPLAY_IDENTITY_MISMATCH");
      const result = await reuseProspectiveRun(prisma, existing.id);
      if (guard.getBlockedAccessAttempts() !== 0) throw new Error("PROSPECTIVE_OUTCOME_ACCESS_ATTEMPTED");
      return result;
    }
    const frozenAt = (dependencies.now ?? (() => new Date()))();
    assertFrozenBeforeSportsDate(frozenAt);
    const references = await frozenReferences(prisma);
    const matched = await prisma.matchDecision.findMany({ where: { runId: match.run.id, status: "MATCHED" }, orderBy: { id: "asc" } });
    if (!matched.length) throw new Error("PROSPECTIVE_MATCHED_COUNT_ZERO");
    const observations = await prisma.forebetObservation.findMany({ where: { id: { in: matched.flatMap((decision) => decision.forebetObservationId ? [decision.forebetObservationId] : []) } } });
    const rows = await prisma.statareaRawRow.findMany({ where: { id: { in: matched.flatMap((decision) => decision.statareaRowId ? [decision.statareaRowId] : []) } } });
    const selectedMatchCandidates = await prisma.matchCandidate.findMany({ where: { id: { in: matched.flatMap((decision) => decision.selectedCandidateId ? [decision.selectedCandidateId] : []) } } });
    const observationById = new Map(observations.map((observation) => [observation.id, observation]));
    const rowById = new Map(rows.map((row) => [row.id, row]));
    const matchCandidateById = new Map(selectedMatchCandidates.map((candidate) => [candidate.id, candidate]));
    const prospectiveRunId = deterministicId("psr", { sportsDate: PROSPECTIVE_SPORTS_DATE, forebetSnapshotId: captures.forebet.snapshot.id, statareaSnapshotId: captures.statarea.snapshot.id, matcherVersion: MATCHER_VERSION, normalizerVersion: NORMALIZER_VERSION, matcherConfigurationHash: MATCH_CONFIGURATION_HASH, registryHash: HISTORICAL_REGISTRY_HASH, priorityPolicyHash: marketPriorityPolicyHash, mode: PROSPECTIVE_MODE });
    const semanticProjections = rows.map(projectProspectiveSemanticRow);
    const projectionByRow = new Map(semanticProjections.map((projection) => [projection.rawRowId, projection]));
    const fixtureOutputs = matched.map((decision) => {
      const observation = decision.forebetObservationId ? observationById.get(decision.forebetObservationId) : null;
      const row = decision.statareaRowId ? rowById.get(decision.statareaRowId) : null;
      const projection = row ? projectionByRow.get(row.id) : null;
      const selectedMatchCandidate = decision.selectedCandidateId ? matchCandidateById.get(decision.selectedCandidateId) : null;
      if (!observation || !row || !projection || !selectedMatchCandidate) throw new Error(`PROSPECTIVE_MATCH_REFERENCE_MISSING:${decision.id}`);
      const snapshotIntegrity = observation.snapshotId === captures.forebet.snapshot.id && row.snapshotId === captures.statarea.snapshot.id && match.run.forebetSha256 === captures.forebet.snapshot.contentHash && match.run.statareaSha256 === captures.statarea.snapshot.contentHash;
      return buildProspectiveFixture({ prospectiveRunId, matchDecisionId: decision.id, frozenAt: frozenAt.toISOString(), fixtureIdentity: { forebetObservationId: observation.id, statareaRowId: row.id, homeTeamRaw: observation.homeTeamRaw, awayTeamRaw: observation.awayTeamRaw, competitionRaw: observation.competitionRaw ?? row.competitionRaw, countryRaw: observation.countryRaw ?? row.countryRaw, scheduledKickoffRaw: observation.kickoffRaw ?? row.kickoffRaw }, matchingQualityClass: matchingQuality(selectedMatchCandidate.stage), snapshotIntegrityVerified: snapshotIntegrity, forebet: { suggestedSide: observation.suggestedSide, probabilityUnder25: numberOrNull(observation.probabilityUnder25), probabilityOver25: numberOrNull(observation.probabilityOver25), predictedHomeGoals: observation.predictedHomeGoals, predictedAwayGoals: observation.predictedAwayGoals, averageGoals: numberOrNull(observation.averageGoals) }, semantic: { sourceDoubleChance1XPercent: numberOrNull(projection.sourceDoubleChance1XPercent), sourceDoubleChanceX2Percent: numberOrNull(projection.sourceDoubleChanceX2Percent), sourceDoubleChance12Percent: numberOrNull(projection.sourceDoubleChance12Percent), sourceOver25Percent: numberOrNull(projection.sourceOver25Percent), ou25SemanticReady: projection.ou25SemanticReady, doubleChanceSemanticReady: projection.doubleChanceSemanticReady }, metricByKey: references.metricByKey });
    });
    const candidates = fixtureOutputs.flatMap((output) => output.candidates);
    const assessments = fixtureOutputs.map((output) => output.assessment).sort((left, right) => left.matchDecisionId.localeCompare(right.matchDecisionId));
    const quotes = fixtureOutputs.flatMap((output) => output.quoteRequests).sort((left, right) => left.fixtureAssessmentId.localeCompare(right.fixtureAssessmentId) || left.family.localeCompare(right.family));
    if (!assessments.length || !quotes.length || assessments.length !== match.run.matchedCount) throw new Error("PROSPECTIVE_MINIMUM_GO_CONDITION_NOT_MET");
    const selectionCounts = { PREFERRED: assessments.filter((assessment) => assessment.prePriceSelectionStatus === "PREFERRED").length, PROVISIONAL: assessments.filter((assessment) => assessment.prePriceSelectionStatus === "PROVISIONAL").length, NONE: assessments.filter((assessment) => assessment.prePriceSelectionStatus === "NONE").length };
    const quoteCounts = { DOUBLE_CHANCE: quotes.filter((quote) => quote.family === "DOUBLE_CHANCE").length, OU25: quotes.filter((quote) => quote.family === "OU25").length, SAME_MATCH_COMBINATION: quotes.filter((quote) => quote.family === "SAME_MATCH_COMBINATION").length };
    const counts: ProspectiveCounts = { matching: { matched: match.run.matchedCount, ambiguous: match.run.ambiguousCount, onlyForebet: match.run.onlyForebetCount, onlyStatarea: match.run.onlyStatareaCount, conflict: match.run.conflictCount }, candidates: candidates.length, assessments: assessments.length, selections: selectionCounts, quoteRequests: { ...quoteCounts, total: quotes.length, maximumPerFixture: Math.max(...assessments.map((assessment) => quotes.filter((quote) => quote.fixtureAssessmentId === assessment.id).length)) }, semantic: { projected: semanticProjections.length, ou25Ready: semanticProjections.filter((projection) => projection.ou25SemanticReady).length, doubleChanceReady: semanticProjections.filter((projection) => projection.doubleChanceSemanticReady).length }, availableOdds: 0, marketValueEvaluated: 0, outcomeReads: 0, ranking: 0, bets: 0, multiMatchCombinations: 0 };
    if (counts.quoteRequests.maximumPerFixture > 3) throw new Error("PROSPECTIVE_MORE_THAN_THREE_QUOTES_PER_FIXTURE");
    const runWithoutHash = { id: prospectiveRunId, sportsDate: PROSPECTIVE_SPORTS_DATE as typeof PROSPECTIVE_SPORTS_DATE, mode: PROSPECTIVE_MODE as typeof PROSPECTIVE_MODE, status: "FROZEN" as const, forebetSnapshot: { id: captures.forebet.snapshot.id, sha256: captures.forebet.snapshot.contentHash, parserVersion: captures.forebet.snapshot.parserVersion }, statareaSnapshot: { id: captures.statarea.snapshot.id, sha256: captures.statarea.snapshot.contentHash, parserVersion: captures.statarea.snapshot.parserVersion, sourcePresentation: "LEGACY_OFFICIAL" as const }, matchRunId: match.run.id, matcherVersion: MATCHER_VERSION as "ou25-fixture-matcher/1.0.0", normalizerVersion: NORMALIZER_VERSION as "ou25-identity-normalizer/1.0.0", matcherConfigurationHash: MATCH_CONFIGURATION_HASH, registry: { code: "STATAREA-LEGACY-SEMANTIC-REGISTRY" as const, version: "1.0.0" as const, hash: HISTORICAL_REGISTRY_HASH }, policy: { code: "OU25-MARKET-PRIORITY-POLICY" as const, version: "1.0.0" as const, hash: marketPriorityPolicyHash, historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH }, outcomeEvaluationEnabled: false as const, priceEvaluationEnabled: false as const, frozenBeforeOutcome: true as const, frozenAt: frozenAt.toISOString(), fixtureCount: assessments.length, counts, warnings: [...PROSPECTIVE_WARNINGS], networkRequestsAtFreeze: captures.networkRequests, outcomeReads: 0 as const, quoteCaptures: 0 as const };
    const runHash = canonicalHash(runWithoutHash);
    const runDocument: ProspectiveShadowRunDocument = { contractVersion: PROSPECTIVE_RUN_CONTRACT_VERSION, run: { ...runWithoutHash, runHash } };
    const assessmentDocument: ProspectiveFixtureAssessmentDocument = { contractVersion: PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION, prospectiveRunId, assessmentSetHash: canonicalHash(assessments), assessments };
    const quoteDocument: QuoteRequestPlanDocument = { contractVersion: QUOTE_REQUEST_PLAN_CONTRACT_VERSION, prospectiveRunId, sportsDate: PROSPECTIVE_SPORTS_DATE, frozenAt: frozenAt.toISOString(), quotePlanHash: canonicalHash(quotes), requests: quotes };
    prospectiveShadowRunDocumentSchema.parse(runDocument);
    prospectiveFixtureAssessmentDocumentSchema.parse(assessmentDocument);
    quoteRequestPlanDocumentSchema.parse(quoteDocument);
    assertAjv(runJsonSchema, runDocument, "PROSPECTIVE_RUN");
    assertAjv(assessmentJsonSchema, assessmentDocument, "PROSPECTIVE_ASSESSMENTS");
    assertAjv(quoteJsonSchema, quoteDocument, "QUOTE_PLAN");
    if (guard.getBlockedAccessAttempts() !== 0) throw new Error("PROSPECTIVE_OUTCOME_ACCESS_ATTEMPTED");
    await prisma.$transaction(async (transaction) => {
      await transaction.prospectiveShadowRun.create({ data: { id: prospectiveRunId, sportsDate: dateValue(PROSPECTIVE_SPORTS_DATE), forebetSnapshotId: captures.forebet.snapshot.id, statareaSnapshotId: captures.statarea.snapshot.id, matchRunId: match.run.id, matcherVersion: MATCHER_VERSION, normalizerVersion: NORMALIZER_VERSION, matcherConfigurationHash: MATCH_CONFIGURATION_HASH, registryHash: HISTORICAL_REGISTRY_HASH, historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH, priorityPolicyHash: marketPriorityPolicyHash, mode: PROSPECTIVE_MODE, status: PROSPECTIVE_STATUS, outcomeEvaluationEnabled: false, priceEvaluationEnabled: false, frozenBeforeOutcome: true, frozenAt, fixtureCount: assessments.length, countsJson: canonicalJson(counts), warningsJson: canonicalJson([...PROSPECTIVE_WARNINGS]), runHash, exportPath: PROSPECTIVE_EXPORT_ROOT, networkRequestCount: captures.networkRequests, outcomeReadCount: 0, quoteCaptureCount: 0 } });
      await transaction.prospectiveSemanticProjection.createMany({ data: semanticProjections.map((projection) => ({ id: deterministicId("psp", { prospectiveRunId, rawRowId: projection.rawRowId }), prospectiveRunId, rawRowId: projection.rawRowId, sourceHomeWinPercent: projection.sourceHomeWinPercent, sourceDrawPercent: projection.sourceDrawPercent, sourceAwayWinPercent: projection.sourceAwayWinPercent, sourceDoubleChance1XPercent: projection.sourceDoubleChance1XPercent, sourceDoubleChanceX2Percent: projection.sourceDoubleChanceX2Percent, sourceDoubleChance12Percent: projection.sourceDoubleChance12Percent, sourceOver25Percent: projection.sourceOver25Percent, sourceUnder25Percent: projection.sourceUnder25Percent, ou25SemanticReady: projection.ou25SemanticReady, doubleChanceSemanticReady: projection.doubleChanceSemanticReady, qualityStatus: projection.qualityStatus, warningsJson: canonicalJson(projection.warnings) })) });
      await transaction.prospectiveCandidateSnapshot.createMany({ data: candidates.map((candidate) => ({ id: candidate.id, prospectiveRunId, matchDecisionId: candidate.matchDecisionId, family: candidate.family, marketCode: candidate.marketCode, componentsJson: canonicalJson(candidate.family === "SAME_MATCH_COMBINATION" ? candidate.marketCode.split(" + ") : [candidate.marketCode]), signalScore: candidate.signalScore, historicalEvidenceScore: candidate.historicalEvidenceScore, dataQualityScore: candidate.dataQualityScore, finalPriorityScore: candidate.finalPriorityScore, priorityClass: candidate.priorityClass, blocked: candidate.blocked, payloadJson: canonicalJson(candidate) })) });
      await transaction.prospectiveFixtureAssessment.createMany({ data: assessments.map((assessment) => ({ id: assessment.id, prospectiveRunId, matchDecisionId: assessment.matchDecisionId, sportsDate: dateValue(PROSPECTIVE_SPORTS_DATE), fixtureIdentityJson: canonicalJson(assessment.fixtureIdentity), dcCandidateId: assessment.dcCandidateId, ouCandidateId: assessment.ouCandidateId, combinationCandidateId: assessment.combinationCandidateId, prePricePreferenceCandidateId: assessment.prePricePreference?.candidateId ?? null, prePriceTopCandidateId: assessment.prePricePreference?.candidateId ?? assessment.prePriceSecondAlternative?.candidateId ?? null, prePriceSecondCandidateId: assessment.prePriceSecondAlternative?.candidateId ?? null, prePriceSelectionStatus: assessment.prePriceSelectionStatus, prePriceScoreMargin: assessment.prePriceScoreMargin, priceEvaluationStatus: "NOT_CAPTURED", decisionFrozenAt: frozenAt, warningsJson: canonicalJson(assessment.warnings), contractJson: canonicalJson(assessment) })) });
      await transaction.quoteRequestPlan.createMany({ data: quotes.map((quote) => ({ id: quote.id, prospectiveRunId, fixtureAssessmentId: quote.fixtureAssessmentId, matchDecisionId: quote.matchDecisionId, sportsDate: dateValue(PROSPECTIVE_SPORTS_DATE), fixtureIdentityRawJson: canonicalJson(quote.fixtureIdentityRaw), homeTeamRaw: quote.homeTeamRaw, awayTeamRaw: quote.awayTeamRaw, competitionRaw: quote.competitionRaw, countryRaw: quote.countryRaw, scheduledKickoffRaw: quote.scheduledKickoffRaw, family: quote.family, internalMarketCode: quote.internalMarketCode, componentsJson: canonicalJson(quote.marketComponents), bookmaker: "APOSTALA", bookmakerMarketCode: "UNRESOLVED", bookmakerMarketLabel: "UNRESOLVED", prePricePriorityScore: quote.prePricePriorityScore, prePricePriorityClass: quote.prePricePriorityClass, prePriceSelectionStatus: quote.prePriceSelectionStatus, quoteRequired: true, priceStatus: "NOT_CAPTURED", availableOdds: null, marketValueStatus: "UNKNOWN", warningsJson: canonicalJson(quote.warnings) })) });
      await transaction.prospectiveShadowAttempt.create({ data: { prospectiveRunId, status: "CREATED", networkRequestCount: captures.networkRequests, outcomeReadCount: 0, quoteCaptureCount: 0, contextJson: canonicalJson({ runHash, matchExecutionStatus: match.executionStatus, policyHash: marketPriorityPolicyHash }) } });
      await transaction.prospectiveAuditEvent.createMany({ data: [
        ["SOURCE_CAPTURES_FIXED", { forebetSnapshotId: captures.forebet.snapshot.id, statareaSnapshotId: captures.statarea.snapshot.id, sourcePresentation: "LEGACY_OFFICIAL", networkRequests: captures.networkRequests, resultsPersisted: false }],
        ["MATCHING_REUSED_OR_CREATED", { matchRunId: match.run.id, executionStatus: match.executionStatus, matcherVersion: MATCHER_VERSION, configurationHash: MATCH_CONFIGURATION_HASH, matched: match.run.matchedCount }],
        ["SEMANTIC_PROJECTION_COMPLETED", { registryHash: HISTORICAL_REGISTRY_HASH, projections: semanticProjections.length }],
        ["POLICY_REFERENCES_VERIFIED", { priorityPolicyHash: marketPriorityPolicyHash, historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH, manifestHash: HISTORICAL_MANIFEST_HASH }],
        ["DECISIONS_FROZEN_BEFORE_OUTCOME", { frozenAt: frozenAt.toISOString(), fixtureCount: assessments.length, outcomeReads: 0 }],
        ["QUOTE_REQUEST_PLAN_CREATED", { counts: quoteCounts, total: quotes.length, apostalaAccesses: 0, quoteCaptures: 0 }],
        ["CONTRACTS_VALIDATED", { ajv: true, zod: true, canonical: true }],
      ].map(([eventType, context]) => ({ id: randomUUID(), prospectiveRunId, eventType: eventType as string, contextJson: canonicalJson(context) })) });
    });
    const built = await buildExportBundle(prisma, prospectiveRunId);
    const exports = await preserveProspectiveExports(built.bundle);
    return { executionStatus: "CREATED" as const, prospectiveRunId, ...built, exports, networkRequests: captures.networkRequests, outcomeReads: guard.getBlockedAccessAttempts(), quoteCaptures: 0 };
  });
}
