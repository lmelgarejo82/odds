import { canonicalHash } from "@/domain/canonical-hash";

export type OutcomeSource = "FOREBET" | "STATAREA";
export type ParseStatus = "PARSED" | "MISSING" | "UNSUPPORTED";
export type ReconciliationStatus = "AGREED" | "FOREBET_ONLY" | "STATAREA_ONLY" | "CONFLICT" | "MISSING" | "UNSUPPORTED";
export type Result1X2 = "HOME_WIN" | "DRAW" | "AWAY_WIN";
export type Ou25Outcome = "OVER_25" | "UNDER_25";

export type ParsedScore = Readonly<{
  rawResult: string | null;
  normalizedResult: string | null;
  homeGoals: number | null;
  awayGoals: number | null;
  parseStatus: ParseStatus;
  reasonCode: string;
  warnings: string[];
}>;

export type SourceOutcomeEvidence = ParsedScore & Readonly<{
  source: OutcomeSource;
  snapshotId: string;
  sourceRecordId: string;
  sportsDate: string;
  rawHtResult: string | null;
  extractorVersion: string;
  evidenceHash: string;
}>;

const specialResult = /\b(postponed|cancelled|canceled|canc|abandoned|suspended|awarded|walkover|w\.o\.|pens?|penalties|aggregate|aet|extra\s*time|desk|aplazad[oa]s?|cancelad[oa]s?|abandonad[oa]s?|penales?|pr[oó]rroga|global)\b/i;

export function parseStrictScore(rawResult: string | null | undefined): ParsedScore {
  const raw = rawResult?.normalize("NFKC").replace(/\s+/g, " ").trim() ?? "";
  if (!raw) return { rawResult: rawResult ?? null, normalizedResult: null, homeGoals: null, awayGoals: null, parseStatus: "MISSING", reasonCode: "EMPTY_RESULT", warnings: [] };
  if (specialResult.test(raw)) return { rawResult: raw, normalizedResult: null, homeGoals: null, awayGoals: null, parseStatus: "UNSUPPORTED", reasonCode: "SPECIAL_RESULT_UNSUPPORTED", warnings: ["RESULT_REQUIRES_ASSUMPTION"] };
  if (/^\s*-\d/.test(raw) || /[-:–—−]\s*-\d/.test(raw)) return { rawResult: raw, normalizedResult: null, homeGoals: null, awayGoals: null, parseStatus: "UNSUPPORTED", reasonCode: "NEGATIVE_GOALS", warnings: [] };
  const normalized = raw.replace(/[‐‑‒–—−]/g, "-").replace(/\s*:\s*/, "-").replace(/\s*-\s*/, "-");
  const match = normalized.match(/^(0|[1-9]\d*)-(0|[1-9]\d*)$/);
  if (!match) return { rawResult: raw, normalizedResult: null, homeGoals: null, awayGoals: null, parseStatus: "UNSUPPORTED", reasonCode: "SCORE_FORMAT_UNSUPPORTED", warnings: [] };
  const homeGoals = Number(match[1]);
  const awayGoals = Number(match[2]);
  if (!Number.isSafeInteger(homeGoals) || !Number.isSafeInteger(awayGoals)) return { rawResult: raw, normalizedResult: null, homeGoals: null, awayGoals: null, parseStatus: "UNSUPPORTED", reasonCode: "SCORE_OUT_OF_RANGE", warnings: [] };
  const warnings = normalized === raw ? [] : ["VISUAL_SEPARATOR_NORMALIZED"];
  return { rawResult: raw, normalizedResult: `${homeGoals}-${awayGoals}`, homeGoals, awayGoals, parseStatus: "PARSED", reasonCode: "SCORE_PARSED", warnings };
}

export function buildSourceOutcomeEvidence(input: {
  source: OutcomeSource;
  snapshotId: string;
  sourceRecordId: string;
  sportsDate: string;
  rawResult: string | null;
  rawHtResult: string | null;
  extractorVersion: string;
}): SourceOutcomeEvidence {
  const parsed = parseStrictScore(input.rawResult);
  const core = { ...input, ...parsed };
  return Object.freeze({ ...core, evidenceHash: canonicalHash(core) });
}

export function deriveCanonicalOutcome(homeGoals: number, awayGoals: number) {
  if (!Number.isSafeInteger(homeGoals) || !Number.isSafeInteger(awayGoals) || homeGoals < 0 || awayGoals < 0) throw new Error("INVALID_CANONICAL_GOALS");
  const totalGoals = homeGoals + awayGoals;
  const result1X2: Result1X2 = homeGoals > awayGoals ? "HOME_WIN" : homeGoals < awayGoals ? "AWAY_WIN" : "DRAW";
  const ou25Outcome: Ou25Outcome = totalGoals >= 3 ? "OVER_25" : "UNDER_25";
  return Object.freeze({
    homeGoals,
    awayGoals,
    totalGoals,
    result1X2,
    ou25Outcome,
    doubleChance1XOutcome: result1X2 !== "AWAY_WIN",
    doubleChanceX2Outcome: result1X2 !== "HOME_WIN",
    doubleChance12Outcome: result1X2 !== "DRAW",
  });
}

export function reconcileSourceOutcomes(input: {
  forebet: SourceOutcomeEvidence | null;
  statarea: SourceOutcomeEvidence | null;
  directOrientation: boolean;
  sameSportsDate: boolean;
}) {
  const { forebet, statarea } = input;
  const fParsed = forebet?.parseStatus === "PARSED";
  const sParsed = statarea?.parseStatus === "PARSED";
  const hasUnsupported = forebet?.parseStatus === "UNSUPPORTED" || statarea?.parseStatus === "UNSUPPORTED";
  let reconciliationStatus: ReconciliationStatus;
  if (fParsed && sParsed) {
    reconciliationStatus = input.directOrientation && input.sameSportsDate && forebet.homeGoals === statarea.homeGoals && forebet.awayGoals === statarea.awayGoals ? "AGREED" : "CONFLICT";
  } else if (fParsed) reconciliationStatus = "FOREBET_ONLY";
  else if (sParsed) reconciliationStatus = "STATAREA_ONLY";
  else if (hasUnsupported) reconciliationStatus = "UNSUPPORTED";
  else reconciliationStatus = "MISSING";
  const chosen = reconciliationStatus === "AGREED" ? forebet : reconciliationStatus === "FOREBET_ONLY" ? forebet : reconciliationStatus === "STATAREA_ONLY" ? statarea : null;
  const outcome = chosen && chosen.homeGoals !== null && chosen.awayGoals !== null ? deriveCanonicalOutcome(chosen.homeGoals, chosen.awayGoals) : null;
  return Object.freeze({ reconciliationStatus, outcome, principalEvaluable: reconciliationStatus === "AGREED", sensitivityEvaluable: reconciliationStatus === "FOREBET_ONLY" || reconciliationStatus === "STATAREA_ONLY" });
}
