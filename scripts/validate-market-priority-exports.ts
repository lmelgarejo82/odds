import { readFile } from "node:fs/promises";
import { join } from "node:path";
import candidateJsonSchema from "../src/contracts/schemas/fixture-market-candidates.schema.json";
import decisionJsonSchema from "../src/contracts/schemas/fixture-preferred-line-decisions.schema.json";
import policyJsonSchema from "../src/contracts/schemas/market-priority-policy.schema.json";
import {
  fixtureMarketCandidatesDocumentSchema,
  fixturePreferredLineDecisionsDocumentSchema,
  marketPriorityPolicyDocumentSchema,
} from "../src/contracts/market-priority";
import { validateContract } from "../src/contracts/validator";
import { canonicalJson } from "../src/domain/canonical-json";
import { MARKET_PRIORITY_EXPORT_FILES } from "../src/domain/market-priority/constants";
import { marketPriorityExportRoot } from "../src/infrastructure/market-priority/export-store";

async function main() {
  const root = marketPriorityExportRoot();
  const documents = new Map<string, unknown>();
  for (const file of MARKET_PRIORITY_EXPORT_FILES) {
    const body = await readFile(join(root, file), "utf8");
    const document = JSON.parse(body) as unknown;
    if (body !== `${canonicalJson(document)}\n`) throw new Error(`MARKET_PRIORITY_EXPORT_NOT_CANONICAL:${file}`);
    documents.set(file, document);
  }
  const policy = documents.get("policy.json");
  const candidates = documents.get("candidates.json");
  const decisions = documents.get("final-decisions.json");
  marketPriorityPolicyDocumentSchema.parse(policy);
  fixtureMarketCandidatesDocumentSchema.parse(candidates);
  fixturePreferredLineDecisionsDocumentSchema.parse(decisions);
  for (const [schema, document, label] of [[policyJsonSchema, policy, "policy"], [candidateJsonSchema, candidates, "candidates"], [decisionJsonSchema, decisions, "decisions"]] as const) {
    const result = validateContract(schema, document);
    if (!result.valid) throw new Error(`MARKET_PRIORITY_EXPORT_AJV_INVALID:${label}:${JSON.stringify(result.errors)}`);
  }
  console.log(JSON.stringify({ files: MARKET_PRIORITY_EXPORT_FILES.length, ajv: true, zod: true, canonical: true, networkRequests: 0, outcomeReads: 0 }));
}

void main();
