import { z } from "zod";
import { canonicalHash } from "@/domain/canonical-hash";
import {
  SEMANTIC_ASSESSMENT_CONTRACT_VERSION,
  SEMANTIC_ASSESSMENT_VERSION,
  SEMANTIC_DATASET_CODE,
  SEMANTIC_LEGEND_SHA256,
  SEMANTIC_MANIFEST_HASH,
  SEMANTIC_PARSER_VERSION,
  SEMANTIC_REGISTRY_CODE,
  SEMANTIC_REGISTRY_CONTRACT_VERSION,
  SEMANTIC_REGISTRY_VERSION,
  SEMANTIC_SOURCE_PRESENTATION,
} from "@/domain/statarea-semantics/constants";

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const exactDerivations: Record<string, { rule: string; components: string[] }> = {
  sourceUnder15Percent: { rule: "100 - sourceOver15Percent", components: ["sourceOver15Percent"] },
  sourceUnder25Percent: { rule: "100 - sourceOver25Percent", components: ["sourceOver25Percent"] },
  sourceUnder35Percent: { rule: "100 - sourceOver35Percent", components: ["sourceOver35Percent"] },
  sourceDoubleChance1XPercent: { rule: "sourceHomeWinPercent + sourceDrawPercent", components: ["sourceHomeWinPercent", "sourceDrawPercent"] },
  sourceDoubleChanceX2Percent: { rule: "sourceDrawPercent + sourceAwayWinPercent", components: ["sourceDrawPercent", "sourceAwayWinPercent"] },
  sourceDoubleChance12Percent: { rule: "sourceHomeWinPercent + sourceAwayWinPercent", components: ["sourceHomeWinPercent", "sourceAwayWinPercent"] },
};
const evidence = z.object({
  legendSha256: z.literal(SEMANTIC_LEGEND_SHA256).optional(),
  legendResourcePath: z.string().startsWith("/images/predictions/").optional(),
  officialAlt: z.string().min(1).max(180).optional(),
  historicalHeaderResourcePath: z.string().startsWith("/images/predictions/").optional(),
  snapshotsVerified: z.literal(21).optional(),
  rowsVerified: z.literal(1110).optional(),
  bridgeStatus: z.literal("DIRECT_RESOURCE_MATCH").optional(),
  bridgeDiagnosticSha256: hash.optional(),
  components: z.array(z.string().min(1)).min(1).optional(),
  formula: z.string().min(1).optional(),
  registryVersion: z.literal(SEMANTIC_REGISTRY_VERSION).optional(),
  reason: z.string().min(1).optional(),
  resourceFamily: z.string().min(1).optional(),
  resource: z.string().min(1).optional(),
}).strict();

const definition = z.object({
  rawHeader: z.string().max(20).nullable(),
  canonicalField: z.string().regex(/^source[A-Z]|^statareaTip$|^user/),
  meaning: z.string().min(1).max(220),
  unit: z.enum(["SOURCE_PERCENT", "NOT_APPLICABLE"]),
  direction: z.string().min(1).max(50).nullable(),
  line: z.enum(["1.5", "2.5", "3.5"]).nullable(),
  semanticStatus: z.enum(["VERIFIED_DIRECT", "VERIFIED_DERIVED", "UNVERIFIED", "NOT_APPLICABLE"]),
  evidenceLevel: z.enum(["OFFICIAL_DIRECT_RESOURCE_BRIDGE", "DETERMINISTIC_FORMULA", "INSUFFICIENT", "OUT_OF_SCOPE"]),
  evidence,
  normalizationRule: z.string().min(1).max(180),
  derivationRule: z.string().min(1).max(180).nullable(),
  analysisEnabled: z.boolean(),
  warnings: z.array(z.string().max(240)),
}).strict().superRefine((value, context) => {
  if (value.semanticStatus === "VERIFIED_DIRECT") {
    if (value.evidenceLevel !== "OFFICIAL_DIRECT_RESOURCE_BRIDGE" || value.evidence.legendSha256 !== SEMANTIC_LEGEND_SHA256 || !value.evidence.officialAlt || value.evidence.legendResourcePath !== value.evidence.historicalHeaderResourcePath || value.evidence.bridgeStatus !== "DIRECT_RESOURCE_MATCH") {
      context.addIssue({ code: "custom", message: "VERIFIED_DIRECT requires complete official resource evidence" });
    }
    if (value.direction === "OVER" && !value.evidence.officialAlt?.toLowerCase().includes(`over ${value.line} goals`)) context.addIssue({ code: "custom", message: "OVER requires exact official text" });
    if (["1.5", "2.5", "3.5"].includes(value.rawHeader ?? "") && value.direction !== "OVER") context.addIssue({ code: "custom", message: "Goal-line headers require OVER direction" });
  }
  if (value.semanticStatus === "VERIFIED_DERIVED") {
    const expected = exactDerivations[value.canonicalField];
    if (!value.derivationRule || !value.evidence.components?.length || value.evidenceLevel !== "DETERMINISTIC_FORMULA") context.addIssue({ code: "custom", message: "Derived field requires formula and components" });
    if (!expected || value.derivationRule !== expected.rule || value.evidence.formula !== expected.rule || JSON.stringify(value.evidence.components) !== JSON.stringify(expected.components)) context.addIssue({ code: "custom", message: "Derived field must use its exact deterministic formula and source components" });
  }
});

export const semanticRegistrySchema = z.object({
  contractVersion: z.literal(SEMANTIC_REGISTRY_CONTRACT_VERSION),
  code: z.literal(SEMANTIC_REGISTRY_CODE),
  version: z.literal(SEMANTIC_REGISTRY_VERSION),
  source: z.literal("STATAREA"),
  sourcePresentation: z.literal(SEMANTIC_SOURCE_PRESENTATION),
  parserVersion: z.literal(SEMANTIC_PARSER_VERSION),
  evidenceStatus: z.literal("VERIFIED"),
  evidence: z.object({ legendSha256: z.literal(SEMANTIC_LEGEND_SHA256), bridgeDiagnosticSha256: hash, snapshotsVerified: z.literal(21), rowsVerified: z.literal(1110), resultsUsed: z.literal(0) }).strict(),
  fieldDefinitions: z.array(definition).min(1),
  derivedDefinitions: z.array(definition).min(1),
  assessmentVersion: z.literal(SEMANTIC_ASSESSMENT_VERSION),
  warnings: z.array(z.string().max(240)),
  registryHash: hash,
}).strict().superRefine((value, context) => {
  const { registryHash, ...core } = value;
  if (canonicalHash(core) !== registryHash) context.addIssue({ code: "custom", path: ["registryHash"], message: "Non-canonical registry hash" });
});

const residual = z.object({ total: z.number().int().nonnegative(), exact100: z.number().int().nonnegative(), withinTolerance: z.number().int().nonnegative(), outsideTolerance: z.number().int().nonnegative(), averageAbsoluteResidual: z.string(), maximumAbsoluteResidual: z.string(), tolerancePercentagePoints: z.literal("1") }).strict();
const fieldQuality = z.object({ field: z.string(), total: z.literal(1110), present: z.number().int().nonnegative(), missing: z.number().int().nonnegative(), parseable: z.number().int().nonnegative(), invalid: z.number().int().nonnegative(), outOfRange: z.number().int().nonnegative(), minimum: z.string().nullable(), maximum: z.string().nullable(), distinctValues: z.number().int().nonnegative(), formatsObserved: z.array(z.string()), affectedDates: z.array(z.iso.date()), affectedCountries: z.array(z.string()), affectedCompetitions: z.array(z.string()) }).strict();
const dateQuality = z.object({ sportsDate: z.iso.date(), partition: z.enum(["DISCOVERY", "VALIDATION"]), rows: z.number().int().nonnegative(), ready: z.number().int().nonnegative(), readyWithWarnings: z.number().int().nonnegative(), insufficient: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), invalidValues: z.number().int().nonnegative(), warnings: z.array(z.string()) }).strict();
const derivedQuality = z.object({ field: z.string(), total: z.literal(1110), derivable: z.number().int().nonnegative(), notDerivable: z.number().int().nonnegative(), outOfRange: z.number().int().nonnegative(), maximumDecimalPlaces: z.number().int().nonnegative(), sourcePrecisionPreserved: z.literal(true), warnings: z.array(z.string()) }).strict();

export const semanticAssessmentSchema = z.object({
  contractVersion: z.literal(SEMANTIC_ASSESSMENT_CONTRACT_VERSION),
  assessment: z.object({ id: z.string().min(1), version: z.literal(SEMANTIC_ASSESSMENT_VERSION), status: z.literal("COMPLETED"), createdAt: z.iso.datetime(), rowCount: z.literal(1110) }).strict(),
  registryReference: z.object({ id: z.string().min(1), code: z.literal(SEMANTIC_REGISTRY_CODE), version: z.literal(SEMANTIC_REGISTRY_VERSION), registryHash: hash, legendSha256: z.literal(SEMANTIC_LEGEND_SHA256) }).strict(),
  datasetReference: z.object({ id: z.string().min(1), code: z.literal(SEMANTIC_DATASET_CODE), version: z.literal("1.0.0"), status: z.literal("FROZEN"), sourcePresentation: z.literal(SEMANTIC_SOURCE_PRESENTATION), manifestHash: z.literal(SEMANTIC_MANIFEST_HASH) }).strict(),
  qualityTotals: z.object({ rows: z.literal(1110), ready: z.number().int().nonnegative(), readyWithWarnings: z.number().int().nonnegative(), insufficient: z.number().int().nonnegative(), rejected: z.number().int().nonnegative(), invalidValues: z.number().int().nonnegative(), missingValues: z.number().int().nonnegative(), oneXTwo: residual, halfTime: residual, monotonicity: z.object({ compliant: z.number().int().nonnegative(), violations: z.number().int().nonnegative(), maximumViolation: z.string(), affectedDates: z.array(z.iso.date()), affectedCountries: z.array(z.string()), affectedCompetitions: z.array(z.string()) }).strict(), complementsValid: z.number().int().nonnegative(), doubleChanceIdentitiesWithinTolerance: z.number().int().nonnegative(), derivedQuality: z.array(derivedQuality).length(6) }).strict(),
  qualityByField: z.array(fieldQuality).min(9),
  qualityByDate: z.array(dateQuality).length(21),
  matchedReadiness: z.object({ total: z.literal(98), discovery: z.literal(64), validation: z.literal(34), ou25SemanticReady: z.number().int().nonnegative(), doubleChanceSemanticReady: z.number().int().nonnegative(), bothReady: z.number().int().nonnegative(), htSemanticReady: z.number().int().nonnegative(), handicap01SemanticReady: z.number().int().nonnegative(), withWarnings: z.number().int().nonnegative(), insufficient: z.number().int().nonnegative() }).strict(),
  findings: z.array(z.object({ field: z.string(), findingType: z.string(), severity: z.enum(["INFO", "WARNING", "ERROR"]), count: z.number().int().nonnegative(), expectedRule: z.string() }).strict()),
  warnings: z.array(z.string().max(240)),
  resultsUsed: z.literal(0),
  networkRequests: z.literal(0),
  assessmentHash: hash,
}).strict().superRefine((value, context) => {
  const { assessmentHash, ...core } = value;
  if (canonicalHash(core) !== assessmentHash) context.addIssue({ code: "custom", path: ["assessmentHash"], message: "Non-canonical assessment hash" });
});
