import { PrismaClient } from "@prisma/client";
import { evaluateMarkets, type DailyPrediction } from "@/domain/market-v2/daily-analysis";
import { matchAutomaticFixture, scoreAutomaticReview, selectAutomaticReview } from "@/domain/market-v2/automatic-review-v1";
import { mapPriceableOdds } from "@/domain/market-v2/odds-market-mapping";
import { readVerifiedOddsEvidence } from "@/infrastructure/market-v2/daily/team-alias-workflow";

const values = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) values.set(process.argv[index], process.argv[index + 1]);
const databaseUrl = values.get("--database-url"), evidenceRoot = values.get("--evidence-root"), runId = values.get("--run-id");
if (!databaseUrl?.startsWith("file:/") || !evidenceRoot?.startsWith("/") || !runId) throw new Error("ARGUMENT_INVALID");
const safeDatabaseUrl = databaseUrl as string, safeEvidenceRoot = evidenceRoot as string, safeRunId = runId as string;

async function main(): Promise<void> {
  const db = new PrismaClient({ datasourceUrl: safeDatabaseUrl });
  try {
    const run = await db.dailyAnalysisRun.findUnique({ where: { id: safeRunId }, select: { id: true, evidence: true, candidates: { where: { predictionJson: { not: null } }, include: { fixture: { include: { homeTeam: true, awayTeam: true } } } } } });
    if (!run) throw new Error("RUN_NOT_FOUND");
    const artifact = run.evidence.find((x) => x.providerKey === "the-odds-api");
    if (!artifact) throw new Error("ODDS_EVIDENCE_NOT_FOUND");
    const verified = await readVerifiedOddsEvidence(safeEvidenceRoot, artifact.storageReference, artifact.contentHash);
    const candidates = run.candidates.map((candidate) => {
      const prediction = JSON.parse(candidate.predictionJson!) as DailyPrediction;
      const match = matchAutomaticFixture({ fixtureId: candidate.fixtureId, homeName: candidate.fixture.homeTeam.displayName, awayName: candidate.fixture.awayTeam.displayName, kickoffAtUtc: candidate.fixture.kickoffAtUtc.toISOString(), competitionName: candidate.fixture.competitionName, country: candidate.fixture.country }, verified.events.map((event) => ({ id: event.id, homeName: event.home_team, awayName: event.away_team, kickoffAtUtc: event.commence_time, sportKey: event.sport_key, sportTitle: event.sport_title })));
      const event = match.matchedEventId ? verified.events.find((x) => x.id === match.matchedEventId) : undefined;
      const mapped = event ? mapPriceableOdds(event) : { quotes: [] };
      const evaluations = evaluateMarkets(prediction, mapped.quotes);
      const probabilities = [prediction.home, prediction.draw, prediction.away].sort((a, b) => b - a);
      const best = evaluations.filter((x) => x.modelProbability !== null).map((evaluation) => ({ evaluation, score: scoreAutomaticReview({ market: evaluation.market, modelProbability: evaluation.modelProbability!, topMargin: ["HOME", "DRAW", "AWAY"].includes(evaluation.market) ? probabilities[0] - probabilities[1] : 0.1, dataQuality: Number(candidate.dataQuality), contextualAgreement: prediction.contextualAgreement, contradictory: prediction.contradictory, edge: evaluation.edge, expectedValue: evaluation.expectedValue, dispersion: evaluation.dispersion }) })).sort((a, b) => b.score.total - a.score.total)[0];
      return { fixtureId: candidate.fixtureId, category: best.score.category, score: best.score.total, edge: best.evaluation.edge, kickoffAtUtc: candidate.fixture.kickoffAtUtc.toISOString(), match, usableOdds: event ? mapPriceableOdds(event).quotes.length : 0 };
    });
    const selected = selectAutomaticReview(candidates);
    const counts = (category: string) => candidates.filter((x) => x.category === category).length;
    for (const [key, value] of Object.entries({ OFFLINE_REPLAY_COMPLETE: true, SOURCE_RUN_ID: run.id, NETWORK_CALLS: 0, EVENTS: verified.events.length, MATCHED: candidates.filter((x) => x.match.matchedEventId).length, USABLE_ODDS: candidates.reduce((sum, x) => sum + x.usableOdds, 0), VALUE_DETECTED: counts("VALUE_DETECTED"), MODEL_REVIEW: counts("MODEL_REVIEW"), WATCH: counts("WATCH"), PASS: counts("PASS"), PRIMARY_SELECTIONS: selected.primary.length, EXIT: 0 })) console.log(`${key} ${String(value)}`);
  } finally { await db.$disconnect(); }
}
void main();
