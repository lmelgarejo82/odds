export const HISTORICAL_ANALYSIS_CODE = "OU25-HISTORICAL-MARKET-ANALYSIS";
export const HISTORICAL_ANALYSIS_VERSION = "1.0.0";
export const HISTORICAL_ANALYSIS_STATUS = "FROZEN_SPEC";
export const HISTORICAL_ANALYSIS_CONTRACT_VERSION = "historical-analysis-spec/1.0";
export const FIXTURE_OUTCOMES_CONTRACT_VERSION = "fixture-outcomes/1.0";
export const PATTERN_EVALUATION_CONTRACT_VERSION = "historical-pattern-evaluation/1.0";
export const HISTORICAL_DATASET_CODE = "OU25-JULY-2026-V1";
export const HISTORICAL_DATASET_VERSION = "1.0.0";
export const HISTORICAL_DATASET_ID = "ou25-july-2026-v1";
export const HISTORICAL_MANIFEST_HASH = "b651152816688759d54486ebc4cdac11704dd9e287818dec6b7f935c185ed105";
export const HISTORICAL_REGISTRY_CODE = "STATAREA-LEGACY-SEMANTIC-REGISTRY";
export const HISTORICAL_REGISTRY_VERSION = "1.0.0";
export const HISTORICAL_REGISTRY_HASH = "735762986050e6fc0d763c180b23cf7a28439ca92fd6ea934d4725531f9650d3";
export const OUTCOME_POLICY_VERSION = "historical-outcome-policy/1.0.0";
export const HISTORICAL_ENGINE_VERSION = "historical-market-engine/1.0.0";
export const FOREBET_RESULT_EXTRACTOR_VERSION = "forebet-result-extractor/1.0.0";
export const STATAREA_RESULT_EXTRACTOR_VERSION = "statarea-legacy-result-extractor/1.0.0";
export const HISTORICAL_EXPORT_DIRECTORY = "OU25-HISTORICAL-MARKET-ANALYSIS-1.0.0";
export const HISTORICAL_EXPECTED_HEAD = "8d0c0d5";

export const HISTORICAL_PATTERN_CODES = [
  "FOREBET_OU25_CONTROL",
  "STATAREA_OU25_CONTROL",
  "OU25_CONSENSUS_SIMPLE",
  "OU25_CONSENSUS_60",
  "OU25_CONSENSUS_65",
  "OU25_CONSENSUS_70",
  "FOREBET_OVER_CONFLUENCE",
  "FOREBET_UNDER_CONFLUENCE",
  "DOUBLE_CHANCE_1X",
  "DOUBLE_CHANCE_X2",
  "DOUBLE_CHANCE_12",
  "PREFERRED_DOUBLE_CHANCE",
  "COMBO_1X_OVER_25",
  "COMBO_1X_UNDER_25",
  "COMBO_X2_OVER_25",
  "COMBO_X2_UNDER_25",
  "COMBO_12_OVER_25",
  "COMBO_12_UNDER_25",
  "PREFERRED_DC_PLUS_CONSENSUS_OU",
] as const;

export type HistoricalPatternCode = (typeof HISTORICAL_PATTERN_CODES)[number];

export const HISTORICAL_EXPORT_FILES = [
  "analysis-spec.json",
  "outcome-evidence-summary.json",
  "outcome-conflicts.json",
  "fixture-outcomes.json",
  "ou25-source-controls.json",
  "ou25-consensus.json",
  "forebet-confluences.json",
  "double-chance-lines.json",
  "preferred-double-chance.json",
  "same-match-combinations.json",
  "favorite-segments.json",
  "discovery-metrics.json",
  "validation-metrics.json",
  "discovery-validation-comparison.json",
  "calibration.json",
  "brier.json",
  "wilson.json",
  "concentration.json",
  "streaks.json",
  "warnings.json",
  "audit-summary.json",
] as const;
