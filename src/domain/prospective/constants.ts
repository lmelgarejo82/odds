import { HISTORICAL_ANALYSIS_SPEC_HASH } from "@/domain/market-priority/constants";

export const PROSPECTIVE_SPORTS_DATE = "2026-07-23";
export const PROSPECTIVE_TIME_ZONE = "America/Asuncion";
export const PROSPECTIVE_MODE = "PROSPECTIVE_SHADOW";
export const PROSPECTIVE_STATUS = "FROZEN";
export const PROSPECTIVE_ENGINE_VERSION = "ou25-prospective-shadow-engine/1.0.0";
export const PROSPECTIVE_RUN_CONTRACT_VERSION = "prospective-shadow-run/1.0";
export const PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION = "prospective-fixture-assessment/1.0";
export const QUOTE_REQUEST_PLAN_CONTRACT_VERSION = "quote-request-plan/1.0";
export const PROSPECTIVE_EXPORT_ROOT = `var/exports/prospective/${PROSPECTIVE_SPORTS_DATE}`;
export const PROSPECTIVE_HISTORICAL_ANALYSIS_SPEC_HASH = HISTORICAL_ANALYSIS_SPEC_HASH;

export const PROSPECTIVE_WARNINGS = [
  "PRE_PRICE_POLICY_SELECTS_95_9_PERCENT_OF_FIXTURES",
  "FINAL_SELECTION_DOMINATED_BY_DOUBLE_CHANCE",
  "PRICE_REQUIRED_BEFORE_REAL_USE",
  "PRE_PRICE_PREFERENCE_MAY_CHANGE_WITH_ODDS",
] as const;

export const PROSPECTIVE_EXPORT_FILES = [
  "prospective-run.json",
  "source-capture-summary.json",
  "match-summary.json",
  "semantic-readiness.json",
  "prospective-candidates.json",
  "pre-price-decisions.json",
  "quote-request-plan.json",
  "quote-request-plan-dc.json",
  "quote-request-plan-ou25.json",
  "quote-request-plan-combinations.json",
  "no-quote-required.json",
  "warnings.json",
  "audit-summary.json",
  "b008-dominance-diagnostic.json",
] as const;

export type ProspectiveFamily = "DOUBLE_CHANCE" | "OU25" | "SAME_MATCH_COMBINATION";

export function validateProspectiveDate(date: string) {
  if (date !== PROSPECTIVE_SPORTS_DATE) throw new Error(`PROSPECTIVE_DATE_NOT_AUTHORIZED:${date}`);
}

export function assertFrozenBeforeSportsDate(now: Date) {
  const localDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: PROSPECTIVE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  if (localDate >= PROSPECTIVE_SPORTS_DATE) throw new Error(`PROSPECTIVE_FREEZE_WINDOW_CLOSED:${localDate}`);
}
