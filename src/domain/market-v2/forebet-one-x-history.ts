export const FOREBET_ONE_X_HISTORY = Object.freeze({
  version: "forebet-top10-1x-history/1.0.0",
  source: "FOREBET",
  datasetCode: "FOREBET-1X2-HISTORICAL-BACKTEST",
  datasetHash: "95d596e7c1897bf733aa9c2365badedfeaedfd219a936a45be6bee5396ebd317",
  sourceCommit: "59c9c04",
  period: Object.freeze({ from: "2026-06-24", to: "2026-07-29", dates: 36 }),
  universe: Object.freeze({ matches: 4809, settled: 4713 }),
  allForebetHome: Object.freeze({ selected: 2026, settled: 1985, hits: 1572, misses: 413, hitRate: 1572 / 1985 }),
  topTen: Object.freeze({ selected: 359, settled: 348, hits: 307, misses: 41, unresolved: 11, hitRate: 307 / 348 }),
  verification: Object.freeze({ selected: 110, settled: 103, hits: 91, misses: 12, unresolved: 7, hitRate: 91 / 103, wilsonLower95: 0.8073288034372147, wilsonUpper95: 0.9320845373388708 }),
  rankBands: Object.freeze({
    topThree: Object.freeze({ from: 1, to: 3, settled: 103, hits: 95, misses: 8, hitRate: 95 / 103, verificationSettled: 30, verificationHits: 27, verificationHitRate: 27 / 30 }),
    fourToTen: Object.freeze({ from: 4, to: 10, settled: 245, hits: 212, misses: 33, hitRate: 212 / 245, verificationSettled: 73, verificationHits: 64, verificationHitRate: 64 / 73 }),
    elevenToTwenty: Object.freeze({ from: 11, to: 20, settled: 316, hits: 252, misses: 64, hitRate: 252 / 316, verificationSettled: 100, verificationHits: 81, verificationHitRate: 81 / 100 }),
  }),
  oneXOver15Verification: Object.freeze({ settled: 380, hits: 241, misses: 139, hitRate: 241 / 380 }),
  directOneXVerification: Object.freeze({ settled: 380, hits: 303, misses: 77, hitRate: 303 / 380 }),
  minimumConservativeReviewOdds: 1.24,
} as const);

export type ForebetRankEvidence = Readonly<{
  label: string;
  settled: number;
  hits: number;
  hitRate: number;
  verificationSettled: number;
  verificationHits: number;
  verificationHitRate: number;
}>;

export function forebetRankEvidence(rank: number): ForebetRankEvidence | null {
  const band = rank <= 3
    ? FOREBET_ONE_X_HISTORY.rankBands.topThree
    : rank <= 10
      ? FOREBET_ONE_X_HISTORY.rankBands.fourToTen
      : rank <= 20
        ? FOREBET_ONE_X_HISTORY.rankBands.elevenToTwenty
        : null;
  if (!band) return null;
  return Object.freeze({
    label: `Puestos ${band.from}–${band.to}`,
    settled: band.settled,
    hits: band.hits,
    hitRate: band.hitRate,
    verificationSettled: band.verificationSettled,
    verificationHits: band.verificationHits,
    verificationHitRate: band.verificationHitRate,
  });
}

export function normalizeForebetOneX(home: number, draw: number, away: number): number | null {
  const total = home + draw + away;
  if (![home, draw, away, total].every(Number.isFinite) || home < 0 || draw < 0 || away < 0 || total <= 0) return null;
  return (home + draw) / total;
}

export function oneXExpectedValue(probability: number, decimalOdds: number): number | null {
  if (!Number.isFinite(probability) || probability < 0 || probability > 1 || !Number.isFinite(decimalOdds) || decimalOdds <= 1) return null;
  return probability * decimalOdds - 1;
}
