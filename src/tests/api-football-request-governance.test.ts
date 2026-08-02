import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import {
  GovernedRequestExecutor,
  type GovernedClientErrorClassification,
  type GovernedClientResult,
  type GovernedRequestConfiguration,
  type GovernedRequestInput,
} from "@/application/market-v2/api-football/governed-request-executor";
import type {
  ProviderRequestAuditAppendResult,
  ProviderRequestAuditRecord,
  ProviderRequestAuditRepository,
} from "@/domain/market-v2/audit/provider-request-audit-repository";
import {
  evaluateApiFootballRateLimitResponse,
  parseApiFootballRateLimits,
} from "@/infrastructure/market-v2/api-football/rate-limit-parser";
import { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_GOVERNANCE_TEST");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(fetchCalls).toBe(0);
});

class FixedClock {
  calls = 0;

  nowUtc(): string {
    this.calls += 1;
    return `2030-01-01T00:00:0${Math.min(this.calls, 9)}.000Z`;
  }
}

class FakeAuditRepository implements ProviderRequestAuditRepository {
  readonly records: ProviderRequestAuditRecord[] = [];
  readonly events: string[];
  result: ProviderRequestAuditAppendResult = Object.freeze({
    ok: true,
    disposition: "CREATED",
  });
  throws = false;

  constructor(events: string[] = []) {
    this.events = events;
  }

  async append(record: ProviderRequestAuditRecord): Promise<ProviderRequestAuditAppendResult> {
    this.events.push("audit");
    this.records.push(record);
    if (this.throws) throw new Error("SYNTHETIC_AUDIT_FAILURE");
    return this.result;
  }
}

const input: GovernedRequestInput = Object.freeze({
  providerKey: "api-football",
  endpointKey: "prediction-by-fixture",
  requestKeyHash: "a".repeat(64),
  correlationId: "synthetic-correlation-1",
});

const defaultConfiguration: GovernedRequestConfiguration = Object.freeze({
  maxAttempts: 4,
  maxRetries: 2,
  dailySafetyThreshold: 20,
  requireDailyRemaining: false,
  requireMinuteRemaining: false,
  maxConsecutiveRetryableFailures: 4,
});

function metadata(overrides: Readonly<{
  requestsLimit?: string | null;
  requestsRemaining?: string | null;
  limit?: string | null;
  remaining?: string | null;
  retryAfterRaw?: string | null;
}> = {}) {
  return Object.freeze({
    httpStatus: 200,
    rateLimitHeaders: Object.freeze({
      requestsLimit: overrides.requestsLimit ?? null,
      requestsRemaining: overrides.requestsRemaining ?? null,
      limit: overrides.limit ?? null,
      remaining: overrides.remaining ?? null,
    }),
    retryAfterRaw: overrides.retryAfterRaw ?? null,
  });
}

function success<T>(
  payload: T,
  overrides: Parameters<typeof metadata>[0] = {},
): GovernedClientResult<T> {
  return Object.freeze({ ok: true, payload, metadata: metadata(overrides) });
}

function failure(
  classification: GovernedClientErrorClassification,
  options: Readonly<{
    retryable?: boolean;
    httpStatus?: number;
    responseMetadata?: ReturnType<typeof metadata>;
  }> = {},
): GovernedClientResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({
      classification,
      retryable: options.retryable ?? false,
      ...(options.httpStatus === undefined ? {} : { httpStatus: options.httpStatus }),
      sanitizedCode: `SYNTHETIC_${classification}`,
    }),
    ...(options.responseMetadata === undefined ? {} : { metadata: options.responseMetadata }),
  });
}

function harness(configuration: Partial<GovernedRequestConfiguration> = {}) {
  const config = Object.freeze({ ...defaultConfiguration, ...configuration });
  const budget = new RequestBudget(config.maxAttempts);
  const circuitBreaker = new RunCircuitBreaker(config.maxConsecutiveRetryableFailures);
  const auditRepository = new FakeAuditRepository();
  const sleeper = new FakeSleeper();
  const clock = new FixedClock();
  const executor = new GovernedRequestExecutor({
    budget,
    circuitBreaker,
    auditRepository,
    sleeper,
    clock,
    retryPolicy: new RetryPolicy({
      maxAttempts: config.maxRetries + 1,
      baseDelayMilliseconds: 10,
      maximumDelayMilliseconds: 1_000,
    }),
    rateLimits: Object.freeze({
      parse: parseApiFootballRateLimits,
      evaluateResponse: evaluateApiFootballRateLimitResponse,
    }),
  }, config);
  return { executor, budget, circuitBreaker, auditRepository, sleeper, clock };
}

describe("RequestBudget mandatory attempt accounting", () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY])(
    "rejects invalid maxAttempts %s",
    (maximum) => expect(() => new RequestBudget(maximum)).toThrow(/positive safe integer/u),
  );

  it("reserves, commits, and exposes coherent counters", () => {
    const budget = new RequestBudget(2);
    const reserved = budget.reserve();
    expect(reserved.disposition).toBe("RESERVED");
    expect(budget.inspect()).toEqual({
      maxAttempts: 2,
      reservedAttempts: 1,
      startedAttempts: 0,
      remainingAttempts: 1,
    });
    if (reserved.disposition !== "RESERVED") throw new Error("reservation required");
    expect(budget.commit(reserved.reservation)).toEqual({
      disposition: "RESERVED",
      attemptNumber: 1,
    });
    expect(budget.inspect()).toEqual({
      maxAttempts: 2,
      reservedAttempts: 0,
      startedAttempts: 1,
      remainingAttempts: 1,
    });
  });

  it("releases only a reservation whose transport never started", () => {
    const budget = new RequestBudget(2);
    const first = budget.reserve();
    const second = budget.reserve();
    expect(first.disposition).toBe("RESERVED");
    expect(second.disposition).toBe("RESERVED");
    if (first.disposition !== "RESERVED" || second.disposition !== "RESERVED") {
      throw new Error("reservations required");
    }
    expect(budget.release(first.reservation).disposition).toBe("RESERVED");
    expect(budget.commit(second.reservation).disposition).toBe("RESERVED");
    expect(budget.release(second.reservation).disposition).toBe("INVALID_STATE");
    expect(budget.release(first.reservation).disposition).toBe("INVALID_STATE");
    expect(budget.inspect()).toMatchObject({
      reservedAttempts: 0,
      startedAttempts: 1,
      remainingAttempts: 1,
    });
  });

  it("never exceeds its finite budget", () => {
    const budget = new RequestBudget(1);
    const reservation = budget.reserve();
    if (reservation.disposition !== "RESERVED") throw new Error("reservation required");
    budget.commit(reservation.reservation);
    expect(budget.reserve().disposition).toBe("EXHAUSTED");
    expect(budget.inspect().remainingAttempts).toBe(0);
  });
});

describe("RunCircuitBreaker local one-way state", () => {
  it("starts CLOSED and validates its retryable threshold", () => {
    expect(new RunCircuitBreaker(2).inspect()).toMatchObject({
      state: "CLOSED",
      consecutiveRetryableFailures: 0,
    });
    expect(() => new RunCircuitBreaker(0)).toThrow(/positive safe integer/u);
  });

  it.each([
    "AUTHENTICATION_REJECTED",
    "QUOTA_EXHAUSTED",
    "DAILY_SAFETY_THRESHOLD_REACHED",
    "MINUTE_LIMIT_EXHAUSTED",
    "INVALID_RATE_LIMIT_HEADERS",
    "AUDIT_PERSISTENCE_FAILURE",
  ] as const)("opens immediately for %s and never closes", (reason) => {
    const breaker = new RunCircuitBreaker(3);
    breaker.open(reason);
    breaker.recordSuccess();
    breaker.open("QUOTA_EXHAUSTED");
    expect(breaker.inspect()).toMatchObject({ state: "OPEN", reason });
  });

  it("opens at consecutive retryable threshold and success resets while CLOSED", () => {
    const breaker = new RunCircuitBreaker(2);
    breaker.recordRetryableFailure();
    breaker.recordSuccess();
    expect(breaker.inspect().consecutiveRetryableFailures).toBe(0);
    breaker.recordRetryableFailure();
    breaker.recordRetryableFailure();
    expect(breaker.inspect()).toMatchObject({
      state: "OPEN",
      reason: "RETRYABLE_FAILURE_THRESHOLD_REACHED",
      consecutiveRetryableFailures: 2,
    });
  });

  it("normal permanent failure does not count as retryable", () => {
    const breaker = new RunCircuitBreaker(1);
    breaker.recordPermanentFailure();
    expect(breaker.inspect()).toMatchObject({
      state: "CLOSED",
      consecutiveRetryableFailures: 0,
    });
  });
});

describe("GovernedRequestExecutor per-attempt governance", () => {
  it("uses one attempt, audits after the operation, and returns a sanitized success", async () => {
    const context = harness();
    const events = context.auditRepository.events;
    const result = await context.executor.execute(input, async () => {
      events.push("operation");
      return success(Object.freeze({ fixtureCount: 1 }), { requestsRemaining: "20" });
    });
    expect(result).toMatchObject({
      status: "SUCCESS",
      attemptsUsed: 1,
      remainingBudget: 3,
      circuitState: "CLOSED",
      classification: "SUCCESS",
      retryable: false,
    });
    expect(events).toEqual(["operation", "audit"]);
    expect(context.auditRepository.records[0]).toMatchObject({
      endpointKey: "prediction-by-fixture",
      attemptNumber: 1,
      classification: "SUCCESS",
      dailyRemaining: 20,
    });
    expect(Object.keys(context.auditRepository.records[0])).not.toEqual(
      expect.arrayContaining(["apiKey", "headers", "body", "authorization", "cookie"]),
    );
  });

  it.each([
    "AUTHENTICATION_REJECTED",
    "HTTP_PERMANENT_FAILURE",
    "REDIRECT_BLOCKED",
    "INVALID_REQUEST",
    "INVALID_JSON",
    "INVALID_ENVELOPE",
    "API_ERRORS_PRESENT",
    "RESPONSE_TOO_LARGE",
  ] as const)("does not retry terminal client classification %s", async (classification) => {
    const context = harness();
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return failure(classification, { httpStatus: classification === "AUTHENTICATION_REJECTED" ? 401 : 400 });
    });
    expect(result.status).toBe("FAILED");
    expect(calls).toBe(1);
    expect(context.auditRepository.records).toHaveLength(1);
    expect(context.sleeper.delays).toEqual([]);
    if (classification === "AUTHENTICATION_REJECTED") {
      expect(context.circuitBreaker.inspect()).toMatchObject({
        state: "OPEN",
        reason: "AUTHENTICATION_REJECTED",
      });
    }
  });

  it.each(["TIMEOUT", "NETWORK_FAILURE", "HTTP_RETRYABLE_FAILURE"] as const)(
    "retries %s through the existing policy and injected Sleeper",
    async (classification) => {
      const context = harness();
      let calls = 0;
      const result = await context.executor.execute(input, async () => {
        calls += 1;
        return calls === 1
          ? failure(classification, { retryable: true, httpStatus: 500 })
          : success("synthetic-ok", { requestsRemaining: "20" });
      });
      expect(result.status).toBe("SUCCESS");
      expect(calls).toBe(2);
      expect(context.sleeper.delays).toEqual([10]);
      expect(context.auditRepository.records.map((record) => record.attemptNumber)).toEqual([1, 2]);
      expect(context.budget.inspect()).toMatchObject({ startedAttempts: 2, remainingAttempts: 2 });
    },
  );

  it("bounds retries by explicit maximum", async () => {
    const context = harness({ maxRetries: 1 });
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return failure("TIMEOUT", { retryable: true });
    });
    expect(result.status).toBe("FAILED");
    expect(calls).toBe(2);
    expect(context.auditRepository.records).toHaveLength(2);
    expect(context.sleeper.delays).toEqual([10]);
  });

  it("does not sleep or invoke transport when retry budget is exhausted", async () => {
    const context = harness({ maxAttempts: 1, maxRetries: 2 });
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return failure("NETWORK_FAILURE", { retryable: true });
    });
    expect(result.status).toBe("BUDGET_EXHAUSTED");
    expect(calls).toBe(1);
    expect(context.sleeper.delays).toEqual([]);
  });

  it("requires valid Retry-After seconds before retrying 429", async () => {
    const withoutRetryAfter = harness();
    let absentCalls = 0;
    const absentResult = await withoutRetryAfter.executor.execute(input, async () => {
      absentCalls += 1;
      return failure("RATE_LIMITED", { retryable: true, httpStatus: 429 });
    });
    expect(absentResult.status).toBe("FAILED");
    expect(absentCalls).toBe(1);
    expect(withoutRetryAfter.sleeper.delays).toEqual([]);

    const withRetryAfter = harness();
    let validCalls = 0;
    const validResult = await withRetryAfter.executor.execute(input, async () => {
      validCalls += 1;
      return validCalls === 1
        ? failure("RATE_LIMITED", {
            retryable: true,
            httpStatus: 429,
            responseMetadata: metadata({ retryAfterRaw: "2" }),
          })
        : success("synthetic-ok", { requestsRemaining: "20" });
    });
    expect(validResult.status).toBe("SUCCESS");
    expect(validCalls).toBe(2);
    expect(withRetryAfter.sleeper.delays).toEqual([2_000]);
  });

  it("accepts audit replay and blocks audit conflict or failure", async () => {
    const replay = harness();
    replay.auditRepository.result = Object.freeze({ ok: true, disposition: "REPLAYED" });
    expect((await replay.executor.execute(input, async () => success("ok"))).status).toBe(
      "SUCCESS",
    );

    for (const mode of ["CONFLICT", "FAILED", "THROW"] as const) {
      const context = harness();
      if (mode === "THROW") context.auditRepository.throws = true;
      else {
        context.auditRepository.result = Object.freeze({
          ok: false,
          disposition: mode,
          error: Object.freeze({
            classification: mode,
            retryable: false,
            sanitizedCode: `SYNTHETIC_AUDIT_${mode}`,
          }),
        });
      }
      const result = await context.executor.execute(input, async () => success("ok"));
      expect(result).toMatchObject({
        status: "AUDIT_FAILED",
        circuitState: "OPEN",
        circuitReason: "AUDIT_PERSISTENCE_FAILURE",
      });
    }
  });

  it("prevents transport when budget is already exhausted", async () => {
    const context = harness({ maxAttempts: 1 });
    const reservation = context.budget.reserve();
    if (reservation.disposition !== "RESERVED") throw new Error("reservation required");
    context.budget.commit(reservation.reservation);
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return success("unexpected");
    });
    expect(result.status).toBe("BUDGET_EXHAUSTED");
    expect(calls).toBe(0);
  });

  it("prevents transport when circuit is already OPEN", async () => {
    const context = harness();
    context.circuitBreaker.open("QUOTA_EXHAUSTED");
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return success("unexpected");
    });
    expect(result.status).toBe("CIRCUIT_OPEN");
    expect(calls).toBe(0);
    expect(context.budget.inspect().startedAttempts).toBe(0);
  });

  it("does not consume budget for failed local validation", async () => {
    const context = harness();
    let calls = 0;
    const result = await context.executor.execute({ ...input, requestKeyHash: "invalid" }, async () => {
      calls += 1;
      return success("unexpected");
    });
    expect(result).toMatchObject({ status: "FAILED", classification: "INVALID_REQUEST" });
    expect(calls).toBe(0);
    expect(context.budget.inspect().startedAttempts).toBe(0);
  });

  it.each([
    ["19", null, "DAILY_SAFETY_THRESHOLD_REACHED", "SUCCESS"],
    ["0", null, "QUOTA_EXHAUSTED", "QUOTA_EXHAUSTED"],
    ["20", "0", "MINUTE_LIMIT_EXHAUSTED", "SUCCESS"],
  ] as const)(
    "preserves a successful response then blocks the run for daily=%s minute=%s",
    async (dailyRemaining, minuteRemaining, reason, auditClassification) => {
      const context = harness();
      const result = await context.executor.execute(input, async () => success(
        Object.freeze({ retained: true }),
        { requestsRemaining: dailyRemaining, remaining: minuteRemaining },
      ));
      expect(result).toMatchObject({
        status: "SUCCESS_RUN_BLOCKED",
        value: { retained: true },
        circuitReason: reason,
      });
      expect(context.auditRepository.records[0].classification).toBe(auditClassification);
    },
  );

  it("keeps dailyRemaining 20 open", async () => {
    const context = harness();
    const result = await context.executor.execute(input, async () =>
      success("ok", { requestsRemaining: "20" }));
    expect(result).toMatchObject({ status: "SUCCESS", circuitState: "CLOSED" });
  });

  it("blocks invalid or required-absent headers without retry", async () => {
    const invalid = harness();
    const invalidResult = await invalid.executor.execute(input, async () =>
      success("not-retained", { requestsRemaining: "invalid" }));
    expect(invalidResult).toMatchObject({
      status: "FAILED",
      circuitReason: "INVALID_RATE_LIMIT_HEADERS",
    });
    expect(invalid.auditRepository.records[0]).toMatchObject({
      classification: "INVALID_RESPONSE",
      dailyRemaining: null,
    });

    const required = harness({ requireDailyRemaining: true });
    const requiredResult = await required.executor.execute(input, async () =>
      success("not-retained"));
    expect(requiredResult).toMatchObject({
      status: "FAILED",
      circuitReason: "INVALID_RATE_LIMIT_HEADERS",
    });
  });

  it("opens at consecutive retryable threshold and performs no extra attempt", async () => {
    const context = harness({ maxConsecutiveRetryableFailures: 2, maxRetries: 3 });
    let calls = 0;
    const result = await context.executor.execute(input, async () => {
      calls += 1;
      return failure("TIMEOUT", { retryable: true });
    });
    expect(result).toMatchObject({
      status: "FAILED",
      circuitReason: "RETRYABLE_FAILURE_THRESHOLD_REACHED",
    });
    expect(calls).toBe(2);
    expect(context.auditRepository.records).toHaveLength(2);
  });

  it("does not expose evidence, full headers, credentials, or raw errors", async () => {
    const context = harness();
    const credentialMarker = "synthetic-secret-marker";
    const result = await context.executor.execute(input, async () => Object.freeze({
      ...success(Object.freeze({ retained: true }), { requestsRemaining: "20" }),
      evidenceCandidate: Object.freeze({ rawBytes: credentialMarker }),
      fullHeaders: Object.freeze({ authorization: credentialMarker }),
    }));
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("evidenceCandidate");
    expect(serialized).not.toContain("fullHeaders");
    expect(serialized).not.toContain(credentialMarker);
  });

  it("uses only injected operation, clock, sleeper, and repositories", () => {
    const source = String(GovernedRequestExecutor);
    expect(source).not.toContain("globalThis.fetch");
    expect(source).not.toContain("Date.now");
    expect(source).not.toContain("Prisma");
    expect(source).not.toContain("readFile");
    expect(fetchCalls).toBe(0);
  });
});
