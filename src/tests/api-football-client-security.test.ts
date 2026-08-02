import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ApiFootballClient,
  ApiFootballClientError,
  type ApiFootballClientOptions,
  type ApiFootballClientResult,
  type ApiFootballFetch,
  type ApiFootballFixturesQuery,
} from "@/infrastructure/market-v2/api-football/client";
import {
  API_FOOTBALL_BASE_URL,
  API_FOOTBALL_KEY_HEADER,
  ApiFootballConfigurationError,
  buildApiFootballConfig,
  type ApiFootballConfig,
  type ApiFootballConfigurationOverrides,
} from "@/infrastructure/market-v2/api-football/config";
import type {
  ApiFootballFixtureEnvelope,
  ApiFootballPredictionEnvelope,
} from "@/infrastructure/market-v2/api-football/contracts";
import {
  buildSyntheticFixtureEnvelopeWithArrayErrors,
  buildSyntheticFixtureEnvelopeWithObjectErrors,
  buildSyntheticPredictionEnvelope,
} from "@/tests/fixtures/api-football";

const SYNTHETIC_API_KEY = "SYNTHETIC_STAGE_FOUR_KEY";
const CAPTURED_AT_UTC = "2030-01-01T12:34:56.000Z";
const originalGlobalFetch = globalThis.fetch;
let globalFetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_API_FOOTBALL_CLIENT_TESTS");
  }) as typeof globalThis.fetch;
});

afterEach(() => {
  vi.useRealTimers();
});

afterAll(() => {
  globalThis.fetch = originalGlobalFetch;
  expect(globalFetchCalls).toBe(0);
});

type RecordedRequest = Readonly<{ input: string | URL; init: RequestInit }>;

function config(overrides: ApiFootballConfigurationOverrides = {}): ApiFootballConfig {
  return buildApiFootballConfig({ API_FOOTBALL_KEY: SYNTHETIC_API_KEY }, overrides);
}

function client(fetchImpl: ApiFootballFetch, clientConfig = config()): ApiFootballClient {
  return new ApiFootballClient({
    config: clientConfig,
    fetchImpl,
    clock: { nowUtc: () => CAPTURED_AT_UTC },
  });
}

function recordingFetch(
  responseFactory: (request: RecordedRequest) => Response | Promise<Response>,
): Readonly<{ calls: RecordedRequest[]; fetchImpl: ApiFootballFetch }> {
  const calls: RecordedRequest[] = [];
  const fetchImpl: ApiFootballFetch = async (input, init) => {
    const request = Object.freeze({ input, init });
    calls.push(request);
    return responseFactory(request);
  };
  return Object.freeze({ calls, fetchImpl });
}

function jsonResponse(
  payload: unknown,
  status = 200,
  headers: Readonly<Record<string, string>> = {},
): Response {
  return new Response(JSON.stringify(payload), { status, headers });
}

function successfulFixtureFetch(
  headers: Readonly<Record<string, string>> = {},
): ReturnType<typeof recordingFetch> {
  return recordingFetch(() =>
    jsonResponse(buildSyntheticFixtureEnvelopeWithArrayErrors(), 200, headers),
  );
}

function expectFailure<T>(result: ApiFootballClientResult<T>): ApiFootballClientError {
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected an API-Football client failure");
  return result.error;
}

describe("API-Football pure configuration", () => {
  it("rejects a missing API_FOOTBALL_KEY", () => {
    expect(() => buildApiFootballConfig({})).toThrow(ApiFootballConfigurationError);
  });

  it("rejects an empty API_FOOTBALL_KEY", () => {
    expect(() => buildApiFootballConfig({ API_FOOTBALL_KEY: "" })).toThrow(
      ApiFootballConfigurationError,
    );
  });

  it.each(["contains space", "contains\ttab", "contains\ncontrol", " leading"])(
    "rejects key whitespace or control characters",
    (apiKey) => {
      expect(() => buildApiFootballConfig({ API_FOOTBALL_KEY: apiKey })).toThrow(
        ApiFootballConfigurationError,
      );
    },
  );

  it("accepts a valid synthetic key and returns a frozen configuration", () => {
    const built = config();
    expect(built).toMatchObject({
      baseUrl: API_FOOTBALL_BASE_URL,
      apiKeyHeader: API_FOOTBALL_KEY_HEADER,
    });
    expect(Object.isFrozen(built)).toBe(true);
  });

  it("does not consult THE_ODDS_API_KEY", () => {
    let forbiddenReads = 0;
    const values = new Proxy(
      { API_FOOTBALL_KEY: SYNTHETIC_API_KEY },
      {
        get(target, property, receiver) {
          if (property === "THE_ODDS_API_KEY") forbiddenReads += 1;
          return Reflect.get(target, property, receiver);
        },
      },
    );
    buildApiFootballConfig(values);
    expect(forbiddenReads).toBe(0);
  });

  it("does not expose the rejected key in configuration errors", () => {
    const rejectedKey = "SYNTHETIC REJECTED KEY";
    let serialized = "";
    try {
      buildApiFootballConfig({ API_FOOTBALL_KEY: rejectedKey });
    } catch (error) {
      serialized = JSON.stringify(error);
      expect((error as Error).message).not.toContain(rejectedKey);
    }
    expect(serialized).not.toContain(rejectedKey);
  });

  it("does not allow the fixed base URL to be overridden", () => {
    expect(() =>
      buildApiFootballConfig(
        { API_FOOTBALL_KEY: SYNTHETIC_API_KEY },
        { baseUrl: "http://synthetic.invalid" } as unknown as ApiFootballConfigurationOverrides,
      ),
    ).toThrow(ApiFootballConfigurationError);
  });

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 120_001])(
    "rejects invalid timeout %s",
    (timeoutMilliseconds) => {
      expect(() => config({ timeoutMilliseconds })).toThrow(ApiFootballConfigurationError);
    },
  );

  it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 10_000_001])(
    "rejects invalid max response bytes %s",
    (maxResponseBytes) => {
      expect(() => config({ maxResponseBytes })).toThrow(ApiFootballConfigurationError);
    },
  );
});

describe("API-Football fetch injection and request security", () => {
  it("requires fetchImpl explicitly", () => {
    expect(
      () =>
        new ApiFootballClient({
          config: config(),
          clock: { nowUtc: () => CAPTURED_AT_UTC },
        } as unknown as ApiFootballClientOptions),
    ).toThrowError(ApiFootballClientError);
  });

  it("uses only the injected fetch implementation", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(recorded.calls).toHaveLength(1);
    expect(globalFetchCalls).toBe(0);
  });

  it("uses GET and manual redirects", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(recorded.calls[0]?.init.method).toBe("GET");
    expect(recorded.calls[0]?.init.redirect).toBe("manual");
  });

  it("uses the exact HTTPS host", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    const url = new URL(String(recorded.calls[0]?.input));
    expect(url.origin).toBe(API_FOOTBALL_BASE_URL);
    expect(url.protocol).toBe("https:");
  });

  it("sends only the API key and Accept headers", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    const headers = new Headers(recorded.calls[0]?.init.headers);
    expect(headers.get(API_FOOTBALL_KEY_HEADER)).toBe(SYNTHETIC_API_KEY);
    expect(headers.get("accept")).toBe("application/json");
    expect([...headers.keys()].sort()).toEqual(["accept", API_FOOTBALL_KEY_HEADER].sort());
    expect(headers.has("authorization")).toBe(false);
    expect(headers.has("cookie")).toBe(false);
    expect(headers.has("the-odds-api-key")).toBe(false);
  });

  it("never places the API key in the URL or query", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(String(recorded.calls[0]?.input)).not.toContain(SYNTHETIC_API_KEY);
  });

  it("exposes no generic request or get operation", () => {
    const instance = client(successfulFixtureFetch().fetchImpl);
    expect("request" in instance).toBe(false);
    expect("get" in instance).toBe(false);
    expect(Object.keys(instance)).toEqual([]);
  });
});

describe("API-Football preregistered routes", () => {
  it("builds the date fixture route", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).listFixtures({ date: "2030-01-01", timezone: "UTC" });
    expect(String(recorded.calls[0]?.input)).toBe(
      `${API_FOOTBALL_BASE_URL}/fixtures?date=2030-01-01&timezone=UTC`,
    );
  });

  it("builds the competition, season, and window fixture route", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).listFixtures({
      providerCompetitionId: "910001",
      season: 2030,
      from: "2030-01-01",
      to: "2030-01-03",
      timezone: "UTC",
    });
    expect(String(recorded.calls[0]?.input)).toBe(
      `${API_FOOTBALL_BASE_URL}/fixtures?league=910001&season=2030&from=2030-01-01&to=2030-01-03&timezone=UTC`,
    );
  });

  it("rejects from after to without invoking fetch", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).listFixtures({
      providerCompetitionId: "910001",
      season: 2030,
      from: "2030-01-03",
      to: "2030-01-01",
      timezone: "UTC",
    });
    expect(expectFailure(result).classification).toBe("INVALID_REQUEST");
    expect(recorded.calls).toHaveLength(0);
  });

  it("rejects a timezone other than UTC", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).listFixtures({
      date: "2030-01-01",
      timezone: "Europe/Berlin",
    } as unknown as ApiFootballFixturesQuery);
    expect(expectFailure(result).classification).toBe("INVALID_REQUEST");
    expect(recorded.calls).toHaveLength(0);
  });

  it("rejects unknown fixture query parameters", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).listFixtures({
      date: "2030-01-01",
      timezone: "UTC",
      odds: "forbidden",
    } as unknown as ApiFootballFixturesQuery);
    expect(expectFailure(result).classification).toBe("INVALID_REQUEST");
    expect(recorded.calls).toHaveLength(0);
  });

  it("uses only the prediction fixture route", async () => {
    const recorded = recordingFetch(() => jsonResponse(buildSyntheticPredictionEnvelope()));
    await client(recorded.fetchImpl).getPrediction("900001");
    expect(String(recorded.calls[0]?.input)).toBe(
      `${API_FOOTBALL_BASE_URL}/predictions?fixture=900001`,
    );
  });

  it("uses only the fixture result route", async () => {
    const recorded = successfulFixtureFetch();
    await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(String(recorded.calls[0]?.input)).toBe(
      `${API_FOOTBALL_BASE_URL}/fixtures?id=900001`,
    );
  });

  it.each(["0", "-1", "1.5", "text", " 1", "1 ", "1&odds=true", "%31"])(
    "rejects unsafe provider fixture id %s",
    async (providerFixtureId) => {
      const recorded = successfulFixtureFetch();
      const result = await client(recorded.fetchImpl).getPrediction(providerFixtureId);
      expect(expectFailure(result).classification).toBe("INVALID_REQUEST");
      expect(recorded.calls).toHaveLength(0);
    },
  );

  it("uses URLSearchParams semantics without accepting query fragments", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).getFixtureResult("900001&players=true");
    expect(expectFailure(result).classification).toBe("INVALID_REQUEST");
    expect(recorded.calls).toHaveLength(0);
  });
});

describe("API-Football HTTP classification", () => {
  it.each([
    [301, "REDIRECT_BLOCKED", false],
    [401, "AUTHENTICATION_REJECTED", false],
    [403, "AUTHENTICATION_REJECTED", false],
    [400, "HTTP_PERMANENT_FAILURE", false],
    [404, "HTTP_PERMANENT_FAILURE", false],
    [429, "RATE_LIMITED", true],
    [500, "HTTP_RETRYABLE_FAILURE", true],
    [503, "HTTP_RETRYABLE_FAILURE", true],
  ] as const)("classifies HTTP %s", async (status, classification, retryable) => {
    const recorded = recordingFetch(() => new Response("SYNTHETIC_ERROR_BODY", { status }));
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(expectFailure(result)).toMatchObject({ classification, retryable, httpStatus: status });
  });

  it("does not follow a redirect Location", async () => {
    const recorded = recordingFetch(() =>
      new Response(null, {
        status: 301,
        headers: { location: "https://synthetic.invalid/forbidden" },
      }),
    );
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(expectFailure(result).classification).toBe("REDIRECT_BLOCKED");
    expect(recorded.calls).toHaveLength(1);
  });

  it("never retries an HTTP failure", async () => {
    const recorded = recordingFetch(() => new Response(null, { status: 503 }));
    await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(recorded.calls).toHaveLength(1);
  });

  it("does not expose the key or raw error body", async () => {
    const rawBody = `SYNTHETIC_BODY_${SYNTHETIC_API_KEY}`;
    const recorded = recordingFetch(() => new Response(rawBody, { status: 400 }));
    const error = expectFailure(
      await client(recorded.fetchImpl).getFixtureResult("900001"),
    );
    const serialized = JSON.stringify(error);
    expect(error.message).not.toContain(SYNTHETIC_API_KEY);
    expect(serialized).not.toContain(SYNTHETIC_API_KEY);
    expect(serialized).not.toContain(rawBody);
  });
});

describe("API-Football timeout and transport failures", () => {
  it("aborts at timeout, classifies TIMEOUT, and clears the timer", async () => {
    vi.useFakeTimers();
    let observedAbort = false;
    const recorded = recordingFetch(
      ({ init }) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            observedAbort = true;
            reject(new DOMException("synthetic abort", "AbortError"));
          });
        }),
    );
    const pending = client(recorded.fetchImpl, config({ timeoutMilliseconds: 5 })).getFixtureResult(
      "900001",
    );
    await vi.advanceTimersByTimeAsync(5);
    const result = await pending;
    expect(expectFailure(result).classification).toBe("TIMEOUT");
    expect(observedAbort).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
    expect(recorded.calls).toHaveLength(1);
  });

  it("classifies a non-aborted transport failure as NETWORK_FAILURE", async () => {
    const recorded = recordingFetch(() => {
      throw new Error("synthetic transport failure");
    });
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    const error = expectFailure(result);
    expect(error.classification).toBe("NETWORK_FAILURE");
    expect(error.classification).not.toBe("TIMEOUT");
    expect(recorded.calls).toHaveLength(1);
  });
});

describe("API-Football response size boundary", () => {
  it("blocks a declared Content-Length above the limit before decoding", async () => {
    const recorded = recordingFetch(() =>
      new Response("{}", { status: 200, headers: { "content-length": "65" } }),
    );
    const result = await client(recorded.fetchImpl, config({ maxResponseBytes: 64 })).getFixtureResult(
      "900001",
    );
    expect(expectFailure(result).classification).toBe("RESPONSE_TOO_LARGE");
  });

  it("blocks actual bytes above the limit when Content-Length is absent", async () => {
    const recorded = recordingFetch(() => new Response("x".repeat(65), { status: 200 }));
    const result = await client(recorded.fetchImpl, config({ maxResponseBytes: 64 })).getFixtureResult(
      "900001",
    );
    expect(expectFailure(result).classification).toBe("RESPONSE_TOO_LARGE");
  });

  it("blocks actual bytes when Content-Length understates the body", async () => {
    const recorded = recordingFetch(() =>
      new Response("x".repeat(65), { status: 200, headers: { "content-length": "2" } }),
    );
    const result = await client(recorded.fetchImpl, config({ maxResponseBytes: 64 })).getFixtureResult(
      "900001",
    );
    expect(expectFailure(result).classification).toBe("RESPONSE_TOO_LARGE");
  });

  it("does not include body content in RESPONSE_TOO_LARGE", async () => {
    const body = "SYNTHETIC_OVERSIZED_BODY";
    const recorded = recordingFetch(() => new Response(body, { status: 200 }));
    const error = expectFailure(
      await client(recorded.fetchImpl, config({ maxResponseBytes: 8 })).getFixtureResult("900001"),
    );
    expect(JSON.stringify(error)).not.toContain(body);
  });
});

describe("API-Football JSON and envelope boundary", () => {
  it("classifies invalid JSON", async () => {
    const recorded = recordingFetch(() => new Response("not-json", { status: 200 }));
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(expectFailure(result).classification).toBe("INVALID_JSON");
  });

  it("classifies an incomplete envelope", async () => {
    const recorded = recordingFetch(() => jsonResponse({ get: "fixtures" }));
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(expectFailure(result).classification).toBe("INVALID_ENVELOPE");
  });

  it.each([
    { requests: "Synthetic provider error" },
    ["Synthetic provider error"],
  ])("classifies non-empty provider errors", async (errors) => {
    const payload = { ...buildSyntheticFixtureEnvelopeWithArrayErrors(), errors };
    const recorded = recordingFetch(() => jsonResponse(payload));
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(expectFailure(result).classification).toBe("API_ERRORS_PRESENT");
  });

  it("accepts an empty errors array", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
  });

  it("accepts an empty errors object", async () => {
    const recorded = recordingFetch(() =>
      jsonResponse(buildSyntheticFixtureEnvelopeWithObjectErrors()),
    );
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
  });

  it("accepts results zero with an empty response", async () => {
    const payload: ApiFootballFixtureEnvelope = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
      results: 0,
      response: [],
    };
    const recorded = recordingFetch(() => jsonResponse(payload));
    const result = await client(recorded.fetchImpl).listFixtures({
      date: "2030-01-01",
      timezone: "UTC",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.payload.response).toEqual([]);
  });

  it("returns a validated source-specific fixture payload", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.payload.response[0]?.fixture.id).toBe(900001);
    expect(result.payload.response[0]).not.toHaveProperty("canonicalStatus");
  });

  it("returns a validated source-specific prediction payload", async () => {
    const recorded = recordingFetch(() => jsonResponse(buildSyntheticPredictionEnvelope()));
    const result = await client(recorded.fetchImpl).getPrediction("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.payload.response[0]?.predictions.percent.home).toBe("45%");
    expect(result.payload.response[0]).not.toHaveProperty("contentHash");
  });

  it("does not convert percentages or derive Double Chance", async () => {
    const recorded = recordingFetch(() => jsonResponse(buildSyntheticPredictionEnvelope()));
    const result: ApiFootballClientResult<ApiFootballPredictionEnvelope> = await client(
      recorded.fetchImpl,
    ).getPrediction("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    const prediction = result.payload.response[0]?.predictions;
    expect(typeof prediction?.percent.home).toBe("string");
    expect(prediction).not.toHaveProperty("doubleChance");
    expect(prediction).not.toHaveProperty("normalizedProbability");
  });
});

describe("API-Football sanitized success metadata", () => {
  it("returns only preregistered raw metadata and the injected clock", async () => {
    const body = JSON.stringify(buildSyntheticFixtureEnvelopeWithArrayErrors());
    const recorded = successfulFixtureFetch({
      date: "Tue, 01 Jan 2030 12:34:56 GMT",
      "x-ratelimit-requests-limit": "100",
      "x-ratelimit-requests-remaining": "099",
      "x-ratelimit-limit": "10",
      "x-ratelimit-remaining": "09",
      "retry-after": "07",
      "x-synthetic-forbidden": "must-not-be-returned",
    });
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.metadata).toEqual({
      endpointKey: "fixture-result-by-id",
      httpStatus: 200,
      httpDate: "Tue, 01 Jan 2030 12:34:56 GMT",
      capturedAtUtc: CAPTURED_AT_UTC,
      responseByteLength: new TextEncoder().encode(body).byteLength,
      rateLimitHeaders: {
        requestsLimit: "100",
        requestsRemaining: "099",
        limit: "10",
        remaining: "09",
      },
      retryAfterRaw: "07",
    });
    expect(result.metadata).not.toHaveProperty("headers");
    expect(JSON.stringify(result.metadata)).not.toContain("must-not-be-returned");
    expect(JSON.stringify(result.metadata)).not.toContain(SYNTHETIC_API_KEY);
    expect(result.metadata.endpointKey).not.toContain("http");
    expect(result.rawBytes).toBeInstanceOf(Uint8Array);
  });

  it("does not infer missing rate-limit or Retry-After headers", async () => {
    const recorded = successfulFixtureFetch();
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.metadata.rateLimitHeaders).toEqual({
      requestsLimit: null,
      requestsRemaining: null,
      limit: null,
      remaining: null,
    });
    expect(result.metadata.retryAfterRaw).toBeNull();
    expect(result.metadata.httpDate).toBeNull();
  });

  it("hands off complete raw evidence without request secrets", async () => {
    const recorded = successfulFixtureFetch({ "content-type": "application/json" });
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.evidenceCandidate).toMatchObject({
      endpointKey: "fixture-result-by-id",
      capturedAtUtc: CAPTURED_AT_UTC,
      mediaType: "application/json",
      responseByteLength: result.rawBytes.byteLength,
    });
    expect(JSON.stringify({ ...result.evidenceCandidate, rawBytes: undefined })).not.toContain(
      SYNTHETIC_API_KEY,
    );
    expect(new TextDecoder().decode(result.evidenceCandidate.rawBytes)).not.toContain(
      SYNTHETIC_API_KEY,
    );
  });
});

describe("API-Football raw evidence handoff on failures", () => {
  it.each([
    [400, "HTTP_PERMANENT_FAILURE"],
    [500, "HTTP_RETRYABLE_FAILURE"],
  ] as const)("keeps a complete bounded HTTP %s body", async (status, classification) => {
    const recorded = recordingFetch(() =>
      new Response("SYNTHETIC_BOUNDED_ERROR", {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected client failure");
    expect(result.error.classification).toBe(classification);
    expect(result.evidenceCandidate?.responseByteLength).toBeGreaterThan(0);
  });

  it.each([
    ["not-json", "INVALID_JSON"],
    [JSON.stringify({ get: "fixtures" }), "INVALID_ENVELOPE"],
    [
      JSON.stringify({
        ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
        errors: ["Synthetic provider error"],
      }),
      "API_ERRORS_PRESENT",
    ],
  ] as const)("keeps complete bounded parsing failures", async (body, classification) => {
    const recorded = recordingFetch(() => new Response(body, { status: 200 }));
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected client failure");
    expect(result.error.classification).toBe(classification);
    expect(result.evidenceCandidate?.rawBytes.byteLength).toBeGreaterThan(0);
  });

  it("does not hand off an oversized body", async () => {
    const recorded = recordingFetch(() => new Response("x".repeat(65), { status: 200 }));
    const result = await client(
      recorded.fetchImpl,
      config({ maxResponseBytes: 64 }),
    ).getFixtureResult("900001");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected client failure");
    expect(result.error.classification).toBe("RESPONSE_TOO_LARGE");
    expect(result.evidenceCandidate).toBeUndefined();
  });

  it("does not hand off a transport failure without a complete body", async () => {
    const recorded = recordingFetch(() => {
      throw new Error("synthetic transport failure");
    });
    const result = await client(recorded.fetchImpl).getFixtureResult("900001");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected client failure");
    expect(result.error.classification).toBe("NETWORK_FAILURE");
    expect(result.evidenceCandidate).toBeUndefined();
  });
});
