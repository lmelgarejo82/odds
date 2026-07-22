import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import candidateJsonSchema from "@/contracts/schemas/fixture-market-candidates.schema.json";
import decisionJsonSchema from "@/contracts/schemas/fixture-preferred-line-decisions.schema.json";
import policyJsonSchema from "@/contracts/schemas/market-priority-policy.schema.json";
import {
  fixtureMarketCandidatesDocumentSchema,
  fixturePreferredLineDecisionsDocumentSchema,
  marketPriorityPolicyDocumentSchema,
  type FixtureMarketCandidateContract,
  type FixturePreferredLineDecisionContract,
} from "@/contracts/market-priority";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import { PRICE_FIELDS, REQUIRED_PRICE_WARNING } from "@/domain/market-priority/constants";
import { marketPriorityPolicy, marketPriorityPolicyHash } from "@/domain/market-priority/policy";
import {
  combinationSignalScore,
  dataQualityScore,
  doubleChanceSignalScore,
  historicalEvidenceScore,
  ou25SignalScore,
  priorityClass,
  priorityScore,
  selectStrictWinner,
} from "@/domain/market-priority/scoring";
import { withMarketPriorityOfflineGuard } from "@/infrastructure/market-priority/offline-guard";
import { createOutcomeAccessGuard } from "@/infrastructure/market-priority/outcome-access-guard";

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");

const candidate = (): FixtureMarketCandidateContract => ({
  id: "candidate",
  matchDecisionId: "match",
  sportsDate: "2026-07-01",
  fixture: { homeTeam: "Home", awayTeam: "Away" },
  family: "DOUBLE_CHANCE",
  marketCode: "1X",
  historicalPatternCode: "DOUBLE_CHANCE_1X",
  matchingQualityClass: "EXACT",
  strengthClass: null,
  confluenceCode: null,
  sourceEvidence: { doubleChanceSourcePercent: 70, secondHighestDcPercent: 60, forebetSuggestedSide: null, forebetSidePercent: null, statareaSidePercent: null, statareaSourceOver25Percent: 55 },
  signalDetails: { percentComponent: 15, lineMargin: 10, marginComponent: 5, minimumAgreementPercent: null, strengthComponent: null, sourceGap: null, balanceComponent: null, combinationDcScore: null, combinationOuScore: null },
  historicalEvidence: { patternCode: "DOUBLE_CHANCE_1X", side: "1X", validationN: 33, validationHitRate: 0.7, validationWilsonLower: 0.5, stabilityClass: "STABLE_OR_IMPROVED", validationHitRateComponent: 8.4, validationWilsonLowerComponent: 6, sampleComponent: 8, stabilityComponent: 8, uncappedScore: 30.4, validationLift: null, maxCountryShare: 0.3, maxCompetitionShare: 0.2 },
  dataQuality: { matchingComponent: 8, completenessComponent: 6, semanticReadinessComponent: 4, integrityComponent: 2 },
  signalScore: 20,
  historicalEvidenceScore: 30.4,
  dataQualityScore: 20,
  rawPriorityScore: 70.4,
  finalPriorityScore: 70.4,
  priorityClass: "TRACK",
  blocked: false,
  blockers: [],
  caps: [],
  reasons: ["FROZEN_AGGREGATE_METRIC"],
  warnings: [REQUIRED_PRICE_WARNING],
  ...PRICE_FIELDS,
});

const decision = (): FixturePreferredLineDecisionContract => ({
  id: "decision",
  matchDecisionId: "match",
  selectionStatus: "PROVISIONAL",
  selectedCandidateId: "candidate",
  selectedMarketCode: "1X",
  selectedLineCount: 1,
  selectedCandidateBlocked: false,
  topCandidateId: "candidate",
  topFinalPriorityScore: 70.4,
  secondCandidateId: null,
  marginToSecond: 70.4,
  reasonCode: "PROVISIONAL_PRIORITY_THRESHOLD",
  reasons: ["threshold"],
  caps: [],
  warnings: [REQUIRED_PRICE_WARNING],
  ...PRICE_FIELDS,
});

describe("política de prioridad congelada", () => {
  it("produce un policyHash reproducible y canónico", () => {
    expect(marketPriorityPolicyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(canonicalHash(JSON.parse(canonicalJson(marketPriorityPolicy)))).toBe(marketPriorityPolicyHash);
  });
  it("conserva las referencias B005-B007 exactas", () => expect(marketPriorityPolicy.frozenReferences).toEqual(expect.objectContaining({ datasetId: "ou25-july-2026-v1", manifestHash: "b651152816688759d54486ebc4cdac11704dd9e287818dec6b7f935c185ed105", semanticRegistryHash: "735762986050e6fc0d763c180b23cf7a28439ca92fd6ea934d4725531f9650d3", historicalAnalysisSpecHash: "433e63cf4e7c3dac22a513d32a60337816a7fe9f15e88abb33c03748ad2d14e9" })));
  it("declara la frontera anti-leakage", () => expect(marketPriorityPolicy.evidenceBoundary).toEqual(expect.objectContaining({ developmentEvidenceWindow: "2026-07-01..2026-07-21", independentValidationStatus: "NOT_AVAILABLE_FOR_PRIORITY_POLICY", prospectiveValidationRequired: true, outcomeEvaluationEnabled: false })));
  it("no presenta Validation B007 como validación independiente", () => expect(marketPriorityPolicy.evidenceBoundary.independentValidationStatus).not.toBe("AVAILABLE"));
  it("congela tres familias y una sola línea", () => { expect(Object.keys(marketPriorityPolicy.families)).toHaveLength(3); expect(marketPriorityPolicy.finalSelection.selectedLineMaximum).toBe(1); });
  it("no calcula probabilidad conjunta", () => expect(marketPriorityPolicy.families.sameMatchCombination.jointProbabilityCalculated).toBe(false));
  it("mantiene el precio sin evaluar", () => expect(marketPriorityPolicy.priceBoundary).toEqual(expect.objectContaining(PRICE_FIELDS)));
});

describe("fórmulas Decimal.js", () => {
  it("calcula señal DC", () => expect(doubleChanceSignalScore(70, [60, 55])).toEqual({ percentComponent: 15, lineMargin: 10, marginComponent: 5, signalScore: 20 }));
  it("clampa señal DC débil", () => expect(doubleChanceSignalScore(45, [60, 55]).signalScore).toBe(0));
  it("calcula señal O/U", () => expect(ou25SignalScore(65, 70)).toEqual({ minimumAgreementPercent: 65, strengthComponent: 19.2, sourceGap: 5, balanceComponent: 6, signalScore: 25.2 }));
  it("penaliza brecha O/U", () => expect(ou25SignalScore(75, 55).balanceComponent).toBe(0));
  it("usa el mínimo para la combinación", () => expect(combinationSignalScore(31.5, 22.25)).toBe(22.25));
  it("calcula evidencia histórica", () => expect(historicalEvidenceScore({ validationN: 33, validationHitRate: 0.8, validationWilsonLower: 0.65, stabilityClass: "STABLE_OR_IMPROVED", maxCountryShare: 0.3, maxCompetitionShare: 0.2 }).score).toBe(33.4));
  it("no sustituye muestra Validation n=0", () => expect(historicalEvidenceScore({ validationN: 0, validationHitRate: null, validationWilsonLower: null, stabilityClass: null, maxCountryShare: null, maxCompetitionShare: null }).score).toBe(0));
  it("aplica cap severo de evidencia", () => expect(historicalEvidenceScore({ validationN: 33, validationHitRate: 1, validationWilsonLower: 1, stabilityClass: "SEVERE_DROP", maxCountryShare: 0.2, maxCompetitionShare: 0.2 }).score).toBe(18));
  it("calcula calidad exacta completa", () => expect(dataQualityScore({ matchingQualityClass: "EXACT", requiredFieldsComplete: true, semanticReady: true, snapshotIntegrityVerified: true }).score).toBe(20));
  it("calcula calidad conservadora", () => expect(dataQualityScore({ matchingQualityClass: "CONSERVATIVE", requiredFieldsComplete: true, semanticReady: true, snapshotIntegrityVerified: true }).score).toBe(18));
  it("calcula calidad aproximada", () => expect(dataQualityScore({ matchingQualityClass: "APPROXIMATE", requiredFieldsComplete: true, semanticReady: true, snapshotIntegrityVerified: true }).score).toBe(15));
  it("aplica cap de calidad", () => expect(priorityScore({ signalScore: 40, historicalEvidenceScore: 40, dataQualityScore: 13, validationN: 30, stabilityClass: "STABLE_OR_IMPROVED", maxCountryShare: 0.2, maxCompetitionShare: 0.2, family: "DOUBLE_CHANCE", validationLift: null }).finalPriorityScore).toBe(64));
  it("aplica cap por caída moderada", () => expect(priorityScore({ signalScore: 40, historicalEvidenceScore: 30, dataQualityScore: 20, validationN: 30, stabilityClass: "MODERATE_DROP", maxCountryShare: 0.2, maxCompetitionShare: 0.2, family: "DOUBLE_CHANCE", validationLift: null }).finalPriorityScore).toBe(74));
  it("aplica cap por concentración", () => expect(priorityScore({ signalScore: 40, historicalEvidenceScore: 40, dataQualityScore: 20, validationN: 30, stabilityClass: "STABLE_OR_IMPROVED", maxCountryShare: 0.51, maxCompetitionShare: 0.2, family: "DOUBLE_CHANCE", validationLift: null }).finalPriorityScore).toBe(84));
  it("aplica cap O/U con lift no positivo", () => expect(priorityScore({ signalScore: 40, historicalEvidenceScore: 40, dataQualityScore: 20, validationN: 30, stabilityClass: "STABLE_OR_IMPROVED", maxCountryShare: 0.2, maxCompetitionShare: 0.2, family: "OU25", validationLift: 0 }).finalPriorityScore).toBe(84));
  it.each([[85, "HIGH"], [75, "INTERESTING"], [65, "TRACK"], [64.999, "DO_NOT_PRIORITIZE"]] as const)("clasifica score %s", (score, expected) => expect(priorityClass(score)).toBe(expected));
});

describe("desempates y decisión única", () => {
  const base = { id: "a", finalPriorityScore: 75, historicalEvidenceScore: 30, dataQualityScore: 20, signalScore: 25, historicalEvidence: { validationWilsonLower: 0.5, validationN: 30 }, blocked: false };
  it("prefiere evidencia histórica en empate de score", () => expect(selectStrictWinner([base, { ...base, id: "b", historicalEvidenceScore: 29 }]).winner?.id).toBe("a"));
  it("prefiere Wilson después de los scores", () => expect(selectStrictWinner([base, { ...base, id: "b", historicalEvidence: { validationWilsonLower: 0.4, validationN: 30 } }]).winner?.id).toBe("a"));
  it("declara empate final sin fallback arbitrario", () => expect(selectStrictWinner([base, { ...base, id: "b" }])).toEqual(expect.objectContaining({ winner: null, tied: true })));
  it("excluye candidatos bloqueados", () => expect(selectStrictWinner([{ ...base, blocked: true }]).winner).toBeNull());
});

describe("contratos B008", () => {
  const policyDocument = { contractVersion: "market-priority-policy/1.0" as const, priorityPolicyHash: marketPriorityPolicyHash, policy: marketPriorityPolicy };
  it("valida policy con Zod y AJV", () => { expect(marketPriorityPolicyDocumentSchema.safeParse(policyDocument).success).toBe(true); expect(validateContract(policyJsonSchema, policyDocument).valid).toBe(true); });
  it("rechaza policy adulterada", () => expect(marketPriorityPolicyDocumentSchema.safeParse({ ...policyDocument, policy: { ...marketPriorityPolicy, status: "DRAFT" } }).success).toBe(false));
  it("valida candidatos y hash", () => { const candidates = [candidate()]; const document = { contractVersion: "fixture-market-candidates/1.0" as const, priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", candidateSetHash: canonicalHash(candidates), candidates }; expect(fixtureMarketCandidatesDocumentSchema.safeParse(document).success).toBe(true); expect(validateContract(candidateJsonSchema, document).valid).toBe(true); });
  it("rechaza suma inconsistente", () => { const invalid = { ...candidate(), rawPriorityScore: 99 }; expect(fixtureMarketCandidatesDocumentSchema.safeParse({ contractVersion: "fixture-market-candidates/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", candidateSetHash: canonicalHash([invalid]), candidates: [invalid] }).success).toBe(false); });
  it("rechaza clase inconsistente", () => { const invalid = { ...candidate(), priorityClass: "HIGH" }; expect(fixtureMarketCandidatesDocumentSchema.safeParse({ contractVersion: "fixture-market-candidates/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", candidateSetHash: canonicalHash([invalid]), candidates: [invalid] }).success).toBe(false); });
  it("rechaza cuota no nula", () => expect(fixtureMarketCandidatesDocumentSchema.safeParse({ contractVersion: "fixture-market-candidates/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", candidateSetHash: "a".repeat(64), candidates: [{ ...candidate(), availableOdds: 2 }] }).success).toBe(false));
  it("rechaza combinación sin componentes", () => { const invalid = { ...candidate(), family: "SAME_MATCH_COMBINATION", marketCode: "1X" }; expect(fixtureMarketCandidatesDocumentSchema.safeParse({ contractVersion: "fixture-market-candidates/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", candidateSetHash: canonicalHash([invalid]), candidates: [invalid] }).success).toBe(false); });
  it("valida decisión PROVISIONAL", () => { const decisions = [decision()]; const document = { contractVersion: "fixture-preferred-line-decisions/1.0" as const, priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", decisionSetHash: canonicalHash(decisions), decisions }; expect(fixturePreferredLineDecisionsDocumentSchema.safeParse(document).success).toBe(true); expect(validateContract(decisionJsonSchema, document).valid).toBe(true); });
  it("rechaza PREFERRED bajo 75", () => { const invalid = { ...decision(), selectionStatus: "PREFERRED", topFinalPriorityScore: 74 }; expect(fixturePreferredLineDecisionsDocumentSchema.safeParse({ contractVersion: "fixture-preferred-line-decisions/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", decisionSetHash: canonicalHash([invalid]), decisions: [invalid] }).success).toBe(false); });
  it("rechaza PREFERRED con margen menor de cinco", () => { const invalid = { ...decision(), selectionStatus: "PREFERRED", topFinalPriorityScore: 80, marginToSecond: 4.99 }; expect(fixturePreferredLineDecisionsDocumentSchema.safeParse({ contractVersion: "fixture-preferred-line-decisions/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", decisionSetHash: canonicalHash([invalid]), decisions: [invalid] }).success).toBe(false); });
  it("rechaza NONE con línea", () => { const invalid = { ...decision(), selectionStatus: "NONE" }; expect(fixturePreferredLineDecisionsDocumentSchema.safeParse({ contractVersion: "fixture-preferred-line-decisions/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", decisionSetHash: canonicalHash([invalid]), decisions: [invalid] }).success).toBe(false); });
  it("rechaza candidato bloqueado seleccionado", () => { const invalid = { ...decision(), selectedCandidateBlocked: true }; expect(fixturePreferredLineDecisionsDocumentSchema.safeParse({ contractVersion: "fixture-preferred-line-decisions/1.0", priorityPolicyHash: marketPriorityPolicyHash, assessmentId: "assessment", decisionSetHash: canonicalHash([invalid]), decisions: [invalid] }).success).toBe(false); });
});

describe("guardas y fronteras B008", () => {
  it("bloquea acceso a outcomes", async () => { const prisma = new PrismaClient(); const guard = createOutcomeAccessGuard(prisma); expect(() => guard.client.fixtureOutcome.count()).toThrow(/PROHIBITED_DATA_ACCESS/); expect(guard.getBlockedAccessAttempts()).toBe(1); await prisma.$disconnect(); });
  it("bloquea red", async () => await expect(withMarketPriorityOfflineGuard(async () => fetch("https://example.com"))).rejects.toThrow(/NETWORK_BLOCKED/));
  it("el application service no menciona modelos de outcome", () => { const body = source("src/application/assess-market-priority.ts"); expect(body).not.toMatch(/fixtureOutcome|outcomeEvidence|matchResult/); });
  it("no depende de Apostala ni x2-ht-lab", () => { const body = source("package.json"); expect(body.toLowerCase()).not.toContain("apostala"); expect(body).not.toContain("x2-ht-lab"); });
  it("B010 no existe", () => {
    const trackedSources = ["src", "scripts", "prisma"].flatMap((directory) => readdirSync(join(root, directory), { recursive: true }).map((path) => `${directory}/${String(path)}`));
    expect([...trackedSources, source("package.json")].join("\n")).not.toMatch(/(?:^|[\\/])b010(?:[\\/.-]|$)/i);
  });
  it("la UI contiene textos obligatorios", () => { const body = source("src/components/market-priority-status.tsx"); expect(body).toContain("La línea seleccionada es una preferencia por evidencia."); expect(body).toContain("No confirma valor de mercado porque la cuota todavía no fue evaluada."); });
  it("la UI no muestra evaluación del resultado", () => { const body = source("src/components/market-priority-status.tsx"); expect(body).not.toMatch(/HIT|MISS|rentabilidad|stake|ranking diario/i); });
});
