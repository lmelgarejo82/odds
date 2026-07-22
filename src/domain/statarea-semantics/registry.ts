import { canonicalHash } from "@/domain/canonical-hash";
import {
  SEMANTIC_ASSESSMENT_VERSION,
  SEMANTIC_BRIDGE_DIAGNOSTIC_SHA256,
  SEMANTIC_LEGEND_SHA256,
  SEMANTIC_PARSER_VERSION,
  SEMANTIC_REGISTRY_CODE,
  SEMANTIC_REGISTRY_CONTRACT_VERSION,
  SEMANTIC_REGISTRY_VERSION,
  SEMANTIC_SOURCE_PRESENTATION,
} from "@/domain/statarea-semantics/constants";

export type SemanticDefinition = {
  rawHeader: string | null;
  canonicalField: string;
  meaning: string;
  unit: "SOURCE_PERCENT" | "NOT_APPLICABLE";
  direction: string | null;
  line: string | null;
  semanticStatus: "VERIFIED_DIRECT" | "VERIFIED_DERIVED" | "UNVERIFIED" | "NOT_APPLICABLE";
  evidenceLevel: "OFFICIAL_DIRECT_RESOURCE_BRIDGE" | "DETERMINISTIC_FORMULA" | "INSUFFICIENT" | "OUT_OF_SCOPE";
  evidence: Record<string, unknown>;
  normalizationRule: string;
  derivationRule: string | null;
  analysisEnabled: boolean;
  warnings: string[];
};

const direct = (
  rawHeader: string,
  canonicalField: string,
  meaning: string,
  direction: string,
  resource: string,
  alt: string,
  options: { line?: string; analysisEnabled?: boolean; warnings?: string[] } = {},
): SemanticDefinition => ({
  rawHeader,
  canonicalField,
  meaning,
  unit: "SOURCE_PERCENT",
  direction,
  line: options.line ?? null,
  semanticStatus: "VERIFIED_DIRECT",
  evidenceLevel: "OFFICIAL_DIRECT_RESOURCE_BRIDGE",
  evidence: {
    legendSha256: SEMANTIC_LEGEND_SHA256,
    legendResourcePath: resource,
    officialAlt: alt,
    historicalHeaderResourcePath: resource,
    snapshotsVerified: 21,
    rowsVerified: 1110,
    bridgeStatus: "DIRECT_RESOURCE_MATCH",
    bridgeDiagnosticSha256: SEMANTIC_BRIDGE_DIAGNOSTIC_SHA256,
  },
  normalizationRule: "trim -> require terminal % -> Decimal.js parse -> validate inclusive range 0..100",
  derivationRule: null,
  analysisEnabled: options.analysisEnabled ?? true,
  warnings: options.warnings ?? [],
});

export const directSemanticDefinitions: SemanticDefinition[] = [
  direct("1", "sourceHomeWinPercent", "Porcentaje fuente de victoria del equipo local", "HOME_WIN", "/images/predictions/1.gif", "prediction to win host team"),
  direct("X", "sourceDrawPercent", "Porcentaje fuente de empate", "DRAW", "/images/predictions/X.gif", "prediction to draw match"),
  direct("2", "sourceAwayWinPercent", "Porcentaje fuente de victoria del equipo visitante", "AWAY_WIN", "/images/predictions/2.gif", "prediction to win guest team"),
  direct("H1", "sourceHtHomeWinPercent", "Porcentaje fuente de victoria local al descanso", "HT_HOME_WIN", "/images/predictions/H1.gif", "prediction to win host team at halftime"),
  direct("HX", "sourceHtDrawPercent", "Porcentaje fuente de empate al descanso", "HT_DRAW", "/images/predictions/HX.gif", "prediction to draw match at halftime"),
  direct("H2", "sourceHtAwayWinPercent", "Porcentaje fuente de victoria visitante al descanso", "HT_AWAY_WIN", "/images/predictions/H2.gif", "prediction to win guest team at halftime"),
  direct("1.5", "sourceOver15Percent", "Porcentaje fuente de más de 1.5 goles", "OVER", "/images/predictions/1_5.gif", "prediction for scored goal in match - over 1.5 goals ", { line: "1.5" }),
  direct("2.5", "sourceOver25Percent", "Porcentaje fuente de más de 2.5 goles", "OVER", "/images/predictions/2_5.gif", "prediction for scored goal in match - over 2.5 goals ", { line: "2.5" }),
  direct("3.5", "sourceOver35Percent", "Porcentaje fuente de más de 3.5 goles", "OVER", "/images/predictions/3_5.gif", "prediction for scored goal in match - over 3.5 goals ", { line: "3.5" }),
  direct("hc1", "sourceHandicap01HomePercent", "Porcentaje fuente local para la modalidad con resultado inicial 0:1", "HANDICAP_0_1_HOME", "/images/predictions/HC1.gif", "nandicap prediction to win host team (match start result 0:1) ", { analysisEnabled: false, warnings: ["Modalidad demostrada, pero fuera del análisis B007."] }),
  direct("hcX", "sourceHandicap01DrawPercent", "Porcentaje fuente de empate para la modalidad con resultado inicial 0:1", "HANDICAP_0_1_DRAW", "/images/predictions/HCX.gif", "nandicap prediction to draw match (match start result 0:1) ", { analysisEnabled: false, warnings: ["Modalidad demostrada, pero fuera del análisis B007."] }),
  direct("hc2", "sourceHandicap01AwayPercent", "Porcentaje fuente visitante para la modalidad con resultado inicial 0:1", "HANDICAP_0_1_AWAY", "/images/predictions/HC2.gif", "nandicap prediction to win guest team (match start result 0:1) ", { analysisEnabled: false, warnings: ["Modalidad demostrada, pero fuera del análisis B007."] }),
];

const derived = (canonicalField: string, meaning: string, direction: string, rule: string, components: string[]): SemanticDefinition => ({
  rawHeader: null,
  canonicalField,
  meaning,
  unit: "SOURCE_PERCENT",
  direction,
  line: direction === "UNDER_1_5" ? "1.5" : direction === "UNDER_2_5" ? "2.5" : direction === "UNDER_3_5" ? "3.5" : null,
  semanticStatus: "VERIFIED_DERIVED",
  evidenceLevel: "DETERMINISTIC_FORMULA",
  evidence: { components, formula: rule, registryVersion: SEMANTIC_REGISTRY_VERSION },
  normalizationRule: "Decimal.js operands; preserve source precision; validate inclusive range 0..100",
  derivationRule: rule,
  analysisEnabled: true,
  warnings: ["Valor derivado; no es una probabilidad real ni calibrada."],
});

export const derivedSemanticDefinitions: SemanticDefinition[] = [
  derived("sourceUnder15Percent", "Valor derivado de menos de 1.5 goles", "UNDER_1_5", "100 - sourceOver15Percent", ["sourceOver15Percent"]),
  derived("sourceUnder25Percent", "Valor derivado de menos de 2.5 goles", "UNDER_2_5", "100 - sourceOver25Percent", ["sourceOver25Percent"]),
  derived("sourceUnder35Percent", "Valor derivado de menos de 3.5 goles", "UNDER_3_5", "100 - sourceOver35Percent", ["sourceOver35Percent"]),
  derived("sourceDoubleChance1XPercent", "Valor derivado de doble oportunidad 1X", "DOUBLE_CHANCE_1X", "sourceHomeWinPercent + sourceDrawPercent", ["sourceHomeWinPercent", "sourceDrawPercent"]),
  derived("sourceDoubleChanceX2Percent", "Valor derivado de doble oportunidad X2", "DOUBLE_CHANCE_X2", "sourceDrawPercent + sourceAwayWinPercent", ["sourceDrawPercent", "sourceAwayWinPercent"]),
  derived("sourceDoubleChance12Percent", "Valor derivado de doble oportunidad 12", "DOUBLE_CHANCE_12", "sourceHomeWinPercent + sourceAwayWinPercent", ["sourceHomeWinPercent", "sourceAwayWinPercent"]),
];

export const excludedSemanticDefinitions: SemanticDefinition[] = [
  { rawHeader: "TIP", canonicalField: "statareaTip", meaning: "Predicción del sistema sin definición formal suficiente", unit: "NOT_APPLICABLE", direction: null, line: null, semanticStatus: "UNVERIFIED", evidenceLevel: "INSUFFICIENT", evidence: { reason: "TIP is structurally separate from percentage columns." }, normalizationRule: "none", derivationRule: null, analysisEnabled: false, warnings: ["No interpretar imágenes prd* sin evidencia formal adicional."] },
  { rawHeader: null, canonicalField: "userPrediction", meaning: "Predicción de usuario fuera del alcance B007", unit: "NOT_APPLICABLE", direction: null, line: null, semanticStatus: "NOT_APPLICABLE", evidenceLevel: "OUT_OF_SCOPE", evidence: { resourceFamily: "usr_*" }, normalizationRule: "none", derivationRule: null, analysisEnabled: false, warnings: [] },
  { rawHeader: null, canonicalField: "userVoting", meaning: "Votación de usuario fuera del alcance B007", unit: "NOT_APPLICABLE", direction: null, line: null, semanticStatus: "NOT_APPLICABLE", evidenceLevel: "OUT_OF_SCOPE", evidence: { resourceFamily: "usr_btn_*" }, normalizationRule: "none", derivationRule: null, analysisEnabled: false, warnings: [] },
  { rawHeader: null, canonicalField: "userComment", meaning: "Comentario de usuario fuera del alcance B007", unit: "NOT_APPLICABLE", direction: null, line: null, semanticStatus: "NOT_APPLICABLE", evidenceLevel: "OUT_OF_SCOPE", evidence: { resource: "/images/predictions/usr_comments.gif" }, normalizationRule: "none", derivationRule: null, analysisEnabled: false, warnings: [] },
];

export const semanticRegistryCore = {
  contractVersion: SEMANTIC_REGISTRY_CONTRACT_VERSION,
  code: SEMANTIC_REGISTRY_CODE,
  version: SEMANTIC_REGISTRY_VERSION,
  source: "STATAREA" as const,
  sourcePresentation: SEMANTIC_SOURCE_PRESENTATION,
  parserVersion: SEMANTIC_PARSER_VERSION,
  evidenceStatus: "VERIFIED" as const,
  evidence: {
    legendSha256: SEMANTIC_LEGEND_SHA256,
    bridgeDiagnosticSha256: SEMANTIC_BRIDGE_DIAGNOSTIC_SHA256,
    snapshotsVerified: 21,
    rowsVerified: 1110,
    resultsUsed: 0,
  },
  fieldDefinitions: [...directSemanticDefinitions, ...excludedSemanticDefinitions],
  derivedDefinitions: derivedSemanticDefinitions,
  assessmentVersion: SEMANTIC_ASSESSMENT_VERSION,
  warnings: ["Estos valores son porcentajes publicados por Statarea; no son probabilidades reales ni calibradas."],
};

export const SEMANTIC_REGISTRY_HASH = canonicalHash(semanticRegistryCore);
export const semanticRegistryContract = { ...semanticRegistryCore, registryHash: SEMANTIC_REGISTRY_HASH };
