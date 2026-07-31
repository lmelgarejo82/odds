import type { ProviderCapability } from "@/domain/market-v2/capture/stages";
import type { CaptureClock } from "@/domain/market-v2/capture/types";

export type RateLimitResult = Readonly<{
  allowed: boolean;
  recommendedDelayMilliseconds: number;
  reasonCode: string;
}>;

export interface RateLimitPolicy {
  acquire(
    providerKey: string,
    capability: ProviderCapability,
    clock: CaptureClock,
  ): RateLimitResult;
}

export class AllowAllRateLimitPolicy implements RateLimitPolicy {
  acquire(
    _providerKey: string,
    _capability: ProviderCapability,
    clock: CaptureClock,
  ): RateLimitResult {
    clock.nowUtc();
    return Object.freeze({
      allowed: true,
      recommendedDelayMilliseconds: 0,
      reasonCode: "SYNTHETIC_RATE_LIMIT_ALLOWED",
    });
  }
}

export class BlockingRateLimitPolicy implements RateLimitPolicy {
  constructor(readonly delayMilliseconds: number) {}

  acquire(
    _providerKey: string,
    _capability: ProviderCapability,
    clock: CaptureClock,
  ): RateLimitResult {
    clock.nowUtc();
    return Object.freeze({
      allowed: false,
      recommendedDelayMilliseconds: this.delayMilliseconds,
      reasonCode: "SYNTHETIC_RATE_LIMIT_BLOCKED",
    });
  }
}
