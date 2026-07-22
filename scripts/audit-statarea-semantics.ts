import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import assessmentJsonSchema from "../src/contracts/schemas/statarea-semantic-assessment.schema.json";
import registryJsonSchema from "../src/contracts/schemas/statarea-semantic-registry.schema.json";
import { semanticAssessmentSchema, semanticRegistrySchema } from "../src/contracts/statarea-semantics";
import { validateContract } from "../src/contracts/validator";
import { canonicalJson } from "../src/domain/canonical-json";
import { MATCH_CONFIGURATION } from "../src/domain/reconciliation/configuration";
import {
  SEMANTIC_DATASET_CODE,
  SEMANTIC_EXPORT_DIRECTORY,
  SEMANTIC_LEGEND_SHA256,
  SEMANTIC_MANIFEST_HASH,
  SEMANTIC_REGISTRY_CODE,
  SEMANTIC_REGISTRY_VERSION,
} from "../src/domain/statarea-semantics/constants";
import { SEMANTIC_REGISTRY_HASH } from "../src/domain/statarea-semantics/registry";

const prisma = new PrismaClient();

async function appendOnly(label: string, operation: () => Promise<unknown>) {
  try {
    await operation();
  } catch (error) {
    if (String(error).includes("append-only") || (typeof error === "object" && error !== null && "code" in error && error.code === "P2003")) return true;
    throw error;
  }
  throw new Error(`${label}_WAS_NOT_REJECTED`);
}

async function main() {
  const dataset = await prisma.historicalDataset.findUniqueOrThrow({
    where: { code_version: { code: SEMANTIC_DATASET_CODE, version: "1.0.0" } },
  });
  const frozen = await prisma.historicalDatasetState.findFirstOrThrow({
    where: { datasetId: dataset.id, status: "FROZEN", manifestHash: SEMANTIC_MANIFEST_HASH },
  });
  const registry = await prisma.semanticRegistry.findUniqueOrThrow({
    where: { code_version: { code: SEMANTIC_REGISTRY_CODE, version: SEMANTIC_REGISTRY_VERSION } },
  });
  const run = await prisma.semanticAssessmentRun.findUniqueOrThrow({
    where: {
      registryId_datasetId_manifestHash_assessmentVersion: {
        registryId: registry.id,
        datasetId: dataset.id,
        manifestHash: SEMANTIC_MANIFEST_HASH,
        assessmentVersion: "statarea-semantic-assessment/1.0.0",
      },
    },
  });

  const exportRoot = join(process.cwd(), "var", "exports", "semantics", SEMANTIC_EXPORT_DIRECTORY);
  const exportFiles = (await readdir(exportRoot)).sort();
  const canonicalExports: Record<string, boolean> = {};
  for (const file of exportFiles) {
    const body = await readFile(join(exportRoot, file), "utf8");
    canonicalExports[file] = body === `${canonicalJson(JSON.parse(body))}\n`;
  }
  const registryExport = JSON.parse(await readFile(join(exportRoot, "semantic-registry.json"), "utf8"));
  const assessmentExport = JSON.parse(await readFile(join(exportRoot, "semantic-assessment.json"), "utf8"));
  const contracts = {
    registryZod: semanticRegistrySchema.safeParse(registryExport).success,
    registryAjv: validateContract(registryJsonSchema, registryExport).valid,
    assessmentZod: semanticAssessmentSchema.safeParse(assessmentExport).success,
    assessmentAjv: validateContract(assessmentJsonSchema, assessmentExport).valid,
    canonical: Object.values(canonicalExports).every(Boolean),
  };

  const [
    definitionGroups,
    projectionGroups,
    partitionGroups,
    attemptGroups,
    auditGroups,
    findings,
    historicalStates,
    matched,
    legacy,
    emptyAnalyticalTables,
  ] = await Promise.all([
    prisma.semanticFieldDefinition.groupBy({ by: ["semanticStatus"], where: { registryId: registry.id }, _count: true }),
    prisma.statareaSemanticProjection.groupBy({ by: ["qualityStatus"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.statareaSemanticProjection.groupBy({ by: ["partition"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.semanticAssessmentAttempt.groupBy({ by: ["status"], where: { registryId: registry.id }, _count: true }),
    prisma.semanticAuditEvent.groupBy({ by: ["eventType"], where: { registryId: registry.id }, _count: true }),
    prisma.semanticQualityFinding.count({ where: { assessmentRunId: run.id } }),
    Promise.all([
      prisma.forebetCaptureSnapshot.count(), prisma.forebetObservation.count(), prisma.forebetRowRejection.count(),
      prisma.statareaCaptureSnapshot.count(), prisma.statareaRawRow.count(), prisma.statareaRowRejection.count(),
      prisma.historicalDatasetDay.count({ where: { datasetId: dataset.id } }),
      prisma.matchRun.count(), prisma.matchRun.count({ where: { datasetId: dataset.id, runType: "HISTORICAL_DATASET" } }),
    ]),
    prisma.matchDecision.groupBy({ by: ["status"], where: { run: { datasetId: dataset.id, runType: "HISTORICAL_DATASET" } }, _count: true }),
    Promise.all([
      prisma.statareaCaptureSnapshot.count({ where: { profile: { sourcePresentation: "LEGACY_OFFICIAL" } } }),
      prisma.statareaCaptureSnapshot.count({ where: { profile: { sourcePresentation: "MODERN" } } }),
    ]),
    Promise.all([
      prisma.sourceArtifact.count({ where: { source: "RESULT" } }), prisma.matchResult.count(), prisma.dailyRanking.count(),
      prisma.dailyRankedCandidate.count(), prisma.trackedObservation.count(),
    ]),
  ]);

  if (registry.registryHash !== SEMANTIC_REGISTRY_HASH || registry.legendSha256 !== SEMANTIC_LEGEND_SHA256) throw new Error("SEMANTIC_REGISTRY_REFERENCE_MISMATCH");
  if (!Object.values(contracts).every(Boolean)) throw new Error("SEMANTIC_EXPORT_VALIDATION_FAILED");
  if (exportFiles.length !== 15) throw new Error(`SEMANTIC_EXPORT_COUNT_MISMATCH:${exportFiles.length}`);
  if (run.rowCount !== 1110 || run.matchedCount !== 98) throw new Error("SEMANTIC_ASSESSMENT_COUNT_MISMATCH");
  if (emptyAnalyticalTables.some((count) => count !== 0)) throw new Error("SEMANTIC_ASSESSMENT_ANALYTICAL_OUTPUT_DETECTED");

  const appendOnlyChecks = {
    registryUpdate: await appendOnly("REGISTRY_UPDATE", () => prisma.semanticRegistry.update({ where: { id: registry.id }, data: { warningsJson: registry.warningsJson } })),
    registryDelete: await appendOnly("REGISTRY_DELETE", () => prisma.semanticRegistry.delete({ where: { id: registry.id } })),
    definitionUpdate: await appendOnly("DEFINITION_UPDATE", async () => {
      const definition = await prisma.semanticFieldDefinition.findFirstOrThrow({ where: { registryId: registry.id } });
      return prisma.semanticFieldDefinition.update({ where: { id: definition.id }, data: { meaning: definition.meaning } });
    }),
    assessmentUpdate: await appendOnly("ASSESSMENT_UPDATE", () => prisma.semanticAssessmentRun.update({ where: { id: run.id }, data: { rowCount: run.rowCount } })),
    projectionDelete: await appendOnly("PROJECTION_DELETE", async () => {
      const projection = await prisma.statareaSemanticProjection.findFirstOrThrow({ where: { assessmentRunId: run.id } });
      return prisma.statareaSemanticProjection.delete({ where: { id: projection.id } });
    }),
    findingUpdate: await appendOnly("FINDING_UPDATE", async () => {
      const finding = await prisma.semanticQualityFinding.findFirstOrThrow({ where: { assessmentRunId: run.id } });
      return prisma.semanticQualityFinding.update({ where: { id: finding.id }, data: { field: finding.field } });
    }),
    auditDelete: await appendOnly("AUDIT_DELETE", async () => {
      const event = await prisma.semanticAuditEvent.findFirstOrThrow({ where: { registryId: registry.id } });
      return prisma.semanticAuditEvent.delete({ where: { id: event.id } });
    }),
  };

  console.log(JSON.stringify({
    dataset: { id: dataset.id, code: dataset.code, version: dataset.version, frozenStateId: frozen.id, manifestHash: frozen.manifestHash },
    registry: { id: registry.id, code: registry.code, version: registry.version, registryHash: registry.registryHash, legendSha256: registry.legendSha256 },
    assessment: { id: run.id, version: run.assessmentVersion, rows: run.rowCount, matched: run.matchedCount, createdAt: run.createdAt, summary: JSON.parse(run.qualitySummaryJson) },
    definitionGroups,
    projectionGroups,
    partitionGroups,
    attemptGroups,
    findings,
    auditGroups,
    historicalStates: { forebetSnapshots: historicalStates[0], forebetRows: historicalStates[1], forebetRejections: historicalStates[2], statareaSnapshots: historicalStates[3], statareaRows: historicalStates[4], statareaRejections: historicalStates[5], datasetDays: historicalStates[6], matchRuns: historicalStates[7], historicalMatchRuns: historicalStates[8], legacySnapshots: legacy[0], modernSnapshots: legacy[1] },
    matched,
    aliases: MATCH_CONFIGURATION.aliases.length,
    analyticalTables: { resultArtifacts: emptyAnalyticalTables[0], matchResults: emptyAnalyticalTables[1], dailyRankings: emptyAnalyticalTables[2], rankedCandidates: emptyAnalyticalTables[3], trackedObservations: emptyAnalyticalTables[4] },
    exports: { root: `var/exports/semantics/${SEMANTIC_EXPORT_DIRECTORY}`, files: exportFiles, contracts, canonicalExports },
    appendOnlyChecks,
    networkRequests: 0,
  }, null, 2));
}

void main().finally(() => prisma.$disconnect());
