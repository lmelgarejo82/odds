import { z } from "zod";
import { canonicalJson } from "@/domain/canonical-json";
import { historicalAnalysisSpec, type HistoricalAnalysisSpecContract } from "@/domain/historical-analysis/spec";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const pattern = z.strictObject({
  code: z.string(),
  family: z.string(),
  side: z.string().nullable(),
  threshold: z.string().nullable(),
  rule: z.record(z.string(), z.unknown()),
});

export const historicalAnalysisSpecSchema = z.strictObject({
  contractVersion: z.literal("historical-analysis-spec/1.0"),
  code: z.literal("OU25-HISTORICAL-MARKET-ANALYSIS"),
  version: z.literal("1.0.0"),
  status: z.literal("FROZEN_SPEC"),
  dataset: z.strictObject({
    id: z.literal("ou25-july-2026-v1"),
    code: z.literal("OU25-JULY-2026-V1"),
    version: z.literal("1.0.0"),
    manifestHash: hash.refine((value) => value === historicalAnalysisSpec.dataset.manifestHash),
    registryHash: hash.refine((value) => value === historicalAnalysisSpec.dataset.registryHash),
  }),
  partitions: z.strictObject({
    discovery: z.strictObject({ code: z.literal("DISCOVERY"), from: z.literal("2026-07-01"), to: z.literal("2026-07-14"), expectedMatched: z.literal(64) }),
    validation: z.strictObject({ code: z.literal("VALIDATION"), from: z.literal("2026-07-15"), to: z.literal("2026-07-21"), expectedMatched: z.literal(34) }),
  }),
  outcomePolicy: z.strictObject({
    version: z.literal("historical-outcome-policy/1.0.0"),
    principalStatus: z.literal("AGREED"),
    sensitivityStatuses: z.tuple([z.literal("FOREBET_ONLY"), z.literal("STATAREA_ONLY")]),
    excludedStatuses: z.tuple([z.literal("CONFLICT"), z.literal("MISSING"), z.literal("UNSUPPORTED")]),
    over25MinimumTotalGoals: z.literal(3),
    under25MaximumTotalGoals: z.literal(2),
    permittedScorePattern: z.literal("^(0|[1-9]\\d*)-(0|[1-9]\\d*)$"),
    specialAnnotations: z.literal("REJECT_WITHOUT_ASSUMPTION"),
  }),
  extractors: z.strictObject({
    forebet: z.literal("forebet-result-extractor/1.0.0"),
    statareaLegacy: z.literal("statarea-legacy-result-extractor/1.0.0"),
    statareaModernAllowed: z.literal(false),
  }),
  engineVersion: z.literal("historical-market-engine/1.0.0"),
  patterns: z.array(pattern).length(19),
  calibrationBands: z.array(z.strictObject({ code: z.string(), lower: z.string(), upper: z.string() })).length(6),
  favoriteSegments: z.strictObject({
    strongFavorite: z.strictObject({ minimumProbability: z.literal("55"), minimumGap: z.literal("15") }),
    balanced: z.strictObject({ maximumGap: z.literal("10") }),
    intermediate: z.literal("ALL_REMAINING"),
    favoriteSides: z.tuple([z.literal("HOME"), z.literal("AWAY"), z.literal("TIED")]),
    combinations: z.tuple([z.literal("STRONG+OVER_25"), z.literal("STRONG+UNDER_25"), z.literal("BALANCED+OVER_25"), z.literal("BALANCED+UNDER_25")]),
  }),
  predictedGoalDifferenceSegments: z.tuple([z.literal("0"), z.literal("1"), z.literal("2_PLUS")]),
  sampleRules: z.array(z.strictObject({ classification: z.string(), minimum: z.number().int().nonnegative(), maximumExclusive: z.number().int().positive().nullable() })).length(3),
  warningRules: z.strictObject({ wideWilsonIntervalGreaterThan: z.literal("0.25"), highCompetitionConcentrationGreaterThan: z.literal("0.40"), highCountryConcentrationGreaterThan: z.literal("0.50") }),
  stabilityRules: z.array(z.record(z.string(), z.unknown())).length(3),
  consensusLiftRules: z.strictObject({ minimumLiftPointsExclusive: z.literal("2"), validationMustImprove: z.literal(true), minimumRetainedSample: z.literal(10), weakWilsonLowerBound: z.literal("0.50"), rejectHighConcentration: z.literal(true), maximumValidationDropPoints: z.literal("5") }),
  metrics: z.array(z.string()).length(13),
  prohibitions: z.array(z.string()).length(12),
}).superRefine((value, context) => {
  if (canonicalJson(value) !== canonicalJson(historicalAnalysisSpec)) context.addIssue({ code: "custom", message: "SPEC_MUST_MATCH_FROZEN_DEFINITION" });
});

export function parseHistoricalAnalysisSpec(value: unknown): HistoricalAnalysisSpecContract {
  return historicalAnalysisSpecSchema.parse(value) as unknown as HistoricalAnalysisSpecContract;
}
