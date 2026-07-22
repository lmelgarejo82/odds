import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import analysisSpecJsonSchema from "../src/contracts/schemas/historical-analysis-spec.schema.json";
import fixtureOutcomesJsonSchema from "../src/contracts/schemas/fixture-outcomes.schema.json";
import patternEvaluationJsonSchema from "../src/contracts/schemas/historical-pattern-evaluation.schema.json";
import { parseHistoricalAnalysisSpec } from "../src/contracts/historical-analysis";
import { fixtureOutcomesSchema, patternEvaluationSchema } from "../src/contracts/historical-outcomes";
import { validateContract } from "../src/contracts/validator";
import { canonicalJson } from "../src/domain/canonical-json";
import { HISTORICAL_EXPORT_FILES } from "../src/domain/historical-analysis/constants";
import { historicalExportRoot } from "../src/infrastructure/historical-analysis/export-store";

async function main() {
  const root = historicalExportRoot();
  const actual = (await readdir(root)).sort(); const expected = [...HISTORICAL_EXPORT_FILES].sort();
  if (canonicalJson(actual) !== canonicalJson(expected)) throw new Error(`HISTORICAL_EXPORT_FILE_SET_MISMATCH:${canonicalJson(actual)}`);
  const values = new Map<string, unknown>();
  for (const file of expected) {
    const text = await readFile(join(root, file), "utf8"); const value = JSON.parse(text);
    if (text.trim() !== canonicalJson(value)) throw new Error(`HISTORICAL_EXPORT_NOT_CANONICAL:${file}`);
    values.set(file, value);
  }
  const spec = values.get("analysis-spec.json"); parseHistoricalAnalysisSpec(spec); if (!validateContract(analysisSpecJsonSchema, spec).valid) throw new Error("HISTORICAL_SPEC_AJV_INVALID");
  const outcomes = values.get("fixture-outcomes.json"); fixtureOutcomesSchema.parse(outcomes); if (!validateContract(fixtureOutcomesJsonSchema, outcomes).valid) throw new Error("HISTORICAL_OUTCOMES_AJV_INVALID");
  for (const file of ["discovery-metrics.json", "validation-metrics.json"] as const) { const value = values.get(file); patternEvaluationSchema.parse(value); if (!validateContract(patternEvaluationJsonSchema, value).valid) throw new Error(`HISTORICAL_METRICS_AJV_INVALID:${file}`); }
  console.log(JSON.stringify({ files: actual.length, ajv: true, zod: true, canonical: true, networkRequests: 0 }));
}
void main();
