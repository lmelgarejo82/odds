import { readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { validateContract } from "../src/contracts/validator";
import { historicalAnalysisSpec } from "../src/domain/historical-analysis/spec";

const root = process.cwd();
const schemas = join(root, "src", "contracts", "schemas");
const fixtures = join(root, "src", "contracts", "fixtures");

const fixtureOutcome = { matchDecisionId: "decision", partition: "DISCOVERY", reconciliationStatus: "AGREED", forebetEvidenceId: "forebet-evidence", statareaEvidenceId: "statarea-evidence", homeGoals: 0, awayGoals: 0, totalGoals: 0, result1X2: "DRAW", ou25Outcome: "UNDER_25", doubleChance1XOutcome: true, doubleChanceX2Outcome: true, doubleChance12Outcome: false, warnings: [] };
const generatedFixtures: Record<string, { valid: unknown; invalid: unknown }> = {
  "historical-analysis-spec": {
    valid: historicalAnalysisSpec,
    invalid: { ...historicalAnalysisSpec, patterns: historicalAnalysisSpec.patterns.map((pattern) => pattern.code === "OU25_CONSENSUS_60" ? { ...pattern, threshold: "59.99" } : pattern) },
  },
  "fixture-outcomes": {
    valid: { contractVersion: "fixture-outcomes/1.0", spec: { code: "OU25-HISTORICAL-MARKET-ANALYSIS", version: "1.0.0", specHash: "a".repeat(64) }, dataset: { code: "OU25-JULY-2026-V1", manifestHash: "b".repeat(64), registryHash: "c".repeat(64) }, extractionRunId: "run", counts: { total: 98, agreed: 98, forebetOnly: 0, statareaOnly: 0, conflict: 0, missing: 0, unsupported: 0 }, outcomes: Array.from({ length: 98 }, (_, index) => ({ ...fixtureOutcome, matchDecisionId: `decision-${index}` })), warnings: [] },
    invalid: { contractVersion: "fixture-outcomes/1.0", score: 99 },
  },
  "historical-pattern-evaluation": {
    valid: { contractVersion: "historical-pattern-evaluation/1.0", specHash: "a".repeat(64), evaluationRunId: "run", partition: "DISCOVERY", evaluations: [{ patternCode: "FOREBET_OU25_CONTROL", side: "OVER_25", segment: "ALL", total: 1, evaluable: 1, hits: 1, misses: 0, hitRate: 1, wilsonLower: 0.2065, wilsonUpper: 1, brierScore: 0.04, theoreticalBreakEvenOdds: 1, sampleClass: "INSUFFICIENT_SAMPLE", warnings: ["INSUFFICIENT_SAMPLE"] }], disclaimer: "La cuota teórica no representa rentabilidad real ni cuota de valor." },
    invalid: { contractVersion: "historical-pattern-evaluation/1.0", ranking: 1 },
  },
};

const schemaFiles = readdirSync(schemas).filter((name) => name.endsWith(".schema.json"));
for (const schemaFile of schemaFiles) {
  const stem = schemaFile.replace(".schema.json", "");
  const schema = JSON.parse(readFileSync(join(schemas, schemaFile), "utf8"));
  for (const kind of ["valid", "invalid"] as const) {
    const fixtureFile = `${stem}.${kind}.json`;
    const fixture = generatedFixtures[stem]?.[kind] ?? JSON.parse(readFileSync(join(fixtures, fixtureFile), "utf8"));
    const result = validateContract(schema, fixture);
    if ((kind === "valid") !== result.valid) throw new Error(`${basename(fixtureFile)} produjo un resultado inesperado: ${JSON.stringify(result.errors)}`);
  }
}
console.log(`${schemaFiles.length * 2} fixtures contractuales validados correctamente.`);
