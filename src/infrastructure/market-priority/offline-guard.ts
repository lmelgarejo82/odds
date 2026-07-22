import { withOfflineNetworkGuard } from "@/infrastructure/historical-analysis/offline-guard";

export function withMarketPriorityOfflineGuard<T>(operation: () => Promise<T>) {
  return withOfflineNetworkGuard(operation);
}
