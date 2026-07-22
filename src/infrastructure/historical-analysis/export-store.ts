import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "@/domain/canonical-json";
import { HISTORICAL_EXPORT_DIRECTORY, HISTORICAL_EXPORT_FILES } from "@/domain/historical-analysis/constants";

export function historicalExportRoot() {
  return join(process.cwd(), "var", "exports", "historical-analysis", HISTORICAL_EXPORT_DIRECTORY);
}

export async function preserveHistoricalExports(bundle: Record<(typeof HISTORICAL_EXPORT_FILES)[number], unknown>) {
  const root = historicalExportRoot();
  await mkdir(root, { recursive: true });
  const results: Array<{ file: string; status: "CREATED" | "REUSED"; bytes: number }> = [];
  for (const file of HISTORICAL_EXPORT_FILES) {
    if (!(file in bundle)) throw new Error(`HISTORICAL_EXPORT_MISSING:${file}`);
    const body = `${canonicalJson(bundle[file])}\n`;
    const path = join(root, file);
    try {
      await writeFile(path, body, { encoding: "utf8", flag: "wx" });
      results.push({ file, status: "CREATED", bytes: Buffer.byteLength(body) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      if (existing !== body) throw new Error(`HISTORICAL_EXPORT_WRITE_ONCE_MISMATCH:${file}`);
      results.push({ file, status: "REUSED", bytes: Buffer.byteLength(body) });
    }
  }
  return { root: `var/exports/historical-analysis/${HISTORICAL_EXPORT_DIRECTORY}`, files: results };
}
