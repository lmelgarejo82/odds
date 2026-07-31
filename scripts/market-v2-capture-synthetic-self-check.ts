import { runSyntheticCaptureSelfCheck } from "@/application/market-v2/capture/synthetic-self-check";

async function main(): Promise<void> {
  const summary = await runSyntheticCaptureSelfCheck();
  console.log(JSON.stringify(summary));
  console.log("SYNTHETIC_CAPTURE_ONLY");
  console.log("NO_NETWORK_USED");
  console.log("NO_REAL_PROVIDER_ACCESSED");
  console.log("NO_OPERATIONAL_DATABASE_WRITTEN");
  console.log("NO_REAL_PERFORMANCE_CLAIM");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "synthetic capture self-check failed");
  process.exitCode = 1;
});
