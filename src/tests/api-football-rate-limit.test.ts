import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  evaluateApiFootballRateLimitResponse,
  evaluateApiFootballRateLimitsForNextRequest,
  parseApiFootballRateLimits,
  type ApiFootballRateLimitRawInput,
} from "@/infrastructure/market-v2/api-football/rate-limit-parser";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_RATE_LIMIT_TEST");
  }) as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(fetchCalls).toBe(0);
});

function raw(overrides: Partial<ApiFootballRateLimitRawInput> = {}): ApiFootballRateLimitRawInput {
  return Object.freeze({
    requestsLimit: null,
    requestsRemaining: null,
    limit: null,
    remaining: null,
    retryAfterRaw: null,
    ...overrides,
  });
}

const optionalHeaders = Object.freeze({
  dailySafetyThreshold: 20,
  requireDailyRemaining: false,
  requireMinuteRemaining: false,
});

describe("API-Football defensive rate-limit parser", () => {
  it("represents total absence without inventing a plan or values", () => {
    const result = parseApiFootballRateLimits(raw());
    expect(result).toMatchObject({
      state: "ABSENT",
      dailyLimit: null,
      dailyRemaining: null,
      minuteLimit: null,
      minuteRemaining: null,
      retryAfterSeconds: null,
    });
    expect(JSON.stringify(result)).not.toContain("100");
  });

  it("accepts decimal integers, exterior whitespace, and zero", () => {
    expect(parseApiFootballRateLimits(raw({
      requestsLimit: " 250 ",
      requestsRemaining: "020",
      limit: "60",
      remaining: "0",
    }))).toMatchObject({
      state: "VALID",
      dailyLimit: 250,
      dailyRemaining: 20,
      minuteLimit: 60,
      minuteRemaining: 0,
    });
  });

  it.each(["-1", "1.5", "1e2", "+1", "Infinity", "NaN", "12 seconds", "word"])(
    "rejects a non-strict decimal value: %s",
    (value) => {
      expect(parseApiFootballRateLimits(raw({ requestsRemaining: value }))).toMatchObject({
        state: "INVALID",
        sanitizedErrorCode: "RATE_LIMIT_VALUE_INVALID",
      });
    },
  );

  it("rejects safe-integer overflow", () => {
    expect(parseApiFootballRateLimits(raw({
      requestsRemaining: String(Number.MAX_SAFE_INTEGER + 1),
    })).state).toBe("INVALID");
  });

  it("rejects remaining greater than its corresponding limit", () => {
    expect(parseApiFootballRateLimits(raw({
      requestsLimit: "20",
      requestsRemaining: "21",
    }))).toMatchObject({
      state: "INVALID",
      sanitizedErrorCode: "RATE_LIMIT_RELATION_INVALID",
    });
    expect(parseApiFootballRateLimits(raw({ limit: "3", remaining: "4" })).state).toBe(
      "INVALID",
    );
  });

  it("preserves remaining when limit is absent without inferring a limit", () => {
    expect(parseApiFootballRateLimits(raw({ requestsRemaining: "19" }))).toMatchObject({
      state: "VALID",
      dailyLimit: null,
      dailyRemaining: 19,
    });
  });

  it("interprets Retry-After only as integer seconds", () => {
    expect(parseApiFootballRateLimits(raw({ retryAfterRaw: " 12 " }))).toMatchObject({
      state: "VALID",
      retryAfterSeconds: 12,
    });
    expect(parseApiFootballRateLimits(raw({
      retryAfterRaw: "Wed, 21 Oct 2030 07:28:00 GMT",
    })).state).toBe("INVALID");
    expect(parseApiFootballRateLimits(raw({ retryAfterRaw: "1.5" })).state).toBe("INVALID");
  });

  it("returns sanitized errors without echoing the raw value", () => {
    const sensitiveMarker = "raw-sensitive-marker-with-units";
    const result = parseApiFootballRateLimits(raw({ requestsRemaining: sensitiveMarker }));
    expect(JSON.stringify(result)).not.toContain(sensitiveMarker);
  });

  it("does not use permissive parseFloat coercion", () => {
    expect(String(parseApiFootballRateLimits)).not.toContain("parseFloat");
    expect(parseApiFootballRateLimits(raw({ requestsRemaining: "20units" })).state).toBe(
      "INVALID",
    );
  });
});

describe("API-Football configurable R0 rate-limit safety", () => {
  it("keeps the threshold explicit and configurable", () => {
    const parsed = parseApiFootballRateLimits(raw({ requestsRemaining: "7" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, {
      ...optionalHeaders,
      dailySafetyThreshold: 7,
    }).outcome).toBe("ALLOW");
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, {
      ...optionalHeaders,
      dailySafetyThreshold: 8,
    }).outcome).toBe("BLOCK_DAILY_THRESHOLD");
  });

  it("allows dailyRemaining 20 and blocks 19 under R0", () => {
    const atThreshold = parseApiFootballRateLimits(raw({ requestsRemaining: "20" }));
    const belowThreshold = parseApiFootballRateLimits(raw({ requestsRemaining: "19" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(atThreshold, optionalHeaders).outcome)
      .toBe("ALLOW");
    expect(evaluateApiFootballRateLimitsForNextRequest(belowThreshold, optionalHeaders).outcome)
      .toBe("BLOCK_DAILY_THRESHOLD");
    expect(evaluateApiFootballRateLimitResponse(belowThreshold, optionalHeaders)).toEqual({
      outcome: "ALLOW_AND_STOP_AFTER_RESPONSE",
      blockReason: "BLOCK_DAILY_THRESHOLD",
    });
  });

  it("classifies daily exhaustion separately", () => {
    const parsed = parseApiFootballRateLimits(raw({ requestsRemaining: "0" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, optionalHeaders).outcome)
      .toBe("BLOCK_DAILY_EXHAUSTED");
    expect(evaluateApiFootballRateLimitResponse(parsed, optionalHeaders)).toEqual({
      outcome: "ALLOW_AND_STOP_AFTER_RESPONSE",
      blockReason: "BLOCK_DAILY_EXHAUSTED",
    });
  });

  it("blocks minute exhaustion without inventing reset timing", () => {
    const parsed = parseApiFootballRateLimits(raw({ remaining: "0" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, optionalHeaders).outcome)
      .toBe("BLOCK_MINUTE_EXHAUSTED");
  });

  it("blocks invalid headers", () => {
    const parsed = parseApiFootballRateLimits(raw({ remaining: "invalid" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, optionalHeaders).outcome)
      .toBe("BLOCK_HEADERS_INVALID");
  });

  it("applies explicit required-header policy", () => {
    const absent = parseApiFootballRateLimits(raw());
    expect(evaluateApiFootballRateLimitsForNextRequest(absent, {
      ...optionalHeaders,
      requireDailyRemaining: true,
    }).outcome).toBe("BLOCK_REQUIRED_HEADERS_ABSENT");
    expect(evaluateApiFootballRateLimitsForNextRequest(absent, optionalHeaders).outcome)
      .toBe("ALLOW");
  });

  it("performs no network or ambient IO", () => {
    const parsed = parseApiFootballRateLimits(raw({ requestsRemaining: "20" }));
    expect(evaluateApiFootballRateLimitsForNextRequest(parsed, optionalHeaders).outcome)
      .toBe("ALLOW");
    expect(fetchCalls).toBe(0);
  });
});
