export const RUN_CIRCUIT_REASONS = [
  "AUTHENTICATION_REJECTED",
  "QUOTA_EXHAUSTED",
  "DAILY_SAFETY_THRESHOLD_REACHED",
  "MINUTE_LIMIT_EXHAUSTED",
  "RETRYABLE_FAILURE_THRESHOLD_REACHED",
  "INVALID_RATE_LIMIT_HEADERS",
  "AUDIT_PERSISTENCE_FAILURE",
] as const;

export type RunCircuitReason = (typeof RUN_CIRCUIT_REASONS)[number];

export type RunCircuitSnapshot = Readonly<{
  state: "CLOSED" | "OPEN";
  reason?: RunCircuitReason;
  consecutiveRetryableFailures: number;
  maxConsecutiveRetryableFailures: number;
}>;

export class RunCircuitBreaker {
  readonly #maximum: number;
  #state: "CLOSED" | "OPEN" = "CLOSED";
  #reason: RunCircuitReason | undefined;
  #consecutiveRetryableFailures = 0;

  constructor(maxConsecutiveRetryableFailures: number) {
    if (
      !Number.isSafeInteger(maxConsecutiveRetryableFailures) ||
      maxConsecutiveRetryableFailures <= 0
    ) {
      throw new Error("maxConsecutiveRetryableFailures must be a positive safe integer");
    }
    this.#maximum = maxConsecutiveRetryableFailures;
  }

  inspect(): RunCircuitSnapshot {
    return Object.freeze({
      state: this.#state,
      ...(this.#reason === undefined ? {} : { reason: this.#reason }),
      consecutiveRetryableFailures: this.#consecutiveRetryableFailures,
      maxConsecutiveRetryableFailures: this.#maximum,
    });
  }

  open(reason: RunCircuitReason): RunCircuitSnapshot {
    if (this.#state === "CLOSED") {
      this.#state = "OPEN";
      this.#reason = reason;
    }
    return this.inspect();
  }

  recordRetryableFailure(): RunCircuitSnapshot {
    if (this.#state === "CLOSED") {
      this.#consecutiveRetryableFailures += 1;
      if (this.#consecutiveRetryableFailures >= this.#maximum) {
        this.open("RETRYABLE_FAILURE_THRESHOLD_REACHED");
      }
    }
    return this.inspect();
  }

  recordSuccess(): RunCircuitSnapshot {
    if (this.#state === "CLOSED") this.#consecutiveRetryableFailures = 0;
    return this.inspect();
  }

  recordPermanentFailure(): RunCircuitSnapshot {
    return this.inspect();
  }
}
