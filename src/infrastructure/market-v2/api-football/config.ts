export const API_FOOTBALL_HTTP_POLICY_VERSION = "api-football-http/1.0" as const;
export const API_FOOTBALL_BASE_URL = "https://v3.football.api-sports.io" as const;
export const API_FOOTBALL_KEY_HEADER = "x-apisports-key" as const;
export const API_FOOTBALL_DEFAULT_TIMEOUT_MILLISECONDS = 20_000;
export const API_FOOTBALL_DEFAULT_MAX_RESPONSE_BYTES = 5_000_000;
export const API_FOOTBALL_MAX_TIMEOUT_MILLISECONDS = 120_000;
export const API_FOOTBALL_MAX_RESPONSE_BYTES = 10_000_000;

export type ApiFootballConfigurationValues = Readonly<Record<string, string | undefined>>;

export type ApiFootballConfigurationOverrides = Readonly<{
  timeoutMilliseconds?: number;
  maxResponseBytes?: number;
}>;

export type ApiFootballConfig = Readonly<{
  policyVersion: typeof API_FOOTBALL_HTTP_POLICY_VERSION;
  baseUrl: typeof API_FOOTBALL_BASE_URL;
  apiKeyHeader: typeof API_FOOTBALL_KEY_HEADER;
  apiKey: string;
  timeoutMilliseconds: number;
  maxResponseBytes: number;
}>;

export class ApiFootballConfigurationError extends Error {
  readonly classification = "INVALID_CONFIGURATION" as const;
  readonly retryable = false;
  readonly sanitizedCode: string;

  constructor(sanitizedCode: string) {
    super("API-Football configuration is invalid");
    this.name = "ApiFootballConfigurationError";
    this.sanitizedCode = sanitizedCode;
  }

  toJSON(): Readonly<{
    classification: "INVALID_CONFIGURATION";
    retryable: false;
    sanitizedCode: string;
  }> {
    return Object.freeze({
      classification: this.classification,
      retryable: this.retryable,
      sanitizedCode: this.sanitizedCode,
    });
  }
}

function requirePositiveBoundedInteger(
  value: number,
  maximum: number,
  sanitizedCode: string,
): number {
  if (!Number.isFinite(value) || !Number.isInteger(value) || value <= 0 || value > maximum) {
    throw new ApiFootballConfigurationError(sanitizedCode);
  }
  return value;
}

export function buildApiFootballConfig(
  values: ApiFootballConfigurationValues,
  overrides: ApiFootballConfigurationOverrides = {},
): ApiFootballConfig {
  const overrideKeys = Object.keys(overrides);
  if (
    overrideKeys.some(
      (key) => key !== "timeoutMilliseconds" && key !== "maxResponseBytes",
    )
  ) {
    throw new ApiFootballConfigurationError("CONFIGURATION_OVERRIDE_NOT_ALLOWED");
  }

  const apiKey = values.API_FOOTBALL_KEY;
  if (apiKey === undefined) {
    throw new ApiFootballConfigurationError("API_FOOTBALL_KEY_REQUIRED");
  }
  if (apiKey.length === 0 || /[\s\u0000-\u001f\u007f]/u.test(apiKey)) {
    throw new ApiFootballConfigurationError("API_FOOTBALL_KEY_INVALID");
  }

  const timeoutMilliseconds = requirePositiveBoundedInteger(
    overrides.timeoutMilliseconds ?? API_FOOTBALL_DEFAULT_TIMEOUT_MILLISECONDS,
    API_FOOTBALL_MAX_TIMEOUT_MILLISECONDS,
    "TIMEOUT_INVALID",
  );
  const maxResponseBytes = requirePositiveBoundedInteger(
    overrides.maxResponseBytes ?? API_FOOTBALL_DEFAULT_MAX_RESPONSE_BYTES,
    API_FOOTBALL_MAX_RESPONSE_BYTES,
    "MAX_RESPONSE_BYTES_INVALID",
  );

  return Object.freeze({
    policyVersion: API_FOOTBALL_HTTP_POLICY_VERSION,
    baseUrl: API_FOOTBALL_BASE_URL,
    apiKeyHeader: API_FOOTBALL_KEY_HEADER,
    apiKey,
    timeoutMilliseconds,
    maxResponseBytes,
  });
}
