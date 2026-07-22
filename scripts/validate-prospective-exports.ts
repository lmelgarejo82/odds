process.env.DATABASE_URL ??= "file:./dev.db";

import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import runJsonSchema from "../src/contracts/schemas/prospective-shadow-run.schema.json";
import assessmentJsonSchema from "../src/contracts/schemas/prospective-fixture-assessment.schema.json";
import quoteJsonSchema from "../src/contracts/schemas/quote-request-plan.schema.json";
import { prospectiveFixtureAssessmentDocumentSchema, prospectiveShadowRunDocumentSchema, quoteRequestPlanDocumentSchema } from "../src/contracts/prospective";
import { validateContract } from "../src/contracts/validator";
import { canonicalJson } from "../src/domain/canonical-json";
import { PROSPECTIVE_EXPORT_FILES } from "../src/domain/prospective/constants";
import { prospectiveExportRoot } from "../src/infrastructure/prospective/export-store";

async function main() {
  const root = prospectiveExportRoot();
  const files = (await readdir(root)).sort();
  if (files.length !== PROSPECTIVE_EXPORT_FILES.length || PROSPECTIVE_EXPORT_FILES.some((file) => !files.includes(file))) throw new Error(`PROSPECTIVE_EXPORT_SET_MISMATCH:${files.join(",")}`);
  const parsed = new Map<string, unknown>();
  for (const file of PROSPECTIVE_EXPORT_FILES) {
    const body = await readFile(join(root, file), "utf8");
    const value = JSON.parse(body) as unknown;
    if (body !== `${canonicalJson(value)}\n`) throw new Error(`PROSPECTIVE_EXPORT_NOT_CANONICAL:${file}`);
    parsed.set(file, value);
  }
  const validations = [
    ["prospective-run.json", runJsonSchema, prospectiveShadowRunDocumentSchema],
    ["pre-price-decisions.json", assessmentJsonSchema, prospectiveFixtureAssessmentDocumentSchema],
    ["quote-request-plan.json", quoteJsonSchema, quoteRequestPlanDocumentSchema],
  ] as const;
  for (const [file, schema, zod] of validations) {
    const value = parsed.get(file);
    const ajv = validateContract(schema, value);
    if (!ajv.valid) throw new Error(`${file}_AJV_INVALID:${JSON.stringify(ajv.errors)}`);
    zod.parse(value);
  }
  console.log(`${files.length} exports prospectivos validados con AJV, Zod y JSON canónico.`);
}

void main();
