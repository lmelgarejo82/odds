import { PrismaClient } from "@prisma/client";
import { canonicalHash } from "../src/domain/canonical-hash";

const prisma = new PrismaClient();

const configuration = {
  targetMarket: "TOTAL_GOALS_2_5",
  sources: ["FOREBET", "STATAREA"],
  separateSides: true,
  discovery: { from: "2026-07-01", to: "2026-07-14" },
  validation: { from: "2026-07-15", to: "2026-07-21" },
  priorityComponents: { signal: 40, historicalEvidence: 40, dataQuality: 20 },
  resultsAsserted: false,
};

async function main() {
  const code = "OU25-CROSS-SOURCE-CONSENSUS";
  const version = "0.1.0";
  const configurationJson = JSON.stringify(configuration);
  const configurationHash = canonicalHash(configuration);

  await prisma.researchConfiguration.upsert({
    where: { code_version: { code, version } },
    update: {},
    create: { code, version, status: "DRAFT", active: false, configurationJson, configurationHash },
  });
  await prisma.auditEvent.upsert({
    where: { eventType_entityType_entityId: { eventType: "LAB_INITIALIZED", entityType: "ResearchConfiguration", entityId: `${code}:${version}` } },
    update: {},
    create: { eventType: "LAB_INITIALIZED", entityType: "ResearchConfiguration", entityId: `${code}:${version}`, detailsJson: JSON.stringify({ configurationHash }) },
  });
}

main().finally(async () => prisma.$disconnect());
