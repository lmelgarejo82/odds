import { canonicalHash } from "@/domain/canonical-hash";

export const MATCHER_VERSION = "ou25-fixture-matcher/1.0.0";
export const NORMALIZER_VERSION = "ou25-identity-normalizer/1.0.0";
export const RECONCILIATION_DATE = "2026-07-21";
export const MATCH_CONFIGURATION = {
  code: "OU25-MATCHER",
  status: "DRAFT",
  matcherVersion: MATCHER_VERSION,
  normalizerVersion: NORMALIZER_VERSION,
  candidateMinimumPerSide: 0.55,
  conflictDetectionMinimumPerSide: 0.4,
  approximateMinimumPerSide: 0.84,
  approximateMinimumAggregate: 0.88,
  minimumMargin: 0.08,
  institutionalTokens: ["ac", "afc", "ca", "cd", "cf", "club", "fc", "fk", "sc", "sk"],
  protectedTokens: ["women", "w", "ladies", "femenino", "u17", "u18", "u19", "u20", "u21", "u23", "youth", "juvenil", "reserve", "reserves", "b", "ii", "2", "academy", "amateur"],
  timeEvidence: "UNVERIFIED",
  aliases: [],
} as const;
export const MATCH_CONFIGURATION_HASH = canonicalHash(MATCH_CONFIGURATION);
