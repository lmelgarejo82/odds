export type ApiFootballRateLimitRawInput = Readonly<{
  requestsLimit: string | null;
  requestsRemaining: string | null;
  limit: string | null;
  remaining: string | null;
  retryAfterRaw: string | null;
}>;

export type ApiFootballRateLimitValues = Readonly<{
  dailyLimit: number | null;
  dailyRemaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
  retryAfterSeconds: number | null;
}>;

export type ApiFootballRateLimitParseResult = ApiFootballRateLimitValues &
  Readonly<{
    state: "VALID" | "ABSENT" | "INVALID";
    rawPresence: Readonly<{
      dailyLimit: boolean;
      dailyRemaining: boolean;
      minuteLimit: boolean;
      minuteRemaining: boolean;
      retryAfter: boolean;
    }>;
    sanitizedErrorCode?: "RATE_LIMIT_VALUE_INVALID" | "RATE_LIMIT_RELATION_INVALID";
  }>;

export type RateLimitSafetyConfig = Readonly<{
  dailySafetyThreshold: number;
  requireDailyRemaining: boolean;
  requireMinuteRemaining: boolean;
}>;

export type RateLimitBlockOutcome =
  | "BLOCK_DAILY_THRESHOLD"
  | "BLOCK_DAILY_EXHAUSTED"
  | "BLOCK_MINUTE_EXHAUSTED"
  | "BLOCK_HEADERS_INVALID"
  | "BLOCK_REQUIRED_HEADERS_ABSENT";

export type RateLimitSafetyEvaluation =
  | Readonly<{ outcome: "ALLOW" }>
  | Readonly<{
      outcome: "ALLOW_AND_STOP_AFTER_RESPONSE";
      blockReason:
        | "BLOCK_DAILY_THRESHOLD"
        | "BLOCK_DAILY_EXHAUSTED"
        | "BLOCK_MINUTE_EXHAUSTED";
    }>
  | Readonly<{ outcome: RateLimitBlockOutcome }>;

const EMPTY_VALUES: ApiFootballRateLimitValues = Object.freeze({
  dailyLimit: null,
  dailyRemaining: null,
  minuteLimit: null,
  minuteRemaining: null,
  retryAfterSeconds: null,
});

function strictNonNegativeInteger(raw: string): number | null {
  const normalized = raw.trim();
  if (!/^\d+$/u.test(normalized)) return null;
  const value = Number(normalized);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function presence(input: ApiFootballRateLimitRawInput) {
  return Object.freeze({
    dailyLimit: input.requestsLimit !== null,
    dailyRemaining: input.requestsRemaining !== null,
    minuteLimit: input.limit !== null,
    minuteRemaining: input.remaining !== null,
    retryAfter: input.retryAfterRaw !== null,
  });
}

export function parseApiFootballRateLimits(
  input: ApiFootballRateLimitRawInput,
): ApiFootballRateLimitParseResult {
  const rawPresence = presence(input);
  if (!Object.values(rawPresence).some(Boolean)) {
    return Object.freeze({ state: "ABSENT", ...EMPTY_VALUES, rawPresence });
  }

  const rawValues = [
    ["dailyLimit", input.requestsLimit],
    ["dailyRemaining", input.requestsRemaining],
    ["minuteLimit", input.limit],
    ["minuteRemaining", input.remaining],
    ["retryAfterSeconds", input.retryAfterRaw],
  ] as const;
  const parsed: Record<(typeof rawValues)[number][0], number | null> = {
    dailyLimit: null,
    dailyRemaining: null,
    minuteLimit: null,
    minuteRemaining: null,
    retryAfterSeconds: null,
  };
  for (const [key, raw] of rawValues) {
    if (raw === null) continue;
    const value = strictNonNegativeInteger(raw);
    if (value === null) {
      return Object.freeze({
        state: "INVALID",
        ...EMPTY_VALUES,
        rawPresence,
        sanitizedErrorCode: "RATE_LIMIT_VALUE_INVALID",
      });
    }
    parsed[key] = value;
  }
  if (
    (parsed.dailyLimit !== null &&
      parsed.dailyRemaining !== null &&
      parsed.dailyRemaining > parsed.dailyLimit) ||
    (parsed.minuteLimit !== null &&
      parsed.minuteRemaining !== null &&
      parsed.minuteRemaining > parsed.minuteLimit)
  ) {
    return Object.freeze({
      state: "INVALID",
      ...EMPTY_VALUES,
      rawPresence,
      sanitizedErrorCode: "RATE_LIMIT_RELATION_INVALID",
    });
  }
  return Object.freeze({ state: "VALID", ...parsed, rawPresence });
}

function validSafetyConfig(config: RateLimitSafetyConfig): boolean {
  return Number.isSafeInteger(config.dailySafetyThreshold) &&
    config.dailySafetyThreshold >= 0 &&
    typeof config.requireDailyRemaining === "boolean" &&
    typeof config.requireMinuteRemaining === "boolean";
}

function blockingOutcome(
  parsed: ApiFootballRateLimitParseResult,
  config: RateLimitSafetyConfig,
): RateLimitBlockOutcome | null {
  if (!validSafetyConfig(config) || parsed.state === "INVALID") {
    return "BLOCK_HEADERS_INVALID";
  }
  if (
    (config.requireDailyRemaining && parsed.dailyRemaining === null) ||
    (config.requireMinuteRemaining && parsed.minuteRemaining === null)
  ) {
    return "BLOCK_REQUIRED_HEADERS_ABSENT";
  }
  if (parsed.dailyRemaining === 0) return "BLOCK_DAILY_EXHAUSTED";
  if (parsed.minuteRemaining === 0) return "BLOCK_MINUTE_EXHAUSTED";
  if (
    parsed.dailyRemaining !== null &&
    parsed.dailyRemaining < config.dailySafetyThreshold
  ) {
    return "BLOCK_DAILY_THRESHOLD";
  }
  return null;
}

export function evaluateApiFootballRateLimitsForNextRequest(
  parsed: ApiFootballRateLimitParseResult,
  config: RateLimitSafetyConfig,
): RateLimitSafetyEvaluation {
  const blocked = blockingOutcome(parsed, config);
  return blocked === null
    ? Object.freeze({ outcome: "ALLOW" })
    : Object.freeze({ outcome: blocked });
}

export function evaluateApiFootballRateLimitResponse(
  parsed: ApiFootballRateLimitParseResult,
  config: RateLimitSafetyConfig,
): RateLimitSafetyEvaluation {
  const blocked = blockingOutcome(parsed, config);
  if (
    blocked === "BLOCK_DAILY_THRESHOLD" ||
    blocked === "BLOCK_DAILY_EXHAUSTED" ||
    blocked === "BLOCK_MINUTE_EXHAUSTED"
  ) {
    return Object.freeze({
      outcome: "ALLOW_AND_STOP_AFTER_RESPONSE",
      blockReason: blocked,
    });
  }
  return blocked === null
    ? Object.freeze({ outcome: "ALLOW" })
    : Object.freeze({ outcome: blocked });
}
