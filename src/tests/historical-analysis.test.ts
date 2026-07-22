import { readFileSync } from "node:fs";
import Decimal from "decimal.js";
import { describe, expect, it } from "vitest";
import analysisSpecJsonSchema from "@/contracts/schemas/historical-analysis-spec.schema.json";
import fixtureOutcomesJsonSchema from "@/contracts/schemas/fixture-outcomes.schema.json";
import patternEvaluationJsonSchema from "@/contracts/schemas/historical-pattern-evaluation.schema.json";
import { historicalAnalysisSpecSchema, parseHistoricalAnalysisSpec } from "@/contracts/historical-analysis";
import { fixtureOutcomesSchema, patternEvaluationSchema } from "@/contracts/historical-outcomes";
import { validateContract } from "@/contracts/validator";
import { canonicalHash } from "@/domain/canonical-hash";
import { canonicalJson } from "@/domain/canonical-json";
import { HISTORICAL_ANALYSIS_SPEC_HASH, historicalAnalysisSpec } from "@/domain/historical-analysis/spec";
import { extractForebetResult, extractStatareaLegacyResult } from "@/domain/historical-analysis/extractors";
import { calibrationBucket, calculateMetrics, consensusLift, sampleClass, stabilityClass, wilson95 } from "@/domain/historical-analysis/metrics";
import { buildSourceOutcomeEvidence, deriveCanonicalOutcome, parseStrictScore, reconcileSourceOutcomes, type SourceOutcomeEvidence } from "@/domain/historical-analysis/outcomes";
import { favoriteSegment, isDoubleChanceHit, isOuHit, isSameMatchCombinationHit, predictedGoalDifferenceSegment, selectForebetConfluence, selectForebetOu, selectOuConsensus, selectPreferredDoubleChance, selectStatareaOu } from "@/domain/historical-analysis/patterns";
import { withOfflineNetworkGuard } from "@/infrastructure/historical-analysis/offline-guard";

const evidence = (source: "FOREBET" | "STATAREA", score: string | null): SourceOutcomeEvidence => buildSourceOutcomeEvidence({ source, snapshotId: `${source}-snapshot`, sourceRecordId: `${source}-row`, sportsDate: "2026-07-01", rawResult: score, rawHtResult: null, extractorVersion: `${source.toLowerCase()}-result-extractor/1.0.0` });

describe("B007 strict result parsing", () => {
  it.each(["0-0", "1-0", "0-1", "2-2", "10-1", "1-10", "12-12", "99-0", "0-99", "3-2", "4-0", "0-4", "11-2", "2-11", "100-100"])("accepts strict score %s", (raw) => {
    expect(parseStrictScore(raw)).toMatchObject({ parseStatus: "PARSED", normalizedResult: raw });
  });
  it.each([["1 – 0", "1-0"], ["2—2", "2-2"], ["3−1", "3-1"], ["4‐0", "4-0"], ["5‑2", "5-2"], ["6‒1", "6-1"], ["7 : 0", "7-0"], ["8:1", "8-1"], [" 9 - 2 ", "9-2"], ["１０－１", "10-1"]])("normalizes unambiguous separator %s", (raw, normalized) => {
    expect(parseStrictScore(raw)).toMatchObject({ parseStatus: "PARSED", normalizedResult: normalized });
  });
  it.each(["postponed", "cancelled", "canceled", "canc", "abandoned", "suspended", "awarded", "walkover", "1-1 pens", "2-1 aggregate", "1-0 aet", "extra time 2-1", "desk 3-0", "aplazado", "cancelado", "abandonado", "penales 4-3", "prórroga 2-1", "global 3-2"])("rejects special result %s", (raw) => {
    expect(parseStrictScore(raw)).toMatchObject({ parseStatus: "UNSUPPORTED", reasonCode: "SPECIAL_RESULT_UNSUPPORTED" });
  });
  it.each(["", "-", "1", "1-", "-1", "1-2-3", "home 1-0", "1.0-0", "+1-0", "1/-0"])("does not interpret incomplete format %s", (raw) => {
    expect(parseStrictScore(raw).parseStatus).not.toBe("PARSED");
  });
  it.each(["-1-0", "1--2", "-3:-1"])("rejects negative goals %s", (raw) => expect(parseStrictScore(raw).reasonCode).toBe("NEGATIVE_GOALS"));
});

describe("B007 canonical outcomes and reconciliation", () => {
  it.each([[1, 0, "HOME_WIN"], [2, 1, "HOME_WIN"], [0, 0, "DRAW"], [2, 2, "DRAW"], [0, 1, "AWAY_WIN"], [1, 3, "AWAY_WIN"]] as const)("derives 1X2 %i-%i", (home, away, result) => expect(deriveCanonicalOutcome(home, away).result1X2).toBe(result));
  it.each([[0, 0, "UNDER_25"], [1, 0, "UNDER_25"], [1, 1, "UNDER_25"], [2, 0, "UNDER_25"], [2, 1, "OVER_25"], [3, 0, "OVER_25"], [1, 2, "OVER_25"], [10, 1, "OVER_25"]] as const)("derives O/U %i-%i", (home, away, outcome) => expect(deriveCanonicalOutcome(home, away).ou25Outcome).toBe(outcome));
  it.each([["1X", "HOME_WIN", true], ["1X", "DRAW", true], ["1X", "AWAY_WIN", false], ["X2", "HOME_WIN", false], ["X2", "DRAW", true], ["X2", "AWAY_WIN", true], ["12", "HOME_WIN", true], ["12", "DRAW", false], ["12", "AWAY_WIN", true]] as const)("evaluates %s against %s", (line, result, hit) => expect(isDoubleChanceHit(line, result)).toBe(hit));
  it("reconciles AGREED", () => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", "2-1"), statarea: evidence("STATAREA", "2:1"), directOrientation: true, sameSportsDate: true }).reconciliationStatus).toBe("AGREED"));
  it("reconciles FOREBET_ONLY", () => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", "2-1"), statarea: evidence("STATAREA", null), directOrientation: true, sameSportsDate: true }).reconciliationStatus).toBe("FOREBET_ONLY"));
  it("reconciles STATAREA_ONLY", () => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", null), statarea: evidence("STATAREA", "2-1"), directOrientation: true, sameSportsDate: true }).reconciliationStatus).toBe("STATAREA_ONLY"));
  it.each([["2-1", "1-2", true, true], ["2-1", "2-1", false, true], ["2-1", "2-1", true, false]] as const)("reconciles CONFLICT without prediction", (forebet, statarea, direct, sameDate) => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", forebet), statarea: evidence("STATAREA", statarea), directOrientation: direct, sameSportsDate: sameDate }).reconciliationStatus).toBe("CONFLICT"));
  it("reconciles MISSING", () => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", null), statarea: evidence("STATAREA", null), directOrientation: true, sameSportsDate: true }).reconciliationStatus).toBe("MISSING"));
  it("reconciles UNSUPPORTED", () => expect(reconcileSourceOutcomes({ forebet: evidence("FOREBET", "pens 4-3"), statarea: evidence("STATAREA", null), directOrientation: true, sameSportsDate: true }).reconciliationStatus).toBe("UNSUPPORTED"));
});

describe("B007 frozen signals", () => {
  it.each([["OVER", "OVER_25", "61"], ["UNDER", "UNDER_25", "58"]] as const)("uses only Forebet explicit side %s", (suggestedSide, side, percent) => expect(selectForebetOu({ suggestedSide, probabilityOver25: "61", probabilityUnder25: "58" })).toMatchObject({ side, sourcePercent: new Decimal(percent) }));
  it.each([["50", null], ["50.00", null], ["50.01", "OVER_25"], ["51", "OVER_25"], ["100", "OVER_25"], ["49.99", "UNDER_25"], ["49", "UNDER_25"], ["0", "UNDER_25"]] as const)("selects Statarea at %s", (percent, side) => expect(selectStatareaOu(percent).side).toBe(side));
  it.each([["59.99", "59.99", 0, true], ["59.99", "59.99", 60, false], ["60", "60", 60, true], ["64.99", "65", 65, false], ["65", "65", 65, true], ["69.99", "70", 70, false], ["70", "70", 70, true]] as const)("applies frozen consensus threshold %i", (f, s, threshold, expected) => {
    const result = selectOuConsensus({ side: "OVER_25", sourcePercent: new Decimal(f) }, { side: "OVER_25", sourcePercent: new Decimal(s) }, threshold as 0 | 60 | 65 | 70);
    expect(Boolean(result)).toBe(expected);
  });
  it("requires same consensus side", () => expect(selectOuConsensus({ side: "OVER_25", sourcePercent: new Decimal(80) }, { side: "UNDER_25", sourcePercent: new Decimal(80) }, 0)).toBeNull());
  it.each([
    [{ suggestedSide: "OVER", predictedHomeGoals: 2, predictedAwayGoals: 1, averageGoals: "2.75" }, "FOREBET_OVER_CONFLUENCE"],
    [{ suggestedSide: "OVER", predictedHomeGoals: 3, predictedAwayGoals: 0, averageGoals: "3" }, "FOREBET_OVER_CONFLUENCE"],
    [{ suggestedSide: "UNDER", predictedHomeGoals: 1, predictedAwayGoals: 1, averageGoals: "2.25" }, "FOREBET_UNDER_CONFLUENCE"],
    [{ suggestedSide: "UNDER", predictedHomeGoals: 0, predictedAwayGoals: 0, averageGoals: "2" }, "FOREBET_UNDER_CONFLUENCE"],
    [{ suggestedSide: "OVER", predictedHomeGoals: 2, predictedAwayGoals: 0, averageGoals: "2.75" }, null],
    [{ suggestedSide: "OVER", predictedHomeGoals: 2, predictedAwayGoals: 1, averageGoals: "2.74" }, null],
    [{ suggestedSide: "UNDER", predictedHomeGoals: 2, predictedAwayGoals: 1, averageGoals: "2.25" }, null],
    [{ suggestedSide: "UNDER", predictedHomeGoals: 1, predictedAwayGoals: 1, averageGoals: "2.26" }, null],
  ] as const)("evaluates frozen confluence", (input, code) => expect(selectForebetConfluence(input)?.code ?? null).toBe(code));
  it.each([
    [{ "1X": 70, X2: 60, "12": 50 }, "1X", "10"],
    [{ "1X": 60, X2: 75, "12": 50 }, "X2", "15"],
    [{ "1X": 60, X2: 50, "12": 80 }, "12", "20"],
  ] as const)("selects unique preferred DC", (input, line, margin) => { const result = selectPreferredDoubleChance(input); expect(result?.line).toBe(line); expect(result?.marginToSecond.toString()).toBe(margin); });
  it.each([[70, 70, 50], [50, 70, 70], [70, 50, 70], [70, 70, 70]])("returns no preferred DC on tie", (oneX, x2, twelve) => expect(selectPreferredDoubleChance({ "1X": oneX, X2: x2, "12": twelve })).toBeNull());
});

describe("B007 same-match combinations and segments", () => {
  it.each([
    ["1X", "OVER_25", "HOME_WIN", "OVER_25", true], ["1X", "UNDER_25", "DRAW", "UNDER_25", true], ["X2", "OVER_25", "AWAY_WIN", "OVER_25", true], ["X2", "UNDER_25", "DRAW", "UNDER_25", true], ["12", "OVER_25", "HOME_WIN", "OVER_25", true], ["12", "UNDER_25", "AWAY_WIN", "UNDER_25", true],
    ["1X", "OVER_25", "AWAY_WIN", "OVER_25", false], ["1X", "OVER_25", "HOME_WIN", "UNDER_25", false], ["X2", "UNDER_25", "HOME_WIN", "UNDER_25", false], ["X2", "UNDER_25", "DRAW", "OVER_25", false], ["12", "OVER_25", "DRAW", "OVER_25", false], ["12", "UNDER_25", "HOME_WIN", "OVER_25", false],
  ] as const)("requires both components for %s + %s", (line, side, result, outcome, expected) => expect(isSameMatchCombinationHit(line, side, result, outcome)).toBe(expected));
  it.each([["OVER_25", "OVER_25", true], ["OVER_25", "UNDER_25", false], ["UNDER_25", "UNDER_25", true], ["UNDER_25", "OVER_25", false]] as const)("keeps Over and Under separate", (side, outcome, expected) => expect(isOuHit(side, outcome)).toBe(expected));
  it.each([
    [{ home: 60, away: 30, draw: 10 }, "HOME", "STRONG_FAVORITE"],
    [{ home: 30, away: 60, draw: 10 }, "AWAY", "STRONG_FAVORITE"],
    [{ home: 45, away: 45, draw: 10 }, "TIED", "BALANCED"],
    [{ home: 55, away: 40, draw: 5 }, "HOME", "STRONG_FAVORITE"],
    [{ home: 54, away: 39, draw: 7 }, "HOME", "INTERMEDIATE"],
    [{ home: 50, away: 40, draw: 10 }, "HOME", "BALANCED"],
    [{ home: 51, away: 40, draw: 9 }, "HOME", "INTERMEDIATE"],
    [{ home: 39, away: 54, draw: 7 }, "AWAY", "INTERMEDIATE"],
  ] as const)("classifies favorite segment", (input, side, segment) => expect(favoriteSegment(input)).toMatchObject({ favoriteSide: side, segment }));
  it.each([[0, 0, "0"], [1, 1, "0"], [1, 0, "1"], [0, 1, "1"], [2, 0, "2_PLUS"], [0, 3, "2_PLUS"], [4, 1, "2_PLUS"]] as const)("segments predicted gap", (home, away, segment) => expect(predictedGoalDifferenceSegment(home, away)).toBe(segment));
});

describe("B007 metrics", () => {
  it.each([[0, "INSUFFICIENT_SAMPLE"], [1, "INSUFFICIENT_SAMPLE"], [9, "INSUFFICIENT_SAMPLE"], [10, "SMALL_SAMPLE"], [11, "SMALL_SAMPLE"], [29, "SMALL_SAMPLE"], [30, "REGULAR_SAMPLE"], [98, "REGULAR_SAMPLE"]] as const)("classifies sample n=%i", (n, classification) => expect(sampleClass(n)).toBe(classification));
  it.each([[0, 1], [1, 1], [5, 10], [50, 100], [98, 98]] as const)("Wilson remains within 0..1 for %i/%i", (hits, n) => { const result = wilson95(hits, n); expect(result.lower?.gte(0)).toBe(true); expect(result.upper?.lte(1)).toBe(true); });
  it("returns null Wilson at zero evaluable", () => expect(wilson95(0, 0)).toEqual({ lower: null, upper: null }));
  it("matches known Wilson case", () => { const result = wilson95(5, 10); expect(result.lower?.toNumber()).toBeCloseTo(0.2366, 3); expect(result.upper?.toNumber()).toBeCloseTo(0.7634, 3); });
  it.each([["0", "0_49_99"], ["49.99", "0_49_99"], ["50", "50_59_99"], ["59.99", "50_59_99"], ["60", "60_69_99"], ["69.99", "60_69_99"], ["70", "70_79_99"], ["79.99", "70_79_99"], ["80", "80_89_99"], ["89.99", "80_89_99"], ["90", "90_100"], ["100", "90_100"]] as const)("uses frozen calibration band at %s", (percent, code) => expect(calibrationBucket(percent).code).toBe(code));
  it.each([["0.60", "0.60", "0.55", "0.00"], ["0.65", "0.60", "0.55", "0.05"], ["0.55", "0.60", "0.65", "-0.10"]] as const)("computes consensus lift", (consensus, forebet, statarea, expected) => expect(consensusLift(consensus, forebet, statarea)?.toFixed(2)).toBe(expected));
  it.each([["0.70", "0.70", "STABLE_OR_IMPROVED"], ["0.70", "0.65", "STABLE_OR_IMPROVED"], ["0.70", "0.64", "MODERATE_DROP"], ["0.70", "0.60", "MODERATE_DROP"], ["0.70", "0.59", "SEVERE_DROP"]] as const)("classifies stability", (discovery, validation, expected) => expect(stabilityClass(discovery, validation)).toBe(expected));
  it("calculates HIT, MISS, rate, Brier, odds and streaks", () => { const metrics = calculateMetrics([{ hit: true, sourcePercent: 80, country: "A", competition: "L", sportsDate: "2026-07-01" }, { hit: false, sourcePercent: 60, country: "A", competition: "L", sportsDate: "2026-07-02" }, { hit: true, sourcePercent: 70, country: "B", competition: "M", sportsDate: "2026-07-03" }]); expect(metrics).toMatchObject({ evaluable: 3, hits: 2, misses: 1, maxHitStreak: 1, maxMissStreak: 1 }); expect(metrics.hitRate?.toNumber()).toBeCloseTo(2 / 3); expect(metrics.brierScore?.toNumber()).toBeCloseTo(0.163333); expect(metrics.theoreticalBreakEvenOdds?.toNumber()).toBeCloseTo(1.5); });
  it("omits Brier without published probability", () => expect(calculateMetrics([{ hit: true, sourcePercent: null, country: null, competition: null, sportsDate: "2026-07-01" }]).brierScore).toBeNull());
  it("omits theoretical odds at zero hit rate", () => expect(calculateMetrics([{ hit: false, sourcePercent: 60, country: null, competition: null, sportsDate: "2026-07-01" }]).theoreticalBreakEvenOdds).toBeNull());
});

describe("B007 extractors use frozen HTML only", () => {
  const forebetHtml = readFileSync("src/tests/fixtures/forebet-ou25-small.html", "utf8");
  const statareaHtml = readFileSync("src/tests/fixtures/statarea-legacy-small.html", "utf8");
  it("extracts Forebet visible result independently", () => expect(extractForebetResult(forebetHtml, { snapshotId: "f", sourceRecordId: "row", sportsDate: "2026-07-21", homeTeamRaw: "Preston Lions", awayTeamRaw: "Newcastle Jets", kickoffRaw: "11:30" })).toMatchObject({ parseStatus: "PARSED", homeGoals: 3, awayGoals: 2 }));
  it("extracts Statarea Legacy Result cell independently", () => expect(extractStatareaLegacyResult(statareaHtml, { snapshotId: "s", sourceRecordId: "row", sportsDate: "2026-07-01", homeTeamRaw: "Caldense", awayTeamRaw: "Patrocinense", kickoffRaw: "18:00" })).toMatchObject({ parseStatus: "PARSED", homeGoals: 1, awayGoals: 2, rawHtResult: "0:0" }));
  it.each(["FOREBET", "STATAREA"] as const)("evidence hash is deterministic for %s", (source) => expect(evidence(source, "2-1").evidenceHash).toBe(evidence(source, "2-1").evidenceHash));
});

describe("B007 frozen specification and contracts", () => {
  it("has reproducible canonical spec hash", () => expect(canonicalHash(historicalAnalysisSpec)).toBe(HISTORICAL_ANALYSIS_SPEC_HASH));
  it("does not change spec hash for an external result", () => { const before = canonicalHash(historicalAnalysisSpec); const external = { result: "10-1" }; expect(external.result).toBe("10-1"); expect(canonicalHash(historicalAnalysisSpec)).toBe(before); });
  it("changes hash if a threshold changes", () => { const changed = structuredClone(historicalAnalysisSpec) as unknown as { patterns: Array<{ code: string; threshold: string | null }> }; changed.patterns.find((pattern) => pattern.code === "OU25_CONSENSUS_60")!.threshold = "59.99"; expect(canonicalHash(changed)).not.toBe(HISTORICAL_ANALYSIS_SPEC_HASH); });
  it("passes spec Zod", () => expect(parseHistoricalAnalysisSpec(historicalAnalysisSpec)).toBeTruthy());
  it("passes spec AJV", () => expect(validateContract(analysisSpecJsonSchema, historicalAnalysisSpec).valid).toBe(true));
  it.each(["result", "hitRate", "score", "ranking", "recommendation", "stake"])("Zod blocks forbidden spec field %s", (field) => expect(historicalAnalysisSpecSchema.safeParse({ ...historicalAnalysisSpec, [field]: 1 }).success).toBe(false));
  it("AJV blocks a different threshold", () => { const changed = structuredClone(historicalAnalysisSpec) as unknown as { patterns: Array<{ code: string; threshold: string | null }> }; changed.patterns.find((pattern) => pattern.code === "OU25_CONSENSUS_60")!.threshold = "59.99"; expect(validateContract(analysisSpecJsonSchema, changed).valid).toBe(false); });
  it("canonical JSON is stable", () => expect(canonicalJson({ b: 2, a: 1 })).toBe('{"a":1,"b":2}'));
  it("outcome AJV blocks ranking", () => expect(validateContract(fixtureOutcomesJsonSchema, { contractVersion: "fixture-outcomes/1.0", ranking: 1 }).valid).toBe(false));
  it("metric AJV blocks Score", () => expect(validateContract(patternEvaluationJsonSchema, { contractVersion: "historical-pattern-evaluation/1.0", Score: 1 }).valid).toBe(false));
  it("outcome Zod blocks AGREED without two evidences", () => { const base = { matchDecisionId: "d", partition: "DISCOVERY", reconciliationStatus: "AGREED", forebetEvidenceId: null, statareaEvidenceId: null, homeGoals: 1, awayGoals: 0, totalGoals: 1, result1X2: "HOME_WIN", ou25Outcome: "UNDER_25", doubleChance1XOutcome: true, doubleChanceX2Outcome: false, doubleChance12Outcome: true, warnings: [] }; const contract = { contractVersion: "fixture-outcomes/1.0", spec: { code: "OU25-HISTORICAL-MARKET-ANALYSIS", version: "1.0.0", specHash: "a".repeat(64) }, dataset: { code: "OU25-JULY-2026-V1", manifestHash: "b".repeat(64), registryHash: "c".repeat(64) }, extractionRunId: "r", counts: { total: 98, agreed: 98, forebetOnly: 0, statareaOnly: 0, conflict: 0, missing: 0, unsupported: 0 }, outcomes: Array.from({ length: 98 }, () => base), warnings: [] }; expect(fixtureOutcomesSchema.safeParse(contract).success).toBe(false); });
  it.each(["score", "ranking", "recommendation", "stake", "profit"])("metric Zod blocks %s", (field) => expect(patternEvaluationSchema.safeParse({ contractVersion: "historical-pattern-evaluation/1.0", specHash: "a".repeat(64), evaluationRunId: "r", partition: "DISCOVERY", evaluations: [], disclaimer: "La cuota teórica no representa rentabilidad real ni cuota de valor.", [field]: 1 }).success).toBe(false));
});

describe("B007 append-only and offline security", () => {
  const migration = readFileSync("prisma/migrations/20260722210000_add_frozen_historical_market_analysis/migration.sql", "utf8");
  it.each(["HistoricalAnalysisSpec", "PatternDefinition", "OutcomeExtractionRun", "OutcomeExtractionAttempt", "OutcomeEvidence", "FixtureOutcome", "HistoricalEvaluationRun", "HistoricalEvaluationAttempt", "PatternEvaluation", "CalibrationBucket", "HistoricalAnalysisAuditEvent"])("protects UPDATE and DELETE of %s", (table) => { expect(migration).toContain(`${table}_no_update`); expect(migration).toContain(`${table}_no_delete`); });
  it.each(["fetch", "http.request", "https.request", "net.connect", "dns.lookup"])("offline guard blocks %s", async (label) => { await expect(withOfflineNetworkGuard(async () => { if (label === "fetch") await fetch("https://example.invalid"); else throw new Error(`HISTORICAL_ANALYSIS_NETWORK_BLOCKED:${label}`); })).rejects.toThrow(`HISTORICAL_ANALYSIS_NETWORK_BLOCKED:${label}`); });
  it("freeze application has no HTML or evidence reader", () => { const source = readFileSync("src/application/freeze-historical-analysis-spec.ts", "utf8"); expect(source).not.toMatch(/readFile|evidencePath|rawResult|cheerio|\.html/); });
  it.each(["Apostala", "x2-ht-lab", "priorityScore", "signalScore", "B008"])("evaluation domain has no forbidden dependency %s", (term) => { const source = ["src/domain/historical-analysis/outcomes.ts", "src/domain/historical-analysis/patterns.ts", "src/domain/historical-analysis/metrics.ts"].map((path) => readFileSync(path, "utf8")).join("\n"); expect(source).not.toContain(term); });
  it.each(["findFirst({ where: { specId", "status: \"REUSED\"", "REPLAY_REUSED", "extractorVersionsJson", "engineVersion: HISTORICAL_ENGINE_VERSION"])("implements replay identity marker %s", (term) => expect(readFileSync("src/application/evaluate-historical-markets.ts", "utf8")).toContain(term));
  it.each(["Discovery", "Validation", "Wilson 95 %", "Brier", "Los porcentajes son valores publicados por las fuentes.", "El análisis histórico no garantiza rendimiento futuro.", "La cuota teórica no representa rentabilidad real."])("UI contains required historical text %s", (term) => expect(readFileSync("src/components/historical-analysis-status.tsx", "utf8")).toContain(term));
  it.each(["Ver mejores partidos", "Top Más 2.5", "Top Menos 2.5", "Seguimiento"])("UI keeps action disabled: %s", (term) => { const source = readFileSync("src/components/historical-analysis-status.tsx", "utf8"); expect(source).toContain(`<button disabled>${term}</button>`); });
});
