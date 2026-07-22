import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import schema from "@/contracts/schemas/fixture-reconciliation.schema.json";
import { reconciliationContractSchema } from "@/contracts/reconciliation";
import { validateContract } from "@/contracts/validator";
import { canonicalJson } from "@/domain/canonical-json";

export async function preserveReconciliationExport(date: string, name: string, value: unknown) {
  reconciliationContractSchema.parse(value);
  const ajv = validateContract(schema, value); if (!ajv.valid) throw new Error(`AJV_RECONCILIATION_INVALID:${JSON.stringify(ajv.errors)}`);
  const absolute = join(process.cwd(), "var", "exports", "reconciliation", date, `${name}.json`); await mkdir(dirname(absolute), { recursive: true });
  const content = `${canonicalJson(value)}\n`; let reused = false;
  try { await writeFile(absolute, content, { flag: "wx", encoding: "utf8" }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; reused = true; if (await readFile(absolute, "utf8") !== content) throw new Error("RECONCILIATION_EXPORT_CONTENT_MISMATCH"); }
  return { relativePath: relative(process.cwd(), absolute).replaceAll("\\", "/"), reused };
}
