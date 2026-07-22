import { PrismaClient } from "@prisma/client";
import { evaluateHistoricalMarkets } from "../src/application/evaluate-historical-markets";
import { withOfflineNetworkGuard } from "../src/infrastructure/historical-analysis/offline-guard";

function argument(name: "dataset" | "spec") { return process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? process.env[`npm_config_${name}`]; }
async function main() {
  const dataset = argument("dataset"); const specVersion = argument("spec");
  if (!dataset || !specVersion) throw new Error("HISTORICAL_EVALUATION_ARGUMENTS_REQUIRED");
  const prisma = new PrismaClient();
  try { console.log(JSON.stringify(await withOfflineNetworkGuard(() => evaluateHistoricalMarkets(prisma, { dataset, specVersion })), null, 2)); }
  finally { await prisma.$disconnect(); }
}
void main();
