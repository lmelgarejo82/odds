import { canonicalHash } from "@/domain/canonical-hash";

export const initialResearch = Object.freeze({
  code: "OU25-CROSS-SOURCE-CONSENSUS", version: "0.1.0", status: "DRAFT", active: false,
  targetMarket: "TOTAL_GOALS_2_5", sources: ["FOREBET", "STATAREA"] as const, separateSides: true,
  discovery: { from: "2026-07-01", to: "2026-07-14" }, validation: { from: "2026-07-15", to: "2026-07-21" },
  priorityComponents: { signal: 40, historicalEvidence: 40, dataQuality: 20 }, resultsAsserted: false,
});

export function initializationIdentity() { return `${initialResearch.code}:${initialResearch.version}:${canonicalHash(initialResearch)}`; }
