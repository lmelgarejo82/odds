import { PrismaClient } from "@prisma/client";
import { freezeHistoricalAnalysisSpec } from "../src/application/freeze-historical-analysis-spec";
import { withOfflineNetworkGuard } from "../src/infrastructure/historical-analysis/offline-guard";

async function main() {
  const prisma = new PrismaClient();
  try {
    const result = await withOfflineNetworkGuard(() => freezeHistoricalAnalysisSpec(prisma));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
