import { PrismaClient } from "@prisma/client";
import { assessMarketPriority } from "../src/application/assess-market-priority";
import { withMarketPriorityOfflineGuard } from "../src/infrastructure/market-priority/offline-guard";

const forbiddenArgument = /^(--)?(url|odds?|available-odds|results?|formula|force|ranking|multi-match|parlay|stake|profit)(=|$)/i;
const forbiddenNpmConfigurations = ["url", "odd", "odds", "available_odds", "result", "results", "formula", "force", "ranking", "multi_match", "multi-match", "parlay", "stake", "profit"];
function argument(name: "dataset" | "policy") {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.split("=").slice(1).join("=") ?? process.env[`npm_config_${name}`];
}

async function main() {
  const supplied = process.argv.slice(2);
  const forbiddenEnvironment = forbiddenNpmConfigurations.find((name) => {
    const value = process.env[`npm_config_${name}`];
    return value !== undefined && value !== "" && value !== "false";
  });
  if (supplied.some((value) => forbiddenArgument.test(value)) || forbiddenEnvironment) throw new Error(`MARKET_PRIORITY_FORBIDDEN_ARGUMENT${forbiddenEnvironment ? `:${forbiddenEnvironment}` : ""}`);
  const unknown = supplied.filter((value) => !value.startsWith("--dataset=") && !value.startsWith("--policy="));
  if (unknown.length) throw new Error(`MARKET_PRIORITY_UNKNOWN_ARGUMENT:${unknown.join(",")}`);
  const dataset = argument("dataset");
  const policyVersion = argument("policy");
  if (!dataset || !policyVersion) throw new Error("MARKET_PRIORITY_ARGUMENTS_REQUIRED");
  const prisma = new PrismaClient();
  try {
    const result = await withMarketPriorityOfflineGuard(() => assessMarketPriority(prisma, { dataset, policyVersion }));
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

void main();
