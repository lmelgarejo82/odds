import Decimal from "decimal.js";
import type { Ou25Outcome, Result1X2 } from "./outcomes";

export type OuSide = "OVER_25" | "UNDER_25";
export type DoubleChanceLine = "1X" | "X2" | "12";

export function selectForebetOu(input: { suggestedSide: "OVER" | "UNDER"; probabilityOver25: Decimal.Value | null; probabilityUnder25: Decimal.Value | null }) {
  const side: OuSide = input.suggestedSide === "OVER" ? "OVER_25" : "UNDER_25";
  const value = side === "OVER_25" ? input.probabilityOver25 : input.probabilityUnder25;
  return { side, sourcePercent: value === null ? null : new Decimal(value) };
}

export function selectStatareaOu(sourceOver25Percent: Decimal.Value) {
  const over = new Decimal(sourceOver25Percent);
  if (over.eq(50)) return { side: null, sourcePercent: null };
  return over.gt(50) ? { side: "OVER_25" as const, sourcePercent: over } : { side: "UNDER_25" as const, sourcePercent: new Decimal(100).minus(over) };
}

export function selectOuConsensus(forebet: ReturnType<typeof selectForebetOu>, statarea: ReturnType<typeof selectStatareaOu>, threshold: 0 | 60 | 65 | 70) {
  if (!forebet.sourcePercent || !statarea.sourcePercent || forebet.side !== statarea.side || !statarea.side) return null;
  if (threshold > 0 && (forebet.sourcePercent.lt(threshold) || statarea.sourcePercent.lt(threshold))) return null;
  return { side: forebet.side, forebetPercent: forebet.sourcePercent, statareaPercent: statarea.sourcePercent };
}

export function selectForebetConfluence(input: { suggestedSide: "OVER" | "UNDER"; predictedHomeGoals: number | null; predictedAwayGoals: number | null; averageGoals: Decimal.Value | null }) {
  if (input.predictedHomeGoals === null || input.predictedAwayGoals === null || input.averageGoals === null) return null;
  const total = input.predictedHomeGoals + input.predictedAwayGoals;
  const average = new Decimal(input.averageGoals);
  if (input.suggestedSide === "OVER" && total >= 3 && average.gte("2.75")) return { code: "FOREBET_OVER_CONFLUENCE" as const, side: "OVER_25" as const };
  if (input.suggestedSide === "UNDER" && total <= 2 && average.lte("2.25")) return { code: "FOREBET_UNDER_CONFLUENCE" as const, side: "UNDER_25" as const };
  return null;
}

export function selectPreferredDoubleChance(input: Record<DoubleChanceLine, Decimal.Value>) {
  const values = (Object.entries(input) as Array<[DoubleChanceLine, Decimal.Value]>).map(([line, value]) => ({ line, value: new Decimal(value) })).sort((left, right) => right.value.comparedTo(left.value));
  if (values[0].value.eq(values[1].value)) return null;
  return { line: values[0].line, sourcePercent: values[0].value, marginToSecond: values[0].value.minus(values[1].value) };
}

export function isOuHit(side: OuSide, outcome: Ou25Outcome) { return side === outcome; }
export function isDoubleChanceHit(line: DoubleChanceLine, result: Result1X2) {
  return line === "1X" ? result !== "AWAY_WIN" : line === "X2" ? result !== "HOME_WIN" : result !== "DRAW";
}
export function isSameMatchCombinationHit(line: DoubleChanceLine, side: OuSide, result: Result1X2, outcome: Ou25Outcome) {
  return isDoubleChanceHit(line, result) && isOuHit(side, outcome);
}

export function favoriteSegment(input: { home: Decimal.Value; away: Decimal.Value; draw: Decimal.Value }) {
  const home = new Decimal(input.home); const away = new Decimal(input.away); const draw = new Decimal(input.draw);
  const favoriteSide = home.gt(away) ? "HOME" as const : away.gt(home) ? "AWAY" as const : "TIED" as const;
  const favoriteProbability = Decimal.max(home, away);
  const favoriteGap = home.minus(away).abs();
  const segment = favoriteProbability.gte(55) && favoriteGap.gte(15) ? "STRONG_FAVORITE" as const : favoriteGap.lte(10) ? "BALANCED" as const : "INTERMEDIATE" as const;
  return { favoriteSide, favoriteProbability, favoriteGap, drawProbability: draw, segment };
}

export function predictedGoalDifferenceSegment(home: number | null, away: number | null) {
  if (home === null || away === null) return null;
  const gap = Math.abs(home - away);
  return gap === 0 ? "0" as const : gap === 1 ? "1" as const : "2_PLUS" as const;
}
