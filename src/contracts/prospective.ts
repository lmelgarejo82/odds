import { z } from "zod";
import { canonicalHash } from "@/domain/canonical-hash";
import {
  PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION,
  PROSPECTIVE_MODE,
  PROSPECTIVE_RUN_CONTRACT_VERSION,
  PROSPECTIVE_SPORTS_DATE,
  QUOTE_REQUEST_PLAN_CONTRACT_VERSION,
} from "@/domain/prospective/constants";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1);
const score = z.number().min(0).max(100);
const selectionStatus = z.enum(["PREFERRED", "PROVISIONAL", "NONE"]);
const priorityClass = z.enum(["HIGH", "INTERESTING", "TRACK", "DO_NOT_PRIORITIZE"]);
const family = z.enum(["DOUBLE_CHANCE", "OU25", "SAME_MATCH_COMBINATION"]);
const snapshot = z.object({ id, sha256: hash, parserVersion: id }).strict();
const prospectiveCounts = z.object({
  matching: z.object({ matched: z.number().int().nonnegative(), ambiguous: z.number().int().nonnegative(), onlyForebet: z.number().int().nonnegative(), onlyStatarea: z.number().int().nonnegative(), conflict: z.number().int().nonnegative() }).strict(),
  candidates: z.number().int().positive(),
  assessments: z.number().int().positive(),
  selections: z.object({ PREFERRED: z.number().int().nonnegative(), PROVISIONAL: z.number().int().nonnegative(), NONE: z.number().int().nonnegative() }).strict(),
  quoteRequests: z.object({ DOUBLE_CHANCE: z.number().int().nonnegative(), OU25: z.number().int().nonnegative(), SAME_MATCH_COMBINATION: z.number().int().nonnegative(), total: z.number().int().positive(), maximumPerFixture: z.number().int().min(1).max(3) }).strict(),
  semantic: z.object({ projected: z.number().int().positive(), ou25Ready: z.number().int().nonnegative(), doubleChanceReady: z.number().int().nonnegative() }).strict(),
  availableOdds: z.literal(0),
  marketValueEvaluated: z.literal(0),
  outcomeReads: z.literal(0),
  ranking: z.literal(0),
  bets: z.literal(0),
  multiMatchCombinations: z.literal(0),
}).strict();

export const prospectiveShadowRunDocumentSchema = z.object({
  contractVersion: z.literal(PROSPECTIVE_RUN_CONTRACT_VERSION),
  run: z.object({
    id,
    sportsDate: z.literal(PROSPECTIVE_SPORTS_DATE),
    mode: z.literal(PROSPECTIVE_MODE),
    status: z.literal("FROZEN"),
    forebetSnapshot: snapshot,
    statareaSnapshot: snapshot.extend({ sourcePresentation: z.literal("LEGACY_OFFICIAL") }).strict(),
    matchRunId: id,
    matcherVersion: z.literal("ou25-fixture-matcher/1.0.0"),
    normalizerVersion: z.literal("ou25-identity-normalizer/1.0.0"),
    matcherConfigurationHash: hash,
    registry: z.object({ code: z.literal("STATAREA-LEGACY-SEMANTIC-REGISTRY"), version: z.literal("1.0.0"), hash }).strict(),
    policy: z.object({ code: z.literal("OU25-MARKET-PRIORITY-POLICY"), version: z.literal("1.0.0"), hash, historicalAnalysisSpecHash: hash }).strict(),
    outcomeEvaluationEnabled: z.literal(false),
    priceEvaluationEnabled: z.literal(false),
    frozenBeforeOutcome: z.literal(true),
    frozenAt: z.iso.datetime(),
    fixtureCount: z.number().int().positive(),
    counts: prospectiveCounts,
    warnings: z.array(z.string()),
    networkRequestsAtFreeze: z.number().int().min(0).max(2),
    outcomeReads: z.literal(0),
    quoteCaptures: z.literal(0),
    runHash: hash,
  }).strict(),
}).strict().superRefine((document, context) => {
  const hashable = Object.fromEntries(Object.entries(document.run).filter(([key]) => key !== "runHash"));
  if (canonicalHash(hashable) !== document.run.runHash) context.addIssue({ code: "custom", message: "PROSPECTIVE_RUN_HASH_MISMATCH" });
});

const fixtureIdentitySchema = z.object({
  forebetObservationId: id,
  statareaRowId: id,
  homeTeamRaw: id,
  awayTeamRaw: id,
  competitionRaw: z.string().nullable(),
  countryRaw: z.string().nullable(),
  scheduledKickoffRaw: z.string().nullable(),
}).strict();

const preferenceSchema = z.object({ candidateId: id, family, marketCode: id, score, priorityClass }).strict();

export const prospectiveFixtureAssessmentSchema = z.object({
  id,
  prospectiveRunId: id,
  matchDecisionId: id,
  sportsDate: z.literal(PROSPECTIVE_SPORTS_DATE),
  fixtureIdentity: fixtureIdentitySchema,
  dcCandidateId: id.nullable(),
  ouCandidateId: id.nullable(),
  combinationCandidateId: id.nullable(),
  prePricePreference: preferenceSchema.nullable(),
  prePriceSecondAlternative: preferenceSchema.nullable(),
  prePriceSelectionStatus: selectionStatus,
  prePriceScoreMargin: score.nullable(),
  priceEvaluationStatus: z.literal("NOT_CAPTURED"),
  decisionFrozenAt: z.iso.datetime(),
  warnings: z.array(z.string()),
}).strict().superRefine((assessment, context) => {
  if (assessment.prePriceSelectionStatus === "NONE" && assessment.prePricePreference !== null) context.addIssue({ code: "custom", message: "NONE_CANNOT_HAVE_PRE_PRICE_PREFERENCE" });
  if (assessment.prePriceSelectionStatus !== "NONE" && assessment.prePricePreference === null) context.addIssue({ code: "custom", message: "SELECTED_STATUS_REQUIRES_PRE_PRICE_PREFERENCE" });
});

export const prospectiveFixtureAssessmentDocumentSchema = z.object({
  contractVersion: z.literal(PROSPECTIVE_ASSESSMENT_CONTRACT_VERSION),
  prospectiveRunId: id,
  assessmentSetHash: hash,
  assessments: z.array(prospectiveFixtureAssessmentSchema).min(1),
}).strict().superRefine((document, context) => {
  if (document.assessments.some((assessment) => assessment.prospectiveRunId !== document.prospectiveRunId)) context.addIssue({ code: "custom", message: "ASSESSMENT_RUN_MISMATCH" });
  if (canonicalHash(document.assessments) !== document.assessmentSetHash) context.addIssue({ code: "custom", message: "ASSESSMENT_SET_HASH_MISMATCH" });
});

export const quoteRequestSchema = z.object({
  id,
  prospectiveRunId: id,
  fixtureAssessmentId: id,
  matchDecisionId: id,
  sportsDate: z.literal(PROSPECTIVE_SPORTS_DATE),
  fixtureIdentityRaw: fixtureIdentitySchema,
  homeTeamRaw: id,
  awayTeamRaw: id,
  competitionRaw: z.string().nullable(),
  countryRaw: z.string().nullable(),
  scheduledKickoffRaw: z.string().nullable(),
  family,
  internalMarketCode: id,
  marketComponents: z.array(id).min(1).max(2),
  prePricePriorityScore: score,
  prePricePriorityClass: priorityClass,
  prePriceSelectionStatus: selectionStatus,
  quoteRequired: z.literal(true),
  bookmaker: z.literal("APOSTALA"),
  bookmakerMarketCode: z.literal("UNRESOLVED"),
  bookmakerMarketLabel: z.literal("UNRESOLVED"),
  availableOdds: z.null(),
  priceStatus: z.literal("NOT_CAPTURED"),
  marketValueStatus: z.literal("UNKNOWN"),
  warnings: z.array(z.string()),
}).strict().superRefine((request, context) => {
  if (request.homeTeamRaw !== request.fixtureIdentityRaw.homeTeamRaw || request.awayTeamRaw !== request.fixtureIdentityRaw.awayTeamRaw) context.addIssue({ code: "custom", message: "FIXTURE_IDENTITY_MISMATCH" });
  if (request.family === "DOUBLE_CHANCE" && (!/^(1X|X2|12)$/.test(request.internalMarketCode) || request.marketComponents.length !== 1 || request.marketComponents[0] !== request.internalMarketCode)) context.addIssue({ code: "custom", message: "INVALID_DOUBLE_CHANCE_REQUEST" });
  if (request.family === "OU25" && (!/^(OVER_25|UNDER_25)$/.test(request.internalMarketCode) || request.marketComponents.length !== 1 || request.marketComponents[0] !== request.internalMarketCode)) context.addIssue({ code: "custom", message: "INVALID_OU25_REQUEST" });
  if (request.family === "SAME_MATCH_COMBINATION" && (!/^(1X|X2|12) \+ (OVER_25|UNDER_25)$/.test(request.internalMarketCode) || request.marketComponents.length !== 2 || request.marketComponents.join(" + ") !== request.internalMarketCode)) context.addIssue({ code: "custom", message: "COMBINATION_COMPONENTS_REQUIRED" });
});

export const quoteRequestPlanDocumentSchema = z.object({
  contractVersion: z.literal(QUOTE_REQUEST_PLAN_CONTRACT_VERSION),
  prospectiveRunId: id,
  sportsDate: z.literal(PROSPECTIVE_SPORTS_DATE),
  frozenAt: z.iso.datetime(),
  quotePlanHash: hash,
  requests: z.array(quoteRequestSchema),
}).strict().superRefine((document, context) => {
  if (canonicalHash(document.requests) !== document.quotePlanHash) context.addIssue({ code: "custom", message: "QUOTE_PLAN_HASH_MISMATCH" });
  const byFixture = new Map<string, Array<z.infer<typeof quoteRequestSchema>>>();
  for (const request of document.requests) byFixture.set(request.fixtureAssessmentId, [...(byFixture.get(request.fixtureAssessmentId) ?? []), request]);
  for (const requests of byFixture.values()) {
    if (requests.length > 3) context.addIssue({ code: "custom", message: "MORE_THAN_THREE_QUOTES_PER_FIXTURE" });
    if (new Set(requests.map((request) => request.family)).size !== requests.length) context.addIssue({ code: "custom", message: "DUPLICATE_QUOTE_FAMILY" });
    if (new Set(requests.map((request) => request.matchDecisionId)).size !== 1) context.addIssue({ code: "custom", message: "MULTI_MATCH_COMBINATION_PROHIBITED" });
  }
});

export type ProspectiveShadowRunDocument = z.infer<typeof prospectiveShadowRunDocumentSchema>;
export type ProspectiveFixtureAssessment = z.infer<typeof prospectiveFixtureAssessmentSchema>;
export type ProspectiveFixtureAssessmentDocument = z.infer<typeof prospectiveFixtureAssessmentDocumentSchema>;
export type QuoteRequest = z.infer<typeof quoteRequestSchema>;
export type QuoteRequestPlanDocument = z.infer<typeof quoteRequestPlanDocumentSchema>;
