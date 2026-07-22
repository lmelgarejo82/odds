import type { Prisma, PrismaClient } from "@prisma/client";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import {
  SEMANTIC_ASSESSMENT_CONTRACT_VERSION,
  SEMANTIC_ASSESSMENT_VERSION,
  SEMANTIC_DATASET_CODE,
  SEMANTIC_DATASET_VERSION,
  SEMANTIC_LEGEND_SHA256,
  SEMANTIC_MANIFEST_HASH,
  SEMANTIC_PARSER_VERSION,
  SEMANTIC_REGISTRY_CODE,
  SEMANTIC_REGISTRY_VERSION,
  SEMANTIC_SOURCE_PRESENTATION,
} from "@/domain/statarea-semantics/constants";
import { evaluateSemanticRows } from "@/domain/statarea-semantics/quality";
import {
  derivedSemanticDefinitions,
  directSemanticDefinitions,
  excludedSemanticDefinitions,
  SEMANTIC_REGISTRY_HASH,
  semanticRegistryContract,
} from "@/domain/statarea-semantics/registry";
import { preserveSemanticExports } from "@/infrastructure/statarea/semantic-export-store";

export type SemanticAssessmentRequest = { dataset: string; registryVersion: string };

const auditContext = (value: Record<string, unknown>) => canonicalJson({
  registryVersion: SEMANTIC_REGISTRY_VERSION,
  registryHash: SEMANTIC_REGISTRY_HASH,
  legendSha256: SEMANTIC_LEGEND_SHA256,
  manifestHash: SEMANTIC_MANIFEST_HASH,
  ...value,
});

export function validateSemanticAssessmentRequest(request: SemanticAssessmentRequest) {
  if (request.dataset !== SEMANTIC_DATASET_CODE) throw new Error(`SEMANTIC_DATASET_NOT_ALLOWED:${request.dataset}`);
  if (request.registryVersion !== SEMANTIC_REGISTRY_VERSION) throw new Error(`SEMANTIC_REGISTRY_VERSION_NOT_ALLOWED:${request.registryVersion}`);
}

export async function assessStatareaSemantics(prisma: PrismaClient, request: SemanticAssessmentRequest) {
  validateSemanticAssessmentRequest(request);
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({ where: { code_version: { code: SEMANTIC_DATASET_CODE, version: SEMANTIC_DATASET_VERSION } } });
  const frozen = await prisma.historicalDatasetState.findFirstOrThrow({ where: { datasetId: dataset.id, status: "FROZEN", manifestHash: SEMANTIC_MANIFEST_HASH }, orderBy: { createdAt: "desc" } });
  if (frozen.manifestHash !== SEMANTIC_MANIFEST_HASH) throw new Error("SEMANTIC_MANIFEST_HASH_MISMATCH");
  const days = await prisma.historicalDatasetDay.findMany({ where: { datasetId: dataset.id }, orderBy: { sportsDate: "asc" } });
  if (days.length !== 21 || days.some((day) => day.statareaSourcePresentation !== SEMANTIC_SOURCE_PRESENTATION || day.statareaParserVersion !== SEMANTIC_PARSER_VERSION)) throw new Error("SEMANTIC_DATASET_PRESENTATION_OR_PARSER_MISMATCH");
  const snapshotIds = days.map((day) => day.statareaSnapshotId);
  const rawRows = await prisma.statareaRawRow.findMany({
    where: { snapshotId: { in: snapshotIds }, parserVersion: SEMANTIC_PARSER_VERSION },
    select: { id: true, requestedDate: true, rawColumnsJson: true, countryRaw: true, competitionRaw: true },
    orderBy: [{ requestedDate: "asc" }, { id: "asc" }],
  });
  if (rawRows.length !== 1110) throw new Error(`SEMANTIC_ROW_COUNT_MISMATCH:${rawRows.length}`);
  const partitions = new Map(days.map((day) => [day.sportsDate.toISOString().slice(0, 10), day.partition]));
  const evaluation = evaluateSemanticRows(rawRows, partitions);
  const matchedDecisions = await prisma.matchDecision.findMany({
    where: { status: "MATCHED", run: { datasetId: dataset.id, runType: "HISTORICAL_DATASET" } },
    select: { statareaRowId: true, run: { select: { sportDate: true } } },
  });
  if (matchedDecisions.length !== 98) throw new Error(`SEMANTIC_MATCHED_COUNT_MISMATCH:${matchedDecisions.length}`);
  const projectionByRow = new Map(evaluation.projections.map((projection) => [projection.rawRowId, projection]));
  const matchedProjections = matchedDecisions.map((decision) => decision.statareaRowId ? projectionByRow.get(decision.statareaRowId) : undefined);
  if (matchedProjections.some((projection) => !projection)) throw new Error("SEMANTIC_MATCHED_ROW_NOT_PROJECTED");
  const matchedReadiness = {
    total: 98 as const,
    discovery: matchedDecisions.filter((decision) => decision.run.sportDate.toISOString().slice(0, 10) <= "2026-07-14").length as 64,
    validation: matchedDecisions.filter((decision) => decision.run.sportDate.toISOString().slice(0, 10) >= "2026-07-15").length as 34,
    ou25SemanticReady: matchedProjections.filter((projection) => projection?.ou25SemanticReady).length,
    doubleChanceSemanticReady: matchedProjections.filter((projection) => projection?.doubleChanceSemanticReady).length,
    bothReady: matchedProjections.filter((projection) => projection?.ou25SemanticReady && projection.doubleChanceSemanticReady).length,
    htSemanticReady: matchedProjections.filter((projection) => projection?.htSemanticReady).length,
    handicap01SemanticReady: matchedProjections.filter((projection) => projection?.handicap01SemanticReady).length,
    withWarnings: matchedProjections.filter((projection) => projection?.warnings.length).length,
    insufficient: matchedProjections.filter((projection) => !projection?.ou25SemanticReady).length,
  };
  if (matchedReadiness.discovery !== 64 || matchedReadiness.validation !== 34) throw new Error("SEMANTIC_MATCHED_PARTITION_MISMATCH");
  const summary = {
    qualityTotals: evaluation.qualityTotals,
    qualityByField: evaluation.qualityByField,
    qualityByDate: evaluation.qualityByDate,
    matchedReadiness,
    findings: evaluation.findings,
  };
  const summaryHash = canonicalHash(summary);
  let registry = await prisma.semanticRegistry.findUnique({ where: { code_version: { code: SEMANTIC_REGISTRY_CODE, version: SEMANTIC_REGISTRY_VERSION } }, include: { definitions: true } });
  if (registry && registry.registryHash !== SEMANTIC_REGISTRY_HASH) throw new Error("SEMANTIC_EXISTING_REGISTRY_HASH_MISMATCH");
  let assessmentRun = registry ? await prisma.semanticAssessmentRun.findUnique({ where: { registryId_datasetId_manifestHash_assessmentVersion: { registryId: registry.id, datasetId: dataset.id, manifestHash: SEMANTIC_MANIFEST_HASH, assessmentVersion: SEMANTIC_ASSESSMENT_VERSION } } }) : null;
  let executionStatus: "CREATED" | "REUSED";
  if (registry && assessmentRun) {
    const stored = JSON.parse(assessmentRun.qualitySummaryJson) as { summaryHash: string };
    if (stored.summaryHash !== summaryHash || assessmentRun.rowCount !== 1110 || assessmentRun.matchedCount !== 98) throw new Error("SEMANTIC_REUSED_ASSESSMENT_CONTENT_MISMATCH");
    await prisma.$transaction([
      prisma.semanticAssessmentAttempt.create({ data: { assessmentRunId: assessmentRun.id, registryId: registry.id, datasetId: dataset.id, status: "REUSED", reusedAssessmentRunId: assessmentRun.id, warningsJson: canonicalJson([]) } }),
      prisma.semanticAuditEvent.create({ data: { assessmentRunId: assessmentRun.id, registryId: registry.id, eventType: "ASSESSMENT_REUSED", contextJson: auditContext({ datasetId: dataset.id, assessmentRunId: assessmentRun.id, rowCount: 1110, matchedCount: 98 }) } }),
    ]);
    executionStatus = "REUSED";
  } else {
    const created = await prisma.$transaction(async (transaction) => {
      const createdRegistry = await transaction.semanticRegistry.create({ data: { code: SEMANTIC_REGISTRY_CODE, version: SEMANTIC_REGISTRY_VERSION, source: "STATAREA", sourcePresentation: SEMANTIC_SOURCE_PRESENTATION, parserVersion: SEMANTIC_PARSER_VERSION, evidenceStatus: "VERIFIED", legendSha256: SEMANTIC_LEGEND_SHA256, registryHash: SEMANTIC_REGISTRY_HASH, warningsJson: canonicalJson(semanticRegistryContract.warnings) } });
      const allDefinitions = [...directSemanticDefinitions, ...derivedSemanticDefinitions, ...excludedSemanticDefinitions];
      await transaction.semanticFieldDefinition.createMany({ data: allDefinitions.map((definition) => ({ registryId: createdRegistry.id, rawHeader: definition.rawHeader, canonicalField: definition.canonicalField, meaning: definition.meaning, unit: definition.unit, direction: definition.direction, line: definition.line, semanticStatus: definition.semanticStatus, evidenceLevel: definition.evidenceLevel, evidenceJson: canonicalJson(definition.evidence), normalizationRule: definition.normalizationRule, derivationRule: definition.derivationRule, analysisEnabled: definition.analysisEnabled })) });
      const run = await transaction.semanticAssessmentRun.create({ data: { registryId: createdRegistry.id, datasetId: dataset.id, manifestHash: SEMANTIC_MANIFEST_HASH, assessmentVersion: SEMANTIC_ASSESSMENT_VERSION, status: "COMPLETED", rowCount: 1110, matchedCount: 98, qualitySummaryJson: canonicalJson({ ...summary, summaryHash }) } });
      const projections: Prisma.StatareaSemanticProjectionCreateManyInput[] = evaluation.projections.map((projection) => {
        const values = projection as typeof projection & Record<string, Prisma.Decimal | undefined>;
        return {
          assessmentRunId: run.id,
          rawRowId: projection.rawRowId,
          sportsDate: projection.sportsDate,
          partition: projection.partition,
          sourceHomeWinPercent: values.sourceHomeWinPercent,
          sourceDrawPercent: values.sourceDrawPercent,
          sourceAwayWinPercent: values.sourceAwayWinPercent,
          sourceDoubleChance1XPercent: values.sourceDoubleChance1XPercent,
          sourceDoubleChanceX2Percent: values.sourceDoubleChanceX2Percent,
          sourceDoubleChance12Percent: values.sourceDoubleChance12Percent,
          sourceHtHomeWinPercent: values.sourceHtHomeWinPercent,
          sourceHtDrawPercent: values.sourceHtDrawPercent,
          sourceHtAwayWinPercent: values.sourceHtAwayWinPercent,
          sourceOver15Percent: values.sourceOver15Percent,
          sourceUnder15Percent: values.sourceUnder15Percent,
          sourceOver25Percent: values.sourceOver25Percent,
          sourceUnder25Percent: values.sourceUnder25Percent,
          sourceOver35Percent: values.sourceOver35Percent,
          sourceUnder35Percent: values.sourceUnder35Percent,
          sourceHandicap01HomePercent: values.sourceHandicap01HomePercent,
          sourceHandicap01DrawPercent: values.sourceHandicap01DrawPercent,
          sourceHandicap01AwayPercent: values.sourceHandicap01AwayPercent,
          ou25SemanticReady: projection.ou25SemanticReady,
          doubleChanceSemanticReady: projection.doubleChanceSemanticReady,
          htSemanticReady: projection.htSemanticReady,
          handicap01SemanticReady: projection.handicap01SemanticReady,
          semanticReadiness: projection.semanticReadiness,
          qualityStatus: projection.qualityStatus,
          warningsJson: canonicalJson(projection.warnings),
        };
      });
      await transaction.statareaSemanticProjection.createMany({ data: projections });
      await transaction.semanticQualityFinding.createMany({ data: evaluation.findings.map((finding) => ({ assessmentRunId: run.id, field: finding.field, findingType: finding.findingType, severity: finding.severity, observedValue: String(finding.count), expectedRule: finding.expectedRule, detailsJson: canonicalJson({ count: finding.count }) })) });
      await transaction.semanticAssessmentAttempt.create({ data: { assessmentRunId: run.id, registryId: createdRegistry.id, datasetId: dataset.id, status: "CREATED", reusedAssessmentRunId: null, warningsJson: canonicalJson([]) } });
      const events = [
        ["REGISTRY_CREATED", { registryId: createdRegistry.id }], ["EVIDENCE_VERIFIED", { snapshotsVerified: 21, rowsVerified: 1110 }],
        ...directSemanticDefinitions.map((definition) => ["DIRECT_DEFINITION_REGISTERED", { field: definition.canonicalField, semanticStatus: definition.semanticStatus, evidenceLevel: definition.evidenceLevel }]),
        ...derivedSemanticDefinitions.map((definition) => ["DERIVED_DEFINITION_REGISTERED", { field: definition.canonicalField, semanticStatus: definition.semanticStatus, evidenceLevel: definition.evidenceLevel }]),
        ["ASSESSMENT_STARTED", { assessmentRunId: run.id, datasetId: dataset.id }], ["PROJECTIONS_CREATED", { assessmentRunId: run.id, count: projections.length }],
        ["FINDINGS_CREATED", { assessmentRunId: run.id, count: evaluation.findings.length }], ["QUALITY_COMPLETED", { assessmentRunId: run.id, rowCount: 1110, matchedCount: 98 }],
        ["CONTRACT_VALIDATED", { assessmentRunId: run.id }], ["EXPORT_GENERATED", { assessmentRunId: run.id, writeOnce: true }],
      ] as Array<[string, Record<string, unknown>]>;
      await transaction.semanticAuditEvent.createMany({ data: events.map(([eventType, context]) => ({ assessmentRunId: eventType === "REGISTRY_CREATED" || eventType.includes("DEFINITION") || eventType === "EVIDENCE_VERIFIED" ? null : run.id, registryId: createdRegistry.id, eventType, contextJson: auditContext(context) })) });
      return { registry: createdRegistry, run };
    });
    registry = { ...created.registry, definitions: [] };
    assessmentRun = created.run;
    executionStatus = "CREATED";
  }
  if (!registry || !assessmentRun) throw new Error("SEMANTIC_ASSESSMENT_NOT_CREATED");
  const assessmentCore = {
    contractVersion: SEMANTIC_ASSESSMENT_CONTRACT_VERSION,
    assessment: { id: assessmentRun.id, version: SEMANTIC_ASSESSMENT_VERSION, status: "COMPLETED" as const, createdAt: assessmentRun.createdAt.toISOString(), rowCount: 1110 as const },
    registryReference: { id: registry.id, code: SEMANTIC_REGISTRY_CODE, version: SEMANTIC_REGISTRY_VERSION, registryHash: SEMANTIC_REGISTRY_HASH, legendSha256: SEMANTIC_LEGEND_SHA256 },
    datasetReference: { id: dataset.id, code: SEMANTIC_DATASET_CODE, version: SEMANTIC_DATASET_VERSION, status: "FROZEN" as const, sourcePresentation: SEMANTIC_SOURCE_PRESENTATION, manifestHash: SEMANTIC_MANIFEST_HASH },
    ...summary,
    warnings: ["Porcentajes fuente de Statarea; no son probabilidades reales ni calibradas.", "TIP permanece UNVERIFIED.", "Handicap 0:1 permanece fuera del análisis B007."],
    resultsUsed: 0 as const,
    networkRequests: 0 as const,
  };
  const assessmentContract = { ...assessmentCore, assessmentHash: canonicalHash(assessmentCore) };
  const exports = await preserveSemanticExports({ registry: semanticRegistryContract, assessment: assessmentContract, directDefinitions: directSemanticDefinitions, derivedDefinitions: derivedSemanticDefinitions, excludedDefinitions: excludedSemanticDefinitions, qualityTotals: evaluation.qualityTotals, qualityByField: evaluation.qualityByField, qualityByDate: evaluation.qualityByDate, matchedReadiness, findings: evaluation.findings, auditSummary: { executionStatus: "CREATED", registryId: registry.id, assessmentRunId: assessmentRun.id, registryHash: SEMANTIC_REGISTRY_HASH, manifestHash: SEMANTIC_MANIFEST_HASH } });
  return {
    executionStatus,
    registryId: registry.id,
    registryHash: SEMANTIC_REGISTRY_HASH,
    assessmentRunId: assessmentRun.id,
    assessmentHash: assessmentContract.assessmentHash,
    rows: 1110,
    matchedReadiness,
    qualityTotals: evaluation.qualityTotals,
    exports,
    networkRequests: 0,
    resultsUsed: 0,
  };
}
