import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatProspectiveDateTime, ProspectiveShadowStatus } from "@/components/prospective-shadow-status";
import runJsonSchema from "@/contracts/schemas/prospective-shadow-run.schema.json";
import assessmentJsonSchema from "@/contracts/schemas/prospective-fixture-assessment.schema.json";
import quoteJsonSchema from "@/contracts/schemas/quote-request-plan.schema.json";
import { prospectiveFixtureAssessmentDocumentSchema, prospectiveShadowRunDocumentSchema, quoteRequestPlanDocumentSchema } from "@/contracts/prospective";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { marketPriorityPolicyHash } from "@/domain/market-priority/policy";
import { assertFrozenBeforeSportsDate, PROSPECTIVE_SPORTS_DATE, validateProspectiveDate } from "@/domain/prospective/constants";
import { buildB008DominanceDiagnostic } from "@/domain/prospective/dominance-diagnostic";
import { buildProspectiveFixture, type ProspectiveAggregateMetric } from "@/domain/prospective/engine";
import { projectProspectiveSemanticRow } from "@/domain/prospective/semantic-projection";
import { MATCH_CONFIGURATION_HASH } from "@/domain/reconciliation/configuration";
import { buildForebetUrl } from "@/domain/forebet/constants";
import { buildLegacyStatareaUrl } from "@/domain/statarea/legacy-constants";

const databaseMock = vi.hoisted(() => ({
  prospectiveShadowRun: { findFirst: vi.fn() },
  matchRun: { findUniqueOrThrow: vi.fn() },
  prospectiveCandidateSnapshot: { findMany: vi.fn() },
  prospectiveFixtureAssessment: { findMany: vi.fn() },
  quoteRequestPlan: { findMany: vi.fn() },
}));

vi.mock("@/infrastructure/database", () => ({ database: databaseMock }));

const root = process.cwd();
const source = (path: string) => readFileSync(join(root, path), "utf8");
const metric = (patternCode: string, side: string, hitRate = 0.75): ProspectiveAggregateMetric => ({ patternCode, side, validationN: 34, validationHitRate: hitRate, validationWilsonLower: 0.58, stabilityClass: "STABLE_OR_IMPROVED", maxCountryShare: 0.3, maxCompetitionShare: 0.25, warnings: [] });
const metrics = [
  metric("DOUBLE_CHANCE_1X", "1X", 0.8), metric("DOUBLE_CHANCE_X2", "X2", 0.7), metric("DOUBLE_CHANCE_12", "12", 0.72),
  metric("OU25_CONSENSUS_SIMPLE", "OVER_25", 0.7), metric("FOREBET_OU25_CONTROL", "OVER_25", 0.65), metric("STATAREA_OU25_CONTROL", "OVER_25", 0.64),
  metric("COMBO_1X_OVER_25", "1X+OVER_25", 0.68),
];
const metricByKey = new Map(metrics.map((entry) => [`${entry.patternCode}|${entry.side}`, entry]));
const fixture = () => buildProspectiveFixture({
  prospectiveRunId: "prospective-run",
  matchDecisionId: "match-decision",
  frozenAt: "2026-07-22T12:00:00.000Z",
  fixtureIdentity: { forebetObservationId: "forebet-row", statareaRowId: "statarea-row", homeTeamRaw: "Home", awayTeamRaw: "Away", competitionRaw: "League", countryRaw: "Country", scheduledKickoffRaw: "18:00" },
  matchingQualityClass: "EXACT",
  snapshotIntegrityVerified: true,
  forebet: { suggestedSide: "OVER", probabilityUnder25: 30, probabilityOver25: 70, predictedHomeGoals: 2, predictedAwayGoals: 1, averageGoals: 3 },
  semantic: { sourceDoubleChance1XPercent: 75, sourceDoubleChanceX2Percent: 55, sourceDoubleChance12Percent: 70, sourceOver25Percent: 65, ou25SemanticReady: true, doubleChanceSemanticReady: true },
  metricByKey,
});

describe("frontera prospectiva B009", () => {
  it("fija exactamente 2026-07-23", () => expect(PROSPECTIVE_SPORTS_DATE).toBe("2026-07-23"));
  it("acepta sólo la fecha fija", () => expect(() => validateProspectiveDate("2026-07-23")).not.toThrow());
  it("rechaza otra fecha", () => expect(() => validateProspectiveDate("2026-07-24")).toThrow("DATE_NOT_AUTHORIZED"));
  it("permite congelar el día anterior en Asunción", () => expect(() => assertFrozenBeforeSportsDate(new Date("2026-07-22T12:00:00.000Z"))).not.toThrow());
  it("rechaza congelar desde la fecha deportiva", () => expect(() => assertFrozenBeforeSportsDate(new Date("2026-07-23T12:00:00.000Z"))).toThrow("FREEZE_WINDOW_CLOSED"));
  it("preserva matcher y policy exactos", () => { expect(MATCH_CONFIGURATION_HASH).toBe("b659064ddf02ce1c14bb30f40db4dd3609258f51e7639e380ac020ab2787e90b"); expect(marketPriorityPolicyHash).toBe("41c8be9128e5fea4711d512d7f61cbf24f98a4cdc0b440465d4cf1eb154126e3"); });
  it("construye internamente las dos URLs exactas", () => { expect(buildForebetUrl("2026-07-23").toString()).toContain("/2026-07-23"); expect(buildLegacyStatareaUrl("2026-07-23").toString()).toBe("https://old.statarea.com/predictions/2026-07-23"); });
  it("mantiene 2026-07-22 fuera de la lista autorizada", () => { expect(() => buildForebetUrl("2026-07-22")).toThrow("DATE_NOT_AUTHORIZED"); expect(() => buildLegacyStatareaUrl("2026-07-22")).toThrow("DATE_NOT_AUTHORIZED"); });
});

describe("proyección semántica prospectiva", () => {
  const rawColumnsJson = JSON.stringify([{ headerRaw: "1", valueRaw: "45%" }, { headerRaw: "X", valueRaw: "30%" }, { headerRaw: "2", valueRaw: "25%" }, { headerRaw: "H1", valueRaw: "30%" }, { headerRaw: "HX", valueRaw: "40%" }, { headerRaw: "H2", valueRaw: "30%" }, { headerRaw: "1.5", valueRaw: "80%" }, { headerRaw: "2.5", valueRaw: "65%" }, { headerRaw: "3.5", valueRaw: "40%" }, { headerRaw: "hc1", valueRaw: "30%" }, { headerRaw: "hcX", valueRaw: "40%" }, { headerRaw: "hc2", valueRaw: "30%" }]);
  const projection = projectProspectiveSemanticRow({ id: "row", rawColumnsJson });
  it("deriva O/U 2.5", () => { expect(projection.sourceOver25Percent?.toNumber()).toBe(65); expect(projection.sourceUnder25Percent?.toNumber()).toBe(35); });
  it("deriva 1X, X2 y 12", () => expect([projection.sourceDoubleChance1XPercent?.toNumber(), projection.sourceDoubleChanceX2Percent?.toNumber(), projection.sourceDoubleChance12Percent?.toNumber()]).toEqual([75, 55, 70]));
  it("declara readiness sin interpretar TIP", () => { expect(projection.ou25SemanticReady).toBe(true); expect(projection.doubleChanceSemanticReady).toBe(true); expect(projection.warnings).toContain("TIPS_UNVERIFIED"); });
});

describe("decisión previa al precio y plan de cuotas", () => {
  it("crea tres candidatos DC, O/U y combinación", () => { const output = fixture(); expect(output.candidates.filter((candidate) => candidate.family === "DOUBLE_CHANCE")).toHaveLength(3); expect(output.candidates.filter((candidate) => candidate.family === "OU25")).toHaveLength(1); expect(output.candidates.filter((candidate) => candidate.family === "SAME_MATCH_COMBINATION")).toHaveLength(1); });
  it("elige el ganador familiar DC correcto", () => expect(fixture().candidates.find((candidate) => candidate.id === fixture().assessment.dcCandidateId)?.marketCode).toBe("1X"));
  it("identifica consenso OVER_25", () => expect(fixture().candidates.find((candidate) => candidate.id === fixture().assessment.ouCandidateId)?.marketCode).toBe("OVER_25"));
  it("conserva la combinación del mismo partido", () => expect(fixture().candidates.find((candidate) => candidate.id === fixture().assessment.combinationCandidateId)?.marketCode).toBe("1X + OVER_25"));
  it("genera hasta tres solicitudes y no sólo la preferencia", () => { const output = fixture(); expect(output.quoteRequests).toHaveLength(3); expect(new Set(output.quoteRequests.map((quote) => quote.family))).toEqual(new Set(["DOUBLE_CHANCE", "OU25", "SAME_MATCH_COMBINATION"])); });
  it("genera una solicitud por familia", () => { const requests = fixture().quoteRequests; expect(new Set(requests.map((request) => request.family)).size).toBe(requests.length); });
  it("mantiene bookmaker sin mapping inventado", () => fixture().quoteRequests.forEach((request) => expect(request).toEqual(expect.objectContaining({ bookmaker: "APOSTALA", bookmakerMarketCode: "UNRESOLVED", bookmakerMarketLabel: "UNRESOLVED" }))));
  it("mantiene precio y valor sin capturar", () => fixture().quoteRequests.forEach((request) => expect(request).toEqual(expect.objectContaining({ availableOdds: null, priceStatus: "NOT_CAPTURED", marketValueStatus: "UNKNOWN" }))));
  it("conserva dos componentes en la combinación", () => expect(fixture().quoteRequests.find((request) => request.family === "SAME_MATCH_COMBINATION")?.marketComponents).toEqual(["1X", "OVER_25"]));
  it("congela la decisión antes del outcome", () => expect(fixture().assessment.decisionFrozenAt).toBe("2026-07-22T12:00:00.000Z"));
  it("marca explícitamente la preferencia previa al precio", () => expect(fixture().assessment.warnings).toContain("PRE_PRICE_PREFERENCE_MAY_CHANGE_WITH_ODDS"));
});

describe("contratos prospectivos estrictos", () => {
  const output = fixture();
  const assessmentDocument = { contractVersion: "prospective-fixture-assessment/1.0" as const, prospectiveRunId: "prospective-run", assessmentSetHash: canonicalHash([output.assessment]), assessments: [output.assessment] };
  const quoteDocument = { contractVersion: "quote-request-plan/1.0" as const, prospectiveRunId: "prospective-run", sportsDate: "2026-07-23" as const, frozenAt: "2026-07-22T12:00:00.000Z", quotePlanHash: canonicalHash(output.quoteRequests), requests: output.quoteRequests };
  const runWithoutHash = { id: "prospective-run", sportsDate: "2026-07-23" as const, mode: "PROSPECTIVE_SHADOW" as const, status: "FROZEN" as const, forebetSnapshot: { id: "f", sha256: "a".repeat(64), parserVersion: "forebet/1" }, statareaSnapshot: { id: "s", sha256: "b".repeat(64), parserVersion: "statarea/1", sourcePresentation: "LEGACY_OFFICIAL" as const }, matchRunId: "m", matcherVersion: "ou25-fixture-matcher/1.0.0" as const, normalizerVersion: "ou25-identity-normalizer/1.0.0" as const, matcherConfigurationHash: "c".repeat(64), registry: { code: "STATAREA-LEGACY-SEMANTIC-REGISTRY" as const, version: "1.0.0" as const, hash: "d".repeat(64) }, policy: { code: "OU25-MARKET-PRIORITY-POLICY" as const, version: "1.0.0" as const, hash: "e".repeat(64), historicalAnalysisSpecHash: "f".repeat(64) }, outcomeEvaluationEnabled: false as const, priceEvaluationEnabled: false as const, frozenBeforeOutcome: true as const, frozenAt: "2026-07-22T12:00:00.000Z", fixtureCount: 1, counts: { matching: { matched: 1, ambiguous: 0, onlyForebet: 0, onlyStatarea: 0, conflict: 0 }, candidates: 5, assessments: 1, selections: { PREFERRED: 0, PROVISIONAL: 1, NONE: 0 }, quoteRequests: { DOUBLE_CHANCE: 1, OU25: 1, SAME_MATCH_COMBINATION: 1, total: 3, maximumPerFixture: 3 }, semantic: { projected: 1, ou25Ready: 1, doubleChanceReady: 1 }, availableOdds: 0 as const, marketValueEvaluated: 0 as const, outcomeReads: 0 as const, ranking: 0 as const, bets: 0 as const, multiMatchCombinations: 0 as const }, warnings: [], networkRequestsAtFreeze: 2, outcomeReads: 0 as const, quoteCaptures: 0 as const };
  const runDocument = { contractVersion: "prospective-shadow-run/1.0" as const, run: { ...runWithoutHash, runHash: canonicalHash(runWithoutHash) } };
  it("valida los tres contratos con Zod y AJV", () => { expect(prospectiveShadowRunDocumentSchema.safeParse(runDocument).success).toBe(true); expect(prospectiveFixtureAssessmentDocumentSchema.safeParse(assessmentDocument).success).toBe(true); expect(quoteRequestPlanDocumentSchema.safeParse(quoteDocument).success).toBe(true); expect(validateContract(runJsonSchema, runDocument).valid).toBe(true); expect(validateContract(assessmentJsonSchema, assessmentDocument).valid).toBe(true); expect(validateContract(quoteJsonSchema, quoteDocument).valid).toBe(true); });
  it.each(["result", "HIT", "outcome", "ranking", "stake", "profit"]) ("rechaza campo prohibido %s", (field) => expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, [field]: 1 }).success).toBe(false));
  it("rechaza cuota no nula", () => { const requests = output.quoteRequests.map((request, index) => index === 0 ? { ...request, availableOdds: 1.8 } : request); expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, quotePlanHash: canonicalHash(requests), requests }).success).toBe(false); });
  it("rechaza código de bookmaker inventado", () => { const requests = output.quoteRequests.map((request, index) => index === 0 ? { ...request, bookmakerMarketCode: "DC_1X" } : request); expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, quotePlanHash: canonicalHash(requests), requests }).success).toBe(false); });
  it("rechaza más de tres solicitudes", () => { const requests = [...output.quoteRequests, { ...output.quoteRequests[0], id: "fourth", family: "OU25" as const }]; expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, quotePlanHash: canonicalHash(requests), requests }).success).toBe(false); });
  it("rechaza dos solicitudes de la misma familia", () => { const requests = [...output.quoteRequests, { ...output.quoteRequests[0], id: "duplicate" }]; expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, quotePlanHash: canonicalHash(requests), requests }).success).toBe(false); });
  it("rechaza combinación sin componentes", () => { const requests = output.quoteRequests.map((request) => request.family === "SAME_MATCH_COMBINATION" ? { ...request, marketComponents: ["1X"] } : request); expect(quoteRequestPlanDocumentSchema.safeParse({ ...quoteDocument, quotePlanHash: canonicalHash(requests), requests }).success).toBe(false); });
});

describe("diagnóstico, append-only, replay y UI", () => {
  it("calcula sensibilidad sin cambiar política", () => { const diagnostic = buildB008DominanceDiagnostic([{ id: "a", family: "DOUBLE_CHANCE", marketCode: "1X", signalScore: 30, historicalEvidenceScore: 32, dataQualityScore: 20, finalPriorityScore: 82, caps: [] }], [{ selectedCandidateId: "a", topCandidateId: "a" }]); expect(diagnostic.sensitivity.map((entry) => entry.selected)).toEqual([1, 1, 1, 1, 0]); expect(diagnostic.policyModified).toBe(false); expect(diagnostic.outcomeReads).toBe(0); });
  it("incluye warnings obligatorios de dominancia", () => expect(buildB008DominanceDiagnostic([{ id: "a", family: "DOUBLE_CHANCE", marketCode: "1X", signalScore: 30, historicalEvidenceScore: 32, dataQualityScore: 20, finalPriorityScore: 82, caps: [] }], [{ selectedCandidateId: "a", topCandidateId: "a" }]).warnings).toEqual(["PRE_PRICE_POLICY_SELECTS_95_9_PERCENT_OF_FIXTURES", "FINAL_SELECTION_DOMINATED_BY_DOUBLE_CHANCE"]));
  it("protege siete tablas prospectivas con 14 triggers", () => { const migration = source("prisma/migrations/20260722234500_add_first_prospective_shadow_run/migration.sql"); expect((migration.match(/_no_update/g) ?? [])).toHaveLength(7); expect((migration.match(/_no_delete/g) ?? [])).toHaveLength(7); });
  it("replay fija cero solicitudes HTTP", () => expect(source("src/application/run-prospective-shadow.ts")).toMatch(/executionStatus: "REUSED"[\s\S]*networkRequests: 0/));
  it("no accede a una URL Apostala", () => expect(source("src/application/run-prospective-shadow.ts")).not.toMatch(/https?:\/\/[^"']*apostala/i));
  it("no consulta modelos individuales de outcomes", () => expect(source("src/application/run-prospective-shadow.ts")).not.toMatch(/fixtureOutcome|outcomeEvidence|matchResult/));
  it("la UI contiene los textos obligatorios", () => { const ui = source("src/components/prospective-shadow-status.tsx"); expect(ui).toContain("Esta decisión fue congelada antes del resultado."); expect(ui).toContain("Es una preferencia previa al precio y puede cambiar al incorporar la cuota."); expect(ui).toContain("Cuota: pendiente"); expect(ui).toContain("Valor de mercado: desconocido"); });
  it("la UI no muestra estados prohibidos", () => expect(source("src/components/prospective-shadow-status.tsx")).not.toMatch(/HIT|MISS|ranking|stake|rentabilidad|apuesta/i));
  it("B010 no existe", () => { const files = ["src", "scripts", "prisma"].flatMap((directory) => readdirSync(join(root, directory), { recursive: true }).map((path) => `${directory}/${String(path)}`)); expect(files.join("\n")).not.toMatch(/(?:^|[\\/])b010(?:[\\/.-]|$)/i); });
});

describe("presentación temporal de ejecución prospectiva", () => {
  const originalTimezone = process.env.TZ;
  const frozenAt = new Date("2026-08-04T00:00:00.000Z");
  const ambiguousKickoff = "04/08/2026 20:30";
  const renderComponent = async () => renderToStaticMarkup(await ProspectiveShadowStatus());

  const arrangeStoredRun = () => {
    databaseMock.prospectiveShadowRun.findFirst.mockResolvedValue({
      id: "prospective-run-1",
      matchRunId: "match-run-1",
      sportsDate: new Date("2026-08-04T00:00:00.000Z"),
      mode: "SHADOW",
      status: "COMPLETED",
      frozenAt,
      forebetSnapshotId: "forebet-snapshot-1",
      statareaSnapshotId: "statarea-snapshot-1",
      matcherVersion: "matcher-1",
      matcherConfigurationHash: "a".repeat(64),
      registryHash: "b".repeat(64),
      priorityPolicyHash: "c".repeat(64),
      countsJson: JSON.stringify({ selections: { NONE: 1 } }),
    });
    databaseMock.matchRun.findUniqueOrThrow.mockResolvedValue({ matchedCount: 1, ambiguousCount: 0, conflictCount: 0 });
    databaseMock.prospectiveCandidateSnapshot.findMany.mockResolvedValue([]);
    databaseMock.prospectiveFixtureAssessment.findMany.mockResolvedValue([
      {
        contractJson: JSON.stringify({
          id: "assessment-1",
          matchDecisionId: "decision-1",
          fixtureIdentity: {
            countryRaw: "Paraguay",
            competitionRaw: "Liga sintética",
            homeTeamRaw: "Equipo Norte",
            awayTeamRaw: "Equipo Sur",
            scheduledKickoffRaw: ambiguousKickoff,
          },
          dcCandidateId: null,
          ouCandidateId: null,
          combinationCandidateId: null,
          prePricePreference: null,
          prePriceSecondAlternative: null,
          prePriceScoreMargin: null,
          prePriceSelectionStatus: "NONE",
          warnings: [],
        }),
      },
    ]);
    databaseMock.quoteRequestPlan.findMany.mockResolvedValue([]);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    databaseMock.prospectiveShadowRun.findFirst.mockResolvedValue(null);
  });

  afterEach(() => {
    if (originalTimezone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimezone;
  });

  it("formatea frozenAt en es-PY y America/Asuncion sin depender del TZ del proceso", () => {
    const expected = new Intl.DateTimeFormat("es-PY", {
      timeZone: "America/Asuncion",
      dateStyle: "medium",
      timeStyle: "short",
    }).format(frozenAt);

    process.env.TZ = "UTC";
    const fromUtcProcess = formatProspectiveDateTime(frozenAt);
    process.env.TZ = "Asia/Tokyo";
    const fromTokyoProcess = formatProspectiveDateTime(frozenAt);

    expect(fromUtcProcess).toBe(expected);
    expect(fromTokyoProcess).toBe(expected);
    expect(fromUtcProcess).not.toContain(frozenAt.toISOString());
    expect(fromUtcProcess).not.toMatch(/Z(?:\s|$)/);
  });

  it("sigue renderizando el estado vacío cuando no existe un run", async () => {
    expect(await renderComponent()).toContain("Ejecución prospectiva pendiente");
  });

  it("renderiza equipos y sustituye el kickoff raw ambiguo por el fallback", async () => {
    arrangeStoredRun();

    const html = await renderComponent();

    expect(html).toContain(`Congelado ${formatProspectiveDateTime(frozenAt)}`);
    expect(html).not.toContain(frozenAt.toISOString());
    expect(html).toContain("Equipo Norte");
    expect(html).toContain("Equipo Sur");
    expect(html).toContain("Horario pendiente de normalización");
    expect(html).not.toContain(ambiguousKickoff);
  });

  it("no interpreta el raw ni introduce una dependencia del navegador", () => {
    const ui = source("src/components/prospective-shadow-status.tsx");

    expect(ui).not.toMatch(/new Date\s*\([^)]*scheduledKickoffRaw/);
    expect(ui).not.toContain("assessment.fixtureIdentity.scheduledKickoffRaw");
    expect(ui).not.toMatch(/[\"']use client[\"']/);
    expect(ui).toContain('timeZone: "America/Asuncion"');
  });
});
