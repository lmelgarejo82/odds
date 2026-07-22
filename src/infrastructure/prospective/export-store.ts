import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { canonicalJson } from "@/domain/canonical-json";
import { PROSPECTIVE_EXPORT_FILES, PROSPECTIVE_EXPORT_ROOT } from "@/domain/prospective/constants";

export function prospectiveExportRoot() {
  return join(process.cwd(), ...PROSPECTIVE_EXPORT_ROOT.split("/"));
}

export async function preserveProspectiveExports(bundle: Record<(typeof PROSPECTIVE_EXPORT_FILES)[number], unknown>) {
  const root = prospectiveExportRoot();
  await mkdir(root, { recursive: true });
  const files: Array<{ file: string; status: "CREATED" | "REUSED"; bytes: number }> = [];
  for (const file of PROSPECTIVE_EXPORT_FILES) {
    if (!(file in bundle)) throw new Error(`PROSPECTIVE_EXPORT_MISSING:${file}`);
    const body = `${canonicalJson(bundle[file])}\n`;
    const path = join(root, file);
    try {
      await writeFile(path, body, { encoding: "utf8", flag: "wx" });
      files.push({ file, status: "CREATED", bytes: Buffer.byteLength(body) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await readFile(path, "utf8");
      if (existing !== body) throw new Error(`PROSPECTIVE_EXPORT_WRITE_ONCE_MISMATCH:${file}`);
      files.push({ file, status: "REUSED", bytes: Buffer.byteLength(body) });
    }
  }
  return { root: PROSPECTIVE_EXPORT_ROOT, files };
}
