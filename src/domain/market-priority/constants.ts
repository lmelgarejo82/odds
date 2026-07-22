export const MARKET_PRIORITY_POLICY_CODE = "OU25-MARKET-PRIORITY-POLICY";
export const MARKET_PRIORITY_POLICY_VERSION = "1.0.0";
export const MARKET_PRIORITY_POLICY_STATUS = "FROZEN";
export const MARKET_PRIORITY_ENGINE_VERSION = "ou25-market-priority-engine/1.0.0";
export const MARKET_PRIORITY_POLICY_CONTRACT_VERSION = "market-priority-policy/1.0";
export const MARKET_PRIORITY_CANDIDATES_CONTRACT_VERSION = "fixture-market-candidates/1.0";
export const MARKET_PRIORITY_DECISIONS_CONTRACT_VERSION = "fixture-preferred-line-decisions/1.0";
export const MARKET_PRIORITY_ASSESSMENT_MODE = "RETROSPECTIVE_POLICY_DESIGN";
export const MARKET_PRIORITY_INDEPENDENT_VALIDATION_STATUS = "NOT_AVAILABLE_FOR_PRIORITY_POLICY";
export const MARKET_PRIORITY_DEVELOPMENT_WINDOW = "2026-07-01..2026-07-21";
export const MARKET_PRIORITY_EXPORT_DIRECTORY = "OU25-MARKET-PRIORITY-POLICY-1.0.0";
export const HISTORICAL_ANALYSIS_SPEC_HASH = "433e63cf4e7c3dac22a513d32a60337816a7fe9f15e88abb33c03748ad2d14e9";

export const MARKET_PRIORITY_EXPORT_FILES = [
  "policy.json",
  "formulas.json",
  "caps.json",
  "summary.json",
  "candidates.json",
  "family-decisions.json",
  "final-decisions.json",
  "preferred.json",
  "provisional.json",
  "none.json",
  "double-chance-candidates.json",
  "ou25-candidates.json",
  "same-match-combinations.json",
  "blockers.json",
  "warnings.json",
  "score-distribution.json",
  "class-distribution.json",
  "audit.json",
] as const;

export const PRICE_FIELDS = {
  priceStatus: "NOT_EVALUATED" as const,
  availableOdds: null,
  marketValueStatus: "UNKNOWN" as const,
  breakEvenComparisonStatus: "NOT_AVAILABLE" as const,
};

export const REQUIRED_PRICE_WARNING = "PRICE_REQUIRED_BEFORE_REAL_USE";

export type MarketFamily = "DOUBLE_CHANCE" | "OU25" | "SAME_MATCH_COMBINATION";
export type PriorityClass = "HIGH" | "INTERESTING" | "TRACK" | "DO_NOT_PRIORITIZE";
export type SelectionStatus = "PREFERRED" | "PROVISIONAL" | "NONE";
export type MatchingQualityClass = "EXACT" | "CONSERVATIVE" | "APPROXIMATE";
export type DoubleChanceLine = "1X" | "X2" | "12";
export type Ou25Side = "OVER_25" | "UNDER_25";
