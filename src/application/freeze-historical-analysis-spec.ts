import type { PrismaClient } from "@prisma/client";
import analysisSpecJsonSchema from "@/contracts/schemas/historical-analysis-spec.schema.json";
import { parseHistoricalAnalysisSpec } from "@/contracts/historical-analysis";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import {
  HISTORICAL_ANALYSIS_CODE,
  HISTORICAL_ANALYSIS_STATUS,
  HISTORICAL_ANALYSIS_VERSION,
  HISTORICAL_DATASET_CODE,
  HISTORICAL_DATASET_ID,
  HISTORICAL_DATASET_VERSION,
  HISTORICAL_ENGINE_VERSION,
  HISTORICAL_MANIFEST_HASH,
  HISTORICAL_REGISTRY_CODE,
  HISTORICAL_REGISTRY_HASH,
  HISTORICAL_REGISTRY_VERSION,
  OUTCOME_POLICY_VERSION,
} from "@/domain/historical-analysis/constants";
import { buildHistoricalAnalysisSpec, HISTORICAL_ANALYSIS_SPEC_HASH, historicalPatternDefinitions } from "@/domain/historical-analysis/spec";

export async function freezeHistoricalAnalysisSpec(prisma: PrismaClient) {
  const contract = buildHistoricalAnalysisSpec();
  parseHistoricalAnalysisSpec(contract);
  const ajv = validateContract(analysisSpecJsonSchema, contract);
  if (!ajv.valid) throw new Error(`HISTORICAL_SPEC_AJV_INVALID:${JSON.stringify(ajv.errors)}`);
  const specHash = canonicalHash(contract);
  if (specHash !== HISTORICAL_ANALYSIS_SPEC_HASH) throw new Error("HISTORICAL_SPEC_HASH_NOT_REPRODUCIBLE");

  const dataset = await prisma.historicalDataset.findUniqueOrThrow({
    where: { code_version: { code: HISTORICAL_DATASET_CODE, version: HISTORICAL_DATASET_VERSION } },
  });
  if (dataset.id !== HISTORICAL_DATASET_ID) throw new Error("HISTORICAL_SPEC_DATASET_ID_MISMATCH");
  await prisma.historicalDatasetState.findFirstOrThrow({
    where: { datasetId: dataset.id, status: "FROZEN", manifestHash: HISTORICAL_MANIFEST_HASH },
    orderBy: { createdAt: "desc" },
  });
  await prisma.semanticRegistry.findFirstOrThrow({
    where: { code: HISTORICAL_REGISTRY_CODE, version: HISTORICAL_REGISTRY_VERSION, registryHash: HISTORICAL_REGISTRY_HASH },
  });
  const [days, matched] = await Promise.all([
    prisma.historicalDatasetDay.count({ where: { datasetId: dataset.id } }),
    prisma.matchDecision.findMany({
      where: { status: "MATCHED", run: { datasetId: dataset.id, runType: "HISTORICAL_DATASET" } },
      select: { run: { select: { sportDate: true } } },
    }),
  ]);
  const discovery = matched.filter(({ run }) => run.sportDate.toISOString().slice(0, 10) <= "2026-07-14").length;
  const validation = matched.length - discovery;
  if (days !== 21 || matched.length !== 98 || discovery !== 64 || validation !== 34) throw new Error("HISTORICAL_SPEC_BASELINE_MISMATCH");

  const canonicalSpecJson = canonicalJson(contract);
  const existing = await prisma.historicalAnalysisSpec.findFirst({
    where: { code: HISTORICAL_ANALYSIS_CODE, version: HISTORICAL_ANALYSIS_VERSION, datasetId: dataset.id },
  });
  if (existing) {
    if (existing.status !== HISTORICAL_ANALYSIS_STATUS || existing.specHash !== specHash || existing.canonicalSpecJson !== canonicalSpecJson || existing.manifestHash !== HISTORICAL_MANIFEST_HASH || existing.registryHash !== HISTORICAL_REGISTRY_HASH) throw new Error("HISTORICAL_FROZEN_SPEC_MISMATCH");
    const patterns = await prisma.patternDefinition.count({ where: { specId: existing.id } });
    if (patterns !== historicalPatternDefinitions.length) throw new Error("HISTORICAL_FROZEN_PATTERNS_MISMATCH");
    await prisma.historicalAnalysisAuditEvent.create({ data: { specId: existing.id, eventType: "SPEC_REUSED", contextJson: canonicalJson({ specHash, resultsRead: 0, networkRequests: 0 }) } });
    return { executionStatus: "REUSED" as const, specId: existing.id, specHash, patterns, resultsRead: 0, outcomeEvidenceCreated: 0, metricsCreated: 0, networkRequests: 0 };
  }

  const evidenceBeforeFreeze = await prisma.outcomeEvidence.count();
  if (evidenceBeforeFreeze !== 0) throw new Error("HISTORICAL_RESULT_EVIDENCE_EXISTS_BEFORE_FIRST_FREEZE");
  const spec = await prisma.$transaction(async (transaction) => {
    const created = await transaction.historicalAnalysisSpec.create({
      data: {
        code: HISTORICAL_ANALYSIS_CODE,
        version: HISTORICAL_ANALYSIS_VERSION,
        datasetId: dataset.id,
        manifestHash: HISTORICAL_MANIFEST_HASH,
        registryHash: HISTORICAL_REGISTRY_HASH,
        outcomePolicyVersion: OUTCOME_POLICY_VERSION,
        engineVersion: HISTORICAL_ENGINE_VERSION,
        specHash,
        status: HISTORICAL_ANALYSIS_STATUS,
        canonicalSpecJson,
        resultEvidenceCountAtFreeze: 0,
      },
    });
    await transaction.patternDefinition.createMany({
      data: historicalPatternDefinitions.map((definition) => ({
        specId: created.id,
        code: definition.code,
        family: definition.family,
        side: definition.side,
        threshold: definition.threshold,
        canonicalRuleJson: canonicalJson(definition.rule),
      })),
    });
    await transaction.historicalAnalysisAuditEvent.createMany({ data: [
      { specId: created.id, eventType: "SPEC_CREATED", contextJson: canonicalJson({ code: HISTORICAL_ANALYSIS_CODE, version: HISTORICAL_ANALYSIS_VERSION, specHash }) },
      { specId: created.id, eventType: "SPEC_FROZEN", contextJson: canonicalJson({ status: HISTORICAL_ANALYSIS_STATUS, resultEvidenceCountAtFreeze: 0, resultsRead: 0, networkRequests: 0 }) },
      { specId: created.id, eventType: "CONTRACT_VALIDATED", contextJson: canonicalJson({ contractVersion: contract.contractVersion, ajv: true, zod: true, canonical: true }) },
    ] });
    return created;
  });
  return { executionStatus: "CREATED" as const, specId: spec.id, specHash, patterns: historicalPatternDefinitions.length, resultsRead: 0, outcomeEvidenceCreated: 0, metricsCreated: 0, networkRequests: 0 };
}
