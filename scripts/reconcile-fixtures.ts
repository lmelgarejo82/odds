process.env.DATABASE_URL ??= "file:./dev.db";
export {};
const dateArgument = process.argv.find((value) => value.startsWith("--date="))?.slice(7) ?? process.env.npm_config_date;
if (!dateArgument) throw new Error("Use --date=YYYY-MM-DD");
async function main() {
  const { reconcileFixtures } = await import("../src/application/reconcile-fixtures");
  const { database } = await import("../src/infrastructure/database");
  try { const result = await reconcileFixtures(dateArgument!); console.log(JSON.stringify({ primarySnapshotId: result.primarySnapshotId, configurationHash: result.configurationHash, reused: result.reused, runs: result.runs.map((run) => ({ id: run.id, type: run.runType, forebetInput: run.forebetInputCount, statareaInput: run.statareaInputCount, matched: run.matchedCount, ambiguous: run.ambiguousCount, onlyForebet: run.onlyForebetCount, onlyStatarea: run.onlyStatareaCount, conflict: run.conflictCount, exact: run.exactCount, conservative: run.conservativeCount, approximate: run.approximateCount })), stability: result.stability }, null, 2)); } finally { await database.$disconnect(); }
}
void main();
