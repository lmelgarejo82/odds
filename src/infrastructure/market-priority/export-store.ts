import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "@/domain/canonical-json";
import { MARKET_PRIORITY_EXPORT_DIRECTORY, MARKET_PRIORITY_EXPORT_FILES } from "@/domain/market-priority/constants";

export function marketPriorityExportRoot() {
  return join(process.cwd(), "var", "exports", "priority", MARKET_PRIORITY_EXPORT_DIRECTORY);
}
export async function preserveMarketPriorityExports(bundle: Record<(typeof MARKET_PRIORITY_EXPORT_FILES)[number], unknown>) {
  const root = marketPriorityExportRoot();
  await mkdir(root, { recursive: true });
  const files: Array<{ file: string; status: "CREATED" | "REUSED"; bytes: number }> = [];
  for (const file of MARKET_PRIORITY_EXPORT_FILES) {
    if (!(file in bundle)) throw new Error(`MARKET_PRIORITY_EXPORT_MISSING:${file}`);
    const body = `${canonicalJson(bundle[file])}\n`;
    const path = join(root, file);
    try {
      await writeFile(path, body, { encoding: "utf8", flag: "wx" });
      files.push({ file, status: "CREATED", bytes: Buffer.byteLength(body) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      if (existing !== body) throw new Error(`MARKET_PRIORITY_EXPORT_WRITE_ONCE_MISMATCH:${file}`);
      files.push({ file, status: "REUSED", bytes: Buffer.byteLength(body) });
    }
  }
  return { root: `var/exports/priority/${MARKET_PRIORITY_EXPORT_DIRECTORY}`, files };
}
