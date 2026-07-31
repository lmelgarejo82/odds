import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";
import type {
  CaptureClock,
  CaptureRunContext,
  MarketKey,
  UniverseSpecification,
} from "@/domain/market-v2/capture/types";
import type { CaptureStage } from "@/domain/market-v2/capture/stages";

export class FixedCaptureClock implements CaptureClock {
  constructor(readonly fixedUtc: string) {
    if (!isNormalizedUtcTimestamp(fixedUtc)) throw new Error("fixed clock requires UTC Z");
  }

  nowUtc(): string {
    return this.fixedUtc;
  }
}

export function createCaptureRunContext(input: Readonly<{
  runId: string;
  protocolVersion: string;
  stage: CaptureStage;
  generatedAtUtc: string;
  universeSpecification: UniverseSpecification;
  providerKey: string;
  providerVersion: string;
  attemptNumber?: number;
  allowedCompetitionKeys: readonly string[];
  requestedMarkets: readonly MarketKey[];
  requestedBookmakers: readonly string[];
  cutoffAtUtc?: string;
  synthetic: boolean;
  correlationId: string;
  policyVersion: string;
}>): CaptureRunContext {
  if (!isNormalizedUtcTimestamp(input.generatedAtUtc)) {
    throw new Error("generatedAtUtc requires UTC Z");
  }
  if (input.cutoffAtUtc !== undefined && !isNormalizedUtcTimestamp(input.cutoffAtUtc)) {
    throw new Error("cutoffAtUtc requires UTC Z");
  }
  if (!input.synthetic) throw new Error("capture foundation accepts synthetic contexts only");
  return Object.freeze({
    ...input,
    attemptNumber: input.attemptNumber ?? 1,
    allowedCompetitionKeys: Object.freeze([...input.allowedCompetitionKeys]),
    requestedMarkets: Object.freeze([...input.requestedMarkets]),
    requestedBookmakers: Object.freeze([...input.requestedBookmakers]),
    universeSpecification: Object.freeze(input.universeSpecification),
  });
}

export function contextWithAttempt(
  context: CaptureRunContext,
  attemptNumber: number,
): CaptureRunContext {
  return Object.freeze({ ...context, attemptNumber });
}
