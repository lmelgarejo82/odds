import type { DailyMarket } from "./daily-analysis";

export type OperationalResultStatus = "PENDING" | "HIT" | "MISS" | "VOID";
export type TerminalOutcome = Readonly<{
  result1X2: "HOME" | "DRAW" | "AWAY";
  regulationHomeScore: number;
  regulationAwayScore: number;
  void?: boolean;
}>;

export function evaluateOperationalResult(
  market: DailyMarket,
  outcome: TerminalOutcome | null,
): OperationalResultStatus {
  if (outcome === null) return "PENDING";
  if (outcome.void === true) return "VOID";
  const goals = outcome.regulationHomeScore + outcome.regulationAwayScore;
  const hit = market === "HOME" ? outcome.result1X2 === "HOME"
    : market === "DRAW" ? outcome.result1X2 === "DRAW"
    : market === "AWAY" ? outcome.result1X2 === "AWAY"
    : market === "1X" ? outcome.result1X2 !== "AWAY"
    : market === "X2" ? outcome.result1X2 !== "HOME"
    : market === "12" ? outcome.result1X2 !== "DRAW"
    : market === "OVER_15" ? goals >= 2
    : market === "UNDER_15" ? goals <= 1
    : market === "OVER_25" ? goals >= 3
    : market === "UNDER_25" ? goals <= 2
    : null;
  return hit === null ? "VOID" : hit ? "HIT" : "MISS";
}

export type PerformanceRecord = Readonly<{
  market: DailyMarket;
  category: string;
  probability: number | null;
  frozenOdds: number | null;
  validPrematchOdds: boolean;
  status: OperationalResultStatus;
}>;

export type PerformanceSummary = Readonly<{
  sample: number;
  pending: number;
  resolved: number;
  hits: number;
  misses: number;
  void: number;
  hitRate: number | null;
  brier: number | null;
  wilsonLower95: number | null;
  wilsonUpper95: number | null;
  pricedSample: number;
  pricedNetUnits: number | null;
  calibrationStatus: "BOOTSTRAP" | "EARLY" | "VALIDATED";
}>;

export function summarizePerformance(records: readonly PerformanceRecord[]): PerformanceSummary {
  const pending = records.filter((x) => x.status === "PENDING").length;
  const hits = records.filter((x) => x.status === "HIT").length;
  const misses = records.filter((x) => x.status === "MISS").length;
  const voidCount = records.filter((x) => x.status === "VOID").length;
  const resolved = hits + misses;
  const hitRate = resolved === 0 ? null : hits / resolved;
  const brierRows = records.filter((x) => (x.status === "HIT" || x.status === "MISS") && x.probability !== null && Number.isFinite(x.probability));
  const brier = brierRows.length === 0 ? null : brierRows.reduce((sum, x) => sum + ((x.probability as number) - (x.status === "HIT" ? 1 : 0)) ** 2, 0) / brierRows.length;
  let wilsonLower95: number | null = null, wilsonUpper95: number | null = null;
  if (hitRate !== null) {
    const z = 1.959963984540054, denominator = 1 + z * z / resolved;
    const center = (hitRate + z * z / (2 * resolved)) / denominator;
    const half = z * Math.sqrt((hitRate * (1 - hitRate) + z * z / (4 * resolved)) / resolved) / denominator;
    wilsonLower95 = Math.max(0, center - half);
    wilsonUpper95 = Math.min(1, center + half);
  }
  const priced = records.filter((x) => (x.status === "HIT" || x.status === "MISS" || x.status === "VOID") && x.validPrematchOdds && x.frozenOdds !== null && x.frozenOdds > 1);
  const pricedNetUnits = priced.length === 0 ? null : priced.reduce((sum, x) => sum + (x.status === "HIT" ? (x.frozenOdds as number) - 1 : x.status === "MISS" ? -1 : 0), 0);
  const calibrationStatus = resolved < 30 ? "BOOTSTRAP" : resolved < 100 ? "EARLY" : "VALIDATED";
  return Object.freeze({ sample: records.length, pending, resolved, hits, misses, void: voidCount, hitRate, brier, wilsonLower95, wilsonUpper95, pricedSample: priced.length, pricedNetUnits, calibrationStatus });
}

export function groupPerformance(
  records: readonly PerformanceRecord[],
  key: "market" | "category",
): readonly Readonly<{ key: string; summary: PerformanceSummary }>[] {
  const groups = new Map<string, PerformanceRecord[]>();
  for (const record of records) groups.set(record[key], [...(groups.get(record[key]) ?? []), record]);
  return Object.freeze([...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([value, rows]) => Object.freeze({ key: value, summary: summarizePerformance(rows) })));
}
