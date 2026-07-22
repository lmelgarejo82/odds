import { PrismaClient } from "@prisma/client";
import { HISTORICAL_ANALYSIS_CODE, HISTORICAL_ANALYSIS_VERSION, HISTORICAL_MANIFEST_HASH, HISTORICAL_REGISTRY_HASH } from "../src/domain/historical-analysis/constants";
import { HISTORICAL_ANALYSIS_SPEC_HASH } from "../src/domain/historical-analysis/spec";

async function blocked(operation: () => Promise<unknown>) { try { await operation(); return false; } catch (error) { return String(error).includes("append-only") || (error as { code?: string }).code === "P2003"; } }
async function main() {
  const prisma = new PrismaClient();
  try {
    const spec = await prisma.historicalAnalysisSpec.findFirstOrThrow({ where: { code: HISTORICAL_ANALYSIS_CODE, version: HISTORICAL_ANALYSIS_VERSION } });
    const extraction = await prisma.outcomeExtractionRun.findFirstOrThrow({ where: { specId: spec.id } });
    const evaluation = await prisma.historicalEvaluationRun.findFirstOrThrow({ where: { specId: spec.id, extractionRunId: extraction.id } });
    const [evidence, outcomes, metrics, calibration, audits, matchRuns, snapshots, rankings, tracking] = await Promise.all([
      prisma.outcomeEvidence.count({ where: { extractionRunId: extraction.id } }), prisma.fixtureOutcome.groupBy({ by: ["reconciliationStatus"], where: { extractionRunId: extraction.id }, _count: true }), prisma.patternEvaluation.count({ where: { evaluationRunId: evaluation.id } }), prisma.calibrationBucket.count({ where: { evaluationRunId: evaluation.id } }), prisma.historicalAnalysisAuditEvent.groupBy({ by: ["eventType"], where: { specId: spec.id }, _count: true }), prisma.matchRun.count(), prisma.forebetCaptureSnapshot.count().then(async (forebet) => ({ forebet, statarea: await prisma.statareaCaptureSnapshot.count() })), prisma.dailyRanking.count(), prisma.trackedObservation.count(),
    ]);
    const appendOnly = {
      specUpdate: await blocked(() => prisma.historicalAnalysisSpec.update({ where: { id: spec.id }, data: { status: "MUTATED" } })),
      outcomeDelete: await blocked(async () => { const row = await prisma.fixtureOutcome.findFirstOrThrow({ where: { extractionRunId: extraction.id } }); return prisma.fixtureOutcome.delete({ where: { id: row.id } }); }),
      metricUpdate: await blocked(async () => { const row = await prisma.patternEvaluation.findFirstOrThrow({ where: { evaluationRunId: evaluation.id } }); return prisma.patternEvaluation.update({ where: { id: row.id }, data: { hits: row.hits + 1 } }); }),
      auditDelete: await blocked(async () => { const row = await prisma.historicalAnalysisAuditEvent.findFirstOrThrow({ where: { specId: spec.id } }); return prisma.historicalAnalysisAuditEvent.delete({ where: { id: row.id } }); }),
    };
    console.log(JSON.stringify({ spec: { id: spec.id, specHash: spec.specHash, expectedSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH, status: spec.status, resultEvidenceCountAtFreeze: spec.resultEvidenceCountAtFreeze }, integrity: { manifestHash: spec.manifestHash, expectedManifestHash: HISTORICAL_MANIFEST_HASH, registryHash: spec.registryHash, expectedRegistryHash: HISTORICAL_REGISTRY_HASH }, extraction: { id: extraction.id, evidence, outcomes }, evaluation: { id: evaluation.id, metrics, calibration }, audits, preserved: { matchRuns, snapshots, rankings, tracking }, appendOnly, networkRequests: 0 }, null, 2));
  } finally { await prisma.$disconnect(); }
}
void main();
