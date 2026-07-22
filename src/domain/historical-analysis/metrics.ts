import Decimal from "decimal.js";

export type EvaluationCase = Readonly<{ hit: boolean; sourcePercent: Decimal.Value | null; country: string | null; competition: string | null; sportsDate: string }>;

export function wilson95(hits: number, evaluable: number) {
  if (evaluable === 0) return { lower: null, upper: null };
  const z = new Decimal("1.959963984540054");
  const n = new Decimal(evaluable); const p = new Decimal(hits).div(n); const z2 = z.pow(2);
  const center = p.plus(z2.div(n.mul(2)));
  const margin = z.mul(p.mul(new Decimal(1).minus(p)).div(n).plus(z2.div(n.pow(2).mul(4))).sqrt());
  const denominator = new Decimal(1).plus(z2.div(n));
  return { lower: Decimal.max(0, center.minus(margin).div(denominator)), upper: Decimal.min(1, center.plus(margin).div(denominator)) };
}

export function sampleClass(n: number) { return n < 10 ? "INSUFFICIENT_SAMPLE" as const : n < 30 ? "SMALL_SAMPLE" as const : "REGULAR_SAMPLE" as const; }
export function stabilityClass(discovery: Decimal.Value | null, validation: Decimal.Value | null) {
  if (discovery === null || validation === null) return null;
  const differencePoints = new Decimal(validation).minus(discovery).mul(100);
  return differencePoints.gte(-5) ? "STABLE_OR_IMPROVED" as const : differencePoints.gte(-10) ? "MODERATE_DROP" as const : "SEVERE_DROP" as const;
}

function maximumShare(values: Array<string | null>) {
  if (!values.length) return null;
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value ?? "UNKNOWN", (counts.get(value ?? "UNKNOWN") ?? 0) + 1);
  return new Decimal(Math.max(...counts.values())).div(values.length);
}

function maximumStreak(cases: EvaluationCase[], desired: boolean) {
  let current = 0; let maximum = 0;
  for (const item of [...cases].sort((left, right) => left.sportsDate.localeCompare(right.sportsDate))) {
    current = item.hit === desired ? current + 1 : 0;
    maximum = Math.max(maximum, current);
  }
  return maximum;
}

export function calculateMetrics(cases: EvaluationCase[], total = cases.length) {
  const evaluable = cases.length; const hits = cases.filter((item) => item.hit).length; const misses = evaluable - hits;
  const hitRate = evaluable ? new Decimal(hits).div(evaluable) : null;
  const wilson = wilson95(hits, evaluable);
  const brierCases = cases.filter((item) => item.sourcePercent !== null);
  const brierScore = brierCases.length ? brierCases.reduce((sum, item) => sum.plus(new Decimal(item.sourcePercent!).div(100).minus(item.hit ? 1 : 0).pow(2)), new Decimal(0)).div(brierCases.length) : null;
  const maxCountryShare = maximumShare(cases.map((item) => item.country));
  const maxCompetitionShare = maximumShare(cases.map((item) => item.competition));
  const warnings: string[] = [];
  if (evaluable < 10) warnings.push("INSUFFICIENT_SAMPLE"); else if (evaluable < 30) warnings.push("SMALL_SAMPLE");
  if (wilson.lower && wilson.upper.minus(wilson.lower).gt("0.25")) warnings.push("WIDE_WILSON_INTERVAL");
  if (maxCompetitionShare?.gt("0.40")) warnings.push("HIGH_COMPETITION_CONCENTRATION");
  if (maxCountryShare?.gt("0.50")) warnings.push("HIGH_COUNTRY_CONCENTRATION");
  return {
    total, evaluable, hits, misses, hitRate, wilsonLower: wilson.lower, wilsonUpper: wilson.upper, brierScore,
    theoreticalBreakEvenOdds: hitRate?.gt(0) ? new Decimal(1).div(hitRate) : null,
    retainedSampleRate: total ? new Decimal(evaluable).div(total) : null,
    maxCountryShare, maxCompetitionShare,
    maxHitStreak: maximumStreak(cases, true), maxMissStreak: maximumStreak(cases, false), sampleClass: sampleClass(evaluable), warnings,
  };
}

export function calibrationBucket(percent: Decimal.Value) {
  const value = new Decimal(percent);
  if (value.lt(0) || value.gt(100)) throw new Error("SOURCE_PERCENT_OUT_OF_RANGE");
  if (value.lt(50)) return { code: "0_49_99", lower: new Decimal(0), upper: new Decimal("49.99") };
  if (value.lt(60)) return { code: "50_59_99", lower: new Decimal(50), upper: new Decimal("59.99") };
  if (value.lt(70)) return { code: "60_69_99", lower: new Decimal(60), upper: new Decimal("69.99") };
  if (value.lt(80)) return { code: "70_79_99", lower: new Decimal(70), upper: new Decimal("79.99") };
  if (value.lt(90)) return { code: "80_89_99", lower: new Decimal(80), upper: new Decimal("89.99") };
  return { code: "90_100", lower: new Decimal(90), upper: new Decimal(100) };
}

export function consensusLift(consensus: Decimal.Value | null, forebet: Decimal.Value | null, statarea: Decimal.Value | null) {
  if (consensus === null || forebet === null || statarea === null) return null;
  return new Decimal(consensus).minus(Decimal.max(forebet, statarea));
}
