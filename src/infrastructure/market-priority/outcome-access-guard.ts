import type { PrismaClient } from "@prisma/client";

const forbiddenProperties = new Set<PropertyKey>([
  "fixtureOutcome",
  "outcomeEvidence",
  "matchResult",
  "dailyRanking",
  "dailyRankedCandidate",
  "trackedObservation",
  "$queryRaw",
  "$queryRawUnsafe",
  "$executeRaw",
  "$executeRawUnsafe",
]);

export function createOutcomeAccessGuard(prisma: PrismaClient) {
  let blockedAccessAttempts = 0;
  const client = new Proxy(prisma, {
    get(target, property, receiver) {
      if (forbiddenProperties.has(property)) {
        blockedAccessAttempts += 1;
        throw new Error(`MARKET_PRIORITY_PROHIBITED_DATA_ACCESS:${String(property)}`);
      }
      const value = Reflect.get(target, property, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as PrismaClient;
  return { client, getBlockedAccessAttempts: () => blockedAccessAttempts };
}
