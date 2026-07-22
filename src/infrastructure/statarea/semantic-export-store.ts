import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import assessmentJsonSchema from "@/contracts/schemas/statarea-semantic-assessment.schema.json";
import registryJsonSchema from "@/contracts/schemas/statarea-semantic-registry.schema.json";
import { semanticAssessmentSchema, semanticRegistrySchema } from "@/contracts/statarea-semantics";
import { validateContract } from "@/contracts/validator";
import { canonicalJson } from "@/domain/canonical-json";
import { SEMANTIC_EXPORT_DIRECTORY } from "@/domain/statarea-semantics/constants";

async function writeOnce(path: string, value: unknown) {
  const content = `${canonicalJson(value)}\n`;
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, content, { flag: "wx" });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    if ((await readFile(path, "utf8")) !== content) throw new Error(`SEMANTIC_EXPORT_WRITE_ONCE_MISMATCH:${path}`);
  }
  return relative(process.cwd(), path).replaceAll("\\", "/");
}

export async function preserveSemanticExports(input: {
  registry: Record<string, unknown>;
  assessment: Record<string, unknown>;
  directDefinitions: unknown[];
  derivedDefinitions: unknown[];
  excludedDefinitions: unknown[];
  qualityTotals: Record<string, unknown>;
  qualityByField: unknown[];
  qualityByDate: Array<{ partition: string; [key: string]: unknown }>;
  matchedReadiness: Record<string, number>;
  findings: unknown[];
  auditSummary: Record<string, unknown>;
}) {
  semanticRegistrySchema.parse(input.registry);
  semanticAssessmentSchema.parse(input.assessment);
  const registryAjv = validateContract(registryJsonSchema, input.registry);
  const assessmentAjv = validateContract(assessmentJsonSchema, input.assessment);
  if (!registryAjv.valid) throw new Error(`SEMANTIC_REGISTRY_AJV_INVALID:${JSON.stringify(registryAjv.errors)}`);
  if (!assessmentAjv.valid) throw new Error(`SEMANTIC_ASSESSMENT_AJV_INVALID:${JSON.stringify(assessmentAjv.errors)}`);
  const root = join(process.cwd(), "var", "exports", "semantics", SEMANTIC_EXPORT_DIRECTORY);
  const values: Array<[string, unknown]> = [
    ["semantic-registry.json", input.registry],
    ["semantic-assessment.json", input.assessment],
    ["field-evidence.json", input.directDefinitions],
    ["derived-fields.json", input.derivedDefinitions],
    ["quality-total.json", input.qualityTotals],
    ["quality-by-field.json", input.qualityByField],
    ["quality-by-date.json", input.qualityByDate],
    ["invalid-values.json", input.qualityByField.filter((field) => Number((field as { invalid: number }).invalid) > 0 || Number((field as { missing: number }).missing) > 0)],
    ["sum-residuals.json", { oneXTwo: input.qualityTotals.oneXTwo, halfTime: input.qualityTotals.halfTime }],
    ["ou-monotonicity.json", input.qualityTotals.monotonicity],
    ["matched-readiness.json", input.matchedReadiness],
    ["discovery-readiness.json", { partition: "DISCOVERY", matched: input.matchedReadiness.discovery, semanticReady: input.matchedReadiness.discovery }],
    ["validation-readiness.json", { partition: "VALIDATION", matched: input.matchedReadiness.validation, semanticReady: input.matchedReadiness.validation }],
    ["unverified-fields.json", input.excludedDefinitions],
    ["audit-summary.json", { ...input.auditSummary, findings: input.findings, networkRequests: 0, resultsUsed: 0 }],
  ];
  const paths = [];
  for (const [name, value] of values) paths.push(await writeOnce(join(root, name), value));
  return { paths, registryAjv: true, assessmentAjv: true, zod: true, canonical: true };
}
