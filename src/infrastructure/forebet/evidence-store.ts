import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export function sha256(content: Buffer | string): string { return createHash("sha256").update(content).digest("hex"); }

export async function preserveEvidence(date: string, body: Buffer): Promise<{ hash: string; relativePath: string; reused: boolean }> {
  return preserveSourceEvidence("forebet", date, body);
}

export async function preserveSourceEvidence(source: "forebet" | "statarea", date: string, body: Buffer): Promise<{ hash: string; relativePath: string; reused: boolean }> {
  const hash = sha256(body);
  const absolute = join(process.cwd(), "var", "evidence", source, date, `${hash}.html`);
  await mkdir(dirname(absolute), { recursive: true });
  let reused = false;
  try { await writeFile(absolute, body, { flag: "wx" }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    reused = true;
  }
  const stored = await readFile(absolute);
  if (sha256(stored) !== hash) throw new Error("EVIDENCE_HASH_MISMATCH");
  return { hash, relativePath: relative(process.cwd(), absolute).replaceAll("\\", "/"), reused };
}
