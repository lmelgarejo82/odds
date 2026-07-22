process.env.DATABASE_URL ??= "file:./dev.db";

import { PrismaClient } from "@prisma/client";
import { marketPriorityPolicyHash } from "../src/domain/market-priority/policy";
import { buildB008DominanceDiagnostic } from "../src/domain/prospective/dominance-diagnostic";

async function main() {
  const prisma = new PrismaClient();
  try {
    const assessment = await prisma.marketPriorityAssessmentRun.findFirstOrThrow({ where: { policy: { priorityPolicyHash: marketPriorityPolicyHash }, status: "COMPLETED" }, orderBy: { createdAt: "desc" } });
    const [candidates, decisions] = await Promise.all([
      prisma.fixtureMarketCandidate.findMany({ where: { assessmentRunId: assessment.id } }),
      prisma.fixturePreferredLineDecision.findMany({ where: { assessmentRunId: assessment.id } }),
    ]);
    const diagnostic = buildB008DominanceDiagnostic(candidates.map((candidate) => ({ id: candidate.id, family: candidate.family, marketCode: candidate.marketCode, signalScore: candidate.signalScore.toNumber(), historicalEvidenceScore: candidate.historicalEvidenceScore.toNumber(), dataQualityScore: candidate.dataQualityScore.toNumber(), finalPriorityScore: candidate.finalPriorityScore.toNumber(), caps: JSON.parse(candidate.capsJson) as Array<{ maximum: number }> })), decisions.map((decision) => ({ selectedCandidateId: decision.selectedCandidateId, topCandidateId: decision.topCandidateId })));
    console.log(JSON.stringify(diagnostic, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
