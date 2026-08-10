import { deriveIntelligentOneXRun } from "@/infrastructure/market-v2/daily/derive-intelligent-one-x";

const values = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index];
  const value = process.argv[index + 1];
  if (!key || !value) throw new Error("ARGUMENT_INVALID");
  values.set(key, value);
}
const databaseUrl = values.get("--database-url");
const sourceRunId = values.get("--source-run");
if (!databaseUrl?.startsWith("file:/") || !sourceRunId) throw new Error("ARGUMENT_INVALID");

deriveIntelligentOneXRun(databaseUrl, sourceRunId)
  .then((result) => {
    for (const [key, value] of Object.entries(result)) console.log(`${key.replace(/[A-Z]/gu, (letter) => `_${letter}`).toUpperCase()} ${String(value)}`);
    console.log("API_FOOTBALL_REQUESTS 0");
    console.log("ODDS_REQUESTS 0");
    console.log("AUTOMATED_BETTING false");
    console.log("EXIT 0");
  })
  .catch((error: unknown) => {
    console.error(`INTELLIGENT_ONE_X_REPLAY_FAILED ${error instanceof Error ? error.message : "UNKNOWN"}`);
    console.error("EXIT 1");
    process.exitCode = 1;
  });
