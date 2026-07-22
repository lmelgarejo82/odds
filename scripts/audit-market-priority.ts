import { PrismaClient } from "@prisma/client";
import { canonicalHash } from "../src/domain/canonical-hash";
import { HISTORICAL_MANIFEST_HASH, HISTORICAL_REGISTRY_HASH } from "../src/domain/historical-analysis/constants";
import { HISTORICAL_ANALYSIS_SPEC_HASH, MARKET_PRIORITY_POLICY_CODE, MARKET_PRIORITY_POLICY_VERSION } from "../src/domain/market-priority/constants";
import { marketPriorityPolicyHash } from "../src/domain/market-priority/policy";

const prisma = new PrismaClient();
async function blocked(operation: () => Promise<unknown>) {
  try { await operation(); return false; } catch { return true; }
}

async function main() {
  const policy = await prisma.marketPriorityPolicy.findUniqueOrThrow({ where: { code_version: { code: MARKET_PRIORITY_POLICY_CODE, version: MARKET_PRIORITY_POLICY_VERSION } } });
  const run = await prisma.marketPriorityAssessmentRun.findFirstOrThrow({ where: { policyId: policy.id }, orderBy: { createdAt: "desc" } });
  const [candidateGroups, selectionGroups, classGroups, attempts, audits, candidates, familyDecisions, finalDecisions] = await Promise.all([
    prisma.fixtureMarketCandidate.groupBy({ by: ["family"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.fixturePreferredLineDecision.groupBy({ by: ["selectionStatus"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.fixtureMarketCandidate.groupBy({ by: ["priorityClass"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.marketPriorityAssessmentAttempt.groupBy({ by: ["status"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.marketPriorityAuditEvent.groupBy({ by: ["eventType"], where: { assessmentRunId: run.id }, _count: true }),
    prisma.fixtureMarketCandidate.findMany({ where: { assessmentRunId: run.id } }),
    prisma.fixtureFamilyDecision.count({ where: { assessmentRunId: run.id } }),
    prisma.fixturePreferredLineDecision.findMany({ where: { assessmentRunId: run.id } }),
  ]);
  const appendOnly = {
    policyUpdate: await blocked(() => prisma.marketPriorityPolicy.update({ where: { id: policy.id }, data: { status: "BROKEN" } })),
    assessmentDelete: await blocked(() => prisma.marketPriorityAssessmentRun.delete({ where: { id: run.id } })),
    attemptUpdate: await blocked(() => prisma.marketPriorityAssessmentAttempt.updateMany({ where: { assessmentRunId: run.id }, data: { status: "FAILED" } })),
    candidateDelete: await blocked(() => prisma.fixtureMarketCandidate.delete({ where: { id: candidates[0].id } })),
    familyUpdate: await blocked(() => prisma.fixtureFamilyDecision.updateMany({ where: { assessmentRunId: run.id }, data: { reasonCode: "BROKEN" } })),
    finalDelete: await blocked(() => prisma.fixturePreferredLineDecision.delete({ where: { id: finalDecisions[0].id } })),
    auditDelete: await blocked(() => prisma.marketPriorityAuditEvent.deleteMany({ where: { assessmentRunId: run.id } })),
  };
  const output = {
    policy: { id: policy.id, code: policy.code, version: policy.version, status: policy.status, priorityPolicyHash: policy.priorityPolicyHash, canonicalHash: canonicalHash(JSON.parse(policy.canonicalPolicyJson)) },
    references: { manifestHash: policy.manifestHash, semanticRegistryHash: policy.semanticRegistryHash, historicalAnalysisSpecHash: policy.historicalAnalysisSpecHash, expected: { manifestHash: HISTORICAL_MANIFEST_HASH, semanticRegistryHash: HISTORICAL_REGISTRY_HASH, historicalAnalysisSpecHash: HISTORICAL_ANALYSIS_SPEC_HASH, priorityPolicyHash: marketPriorityPolicyHash } },
    run: { id: run.id, assessmentHash: run.assessmentHash, fixtureCount: run.fixtureCount, candidateCount: run.candidateCount, familyDecisionCount: run.familyDecisionCount, finalDecisionCount: run.finalDecisionCount, networkRequests: run.networkRequestCount, outcomeReads: run.outcomeReadCount },
    candidateGroups,
    selectionGroups,
    classGroups,
    blockedCandidates: candidates.filter((candidate) => candidate.blocked).length,
    familyDecisions,
    selectedLineMaximum: Math.max(...finalDecisions.map((decision) => decision.selectedLineCount)),
    price: { evaluated: candidates.filter((candidate) => candidate.priceStatus !== "NOT_EVALUATED").length, availableOdds: candidates.filter((candidate) => candidate.availableOdds !== null).length, marketValueEvaluated: candidates.filter((candidate) => candidate.marketValueStatus !== "UNKNOWN").length },
    attempts,
    audits,
    appendOnly,
    legacy: { rankings: await prisma.dailyRanking.count(), rankedCandidates: await prisma.dailyRankedCandidate.count(), tracking: await prisma.trackedObservation.count() },
    b009Tables: 0,
  };
  if (Object.values(appendOnly).some((value) => !value) || run.networkRequestCount !== 0 || run.outcomeReadCount !== 0 || output.selectedLineMaximum > 1) throw new Error("MARKET_PRIORITY_AUDIT_FAILED");
  console.log(JSON.stringify(output, null, 2));
}

void main().finally(async () => prisma.$disconnect());
