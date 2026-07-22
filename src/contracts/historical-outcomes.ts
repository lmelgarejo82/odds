import { z } from "zod";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const outcome = z.strictObject({
  matchDecisionId: z.string().min(1),
  partition: z.enum(["DISCOVERY", "VALIDATION"]),
  reconciliationStatus: z.enum(["AGREED", "FOREBET_ONLY", "STATAREA_ONLY", "CONFLICT", "MISSING", "UNSUPPORTED"]),
  forebetEvidenceId: z.string().nullable(),
  statareaEvidenceId: z.string().nullable(),
  homeGoals: z.number().int().nonnegative().nullable(),
  awayGoals: z.number().int().nonnegative().nullable(),
  totalGoals: z.number().int().nonnegative().nullable(),
  result1X2: z.enum(["HOME_WIN", "DRAW", "AWAY_WIN"]).nullable(),
  ou25Outcome: z.enum(["OVER_25", "UNDER_25"]).nullable(),
  doubleChance1XOutcome: z.boolean().nullable(),
  doubleChanceX2Outcome: z.boolean().nullable(),
  doubleChance12Outcome: z.boolean().nullable(),
  warnings: z.array(z.string()),
}).superRefine((value, context) => {
  if (value.reconciliationStatus === "AGREED" && (!value.forebetEvidenceId || !value.statareaEvidenceId)) context.addIssue({ code: "custom", message: "AGREED_REQUIRES_TWO_EVIDENCES" });
  const evaluable = ["AGREED", "FOREBET_ONLY", "STATAREA_ONLY"].includes(value.reconciliationStatus);
  if (!evaluable && value.homeGoals !== null) context.addIssue({ code: "custom", message: "EXCLUDED_STATUS_HAS_OUTCOME" });
  if (value.homeGoals !== null && value.awayGoals !== null) {
    const total = value.homeGoals + value.awayGoals;
    const result = value.homeGoals > value.awayGoals ? "HOME_WIN" : value.homeGoals < value.awayGoals ? "AWAY_WIN" : "DRAW";
    const ou = total >= 3 ? "OVER_25" : "UNDER_25";
    if (value.totalGoals !== total || value.result1X2 !== result || value.ou25Outcome !== ou) context.addIssue({ code: "custom", message: "OUTCOME_INCONSISTENT_WITH_GOALS" });
  }
});

export const fixtureOutcomesSchema = z.strictObject({
  contractVersion: z.literal("fixture-outcomes/1.0"),
  spec: z.strictObject({ code: z.literal("OU25-HISTORICAL-MARKET-ANALYSIS"), version: z.literal("1.0.0"), specHash: hash }),
  dataset: z.strictObject({ code: z.literal("OU25-JULY-2026-V1"), manifestHash: hash, registryHash: hash }),
  extractionRunId: z.string().min(1),
  counts: z.strictObject({ total: z.literal(98), agreed: z.number().int().nonnegative(), forebetOnly: z.number().int().nonnegative(), statareaOnly: z.number().int().nonnegative(), conflict: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), unsupported: z.number().int().nonnegative() }),
  outcomes: z.array(outcome).length(98),
  warnings: z.array(z.string()),
}).superRefine((value, context) => {
  const countSum = value.counts.agreed + value.counts.forebetOnly + value.counts.statareaOnly + value.counts.conflict + value.counts.missing + value.counts.unsupported;
  if (countSum !== 98) context.addIssue({ code: "custom", message: "OUTCOME_COUNTS_MUST_TOTAL_98" });
});

export const patternEvaluationSchema = z.strictObject({
  contractVersion: z.literal("historical-pattern-evaluation/1.0"),
  specHash: hash,
  evaluationRunId: z.string().min(1),
  partition: z.enum(["DISCOVERY", "VALIDATION", "ALL_DESCRIPTIVE"]),
  evaluations: z.array(z.strictObject({
    patternCode: z.string().min(1), side: z.string().min(1), segment: z.string().min(1), total: z.number().int().nonnegative(), evaluable: z.number().int().nonnegative(), hits: z.number().int().nonnegative(), misses: z.number().int().nonnegative(), hitRate: z.number().min(0).max(1).nullable(), wilsonLower: z.number().min(0).max(1).nullable(), wilsonUpper: z.number().min(0).max(1).nullable(), brierScore: z.number().min(0).max(1).nullable(), theoreticalBreakEvenOdds: z.number().positive().nullable(), sampleClass: z.enum(["INSUFFICIENT_SAMPLE", "SMALL_SAMPLE", "REGULAR_SAMPLE"]), warnings: z.array(z.string()),
  }).superRefine((value, context) => {
    if (value.hits + value.misses !== value.evaluable) context.addIssue({ code: "custom", message: "HIT_MISS_MISMATCH" });
    const rate = value.evaluable ? value.hits / value.evaluable : null;
    if ((rate === null) !== (value.hitRate === null) || (rate !== null && Math.abs(rate - value.hitRate!) > 1e-9)) context.addIssue({ code: "custom", message: "HIT_RATE_MISMATCH" });
  })),
  disclaimer: z.literal("La cuota teórica no representa rentabilidad real ni cuota de valor."),
});
