import { randomUUID } from "node:crypto";
import { parseSettlementArguments, settlePending } from "@/infrastructure/market-v2/daily/settle-pending";

async function main(): Promise<void> {
  try {
    const args = parseSettlementArguments(process.argv.slice(2));
    const result = await settlePending(args, { apiFootballKey: () => process.env.API_FOOTBALL_KEY, fetchImpl: globalThis.fetch });
    for (const [key, value] of Object.entries({ SETTLEMENT_COMPLETE: true, RUN_ID: result.runId, MODE: result.mode, ELIGIBLE_FIXTURES: result.eligibleFixtures, REQUESTS_BUDGET: result.requestsBudget, REQUESTS_MADE: result.requestsMade, EVIDENCE_CREATED: result.evidenceCreated, OUTCOMES_CREATED: result.outcomesCreated, PENDING_FIXTURES: result.pendingFixtures, NETWORK_USED: result.networkUsed, AUTOMATED_BETTING: false, EXIT: 0 })) console.log(`${key} ${String(value)}`);
  } catch (error) {
    const code = error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message) ? error.message : "SETTLEMENT_FAILED";
    console.error(`RUN_FAILED SETTLEMENT_FAILED`);
    console.error(`CODE ${code}`);
    console.error(`CORRELATION_ID ${randomUUID()}`);
    console.error("EXIT 1");
    process.exitCode = 1;
  } finally {
    delete process.env.API_FOOTBALL_KEY;
  }
}
void main();
