import {
  ApiFootballRunnerError,
  loadApiFootballTargets,
  parseApiFootballRunnerArguments,
  runApiFootball,
} from "@/infrastructure/market-v2/api-football/runtime";

async function main(): Promise<void> {
  try {
    const args = parseApiFootballRunnerArguments(process.argv.slice(2));
    const targets = await loadApiFootballTargets(args.targetFile);
    const result = await runApiFootball(args, targets, {
      apiKeyProvider: () => process.env.API_FOOTBALL_KEY,
      networkFetch: globalThis.fetch,
    });
    const fields = [
      ["RUN_COMPLETE", result.complete],
      ["MODE", result.mode],
      ["TARGETS", result.targetCount],
      ["TARGET_RESULTS", result.targetResults.join(",")],
      ["ATTEMPTS_USED", result.attemptsUsed],
      ["ATTEMPTS_REMAINING", result.attemptsRemaining],
      ["CIRCUIT_STATE", result.circuitState],
      ["EVIDENCE_CREATED", result.evidenceCreated],
      ["FIXTURES_CREATED", result.fixturesCreated],
      ["PREDICTIONS_CREATED", result.predictionsCreated],
      ["OUTCOMES_CREATED", result.outcomesCreated],
      ["REPLAYED", result.replayed],
      ["CONFLICTS", result.conflicts],
      ["DATABASE_URL_REDACTED", result.databaseUrlRedacted],
      ["EVIDENCE_ROOT", result.evidenceRootRedacted],
      ["NETWORK_USED", result.networkUsed],
      ["EXIT", result.exitCode],
    ] as const;
    for (const [key, value] of fields) console.log(`${key} ${String(value)}`);
    process.exitCode = result.exitCode;
  } catch (error) {
    const code = error instanceof ApiFootballRunnerError
      ? error.sanitizedCode
      : "RUNNER_FAILED";
    console.error(`RUN_FAILED ${code}`);
    console.error("EXIT 1");
    process.exitCode = 1;
  }
}

void main();
