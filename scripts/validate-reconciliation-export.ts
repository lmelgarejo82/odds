import { readFile } from "node:fs/promises";
import { resolve, relative } from "node:path";
import schema from "../src/contracts/schemas/fixture-reconciliation.schema.json";
import { reconciliationContractSchema } from "../src/contracts/reconciliation";
import { validateContract } from "../src/contracts/validator";
import { canonicalJson } from "../src/domain/canonical-json";

async function main() { const input = process.argv[2]; if (!input) throw new Error("EXPORT_PATH_REQUIRED"); const absolute = resolve(input); const allowed = resolve("var/exports/reconciliation"); if (relative(allowed, absolute).startsWith("..")) throw new Error("EXPORT_PATH_NOT_ALLOWED");
  const raw = await readFile(absolute, "utf8"); const value: unknown = JSON.parse(raw); const zod = reconciliationContractSchema.safeParse(value).success; const ajv = validateContract(schema, value).valid; const canonical = raw === `${canonicalJson(value)}\n`; if (!zod || !ajv || !canonical) throw new Error(`INVALID_EXPORT:${JSON.stringify({ zod, ajv, canonical })}`); console.log(JSON.stringify({ zod, ajv, canonical, path: absolute })); }
void main();
