import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { PrismaClient } from "@prisma/client";
import { captureStatarea } from "../src/application/capture-statarea";
import {
  STATAREA_ALLOWED_DATE,
  buildStatareaUrl,
} from "../src/domain/statarea/constants";
import { sha256 } from "../src/infrastructure/forebet/evidence-store";
async function main() {
  const hash =
    process.argv.find((value) => /^[a-f0-9]{64}$/.test(value)) ??
    process.env.STATAREA_EVIDENCE_HASH;
  if (!hash || !/[a-f0-9]{64}/.test(hash)) throw new Error("HASH_REQUIRED");
  const body = await readFile(
    join(
      process.cwd(),
      "var",
      "evidence",
      "statarea",
      STATAREA_ALLOWED_DATE,
      `${hash}.html`,
    ),
  );
  if (sha256(body) !== hash) throw new Error("EVIDENCE_HASH_MISMATCH");
  const url = buildStatareaUrl(STATAREA_ALLOWED_DATE).toString();
  const prisma = new PrismaClient();
  try {
    const report = await captureStatarea(STATAREA_ALLOWED_DATE, {
      prisma,
      fetcher: async () => ({
        requestedUrl: url,
        finalUrl: url,
        hostname: "www.statarea.com",
        capturedAt: new Date(),
        httpStatus: 200,
        contentType: "text/html; charset=UTF-8",
        body,
      }),
    });
    console.log(
      JSON.stringify(
        {
          status: report.captureAttempt.status,
          snapshotId: report.snapshot.id,
          contentHash: report.snapshot.contentHash,
          counts: report.counts,
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}
void main();
