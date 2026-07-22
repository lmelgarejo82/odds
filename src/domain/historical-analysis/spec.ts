import { canonicalHash } from "@/domain/canonical-hash";
import {
  FOREBET_RESULT_EXTRACTOR_VERSION,
  HISTORICAL_ANALYSIS_CODE,
  HISTORICAL_ANALYSIS_CONTRACT_VERSION,
  HISTORICAL_ANALYSIS_STATUS,
  HISTORICAL_ANALYSIS_VERSION,
  HISTORICAL_DATASET_CODE,
  HISTORICAL_DATASET_ID,
  HISTORICAL_DATASET_VERSION,
  HISTORICAL_ENGINE_VERSION,
  HISTORICAL_MANIFEST_HASH,
  HISTORICAL_REGISTRY_HASH,
  OUTCOME_POLICY_VERSION,
  STATAREA_RESULT_EXTRACTOR_VERSION,
} from "./constants";

export const historicalPatternDefinitions = [
  { code: "FOREBET_OU25_CONTROL", family: "OU25_SOURCE_CONTROL", side: null, threshold: null, rule: { selector: "FOREBET_EXPLICIT_OU_SIDE", probability: "SELECTED_SOURCE_PERCENT_ONLY" } },
  { code: "STATAREA_OU25_CONTROL", family: "OU25_SOURCE_CONTROL", side: null, threshold: "50", rule: { over: "SOURCE_OVER_25_PERCENT_GT_50", under: "SOURCE_OVER_25_PERCENT_LT_50", noSignal: "SOURCE_OVER_25_PERCENT_EQ_50" } },
  { code: "OU25_CONSENSUS_SIMPLE", family: "OU25_CONSENSUS", side: null, threshold: null, rule: { sameSide: true, minimumSelectedPercent: null } },
  { code: "OU25_CONSENSUS_60", family: "OU25_CONSENSUS", side: null, threshold: "60", rule: { sameSide: true, minimumSelectedPercent: "60" } },
  { code: "OU25_CONSENSUS_65", family: "OU25_CONSENSUS", side: null, threshold: "65", rule: { sameSide: true, minimumSelectedPercent: "65" } },
  { code: "OU25_CONSENSUS_70", family: "OU25_CONSENSUS", side: null, threshold: "70", rule: { sameSide: true, minimumSelectedPercent: "70" } },
  { code: "FOREBET_OVER_CONFLUENCE", family: "FOREBET_CONFLUENCE", side: "OVER_25", threshold: "2.75", rule: { explicitSide: "OVER_25", minimumPredictedTotal: 3, minimumAverageGoals: "2.75" } },
  { code: "FOREBET_UNDER_CONFLUENCE", family: "FOREBET_CONFLUENCE", side: "UNDER_25", threshold: "2.25", rule: { explicitSide: "UNDER_25", maximumPredictedTotal: 2, maximumAverageGoals: "2.25" } },
  { code: "DOUBLE_CHANCE_1X", family: "DOUBLE_CHANCE", side: "1X", threshold: null, rule: { line: "1X", sourcePercent: "sourceDoubleChance1XPercent" } },
  { code: "DOUBLE_CHANCE_X2", family: "DOUBLE_CHANCE", side: "X2", threshold: null, rule: { line: "X2", sourcePercent: "sourceDoubleChanceX2Percent" } },
  { code: "DOUBLE_CHANCE_12", family: "DOUBLE_CHANCE", side: "12", threshold: null, rule: { line: "12", sourcePercent: "sourceDoubleChance12Percent" } },
  { code: "PREFERRED_DOUBLE_CHANCE", family: "DOUBLE_CHANCE", side: null, threshold: null, rule: { selector: "UNIQUE_MAXIMUM_SOURCE_PERCENT", maximumTie: "NO_SIGNAL", recordMarginToSecond: true } },
  { code: "COMBO_1X_OVER_25", family: "SAME_MATCH_COMBINATION", side: "1X+OVER_25", threshold: null, rule: { doubleChance: "1X", ou25: "OVER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "COMBO_1X_UNDER_25", family: "SAME_MATCH_COMBINATION", side: "1X+UNDER_25", threshold: null, rule: { doubleChance: "1X", ou25: "UNDER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "COMBO_X2_OVER_25", family: "SAME_MATCH_COMBINATION", side: "X2+OVER_25", threshold: null, rule: { doubleChance: "X2", ou25: "OVER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "COMBO_X2_UNDER_25", family: "SAME_MATCH_COMBINATION", side: "X2+UNDER_25", threshold: null, rule: { doubleChance: "X2", ou25: "UNDER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "COMBO_12_OVER_25", family: "SAME_MATCH_COMBINATION", side: "12+OVER_25", threshold: null, rule: { doubleChance: "12", ou25: "OVER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "COMBO_12_UNDER_25", family: "SAME_MATCH_COMBINATION", side: "12+UNDER_25", threshold: null, rule: { doubleChance: "12", ou25: "UNDER_25", inclusion: "OU25_CONSENSUS_SIMPLE" } },
  { code: "PREFERRED_DC_PLUS_CONSENSUS_OU", family: "SAME_MATCH_COMBINATION", side: null, threshold: null, rule: { doubleChance: "PREFERRED_DOUBLE_CHANCE", ou25: "OU25_CONSENSUS_SIMPLE", evaluateJointOutcomeDirectly: true, jointProbability: null } },
] as const;

export const historicalAnalysisSpec = {
  contractVersion: HISTORICAL_ANALYSIS_CONTRACT_VERSION,
  code: HISTORICAL_ANALYSIS_CODE,
  version: HISTORICAL_ANALYSIS_VERSION,
  status: HISTORICAL_ANALYSIS_STATUS,
  dataset: {
    id: HISTORICAL_DATASET_ID,
    code: HISTORICAL_DATASET_CODE,
    version: HISTORICAL_DATASET_VERSION,
    manifestHash: HISTORICAL_MANIFEST_HASH,
    registryHash: HISTORICAL_REGISTRY_HASH,
  },
  partitions: {
    discovery: { code: "DISCOVERY", from: "2026-07-01", to: "2026-07-14", expectedMatched: 64 },
    validation: { code: "VALIDATION", from: "2026-07-15", to: "2026-07-21", expectedMatched: 34 },
  },
  outcomePolicy: {
    version: OUTCOME_POLICY_VERSION,
    principalStatus: "AGREED",
    sensitivityStatuses: ["FOREBET_ONLY", "STATAREA_ONLY"],
    excludedStatuses: ["CONFLICT", "MISSING", "UNSUPPORTED"],
    over25MinimumTotalGoals: 3,
    under25MaximumTotalGoals: 2,
    permittedScorePattern: "^(0|[1-9]\\d*)-(0|[1-9]\\d*)$",
    specialAnnotations: "REJECT_WITHOUT_ASSUMPTION",
  },
  extractors: {
    forebet: FOREBET_RESULT_EXTRACTOR_VERSION,
    statareaLegacy: STATAREA_RESULT_EXTRACTOR_VERSION,
    statareaModernAllowed: false,
  },
  engineVersion: HISTORICAL_ENGINE_VERSION,
  patterns: historicalPatternDefinitions,
  calibrationBands: [
    { code: "0_49_99", lower: "0.00", upper: "49.99" },
    { code: "50_59_99", lower: "50.00", upper: "59.99" },
    { code: "60_69_99", lower: "60.00", upper: "69.99" },
    { code: "70_79_99", lower: "70.00", upper: "79.99" },
    { code: "80_89_99", lower: "80.00", upper: "89.99" },
    { code: "90_100", lower: "90.00", upper: "100.00" },
  ],
  favoriteSegments: {
    strongFavorite: { minimumProbability: "55", minimumGap: "15" },
    balanced: { maximumGap: "10" },
    intermediate: "ALL_REMAINING",
    favoriteSides: ["HOME", "AWAY", "TIED"],
    combinations: ["STRONG+OVER_25", "STRONG+UNDER_25", "BALANCED+OVER_25", "BALANCED+UNDER_25"],
  },
  predictedGoalDifferenceSegments: ["0", "1", "2_PLUS"],
  sampleRules: [
    { classification: "INSUFFICIENT_SAMPLE", minimum: 0, maximumExclusive: 10 },
    { classification: "SMALL_SAMPLE", minimum: 10, maximumExclusive: 30 },
    { classification: "REGULAR_SAMPLE", minimum: 30, maximumExclusive: null },
  ],
  warningRules: {
    wideWilsonIntervalGreaterThan: "0.25",
    highCompetitionConcentrationGreaterThan: "0.40",
    highCountryConcentrationGreaterThan: "0.50",
  },
  stabilityRules: [
    { classification: "STABLE_OR_IMPROVED", minimumValidationMinusDiscoveryPoints: "-5" },
    { classification: "MODERATE_DROP", minimumValidationMinusDiscoveryPoints: "-10", maximumExclusive: "-5" },
    { classification: "SEVERE_DROP", maximumExclusive: "-10" },
  ],
  consensusLiftRules: {
    minimumLiftPointsExclusive: "2",
    validationMustImprove: true,
    minimumRetainedSample: 10,
    weakWilsonLowerBound: "0.50",
    rejectHighConcentration: true,
    maximumValidationDropPoints: "5",
  },
  metrics: ["TOTAL", "EVALUABLE", "HIT", "MISS", "HIT_RATE", "WILSON_95", "BRIER_WHEN_PUBLISHED", "CALIBRATION", "THEORETICAL_BREAK_EVEN_ODDS", "RETAINED_SAMPLE", "CONCENTRATION", "STREAKS", "DISCOVERY_VALIDATION_DIFFERENCE"],
  prohibitions: ["RESULTS_IN_SPEC", "OBSERVED_METRICS_IN_SPEC", "SCORE", "RANKING", "RECOMMENDATION", "DAILY_SELECTION", "STAKE", "REAL_PROFITABILITY", "MULTI_MATCH_PARLAY", "JOINT_PROBABILITY_MULTIPLICATION", "NETWORK_ACCESS", "B008"],
} as const;

export type HistoricalAnalysisSpecContract = typeof historicalAnalysisSpec;
export const HISTORICAL_ANALYSIS_SPEC_HASH = canonicalHash(historicalAnalysisSpec);

export function buildHistoricalAnalysisSpec(): HistoricalAnalysisSpecContract {
  return structuredClone(historicalAnalysisSpec);
}
