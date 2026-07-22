process.env.DATABASE_URL ??= "file:./dev.db";

import { PrismaClient } from "@prisma/client";
import { HISTORICAL_ANALYSIS_SPEC_HASH } from "../src/domain/market-priority/constants";
import { marketPriorityPolicyHash } from "../src/domain/market-priority/policy";
import { HISTORICAL_REGISTRY_HASH } from "../src/domain/historical-analysis/constants";
import { MATCH_CONFIGURATION_HASH } from "../src/domain/reconciliation/configuration";
import { PROSPECTIVE_SPORTS_DATE } from "../src/domain/prospective/constants";

async function main() {
  const prisma = new PrismaClient();
  try {
    const run = await prisma.prospectiveShadowRun.findFirstOrThrow({ where: { sportsDate: new Date(`${PROSPECTIVE_SPORTS_DATE}T00:00:00.000Z`) }, orderBy: { createdAt: "desc" } });
    const [runCount, matchRun, matchRunCount, matchDecisionCount, projections, candidates, assessmentRows, assessments, quoteRows, quotes, attempts, audits, triggers, forebetAttempts, statareaAttempts, rankings, tracking] = await Promise.all([
      prisma.prospectiveShadowRun.count({ where: { sportsDate: run.sportsDate } }),
      prisma.matchRun.findUniqueOrThrow({ where: { id: run.matchRunId } }),
      prisma.matchRun.count({ where: { id: run.matchRunId } }),
      prisma.matchDecision.count({ where: { runId: run.matchRunId, status: "MATCHED" } }),
      prisma.prospectiveSemanticProjection.count({ where: { prospectiveRunId: run.id } }),
      prisma.prospectiveCandidateSnapshot.count({ where: { prospectiveRunId: run.id } }),
      prisma.prospectiveFixtureAssessment.findMany({ where: { prospectiveRunId: run.id } }),
      prisma.prospectiveFixtureAssessment.groupBy({ by: ["prePriceSelectionStatus"], where: { prospectiveRunId: run.id }, _count: true }),
      prisma.quoteRequestPlan.findMany({ where: { prospectiveRunId: run.id } }),
      prisma.quoteRequestPlan.groupBy({ by: ["family"], where: { prospectiveRunId: run.id }, _count: true }),
      prisma.prospectiveShadowAttempt.groupBy({ by: ["status"], where: { prospectiveRunId: run.id }, _count: true }),
      prisma.prospectiveAuditEvent.count({ where: { prospectiveRunId: run.id } }),
      prisma.$queryRaw<Array<{ name: string }>>`SELECT name FROM sqlite_master WHERE type='trigger' AND (name LIKE 'Prospective%' OR name LIKE 'QuoteRequestPlan_%')`,
      prisma.forebetCaptureAttempt.count({ where: { snapshotId: run.forebetSnapshotId } }),
      prisma.statareaCaptureAttempt.count({ where: { snapshotId: run.statareaSnapshotId } }),
      prisma.dailyRanking.count(),
      prisma.trackedObservation.count(),
    ]);
    const quoteRowsWithForbiddenState = await prisma.quoteRequestPlan.count({ where: { prospectiveRunId: run.id, OR: [{ availableOdds: { not: null } }, { priceStatus: { not: "NOT_CAPTURED" } }, { marketValueStatus: { not: "UNKNOWN" } }, { bookmakerMarketCode: { not: "UNRESOLVED" } }, { bookmakerMarketLabel: { not: "UNRESOLVED" } }] } });
    const maximumQuotesPerFixture = Math.max(...assessmentRows.map((assessment) => quoteRows.filter((quote) => quote.fixtureAssessmentId === assessment.id).length));
    const frozenTimestampsUnchanged = assessmentRows.every((assessment) => assessment.decisionFrozenAt.getTime() === run.frozenAt.getTime());
    if (run.registryHash !== HISTORICAL_REGISTRY_HASH || run.historicalAnalysisSpecHash !== HISTORICAL_ANALYSIS_SPEC_HASH || run.priorityPolicyHash !== marketPriorityPolicyHash || run.matcherConfigurationHash !== MATCH_CONFIGURATION_HASH || run.outcomeReadCount !== 0 || run.quoteCaptureCount !== 0 || quoteRowsWithForbiddenState !== 0 || runCount !== 1 || matchRunCount !== 1 || matchRun.matchedCount < 1 || matchDecisionCount !== matchRun.matchedCount || projections !== matchRun.matchedCount || candidates < 1 || assessmentRows.length !== matchRun.matchedCount || !assessments.length || !quotes.length || maximumQuotesPerFixture > 3 || !frozenTimestampsUnchanged || forebetAttempts !== 1 || statareaAttempts !== 1 || triggers.length !== 14) throw new Error("PROSPECTIVE_AUDIT_INVARIANT_FAILED");
    console.log(JSON.stringify({ runId: run.id, runHash: run.runHash, frozenAt: run.frozenAt, uniqueRows: { prospectiveRuns: runCount, matchRuns: matchRunCount, matchedDecisions: matchDecisionCount, projections, candidates, assessments: assessmentRows.length, quoteRequests: quoteRows.length }, sourceCaptureAttempts: { forebet: forebetAttempts, statarea: statareaAttempts }, matchCounts: { matched: matchRun.matchedCount, ambiguous: matchRun.ambiguousCount, conflict: matchRun.conflictCount }, selectionCounts: assessments, quoteFamilyCounts: quotes, maximumQuotesPerFixture, frozenTimestampsUnchanged, attempts, audits, appendOnlyTriggers: triggers.length, outcomeReads: run.outcomeReadCount, quoteCaptures: run.quoteCaptureCount, quoteRowsWithForbiddenState, rankings, tracking, hashes: { registry: run.registryHash, historicalSpec: run.historicalAnalysisSpecHash, policy: run.priorityPolicyHash, matcherConfiguration: run.matcherConfigurationHash } }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
