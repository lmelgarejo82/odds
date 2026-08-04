import { PrismaClient } from "@prisma/client";
import { diagnoseFrozenOddsSet } from "@/domain/market-v2/odds-offline-diagnostic";
import type { DiscoveredFixture } from "@/domain/market-v2/daily-analysis";
import { readVerifiedOddsEvidence } from "@/infrastructure/market-v2/daily/team-alias-workflow";

const values = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const databaseUrl = values.get("--database-url"), evidenceRoot = values.get("--evidence-root"), runId = values.get("--run-id");
if (!databaseUrl?.startsWith("file:/") || !evidenceRoot?.startsWith("/") || !runId) throw new Error("ARGUMENT_INVALID");
const safeDatabaseUrl = databaseUrl as string, safeEvidenceRoot = evidenceRoot as string, safeRunId = runId as string;

async function main(): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: safeDatabaseUrl });
  try {
    const run = await db.dailyAnalysisRun.findUnique({
      where: { id: safeRunId },
      select: {
        id: true,
        evidence: { where: { providerKey: "the-odds-api" }, orderBy: { capturedAtUtc: "desc" }, take: 1 },
        candidates: { orderBy: { discoveryOrdinal: "asc" }, take: 10, include: { fixture: { include: { homeTeam: true, awayTeam: true } } } },
      },
    });
    if (!run) throw new Error("RUN_NOT_FOUND");
    const artifact = run.evidence[0]; if (!artifact) throw new Error("ODDS_EVIDENCE_NOT_FOUND");
    const verified = await readVerifiedOddsEvidence(safeEvidenceRoot, artifact.storageReference, artifact.contentHash);
    const fixtures: DiscoveredFixture[] = run.candidates.map(({ fixture }) => ({
      providerFixtureId: fixture.id,
      providerCompetitionId: fixture.competitionKey,
      providerHomeTeamId: fixture.homeTeamId,
      providerAwayTeamId: fixture.awayTeamId,
      sportsDate: fixture.sportsDate,
      kickoffAtUtc: fixture.kickoffAtUtc.toISOString(),
      sourceTimezone: fixture.sourceTimezone,
      status: fixture.status,
      season: fixture.season,
      round: fixture.round,
      competitionName: fixture.competitionName,
      country: fixture.country,
      homeName: fixture.homeTeam.displayName,
      awayName: fixture.awayTeam.displayName,
    }));
    const matrix = diagnoseFrozenOddsSet(fixtures, verified.events.map((event) => ({ id: event.id, homeName: event.home_team, awayName: event.away_team, kickoffAtUtc: event.commence_time, sportKey: event.sport_key, sportTitle: event.sport_title })));
    for (const row of matrix) console.log(`ODDS_DIAGNOSTIC_ROW ${JSON.stringify(row)}`);
    const counts = new Map<string, number>(); for (const row of matrix) if (row.rejectionReason) counts.set(row.rejectionReason, (counts.get(row.rejectionReason) ?? 0) + 1);
    const dominant = [...counts].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0]?.[0] ?? "NONE";
    for (const [key, value] of Object.entries({ ODDS_DIAGNOSTIC_COMPLETE: true, RUN_ID: run.id, FIXTURES: matrix.length, EVENTS: verified.events.length, NEAREST_PER_FIXTURE: 5, DOMINANT_REJECTION_REASON: dominant, NETWORK_CALLS: 0, EXIT: 0 })) console.log(`${key} ${String(value)}`);
  } finally { await db.$disconnect(); }
}

void main();
