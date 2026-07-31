import { createHash } from "node:crypto";
import type { CaptureError } from "@/domain/market-v2/capture/errors";

export interface Sleeper {
  sleep(milliseconds: number): Promise<void>;
}

export class FakeSleeper implements Sleeper {
  readonly delays: number[] = [];

  async sleep(milliseconds: number): Promise<void> {
    this.delays.push(milliseconds);
  }
}

export type RetryPolicyOptions = Readonly<{
  maxAttempts: number;
  baseDelayMilliseconds: number;
  maximumDelayMilliseconds: number;
  jitterMilliseconds?: number;
  jitterSeed?: string;
}>;

export class RetryPolicy {
  readonly options: RetryPolicyOptions;

  constructor(options: RetryPolicyOptions) {
    if (options.maxAttempts < 1) throw new Error("maxAttempts must be positive");
    if (options.baseDelayMilliseconds < 0 || options.maximumDelayMilliseconds < 0) {
      throw new Error("retry delays must be non-negative");
    }
    this.options = Object.freeze({ ...options });
  }

  shouldRetry(error: CaptureError, attemptNumber: number): boolean {
    return error.retryable && attemptNumber < this.options.maxAttempts;
  }

  delayForAttempt(attemptNumber: number): number {
    const exponential = Math.min(
      this.options.maximumDelayMilliseconds,
      this.options.baseDelayMilliseconds * 2 ** Math.max(0, attemptNumber - 1),
    );
    const jitterMaximum = this.options.jitterMilliseconds ?? 0;
    if (jitterMaximum === 0) return exponential;
    const seed = `${this.options.jitterSeed ?? "explicit-zero-seed"}:${attemptNumber}`;
    const sample = createHash("sha256").update(seed).digest().readUInt32BE(0);
    return Math.min(
      this.options.maximumDelayMilliseconds,
      exponential + (sample % (jitterMaximum + 1)),
    );
  }
}
