import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import assessmentJsonSchema from "@/contracts/schemas/statarea-semantic-assessment.schema.json";
import registryJsonSchema from "@/contracts/schemas/statarea-semantic-registry.schema.json";
import { semanticAssessmentSchema, semanticRegistrySchema } from "@/contracts/statarea-semantics";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import {
  SEMANTIC_ASSESSMENT_VERSION,
  SEMANTIC_DATASET_CODE,
  SEMANTIC_EXPECTED_HEAD,
  SEMANTIC_LEGEND_SHA256,
  SEMANTIC_MANIFEST_HASH,
  SEMANTIC_PARSER_VERSION,
  SEMANTIC_REGISTRY_CODE,
  SEMANTIC_REGISTRY_VERSION,
  SEMANTIC_SOURCE_PRESENTATION,
} from "@/domain/statarea-semantics/constants";
import { deriveSemanticValues, parseSourcePercent } from "@/domain/statarea-semantics/normalization";
import { evaluateSemanticRows } from "@/domain/statarea-semantics/quality";
import {
  derivedSemanticDefinitions,
  directSemanticDefinitions,
  excludedSemanticDefinitions,
  SEMANTIC_REGISTRY_HASH,
  semanticRegistryContract,
} from "@/domain/statarea-semantics/registry";

type SqliteDatabase = {
  close(): void;
  exec(sql: string): void;
  prepare(sql: string): { get(): Record<string, unknown> | undefined };
};
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

const root = process.cwd();
const fixture = (name: string) => JSON.parse(readFileSync(join(root, "src", "contracts", "fixtures", name), "utf8"));
const assessmentFixture = () => fixture("statarea-semantic-assessment.valid.json");
const source = (path: string) => readFileSync(join(root, path), "utf8");

const directByHeader = (header: string) => directSemanticDefinitions.find((definition) => definition.rawHeader === header)!;
const excludedByField = (field: string) => excludedSemanticDefinitions.find((definition) => definition.canonicalField === field)!;

function canonicalRegistry(value: Record<string, unknown>) {
  const copy = structuredClone(value);
  delete copy.registryHash;
  return { ...copy, registryHash: canonicalHash(copy) };
}

const baseColumns: Record<string, string> = {
  "1": "40%", X: "30%", "2": "30%", H1: "30%", HX: "40%", H2: "30%",
  "1.5": "70%", "2.5": "50%", "3.5": "25%", hc1: "25%", hcX: "35%", hc2: "40%",
};

function semanticRow(overrides: Record<string, string> = {}, extras: Array<{ headerRaw: string; valueRaw: string }> = []) {
  const columns = { ...baseColumns, ...overrides };
  return {
    id: "raw-1",
    requestedDate: new Date("2026-07-01T00:00:00.000Z"),
    rawColumnsJson: JSON.stringify([
      ...Object.entries(columns).map(([headerRaw, valueRaw]) => ({ headerRaw, valueRaw })),
      ...extras,
    ]),
    countryRaw: "Testland",
    competitionRaw: "Test League",
  };
}

const evaluate = (overrides: Record<string, string> = {}, extras: Array<{ headerRaw: string; valueRaw: string }> = []) =>
  evaluateSemanticRows([semanticRow(overrides, extras)], new Map([["2026-07-01", "DISCOVERY"]]));

function memoryDatabase() {
  const database = new DatabaseSync(":memory:");
  database.exec("CREATE TABLE HistoricalDataset (id TEXT NOT NULL PRIMARY KEY); CREATE TABLE StatareaRawRow (id TEXT NOT NULL PRIMARY KEY); INSERT INTO HistoricalDataset (id) VALUES ('dataset-1'); INSERT INTO StatareaRawRow (id) VALUES ('raw-1');");
  database.exec(source("prisma/migrations/20260722194500_add_verified_statarea_semantics/migration.sql"));
  database.exec(`
    INSERT INTO SemanticRegistry (id, code, version, source, sourcePresentation, parserVersion, evidenceStatus, legendSha256, registryHash, warningsJson)
    VALUES ('registry-1','${SEMANTIC_REGISTRY_CODE}','1.0.0','STATAREA','LEGACY_OFFICIAL','${SEMANTIC_PARSER_VERSION}','VERIFIED','${SEMANTIC_LEGEND_SHA256}','${"a".repeat(64)}','[]');
    INSERT INTO SemanticFieldDefinition (id,registryId,canonicalField,meaning,unit,semanticStatus,evidenceLevel,evidenceJson,normalizationRule,analysisEnabled)
    VALUES ('field-1','registry-1','sourceHomeWinPercent','Porcentaje fuente','SOURCE_PERCENT','VERIFIED_DIRECT','OFFICIAL_DIRECT_RESOURCE_BRIDGE','{}','Decimal.js',1);
    INSERT INTO SemanticAssessmentRun (id,registryId,datasetId,manifestHash,assessmentVersion,status,rowCount,matchedCount,qualitySummaryJson)
    VALUES ('run-1','registry-1','dataset-1','${SEMANTIC_MANIFEST_HASH}','${SEMANTIC_ASSESSMENT_VERSION}','COMPLETED',1110,98,'{}');
    INSERT INTO StatareaSemanticProjection (id,assessmentRunId,rawRowId,sportsDate,partition,semanticReadiness,qualityStatus,warningsJson)
    VALUES ('projection-1','run-1','raw-1','2026-07-01','DISCOVERY','READY_WITH_WARNINGS','READY_WITH_WARNINGS','[]');
    INSERT INTO SemanticQualityFinding (id,assessmentRunId,field,findingType,severity,expectedRule,detailsJson)
    VALUES ('finding-1','run-1','statareaTip','UNVERIFIED_FIELD','WARNING','separate','{}');
    INSERT INTO SemanticAuditEvent (id,assessmentRunId,registryId,eventType,contextJson)
    VALUES ('audit-1','run-1','registry-1','QUALITY_COMPLETED','{}');
  `);
  return database;
}

describe("registro semántico oficial Statarea Legacy", () => {
  it("documenta el HEAD esperado", () => expect(SEMANTIC_EXPECTED_HEAD).toBe("655be38"));
  it("requiere el dataset congelado", () => expect(assessmentFixture().datasetReference.status).toBe("FROZEN"));
  it("fija el manifest hash exacto", () => expect(SEMANTIC_MANIFEST_HASH).toBe("b651152816688759d54486ebc4cdac11704dd9e287818dec6b7f935c185ed105"));
  it("requiere LEGACY_OFFICIAL", () => expect(SEMANTIC_SOURCE_PRESENTATION).toBe("LEGACY_OFFICIAL"));
  it("excluye MODERN del contrato histórico", () => { const value = assessmentFixture(); value.datasetReference.sourcePresentation = "MODERN"; expect(semanticAssessmentSchema.safeParse(value).success).toBe(false); });
  it("fija el SHA de la leyenda", () => expect(SEMANTIC_LEGEND_SHA256).toBe("7b12c7c3795000ca30a29afe7b65d863f1a9a5f426b81cd012a3fe37feebb3c0"));
  it("fija el registry code", () => expect(SEMANTIC_REGISTRY_CODE).toBe("STATAREA-LEGACY-SEMANTIC-REGISTRY"));
  it("fija la registry version", () => expect(SEMANTIC_REGISTRY_VERSION).toBe("1.0.0"));
  it("calcula un registry hash canónico", () => { const { registryHash, ...core } = semanticRegistryContract; expect(registryHash).toBe(canonicalHash(core)); expect(registryHash).toBe(SEMANTIC_REGISTRY_HASH); });

  it.each(["1", "X", "2", "H1", "HX", "H2", "1.5", "2.5", "3.5"])("conserva evidencia oficial completa para %s", (header) => {
    const definition = directByHeader(header);
    expect(definition.semanticStatus).toBe("VERIFIED_DIRECT");
    expect(definition.evidence).toMatchObject({ legendSha256: SEMANTIC_LEGEND_SHA256, snapshotsVerified: 21, rowsVerified: 1110, bridgeStatus: "DIRECT_RESOURCE_MATCH" });
  });

  it("hace coincidir recurso de leyenda e histórico", () => directSemanticDefinitions.forEach((definition) => expect(definition.evidence.legendResourcePath).toBe(definition.evidence.historicalHeaderResourcePath)));
  it("persiste el puente DIRECT_RESOURCE_MATCH", () => directSemanticDefinitions.forEach((definition) => expect(definition.evidence.bridgeStatus).toBe("DIRECT_RESOURCE_MATCH")));
  it("bloquea un conflicto entre recursos", () => { const value = structuredClone(semanticRegistryContract); (value.fieldDefinitions[0].evidence as Record<string, unknown>).historicalHeaderResourcePath = "/different.gif"; const changed = canonicalRegistry(value); expect(semanticRegistrySchema.safeParse(changed).success).toBe(false); });
  it("exige texto oficial Over para cada línea", () => ["1.5", "2.5", "3.5"].forEach((line) => expect(String(directByHeader(line).evidence.officialAlt).toLowerCase()).toContain(`over ${line} goals`)));
  it("la monotonicidad no es evidencia primaria", () => ["1.5", "2.5", "3.5"].forEach((line) => expect(directByHeader(line).evidenceLevel).toBe("OFFICIAL_DIRECT_RESOURCE_BRIDGE")));
  it("limita handicap al resultado inicial 0:1", () => ["hc1", "hcX", "hc2"].forEach((header) => expect(directByHeader(header).evidence.officialAlt).toContain("match start result 0:1")));
  it("mantiene handicap fuera del análisis", () => ["hc1", "hcX", "hc2"].forEach((header) => expect(directByHeader(header).analysisEnabled).toBe(false)));
  it("mantiene Tips UNVERIFIED", () => expect(excludedByField("statareaTip").semanticStatus).toBe("UNVERIFIED"));
  it("mantiene voting NOT_APPLICABLE", () => expect(excludedByField("userVoting").semanticStatus).toBe("NOT_APPLICABLE"));
  it("mantiene comment NOT_APPLICABLE", () => expect(excludedByField("userComment").semanticStatus).toBe("NOT_APPLICABLE"));
  it("mantiene user prediction separado", () => expect(excludedByField("userPrediction").analysisEnabled).toBe(false));
});

describe("normalización Decimal.js y campos derivados", () => {
  it("reconoce porcentaje con %", () => expect(parseSourcePercent("42%").value.toString()).toBe("42"));
  it("reconoce porcentaje decimal y preserva precisión", () => { const parsed = parseSourcePercent(" 42,50% "); expect(parsed.raw).toBe(" 42,50% "); expect(parsed.trimmed).toBe("42,50%"); expect(parsed.decimalPlaces).toBe(1); });
  it("acepta extremos de la escala 0–100", () => { expect(parseSourcePercent("0%").value.eq(0)).toBe(true); expect(parseSourcePercent("100%").value.eq(100)).toBe(true); });
  it("rechaza un valor negativo", () => expect(() => parseSourcePercent("-1%")).toThrow());
  it("rechaza un valor mayor a 100", () => expect(() => parseSourcePercent("100.1%")).toThrow("OUT_OF_RANGE"));
  it("preserva el raw original", () => expect(parseSourcePercent(" 7.25% ").raw).toBe(" 7.25% "));
  it("utiliza Decimal.js", () => expect(parseSourcePercent("1.1%").value).toBeInstanceOf(Decimal));

  const values = {
    sourceHomeWinPercent: new Decimal("40.1"), sourceDrawPercent: new Decimal("29.9"), sourceAwayWinPercent: new Decimal("30"),
    sourceOver15Percent: new Decimal("70.5"), sourceOver25Percent: new Decimal("50.25"), sourceOver35Percent: new Decimal("20.125"),
  };
  const derived = deriveSemanticValues(values);
  it("deriva Under 1.5", () => expect(derived.sourceUnder15Percent.toString()).toBe("29.5"));
  it("deriva Under 2.5", () => expect(derived.sourceUnder25Percent.toString()).toBe("49.75"));
  it("deriva Under 3.5", () => expect(derived.sourceUnder35Percent.toString()).toBe("79.875"));
  it("deriva 1X", () => expect(derived.sourceDoubleChance1XPercent.toString()).toBe("70"));
  it("deriva X2", () => expect(derived.sourceDoubleChanceX2Percent.toString()).toBe("59.9"));
  it("deriva 12", () => expect(derived.sourceDoubleChance12Percent.toString()).toBe("70.1"));
  it("bloquea derivación sin componentes", () => expect(() => deriveSemanticValues({ ...values, sourceDrawPercent: undefined } as unknown as Record<string, Decimal>)).toThrow("COMPONENT_MISSING"));
  it("documenta las seis fórmulas", () => expect(derivedSemanticDefinitions.map((definition) => definition.derivationRule)).toEqual([
    "100 - sourceOver15Percent", "100 - sourceOver25Percent", "100 - sourceOver35Percent",
    "sourceHomeWinPercent + sourceDrawPercent", "sourceDrawPercent + sourceAwayWinPercent", "sourceHomeWinPercent + sourceAwayWinPercent",
  ]));
  it("conserva componentes fuente en cada definición derivada", () => derivedSemanticDefinitions.forEach((definition) => expect(definition.evidence.components).toBeInstanceOf(Array)));
});

describe("calidad estructural sin resultados", () => {
  it("detecta suma 1X2 exacta", () => expect(evaluate().qualityTotals.oneXTwo.exact100).toBe(1));
  it("acepta suma 1X2 dentro de tolerancia", () => expect(evaluate({ "1": "40.5%" }).qualityTotals.oneXTwo.withinTolerance).toBe(1));
  it("reporta suma 1X2 fuera de tolerancia", () => expect(evaluate({ "1": "42%" }).qualityTotals.oneXTwo.outsideTolerance).toBe(1));
  it("detecta suma HT exacta", () => expect(evaluate().qualityTotals.halfTime.exact100).toBe(1));
  it("reporta suma HT fuera de tolerancia", () => expect(evaluate({ H1: "33%", HX: "40%", H2: "30%" }).qualityTotals.halfTime.outsideTolerance).toBe(1));
  it("valida monotonicidad Over", () => expect(evaluate().qualityTotals.monotonicity.compliant).toBe(1));
  it("reporta monotonicidad Over inválida con contexto", () => { const result = evaluate({ "1.5": "50%", "2.5": "60%" }); expect(result.qualityTotals.monotonicity.violations).toBe(1); expect(result.qualityTotals.monotonicity.affectedDates).toEqual(["2026-07-01"]); });
  it("verifica Over + Under = 100", () => expect(evaluate().qualityTotals.complementsValid).toBe(1));
  it("verifica 1X + 2 = 100", () => { const projection = evaluate().projections[0] as unknown as Record<string, Decimal>; expect(projection.sourceDoubleChance1XPercent.plus(projection.sourceAwayWinPercent).eq(100)).toBe(true); });
  it("verifica X2 + 1 = 100", () => { const projection = evaluate().projections[0] as unknown as Record<string, Decimal>; expect(projection.sourceDoubleChanceX2Percent.plus(projection.sourceHomeWinPercent).eq(100)).toBe(true); });
  it("verifica 12 + X = 100", () => { const projection = evaluate().projections[0] as unknown as Record<string, Decimal>; expect(projection.sourceDoubleChance12Percent.plus(projection.sourceDrawPercent).eq(100)).toBe(true); });
  it("calcula readiness O/U 2.5", () => expect(evaluate().projections[0].ou25SemanticReady).toBe(true));
  it("calcula readiness de doble oportunidad", () => expect(evaluate().projections[0].doubleChanceSemanticReady).toBe(true));
  it("marca insuficiente cuando falta Over 2.5", () => { const row = semanticRow(); const columns = JSON.parse(row.rawColumnsJson).filter((column: { headerRaw: string }) => column.headerRaw !== "2.5"); row.rawColumnsJson = JSON.stringify(columns); const result = evaluateSemanticRows([row], new Map([["2026-07-01", "DISCOVERY"]])); expect(result.projections[0].qualityStatus).toBe("INSUFFICIENT"); });
  it("reporta calidad de los seis derivados", () => expect(evaluate().qualityTotals.derivedQuality).toHaveLength(6));
  it("mantiene raw y proyección separados", () => expect(evaluate().projections[0]).not.toHaveProperty("rawColumnsJson"));
  it("no incluye resultado final", () => expect(evaluate().projections[0]).not.toHaveProperty("result"));
  it("no incluye resultado HT", () => expect(evaluate().projections[0]).not.toHaveProperty("halfTimeResult"));
  it("cambiar una celda Result no altera la semántica", () => expect(evaluate({}, [{ headerRaw: "Result", valueRaw: "9-9" }]).qualityTotals).toEqual(evaluate({}, [{ headerRaw: "Result", valueRaw: "0-0" }]).qualityTotals));
});

describe("contratos estrictos AJV y Zod", () => {
  it("acepta Registry con AJV", () => expect(validateContract(registryJsonSchema, semanticRegistryContract).valid).toBe(true));
  it("rechaza Registry inválido con AJV", () => expect(validateContract(registryJsonSchema, fixture("statarea-semantic-registry.invalid.json")).valid).toBe(false));
  it("acepta Assessment con AJV", () => expect(validateContract(assessmentJsonSchema, assessmentFixture()).valid).toBe(true));
  it("rechaza Assessment inválido con AJV", () => expect(validateContract(assessmentJsonSchema, fixture("statarea-semantic-assessment.invalid.json")).valid).toBe(false));
  it("acepta Registry con Zod", () => expect(semanticRegistrySchema.safeParse(semanticRegistryContract).success).toBe(true));
  it("acepta Assessment con Zod", () => expect(semanticAssessmentSchema.safeParse(assessmentFixture()).success).toBe(true));
  it("bloquea Registry directo sin evidencia", () => { const value = structuredClone(semanticRegistryContract); delete (value.fieldDefinitions[0].evidence as Record<string, unknown>).officialAlt; expect(semanticRegistrySchema.safeParse(canonicalRegistry(value)).success).toBe(false); });
  it("bloquea Registry con hash inválido", () => expect(semanticRegistrySchema.safeParse({ ...semanticRegistryContract, registryHash: "0".repeat(64) }).success).toBe(false));
  it("bloquea Over sin dirección", () => { const value = structuredClone(semanticRegistryContract); value.fieldDefinitions[6].direction = null; expect(semanticRegistrySchema.safeParse(canonicalRegistry(value)).success).toBe(false); });
  it("bloquea Under sin derivación", () => { const value = structuredClone(semanticRegistryContract); value.derivedDefinitions[0].derivationRule = null; expect(semanticRegistrySchema.safeParse(canonicalRegistry(value)).success).toBe(false); });
  it("bloquea doble oportunidad sin componentes", () => { const value = structuredClone(semanticRegistryContract); value.derivedDefinitions[3].evidence.components = []; expect(semanticRegistrySchema.safeParse(canonicalRegistry(value)).success).toBe(false); });
  it("bloquea otro manifestHash", () => { const value = assessmentFixture(); value.datasetReference.manifestHash = "0".repeat(64); expect(semanticAssessmentSchema.safeParse(value).success).toBe(false); });
  it("bloquea un resultado real añadido", () => { const value = assessmentFixture(); value.actualResult = "2-1"; expect(semanticAssessmentSchema.safeParse(value).success).toBe(false); });
  it("bloquea hitRate añadido", () => { const value = assessmentFixture(); value.hitRate = 1; expect(semanticAssessmentSchema.safeParse(value).success).toBe(false); });
  it("bloquea Score añadido", () => { const value = assessmentFixture(); value.Score = 99; expect(semanticAssessmentSchema.safeParse(value).success).toBe(false); });
  it("valida JSON canónico reproducible", () => { const value = assessmentFixture(); const { assessmentHash, ...core } = value; expect(assessmentHash).toBe(canonicalHash(core)); });
  it("mantiene la matriz completa de fixtures inválidos", () => { const cases = fixture("statarea-semantics.invalid-cases.json"); expect([...cases.registry, ...cases.assessment].map((entry: { case: string }) => entry.case)).toEqual(["registry-without-evidence", "registry-invalid-hash", "over-without-direction", "under-without-derivation", "double-chance-without-components", "source-value-out-of-range", "wrong-manifest-hash", "modern-presentation", "actual-result-added", "hit-rate-added", "score-added"]); });
});

describe("assessment offline, alcance y seguridad", () => {
  const service = source("src/application/assess-statarea-semantics.ts");
  const command = source("scripts/assess-statarea-semantics.ts");
  const implementation = `${service}\n${source("src/domain/statarea-semantics/quality.ts")}`;
  it("el evaluador no selecciona campos de resultados", () => expect(service).not.toMatch(/resultRaw|homeScore|awayScore|halfTimeScore/));
  it("el evaluador no accede a red", () => expect(service).not.toMatch(/fetch\(|node:https|node:http|undici|axios/));
  it("el comando bloquea fetch", () => expect(command).toContain("SEMANTIC_ASSESSMENT_NETWORK_FORBIDDEN"));
  it("el comando no invoca captura", () => expect(command).not.toMatch(/capture-statarea-semantic-help|browser|playwright/));
  it("la captura diagnóstica exige una acción allowlisted", () => { const capture = source("scripts/capture-statarea-semantic-help.ts"); expect(capture).toContain("EXPECTED_ONE_ALLOWLISTED_DIAGNOSTIC_ACTION"); expect(capture).toContain("--offline-audit"); });
  it("el replay de evidencia es estrictamente offline", () => expect(source("scripts/analyze-statarea-semantic-evidence.ts")).not.toMatch(/\bfetch\s*\(/));
  it("el comando sólo acepta dataset y registry", () => expect(command).toContain("dataset|registry"));
  it("no elige lado", () => expect(implementation).not.toMatch(/recommendedMarket|selectedSide|bestOption/));
  it("no calcula consenso", () => expect(implementation).not.toMatch(/consensus/iu));
  it("no calcula HIT", () => expect(implementation).not.toMatch(/\bhit\b/iu));
  it("no calcula MISS", () => expect(implementation).not.toMatch(/\bmiss\b/iu));
  it("no calcula hitRate", () => expect(implementation).not.toMatch(/hitRate/));
  it("no calcula Wilson", () => expect(implementation).not.toMatch(/Wilson/));
  it("no calcula Brier", () => expect(implementation).not.toMatch(/Brier/));
  it("no calcula Score", () => expect(implementation).not.toMatch(/\bScore\b/));
  it("no calcula ranking", () => expect(implementation).not.toMatch(/ranking/iu));
  it("declara cero resultados y cero red", () => { expect(service).toContain("resultsUsed: 0"); expect(service).toContain("networkRequests: 0"); });
  it("fija 1.110 filas y 21 fechas", () => { expect(service).toContain("rawRows.length !== 1110"); expect(service).toContain("days.length !== 21"); });
  it("fija 98 MATCHED", () => expect(service).toContain("matchedDecisions.length !== 98"));
  it("fija 64 Discovery y 34 Validation", () => { expect(service).toContain("matchedReadiness.discovery !== 64"); expect(service).toContain("matchedReadiness.validation !== 34"); });
  it("mantiene exports fuera de Git", () => expect(source(".gitignore")).toContain("/var/exports/"));
  it("implementa exports write-once", () => expect(source("src/infrastructure/statarea/semantic-export-store.ts")).toContain("flag: \"wx\""));
});

describe("migración aditiva, identidad e inmutabilidad", () => {
  const migration = source("prisma/migrations/20260722194500_add_verified_statarea_semantics/migration.sql");
  it("no contiene DROP ni ALTER destructivo", () => { expect(migration).not.toMatch(/\bDROP\b/); expect(migration).not.toMatch(/ALTER\s+TABLE/); });
  it("crea un registry por identidad lógica", () => { const db = memoryDatabase(); try { expect(() => db.exec(`INSERT INTO SemanticRegistry (id,code,version,source,sourcePresentation,parserVersion,evidenceStatus,legendSha256,registryHash,warningsJson) VALUES ('r2','${SEMANTIC_REGISTRY_CODE}','1.0.0','STATAREA','LEGACY_OFFICIAL','p','VERIFIED','h','${"b".repeat(64)}','[]')`)).toThrow(); } finally { db.close(); } });
  it("permite otra versión como nuevo registry", () => { const db = memoryDatabase(); try { db.exec(`INSERT INTO SemanticRegistry (id,code,version,source,sourcePresentation,parserVersion,evidenceStatus,legendSha256,registryHash,warningsJson) VALUES ('r2','${SEMANTIC_REGISTRY_CODE}','1.1.0','STATAREA','LEGACY_OFFICIAL','p','VERIFIED','h','${"b".repeat(64)}','[]')`); expect(db.prepare("SELECT count(*) AS n FROM SemanticRegistry").get()).toMatchObject({ n: 2 }); } finally { db.close(); } });
  it.each([
    ["Registry UPDATE", "UPDATE SemanticRegistry SET source='X' WHERE id='registry-1'"],
    ["Registry DELETE", "DELETE FROM SemanticRegistry WHERE id='registry-1'"],
    ["Field definition UPDATE", "UPDATE SemanticFieldDefinition SET meaning='X' WHERE id='field-1'"],
    ["Projection UPDATE", "UPDATE StatareaSemanticProjection SET partition='VALIDATION' WHERE id='projection-1'"],
    ["Projection DELETE", "DELETE FROM StatareaSemanticProjection WHERE id='projection-1'"],
    ["Finding UPDATE", "UPDATE SemanticQualityFinding SET field='X' WHERE id='finding-1'"],
    ["Assessment UPDATE", "UPDATE SemanticAssessmentRun SET rowCount=1 WHERE id='run-1'"],
  ])("bloquea append-only: %s", (_label, sql) => { const db = memoryDatabase(); try { expect(() => db.exec(sql)).toThrow(/append-only/); } finally { db.close(); } });
  it("mantiene auditoría append-only", () => { const db = memoryDatabase(); try { db.exec("INSERT INTO SemanticAuditEvent (id,eventType,contextJson) VALUES ('audit-2','ASSESSMENT_REUSED','{}')"); expect(db.prepare("SELECT count(*) AS n FROM SemanticAuditEvent").get()).toMatchObject({ n: 2 }); expect(() => db.exec("DELETE FROM SemanticAuditEvent WHERE id='audit-1'")).toThrow(/append-only/); } finally { db.close(); } });
  it("permite intentos REUSED sin duplicar el assessment", () => { const db = memoryDatabase(); try { db.exec("INSERT INTO SemanticAssessmentAttempt (id,assessmentRunId,registryId,datasetId,status,reusedAssessmentRunId,warningsJson) VALUES ('attempt-1','run-1','registry-1','dataset-1','REUSED','run-1','[]')"); expect(db.prepare("SELECT count(*) AS n FROM SemanticAssessmentRun").get()).toMatchObject({ n: 1 }); expect(db.prepare("SELECT count(*) AS n FROM StatareaSemanticProjection").get()).toMatchObject({ n: 1 }); } finally { db.close(); } });
  it("la lógica reutiliza registry y assessment", () => { const service = source("src/application/assess-statarea-semantics.ts"); expect(service).toContain("ASSESSMENT_REUSED"); expect(service).toContain("status: \"REUSED\""); });
});

describe("interfaz y fronteras de B006", () => {
  const ui = source("src/components/statarea-semantics-status.tsx");
  it("la UI muestra porcentaje fuente", () => expect(ui).toContain("Porcentajes fuente"));
  it("la UI muestra fórmula Under", () => expect(ui).toContain("100 − Más 2.5"));
  it("la UI muestra doble oportunidad", () => expect(ui).toContain("Doble oportunidad lista"));
  it("la UI no muestra rankings ni candidatos", () => expect(ui).not.toMatch(/ranking|candidatos/iu));
  it("la UI mantiene acciones posteriores deshabilitadas", () => expect((ui.match(/<button disabled>/g) ?? [])).toHaveLength(4));
  it("el manifest B005 permanece intacto", () => { const manifest = JSON.parse(source("var/exports/history/OU25-JULY-2026-V1/manifest.json")); expect(manifest.manifestHash).toBe(SEMANTIC_MANIFEST_HASH); expect(manifest.dataset).toMatchObject({ code: SEMANTIC_DATASET_CODE, status: "FROZEN" }); });
  it("matcher y normalizador conservan sus versiones", () => { const manifest = JSON.parse(source("var/exports/history/OU25-JULY-2026-V1/manifest.json")); expect(manifest.matcher).toMatchObject({ matcherVersion: "ou25-fixture-matcher/1.0.0", normalizerVersion: "ou25-identity-normalizer/1.0.0" }); });
  it("no existe integración Apostala", () => expect(readdirSync(join(root, "src"), { recursive: true }).map(String).some((path) => /apostala/i.test(path))).toBe(false));
  it("no existe dependencia x2-ht-lab", () => expect(source("package.json")).not.toMatch(/x2-ht-lab/i));
  it("no se creó módulo B010", () => expect(["src", "scripts", "prisma"].flatMap((directory) => readdirSync(join(root, directory), { recursive: true }).map(String)).some((path) => /(?:^|[\\/])b010(?:[\\/.]|$)/i.test(path))).toBe(false));
});
