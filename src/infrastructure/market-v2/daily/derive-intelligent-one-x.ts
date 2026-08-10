import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { AUTOMATIC_DAILY_RANKING_POLICY, AUTOMATIC_ODDS_MATCHING_POLICY, scoreAutomaticReview, type AutomaticCategory } from "@/domain/market-v2/automatic-review-v1";
import { isDevelopmentFixture, type DailyPrediction } from "@/domain/market-v2/daily-analysis";
import { INTELLIGENT_ONE_X_POLICY, assessIntelligentOneX } from "@/domain/market-v2/intelligent-one-x";
import { DEEP_ANALYSIS_SELECTION_POLICY } from "@/domain/market-v2/odds-acquisition";

const token = (...values: string[]): string => createHash("sha256").update(values.join("\0")).digest("hex");

function parsePrediction(value: string | null): DailyPrediction | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (![parsed.home, parsed.draw, parsed.away].every((item) => typeof item === "number")) return null;
    return {
      home: Number(parsed.home),
      draw: Number(parsed.draw),
      away: Number(parsed.away),
      winner: typeof parsed.winner === "string" ? parsed.winner : null,
      advice: typeof parsed.advice === "string" ? parsed.advice : null,
      contextualAgreement: typeof parsed.contextualAgreement === "number" ? parsed.contextualAgreement : 0,
      contradictory: parsed.contradictory === true,
      rawSignals: typeof parsed.rawSignals === "object" && parsed.rawSignals !== null ? parsed.rawSignals as Readonly<Record<string, unknown>> : {},
    };
  } catch {
    return null;
  }
}

export type IntelligentOneXReplayResult = Readonly<{
  runId: string;
  sourceRunId: string;
  sportsDate: string;
  fixturesReviewed: number;
  fixturesExcluded: number;
  signals: number;
  modelReview: number;
  watch: number;
  pass: number;
  networkCalls: 0;
  replayed: boolean;
}>;

export async function deriveIntelligentOneXRun(databaseUrl: string, sourceRunId: string): Promise<IntelligentOneXReplayResult> {
  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  try {
    const source = await prisma.dailyAnalysisRun.findUnique({
      where: { id: sourceRunId },
      include: {
        evidence: true,
        exclusions: true,
        candidates: {
          orderBy: { discoveryOrdinal: "asc" },
          include: { fixture: { include: { homeTeam: true, awayTeam: true } } },
        },
      },
    });
    if (!source) throw new Error("SOURCE_RUN_NOT_FOUND");

    const runId = `derived-${token(source.id, INTELLIGENT_ONE_X_POLICY.version, "offline-intelligent-one-x").slice(0, 32)}`;
    const existing = await prisma.dailyAnalysisRun.findUnique({ where: { id: runId }, include: { candidates: { include: { recommendations: true } } } });
    if (existing) return summarize(existing, source.id, true);

    const prepared = source.candidates.map((candidate) => {
      const fixtureShape = {
        homeName: candidate.fixture.homeTeam.displayName,
        awayName: candidate.fixture.awayTeam.displayName,
        competitionName: candidate.fixture.competitionName,
        round: candidate.fixture.round,
      };
      const friendly = /friendl(?:y|ies)|amistos[oa]s?/iu.test(`${fixtureShape.competitionName} ${fixtureShape.round}`);
      const exclusionReason = friendly ? "FRIENDLY_EXCLUDED" : isDevelopmentFixture(fixtureShape) ? "DEVELOPMENT_TEAM_EXCLUDED" : null;
      const prediction = parsePrediction(candidate.predictionJson);
      if (exclusionReason || !candidate.deepAnalyzed || !prediction) return { candidate, prediction, signal: null, scored: null, category: "PASS" as AutomaticCategory, exclusionReason };
      const signal = assessIntelligentOneX({
        homeProbability: prediction.home,
        drawProbability: prediction.draw,
        awayProbability: prediction.away,
        homeName: fixtureShape.homeName,
        winnerName: prediction.winner ?? null,
        advice: prediction.advice ?? null,
      });
      const scored = scoreAutomaticReview({
        market: "1X",
        modelProbability: signal.probability,
        topMargin: signal.protectionGap,
        dataQuality: Number(candidate.dataQuality),
        contextualAgreement: signal.contextualAgreement,
        contradictory: signal.contradictory,
        edge: null,
        expectedValue: null,
        dispersion: null,
      });
      return { candidate, prediction, signal, scored, category: signal.publishable ? scored.category : "PASS" as AutomaticCategory, exclusionReason: null };
    });
    const ranked = prepared
      .filter((item) => item.signal && item.scored && !item.exclusionReason)
      .sort((left, right) => {
        const priority: Record<AutomaticCategory, number> = { VALUE_DETECTED: 0, MODEL_REVIEW: 1, WATCH: 2, PASS: 3 };
        return priority[left.category] - priority[right.category] || right.scored!.total - left.scored!.total || left.candidate.fixture.kickoffAtUtc.valueOf() - right.candidate.fixture.kickoffAtUtc.valueOf();
      });
    const ranks = new Map(ranked.map((item, index) => [item.candidate.id, index + 1]));
    const now = new Date();

    await prisma.$transaction(async (tx) => {
      await tx.dailyAnalysisRun.create({ data: {
        id: runId,
        derivedFromRunId: source.id,
        sportsDate: source.sportsDate,
        mode: "MODEL_ONLY_PROVISIONAL",
        status: "COMPLETED",
        scoringPolicyVersion: AUTOMATIC_DAILY_RANKING_POLICY.version,
        selectionPolicyVersion: DEEP_ANALYSIS_SELECTION_POLICY.version,
        matcherVersion: AUTOMATIC_ODDS_MATCHING_POLICY.version,
        startedAtUtc: now,
        completedAtUtc: now,
        historicalCalibrationAvailable: false,
        historicalDatasetFound: false,
        historicalMarketsCalibrated: 0,
        oddsAvailable: false,
        oddsResponseReceived: false,
        oddsEventsReceived: 0,
        oddsFixturesMatched: 0,
        oddsMarketsMatched: 0,
        usableOddsAvailable: false,
        usableOddsCount: 0,
        marketEvaluationsCreated: ranked.length,
        oddsDiagnosticsJson: "[]",
        marketValueCalculated: false,
        fixturesMatchedExact: 0,
        fixturesMatchedAlias: 0,
        fixturesUnmatched: ranked.length,
        fixturesAmbiguous: 0,
        fixturesDiscovered: source.fixturesDiscovered,
        fixturesEligible: prepared.filter((item) => !item.exclusionReason && item.candidate.eligible).length,
        fixturesDeepAnalyzed: ranked.length,
        fixturesExcluded: source.fixturesExcluded + prepared.filter((item) => item.exclusionReason).length,
        recommendations: ranked.length,
        apiFootballBudget: 0,
        apiFootballRequests: 0,
        oddsBudget: 0,
        oddsRequests: 0,
        warningsJson: JSON.stringify(["INTELLIGENT_ONE_X_OFFLINE_REPLAY", INTELLIGENT_ONE_X_POLICY.version, "NETWORK_CALLS_0", "APPEND_ONLY"]),
      } });

      for (const item of prepared) {
        const candidateId = `cand-${token(runId, item.candidate.fixtureId).slice(0, 24)}`;
        await tx.dailyFixtureCandidate.create({ data: {
          id: candidateId,
          runId,
          fixtureId: item.candidate.fixtureId,
          eligible: item.candidate.eligible && !item.exclusionReason,
          deepAnalyzed: Boolean(item.signal),
          discoveryOrdinal: item.candidate.discoveryOrdinal,
          dataQuality: item.candidate.dataQuality,
          predictionJson: item.candidate.predictionJson,
          reasonsJson: item.candidate.reasonsJson,
          warningsJson: item.candidate.warningsJson,
        } });
        if (item.exclusionReason) {
          await tx.dailyExclusion.create({ data: { id: `exc-${token(runId, item.candidate.id).slice(0, 24)}`, runId, fixtureLabel: `${item.candidate.fixture.homeTeam.displayName} — ${item.candidate.fixture.awayTeam.displayName}`, reasonCode: item.exclusionReason, detailsJson: JSON.stringify({ sourceCandidateId: item.candidate.id }) } });
        }
        if (!item.signal || !item.scored || item.exclusionReason) continue;
        const evaluationId = `eval-${token(candidateId, "1X").slice(0, 24)}`;
        await tx.dailyMarketEvaluation.create({ data: {
          id: evaluationId,
          candidateId,
          market: "1X",
          evaluationStatus: "MODEL_ONLY",
          modelProbability: item.signal.probability,
          fairOdds: 1 / item.signal.probability,
          bestMarketOdds: null,
          marketImpliedProbability: null,
          marketMargin: null,
          noVigProbability: null,
          edge: null,
          expectedValue: null,
          bookmakerDispersion: null,
          bookmakerCount: 0,
          consensusOdds: null,
          historicalSample: 0,
          calibrationStatus: "BOOTSTRAP",
          matchingJson: JSON.stringify({ method: "offline-intelligent-1x", sourceRunId: source.id }),
          offeredOddsStatus: "SIN_COTIZACION_DIRECTA",
          reasonsJson: JSON.stringify(item.signal.reasons),
          warningsJson: JSON.stringify(item.signal.risks),
        } });
        const [model, history, market, context, quality] = item.scored.components;
        await tx.dailyRecommendation.create({ data: {
          id: `rec-${token(evaluationId).slice(0, 24)}`,
          candidateId,
          marketEvaluationId: evaluationId,
          rank: ranks.get(item.candidate.id)!,
          market: "1X",
          recommendationStatus: item.category === "PASS" ? "DISCARDED" : "PENDING_REVIEW",
          classification: item.category,
          automaticCategory: item.category,
          reviewStatus: "PENDING_REVIEW",
          scoreTotal: item.scored.total,
          modelConfidenceScore: model,
          historicalCalibrationScore: history,
          marketValueScore: market,
          contextualAgreementScore: context,
          dataQualityScore: quality,
          penaltiesTotal: model + history + market + context + quality - item.scored.total,
          explanationJson: JSON.stringify(item.signal.reasons),
          risksJson: JSON.stringify([...new Set([...item.scored.risks, ...item.signal.risks])]),
          modelSuggestedMarket: "1X",
          bestPricedMarket: null,
        } });
      }

      for (const exclusion of source.exclusions) await tx.dailyExclusion.create({ data: { id: `exc-${token(runId, exclusion.id).slice(0, 24)}`, runId, providerFixtureId: exclusion.providerFixtureId, fixtureLabel: exclusion.fixtureLabel, reasonCode: exclusion.reasonCode, detailsJson: exclusion.detailsJson } });
      for (const evidence of source.evidence) await tx.dailyRawEvidence.create({ data: { id: `ev-${token(runId, evidence.id).slice(0, 24)}`, runId, providerKey: evidence.providerKey, endpointKey: evidence.endpointKey, capturedAtUtc: evidence.capturedAtUtc, contentHash: evidence.contentHash, byteLength: evidence.byteLength, mediaType: evidence.mediaType, storageReference: evidence.storageReference } });
    });

    const created = await prisma.dailyAnalysisRun.findUniqueOrThrow({ where: { id: runId }, include: { candidates: { include: { recommendations: true } } } });
    return summarize(created, source.id, false);
  } finally {
    await prisma.$disconnect();
  }
}

function summarize(run: { id: string; sportsDate: string; fixturesExcluded: number; candidates: readonly { recommendations: readonly { automaticCategory: string }[] }[] }, sourceRunId: string, replayed: boolean): IntelligentOneXReplayResult {
  const categories = run.candidates.flatMap((candidate) => candidate.recommendations.map((recommendation) => recommendation.automaticCategory));
  const count = (category: string): number => categories.filter((value) => value === category).length;
  return Object.freeze({ runId: run.id, sourceRunId, sportsDate: run.sportsDate, fixturesReviewed: categories.length, fixturesExcluded: run.fixturesExcluded, signals: categories.filter((value) => value !== "PASS").length, modelReview: count("MODEL_REVIEW"), watch: count("WATCH"), pass: count("PASS"), networkCalls: 0, replayed });
}
