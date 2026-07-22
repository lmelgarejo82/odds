import { z } from "zod";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import { marketPriorityPolicy } from "@/domain/market-priority/policy";
import {
  MARKET_PRIORITY_CANDIDATES_CONTRACT_VERSION,
  MARKET_PRIORITY_DECISIONS_CONTRACT_VERSION,
  MARKET_PRIORITY_POLICY_CONTRACT_VERSION,
  REQUIRED_PRICE_WARNING,
} from "@/domain/market-priority/constants";
import { priorityClass } from "@/domain/market-priority/scoring";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const score40 = z.number().min(0).max(40);
const score20 = z.number().min(0).max(20);
const score100 = z.number().min(0).max(100);
const nullablePercent = z.number().min(0).max(100).nullable();
const nullableRatio = z.number().min(0).max(1).nullable();
const priceFields = {
  priceStatus: z.literal("NOT_EVALUATED"),
  availableOdds: z.null(),
  marketValueStatus: z.literal("UNKNOWN"),
  breakEvenComparisonStatus: z.literal("NOT_AVAILABLE"),
};

export const marketPriorityPolicyDocumentSchema = z.object({
  contractVersion: z.literal(MARKET_PRIORITY_POLICY_CONTRACT_VERSION),
  priorityPolicyHash: hash,
  policy: z.unknown(),
}).strict().superRefine((document, context) => {
  if (canonicalJson(document.policy) !== canonicalJson(marketPriorityPolicy)) context.addIssue({ code: "custom", message: "POLICY_NOT_EXACTLY_FROZEN" });
  if (canonicalHash(document.policy) !== document.priorityPolicyHash) context.addIssue({ code: "custom", message: "POLICY_HASH_MISMATCH" });
});

export const capSchema = z.object({
  code: z.string().min(1),
  maximum: z.number().min(0).max(100),
  before: z.number().min(0).max(100),
  after: z.number().min(0).max(100),
}).strict().superRefine((cap, context) => {
  if (cap.after > cap.before || cap.after > cap.maximum) context.addIssue({ code: "custom", message: "CAP_INCONSISTENT" });
});

export const fixtureMarketCandidateSchema = z.object({
  id: z.string().min(1),
  matchDecisionId: z.string().min(1),
  sportsDate: z.iso.date(),
  fixture: z.object({ homeTeam: z.string().min(1), awayTeam: z.string().min(1) }).strict(),
  family: z.enum(["DOUBLE_CHANCE", "OU25", "SAME_MATCH_COMBINATION"]),
  marketCode: z.string().min(1),
  historicalPatternCode: z.string().min(1).nullable(),
  matchingQualityClass: z.enum(["EXACT", "CONSERVATIVE", "APPROXIMATE"]),
  strengthClass: z.enum(["SIMPLE", "MODERATE_60", "STRONG_65", "EXTREME_70"]).nullable(),
  confluenceCode: z.enum(["FOREBET_OVER_CONFLUENCE", "FOREBET_UNDER_CONFLUENCE"]).nullable(),
  sourceEvidence: z.object({
    doubleChanceSourcePercent: nullablePercent,
    secondHighestDcPercent: nullablePercent,
    forebetSuggestedSide: z.enum(["OVER", "UNDER"]).nullable(),
    forebetSidePercent: nullablePercent,
    statareaSidePercent: nullablePercent,
    statareaSourceOver25Percent: nullablePercent,
  }).strict(),
  signalDetails: z.object({
    percentComponent: z.number().nullable(),
    lineMargin: z.number().nullable(),
    marginComponent: z.number().nullable(),
    minimumAgreementPercent: z.number().nullable(),
    strengthComponent: z.number().nullable(),
    sourceGap: z.number().nullable(),
    balanceComponent: z.number().nullable(),
    combinationDcScore: z.number().nullable(),
    combinationOuScore: z.number().nullable(),
  }).strict(),
  historicalEvidence: z.object({
    patternCode: z.string().nullable(),
    side: z.string().nullable(),
    validationN: z.number().int().nonnegative(),
    validationHitRate: nullableRatio,
    validationWilsonLower: nullableRatio,
    stabilityClass: z.enum(["STABLE_OR_IMPROVED", "MODERATE_DROP", "SEVERE_DROP"]).nullable(),
    validationHitRateComponent: score40,
    validationWilsonLowerComponent: score40,
    sampleComponent: z.number().min(0).max(8),
    stabilityComponent: z.number().min(0).max(8),
    uncappedScore: score40,
    validationLift: z.number().nullable(),
    maxCountryShare: nullableRatio,
    maxCompetitionShare: nullableRatio,
  }).strict(),
  dataQuality: z.object({
    matchingComponent: z.number().min(0).max(8),
    completenessComponent: z.number().min(0).max(6),
    semanticReadinessComponent: z.number().min(0).max(4),
    integrityComponent: z.number().min(0).max(2),
  }).strict(),
  signalScore: score40,
  historicalEvidenceScore: score40,
  dataQualityScore: score20,
  rawPriorityScore: score100,
  finalPriorityScore: score100,
  priorityClass: z.enum(["HIGH", "INTERESTING", "TRACK", "DO_NOT_PRIORITIZE"]),
  blocked: z.boolean(),
  blockers: z.array(z.enum(["MISSING_REQUIRED_SOURCE_FIELD", "SEMANTICALLY_NOT_READY", "MATCH_NOT_ELIGIBLE", "SNAPSHOT_INTEGRITY_FAILURE", "POLICY_REFERENCE_MISMATCH", "HISTORICAL_METRIC_NOT_FOUND"])),
  caps: z.array(capSchema),
  reasons: z.array(z.string()),
  warnings: z.array(z.string()),
  ...priceFields,
}).strict().superRefine((candidate, context) => {
  const expectedRaw = candidate.signalScore + candidate.historicalEvidenceScore + candidate.dataQualityScore;
  if (Math.abs(expectedRaw - candidate.rawPriorityScore) > 0.000002) context.addIssue({ code: "custom", message: "RAW_SCORE_SUM_INCONSISTENT" });
  if (candidate.finalPriorityScore > candidate.rawPriorityScore + 0.000002) context.addIssue({ code: "custom", message: "FINAL_SCORE_EXCEEDS_RAW" });
  if (priorityClass(candidate.finalPriorityScore) !== candidate.priorityClass) context.addIssue({ code: "custom", message: "PRIORITY_CLASS_INCONSISTENT" });
  if (candidate.blocked !== (candidate.blockers.length > 0)) context.addIssue({ code: "custom", message: "BLOCKER_STATE_INCONSISTENT" });
  if (!candidate.warnings.includes(REQUIRED_PRICE_WARNING)) context.addIssue({ code: "custom", message: "PRICE_WARNING_REQUIRED" });
  if (candidate.family === "SAME_MATCH_COMBINATION" && !/^(1X|X2|12) \+ (OVER_25|UNDER_25)$/.test(candidate.marketCode)) context.addIssue({ code: "custom", message: "COMBINATION_COMPONENTS_REQUIRED" });
});

export const fixtureMarketCandidatesDocumentSchema = z.object({
  contractVersion: z.literal(MARKET_PRIORITY_CANDIDATES_CONTRACT_VERSION),
  priorityPolicyHash: hash,
  assessmentId: z.string().min(1),
  candidateSetHash: hash,
  candidates: z.array(fixtureMarketCandidateSchema),
}).strict().superRefine((document, context) => {
  if (canonicalHash(document.candidates) !== document.candidateSetHash) context.addIssue({ code: "custom", message: "CANDIDATE_SET_HASH_MISMATCH" });
});

export const preferredLineDecisionSchema = z.object({
  id: z.string().min(1),
  matchDecisionId: z.string().min(1),
  selectionStatus: z.enum(["PREFERRED", "PROVISIONAL", "NONE"]),
  selectedCandidateId: z.string().nullable(),
  selectedMarketCode: z.string().nullable(),
  selectedLineCount: z.number().int().min(0).max(1),
  selectedCandidateBlocked: z.boolean().nullable(),
  topCandidateId: z.string().nullable(),
  topFinalPriorityScore: score100.nullable(),
  secondCandidateId: z.string().nullable(),
  marginToSecond: z.number().min(0).max(100).nullable(),
  reasonCode: z.string().min(1),
  reasons: z.array(z.string()),
  caps: z.array(capSchema),
  warnings: z.array(z.string()),
  ...priceFields,
}).strict().superRefine((decision, context) => {
  const none = decision.selectionStatus === "NONE";
  if (none && (decision.selectedLineCount !== 0 || decision.selectedCandidateId !== null || decision.selectedMarketCode !== null)) context.addIssue({ code: "custom", message: "NONE_MUST_NOT_SELECT_LINE" });
  if (!none && (decision.selectedLineCount !== 1 || decision.selectedCandidateId === null || decision.selectedMarketCode === null || decision.selectedCandidateBlocked !== false)) context.addIssue({ code: "custom", message: "SELECTED_LINE_INVALID" });
  if (decision.selectionStatus === "PREFERRED" && ((decision.topFinalPriorityScore ?? -1) < 75 || (decision.marginToSecond ?? -1) < 5)) context.addIssue({ code: "custom", message: "PREFERRED_THRESHOLD_INVALID" });
  if (decision.selectionStatus === "PROVISIONAL" && (decision.topFinalPriorityScore ?? -1) < 65) context.addIssue({ code: "custom", message: "PROVISIONAL_THRESHOLD_INVALID" });
  if (!decision.warnings.includes(REQUIRED_PRICE_WARNING)) context.addIssue({ code: "custom", message: "PRICE_WARNING_REQUIRED" });
});

export const fixturePreferredLineDecisionsDocumentSchema = z.object({
  contractVersion: z.literal(MARKET_PRIORITY_DECISIONS_CONTRACT_VERSION),
  priorityPolicyHash: hash,
  assessmentId: z.string().min(1),
  decisionSetHash: hash,
  decisions: z.array(preferredLineDecisionSchema),
}).strict().superRefine((document, context) => {
  if (canonicalHash(document.decisions) !== document.decisionSetHash) context.addIssue({ code: "custom", message: "DECISION_SET_HASH_MISMATCH" });
});

export type FixtureMarketCandidateContract = z.infer<typeof fixtureMarketCandidateSchema>;
export type FixturePreferredLineDecisionContract = z.infer<typeof preferredLineDecisionSchema>;
