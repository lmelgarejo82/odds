import {
  decodeApiFootballFixtureEnvelope,
  decodeApiFootballPredictionEnvelope,
  type ApiFootballDecodeResult,
  type ApiFootballFixtureEnvelope,
  type ApiFootballPredictionEnvelope,
} from "./contracts";
import {
  API_FOOTBALL_BASE_URL,
  API_FOOTBALL_KEY_HEADER,
  type ApiFootballConfig,
} from "./config";

export const API_FOOTBALL_CLIENT_ERROR_CLASSIFICATIONS = [
  "INVALID_CONFIGURATION",
  "INVALID_REQUEST",
  "TIMEOUT",
  "NETWORK_FAILURE",
  "REDIRECT_BLOCKED",
  "AUTHENTICATION_REJECTED",
  "HTTP_PERMANENT_FAILURE",
  "RATE_LIMITED",
  "HTTP_RETRYABLE_FAILURE",
  "RESPONSE_TOO_LARGE",
  "INVALID_JSON",
  "INVALID_ENVELOPE",
  "API_ERRORS_PRESENT",
] as const;

export type ApiFootballClientErrorClassification =
  (typeof API_FOOTBALL_CLIENT_ERROR_CLASSIFICATIONS)[number];

export type ApiFootballEndpointKey =
  | "fixtures-list"
  | "fixtures-by-date"
  | "fixtures-by-competition-window"
  | "prediction-by-fixture"
  | "fixture-result-by-id"
  | "client-construction";

export class ApiFootballClientError extends Error {
  readonly classification: ApiFootballClientErrorClassification;
  readonly endpointKey: ApiFootballEndpointKey;
  readonly retryable: boolean;
  readonly httpStatus?: number;
  readonly sanitizedCode?: string;

  constructor(details: Readonly<{
    classification: ApiFootballClientErrorClassification;
    endpointKey: ApiFootballEndpointKey;
    retryable: boolean;
    httpStatus?: number;
    sanitizedCode?: string;
  }>) {
    super("API-Football request failed");
    this.name = "ApiFootballClientError";
    this.classification = details.classification;
    this.endpointKey = details.endpointKey;
    this.retryable = details.retryable;
    this.httpStatus = details.httpStatus;
    this.sanitizedCode = details.sanitizedCode;
  }

  toJSON(): Readonly<{
    classification: ApiFootballClientErrorClassification;
    endpointKey: ApiFootballEndpointKey;
    retryable: boolean;
    httpStatus?: number;
    sanitizedCode?: string;
  }> {
    return Object.freeze({
      classification: this.classification,
      endpointKey: this.endpointKey,
      retryable: this.retryable,
      ...(this.httpStatus === undefined ? {} : { httpStatus: this.httpStatus }),
      ...(this.sanitizedCode === undefined ? {} : { sanitizedCode: this.sanitizedCode }),
    });
  }
}

export type ApiFootballResponseMetadata = Readonly<{
  endpointKey: Exclude<ApiFootballEndpointKey, "fixtures-list" | "client-construction">;
  httpStatus: number;
  httpDate: string | null;
  capturedAtUtc: string;
  responseByteLength: number;
  rateLimitHeaders: Readonly<{
    requestsLimit: string | null;
    requestsRemaining: string | null;
    limit: string | null;
    remaining: string | null;
  }>;
  retryAfterRaw: string | null;
}>;

export type ApiFootballEvidenceCandidate = Readonly<{
  endpointKey: Exclude<ApiFootballEndpointKey, "fixtures-list" | "client-construction">;
  capturedAtUtc: string;
  mediaType: string;
  responseByteLength: number;
  httpDate: string | null;
  rawBytes: Readonly<Uint8Array>;
}>;

export type ApiFootballClientSuccess<T> = Readonly<{
  ok: true;
  payload: T;
  metadata: ApiFootballResponseMetadata;
  rawBytes: Readonly<Uint8Array>;
  evidenceCandidate: ApiFootballEvidenceCandidate;
}>;

export type ApiFootballClientFailure = Readonly<{
  ok: false;
  error: ApiFootballClientError;
  evidenceCandidate?: ApiFootballEvidenceCandidate;
}>;

export type ApiFootballClientResult<T> = ApiFootballClientSuccess<T> | ApiFootballClientFailure;

export type ApiFootballFetch = (
  input: string | URL,
  init: RequestInit,
) => Promise<Response>;

export type ApiFootballClock = Readonly<{ nowUtc(): string }>;

export type ApiFootballFixturesByDateQuery = Readonly<{
  date: string;
  timezone: "UTC";
}>;

export type ApiFootballFixturesByCompetitionWindowQuery = Readonly<{
  providerCompetitionId: string | number;
  season: number;
  from: string;
  to: string;
  timezone: "UTC";
}>;

export type ApiFootballFixturesQuery =
  | ApiFootballFixturesByDateQuery
  | ApiFootballFixturesByCompetitionWindowQuery;

export type ApiFootballClientOptions = Readonly<{
  config: ApiFootballConfig;
  fetchImpl: ApiFootballFetch;
  clock: ApiFootballClock;
}>;

type RequestTarget = Readonly<{
  endpointKey: Exclude<ApiFootballEndpointKey, "fixtures-list" | "client-construction">;
  url: URL;
}>;

type RequestTargetResult =
  | Readonly<{ ok: true; target: RequestTarget }>
  | ApiFootballClientFailure;

type EnvelopeDecoder<T> = (input: unknown) => ApiFootballDecodeResult<T>;

function clientFailure(
  details: ConstructorParameters<typeof ApiFootballClientError>[0],
  evidenceCandidate?: ApiFootballEvidenceCandidate,
): ApiFootballClientFailure {
  return Object.freeze({
    ok: false,
    error: new ApiFootballClientError(details),
    ...(evidenceCandidate === undefined ? {} : { evidenceCandidate }),
  });
}

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  return actual.length === expected.length && actual.every((key, index) => key === [...expected].sort()[index]);
}

function isValidUtcDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

function positiveDecimalIdentifier(value: unknown): string | null {
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
  }
  return typeof value === "string" && /^[1-9]\d*$/.test(value) ? value : null;
}

function buildFixturesTarget(query: unknown): RequestTargetResult {
  if (!isUnknownRecord(query)) {
    return clientFailure({
      classification: "INVALID_REQUEST",
      endpointKey: "fixtures-list",
      retryable: false,
      sanitizedCode: "FIXTURES_QUERY_INVALID",
    });
  }

  if ("date" in query) {
    if (
      !hasExactKeys(query, ["date", "timezone"]) ||
      !isValidUtcDate(query.date) ||
      query.timezone !== "UTC"
    ) {
      return clientFailure({
        classification: "INVALID_REQUEST",
        endpointKey: "fixtures-by-date",
        retryable: false,
        sanitizedCode: "FIXTURES_DATE_QUERY_INVALID",
      });
    }
    const url = new URL("/fixtures", API_FOOTBALL_BASE_URL);
    url.search = new URLSearchParams({ date: query.date, timezone: "UTC" }).toString();
    return Object.freeze({
      ok: true,
      target: Object.freeze({ endpointKey: "fixtures-by-date", url }),
    });
  }

  const providerCompetitionId = positiveDecimalIdentifier(query.providerCompetitionId);
  if (
    !hasExactKeys(query, ["providerCompetitionId", "season", "from", "to", "timezone"]) ||
    providerCompetitionId === null ||
    typeof query.season !== "number" ||
    !Number.isInteger(query.season) ||
    query.season < 1900 ||
    query.season > 2200 ||
    !isValidUtcDate(query.from) ||
    !isValidUtcDate(query.to) ||
    query.from > query.to ||
    query.timezone !== "UTC"
  ) {
    return clientFailure({
      classification: "INVALID_REQUEST",
      endpointKey: "fixtures-by-competition-window",
      retryable: false,
      sanitizedCode: "FIXTURES_WINDOW_QUERY_INVALID",
    });
  }
  const url = new URL("/fixtures", API_FOOTBALL_BASE_URL);
  url.search = new URLSearchParams({
    league: providerCompetitionId,
    season: String(query.season),
    from: query.from,
    to: query.to,
    timezone: "UTC",
  }).toString();
  return Object.freeze({
    ok: true,
    target: Object.freeze({ endpointKey: "fixtures-by-competition-window", url }),
  });
}

function buildFixtureIdentityTarget(
  providerFixtureId: unknown,
  operation: "PREDICTION" | "RESULT",
): RequestTargetResult {
  const normalized = positiveDecimalIdentifier(providerFixtureId);
  const endpointKey =
    operation === "PREDICTION" ? "prediction-by-fixture" : "fixture-result-by-id";
  if (normalized === null) {
    return clientFailure({
      classification: "INVALID_REQUEST",
      endpointKey,
      retryable: false,
      sanitizedCode: "PROVIDER_FIXTURE_ID_INVALID",
    });
  }
  const url = new URL(operation === "PREDICTION" ? "/predictions" : "/fixtures", API_FOOTBALL_BASE_URL);
  url.search = new URLSearchParams(
    operation === "PREDICTION" ? { fixture: normalized } : { id: normalized },
  ).toString();
  return Object.freeze({ ok: true, target: Object.freeze({ endpointKey, url }) });
}

function httpFailure(status: number, endpointKey: RequestTarget["endpointKey"]): ApiFootballClientFailure | null {
  if (status >= 200 && status < 300) return null;
  if (status >= 300 && status < 400) {
    return clientFailure({ classification: "REDIRECT_BLOCKED", endpointKey, retryable: false, httpStatus: status });
  }
  if (status === 401 || status === 403) {
    return clientFailure({ classification: "AUTHENTICATION_REJECTED", endpointKey, retryable: false, httpStatus: status });
  }
  if (status === 429) {
    return clientFailure({ classification: "RATE_LIMITED", endpointKey, retryable: true, httpStatus: status });
  }
  if (status >= 500 && status < 600) {
    return clientFailure({ classification: "HTTP_RETRYABLE_FAILURE", endpointKey, retryable: true, httpStatus: status });
  }
  return clientFailure({ classification: "HTTP_PERMANENT_FAILURE", endpointKey, retryable: false, httpStatus: status });
}

function declaredResponseTooLarge(contentLength: string | null, maximum: number): boolean {
  if (contentLength === null || !/^\d+$/.test(contentLength)) return false;
  return BigInt(contentLength) > BigInt(maximum);
}

function containsBytes(haystack: Readonly<Uint8Array>, needle: Readonly<Uint8Array>): boolean {
  if (needle.byteLength === 0 || needle.byteLength > haystack.byteLength) return false;
  for (let offset = 0; offset <= haystack.byteLength - needle.byteLength; offset += 1) {
    let matches = true;
    for (let index = 0; index < needle.byteLength; index += 1) {
      if (haystack[offset + index] !== needle[index]) {
        matches = false;
        break;
      }
    }
    if (matches) return true;
  }
  return false;
}

function sanitizedMediaType(value: string | null): string {
  if (value === null) return "application/octet-stream";
  const trimmed = value.trim();
  return /^[\x20-\x7e]{1,200}$/u.test(trimmed)
    ? trimmed
    : "application/octet-stream";
}

export class ApiFootballClient {
  readonly #config: ApiFootballConfig;
  readonly #fetchImpl: ApiFootballFetch;
  readonly #clock: ApiFootballClock;

  constructor(options: ApiFootballClientOptions) {
    if (
      options === undefined ||
      typeof options.fetchImpl !== "function" ||
      typeof options.clock?.nowUtc !== "function" ||
      options.config?.baseUrl !== API_FOOTBALL_BASE_URL ||
      options.config.apiKeyHeader !== API_FOOTBALL_KEY_HEADER
    ) {
      throw new ApiFootballClientError({
        classification: "INVALID_CONFIGURATION",
        endpointKey: "client-construction",
        retryable: false,
        sanitizedCode: "CLIENT_OPTIONS_INVALID",
      });
    }
    this.#config = options.config;
    this.#fetchImpl = options.fetchImpl;
    this.#clock = options.clock;
  }

  async listFixtures(
    query: ApiFootballFixturesQuery,
  ): Promise<ApiFootballClientResult<ApiFootballFixtureEnvelope>> {
    const target = buildFixturesTarget(query);
    return target.ok
      ? this.#execute(target.target, decodeApiFootballFixtureEnvelope)
      : target;
  }

  async getPrediction(
    providerFixtureId: string,
  ): Promise<ApiFootballClientResult<ApiFootballPredictionEnvelope>> {
    const target = buildFixtureIdentityTarget(providerFixtureId, "PREDICTION");
    return target.ok
      ? this.#execute(target.target, decodeApiFootballPredictionEnvelope)
      : target;
  }

  async getFixtureResult(
    providerFixtureId: string,
  ): Promise<ApiFootballClientResult<ApiFootballFixtureEnvelope>> {
    const target = buildFixtureIdentityTarget(providerFixtureId, "RESULT");
    return target.ok
      ? this.#execute(target.target, decodeApiFootballFixtureEnvelope)
      : target;
  }

  async #execute<T>(
    target: RequestTarget,
    decodeEnvelope: EnvelopeDecoder<T>,
  ): Promise<ApiFootballClientResult<T>> {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, this.#config.timeoutMilliseconds);
    try {
      let response: Response;
      try {
        response = await this.#fetchImpl(target.url.toString(), {
          method: "GET",
          redirect: "manual",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            [this.#config.apiKeyHeader]: this.#config.apiKey,
          },
        });
      } catch {
        return clientFailure({
          classification: timedOut ? "TIMEOUT" : "NETWORK_FAILURE",
          endpointKey: target.endpointKey,
          retryable: true,
        });
      }

      if (
        declaredResponseTooLarge(
          response.headers.get("content-length"),
          this.#config.maxResponseBytes,
        )
      ) {
        return clientFailure({
          classification: "RESPONSE_TOO_LARGE",
          endpointKey: target.endpointKey,
          retryable: false,
          httpStatus: response.status,
        });
      }

      let rawBytes: Uint8Array;
      try {
        rawBytes = new Uint8Array(await response.arrayBuffer());
      } catch {
        return clientFailure({
          classification: timedOut ? "TIMEOUT" : "NETWORK_FAILURE",
          endpointKey: target.endpointKey,
          retryable: true,
          httpStatus: response.status,
        });
      }
      if (rawBytes.byteLength > this.#config.maxResponseBytes) {
        return clientFailure({
          classification: "RESPONSE_TOO_LARGE",
          endpointKey: target.endpointKey,
          retryable: false,
          httpStatus: response.status,
        });
      }

      const capturedAtUtc = this.#clock.nowUtc();
      const secretReflected = containsBytes(
        rawBytes,
        new TextEncoder().encode(this.#config.apiKey),
      );
      const evidenceCandidate: ApiFootballEvidenceCandidate | undefined =
        rawBytes.byteLength === 0 || secretReflected
          ? undefined
          : Object.freeze({
              endpointKey: target.endpointKey,
              capturedAtUtc,
              mediaType: sanitizedMediaType(response.headers.get("content-type")),
              responseByteLength: rawBytes.byteLength,
              httpDate: response.headers.get("date"),
              rawBytes,
            });

      const statusFailure = httpFailure(response.status, target.endpointKey);
      if (statusFailure !== null) {
        return clientFailure(
          {
            classification: statusFailure.error.classification,
            endpointKey: statusFailure.error.endpointKey,
            retryable: statusFailure.error.retryable,
            httpStatus: statusFailure.error.httpStatus,
          },
          evidenceCandidate,
        );
      }

      let parsed: unknown;
      try {
        const decoded = new TextDecoder("utf-8", { fatal: true }).decode(rawBytes);
        if (secretReflected) {
          return clientFailure({
            classification: "INVALID_ENVELOPE",
            endpointKey: target.endpointKey,
            retryable: false,
            httpStatus: response.status,
            sanitizedCode: "SENSITIVE_VALUE_REFLECTED",
          });
        }
        parsed = JSON.parse(decoded) as unknown;
      } catch {
        return clientFailure(
          {
            classification: "INVALID_JSON",
            endpointKey: target.endpointKey,
            retryable: false,
            httpStatus: response.status,
          },
          evidenceCandidate,
        );
      }

      const decodedEnvelope = decodeEnvelope(parsed);
      if (!decodedEnvelope.ok) {
        return clientFailure(
          {
            classification: decodedEnvelope.error.code,
            endpointKey: target.endpointKey,
            retryable: false,
            httpStatus: response.status,
          },
          evidenceCandidate,
        );
      }

      if (evidenceCandidate === undefined) {
        return clientFailure({
          classification: "INVALID_ENVELOPE",
          endpointKey: target.endpointKey,
          retryable: false,
          httpStatus: response.status,
          sanitizedCode: "EVIDENCE_CANDIDATE_UNAVAILABLE",
        });
      }

      return Object.freeze({
        ok: true,
        payload: decodedEnvelope.data,
        rawBytes,
        evidenceCandidate,
        metadata: Object.freeze({
          endpointKey: target.endpointKey,
          httpStatus: response.status,
          httpDate: response.headers.get("date"),
          capturedAtUtc,
          responseByteLength: rawBytes.byteLength,
          rateLimitHeaders: Object.freeze({
            requestsLimit: response.headers.get("x-ratelimit-requests-limit"),
            requestsRemaining: response.headers.get("x-ratelimit-requests-remaining"),
            limit: response.headers.get("x-ratelimit-limit"),
            remaining: response.headers.get("x-ratelimit-remaining"),
          }),
          retryAfterRaw: response.headers.get("retry-after"),
        }),
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}
