process.env.DATABASE_URL ??= "file:./dev.db";

import { PrismaClient } from "@prisma/client";
import { runProspectiveShadow } from "../src/application/run-prospective-shadow";

const argumentsList = process.argv.slice(2);
const unsupported = argumentsList.filter((value) => !/^--date=\d{4}-\d{2}-\d{2}$/.test(value));
const dateArguments = argumentsList.filter((value) => value.startsWith("--date="));

async function main() {
  if (unsupported.length || dateArguments.length > 1) throw new Error(`PROSPECTIVE_ARGUMENT_NOT_ALLOWED:${unsupported.join(",") || "DUPLICATE_DATE"}`);
  const date = dateArguments[0]?.slice(7) ?? process.env.npm_config_date;
  if (!date) throw new Error("Uso: npm run run:prospective-shadow -- --date=2026-07-23");
  const prisma = new PrismaClient();
  try {
    const result = await runProspectiveShadow(date, { prisma });
    console.log(JSON.stringify({ executionStatus: result.executionStatus, prospectiveRunId: result.prospectiveRunId, runHash: result.runDocument.run.runHash, frozenAt: result.runDocument.run.frozenAt, counts: result.counts, networkRequests: result.networkRequests, outcomeReads: result.outcomeReads, quoteCaptures: result.quoteCaptures, exports: result.exports }, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => {
  console.error(`Ejecución prospectiva detenida: ${error instanceof Error ? error.message : "UNKNOWN_ERROR"}`);
  process.exitCode = 1;
});
