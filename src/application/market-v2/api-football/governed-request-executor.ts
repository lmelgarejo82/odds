import { CaptureError } from "@/domain/market-v2/capture/errors";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";
import type {
  ProviderRequestAuditRecord,
  ProviderRequestAuditRepository,
  ProviderRequestClassification,
} from "@/domain/market-v2/audit/provider-request-audit-repository";
import type { RetryPolicy, Sleeper } from "@/application/market-v2/capture/retry-policy";
import type {
  RequestBudget,
} from "@/infrastructure/market-v2/api-football/request-budget";
import type {
  RunCircuitBreaker,
  RunCircuitReason,
} from "@/infrastructure/market-v2/api-football/run-circuit-breaker";

export type GovernedClientErrorClassification =
  | "INVALID_CONFIGURATION"
  | "INVALID_REQUEST"
  | "TIMEOUT"
  | "NETWORK_FAILURE"
  | "REDIRECT_BLOCKED"
  | "AUTHENTICATION_REJECTED"
  | "HTTP_PERMANENT_FAILURE"
  | "RATE_LIMITED"
  | "HTTP_RETRYABLE_FAILURE"
  | "RESPONSE_TOO_LARGE"
  | "INVALID_JSON"
  | "INVALID_ENVELOPE"
  | "API_ERRORS_PRESENT";

export type GovernedRateLimitRawInput = Readonly<{
  requestsLimit: string | null;
  requestsRemaining: string | null;
  limit: string | null;
  remaining: string | null;
  retryAfterRaw: string | null;
}>;

export type GovernedRateLimitParseResult = Readonly<{
  state: "VALID" | "ABSENT" | "INVALID";
  dailyLimit: number | null;
  dailyRemaining: number | null;
  minuteLimit: number | null;
  minuteRemaining: number | null;
  retryAfterSeconds: number | null;
}>;

export type GovernedRateLimitEvaluation =
  | Readonly<{ outcome: "ALLOW" }>
  | Readonly<{
      outcome: "ALLOW_AND_STOP_AFTER_RESPONSE";
      blockReason:
        | "BLOCK_DAILY_THRESHOLD"
        | "BLOCK_DAILY_EXHAUSTED"
        | "BLOCK_MINUTE_EXHAUSTED";
    }>
  | Readonly<{
      outcome:
        | "BLOCK_DAILY_THRESHOLD"
        | "BLOCK_DAILY_EXHAUSTED"
        | "BLOCK_MINUTE_EXHAUSTED"
        | "BLOCK_HEADERS_INVALID"
        | "BLOCK_REQUIRED_HEADERS_ABSENT";
    }>;

export type GovernedRateLimitInterpreter = Readonly<{
  parse(input: GovernedRateLimitRawInput): GovernedRateLimitParseResult;
  evaluateResponse(
    parsed: GovernedRateLimitParseResult,
    config: Readonly<{
      dailySafetyThreshold: number;
      requireDailyRemaining: boolean;
      requireMinuteRemaining: boolean;
    }>,
  ): GovernedRateLimitEvaluation;
}>;

export type GovernedClientResponseMetadata = Readonly<{
  httpStatus: number;
  rateLimitHeaders: Readonly<{
    requestsLimit: string | null;
    requestsRemaining: string | null;
    limit: string | null;
    remaining: string | null;
  }>;
  retryAfterRaw: string | null;
}>;

export type GovernedClientResult<T> =
  | Readonly<{
      ok: true;
      payload: T;
      metadata: GovernedClientResponseMetadata;
    }>
  | Readonly<{
      ok: false;
      error: Readonly<{
        classification: GovernedClientErrorClassification;
        retryable: boolean;
        httpStatus?: number;
        sanitizedCode?: string;
      }>;
      metadata?: GovernedClientResponseMetadata;
    }>;

export type GovernedRequestConfiguration = Readonly<{
  maxAttempts: number;
  maxRetries: number;
  dailySafetyThreshold: number;
  requireDailyRemaining: boolean;
  requireMinuteRemaining: boolean;
  maxConsecutiveRetryableFailures: number;
}>;

export type GovernedRequestInput = Readonly<{
  providerKey: "api-football";
  importBatchId?: string | null;
  endpointKey:
    | "fixtures-by-date"
    | "fixtures-by-competition-window"
    | "prediction-by-fixture"
    | "fixture-result-by-id";
  requestKeyHash: string;
  correlationId: string;
}>;

export type GovernedRequestClassification =
  | ProviderRequestClassification
  | "INVALID_REQUEST"
  | "BUDGET_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "AUDIT_FAILED";

type GovernedTerminalState = Readonly<{
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: RunCircuitReason;
  classification: GovernedRequestClassification;
  retryable: false;
}>;

export type GovernedRequestResult<T> =
  | (GovernedTerminalState & Readonly<{ status: "SUCCESS" | "SUCCESS_RUN_BLOCKED"; value: T }>)
  | (GovernedTerminalState &
      Readonly<{
        status:
          | "FAILED"
          | "BUDGET_EXHAUSTED"
          | "CIRCUIT_OPEN"
          | "AUDIT_FAILED";
      }>);

export type GovernedRequestDependencies = Readonly<{
  budget: RequestBudget;
  circuitBreaker: RunCircuitBreaker;
  auditRepository: ProviderRequestAuditRepository;
  retryPolicy: RetryPolicy;
  sleeper: Sleeper;
  clock: Readonly<{ nowUtc(): string }>;
  rateLimits: GovernedRateLimitInterpreter;
}>;

const EMPTY_RATE_LIMITS: GovernedRateLimitParseResult = Object.freeze({
  state: "ABSENT",
  dailyLimit: null,
  dailyRemaining: null,
  minuteLimit: null,
  minuteRemaining: null,
  retryAfterSeconds: null,
});

const INVALID_RATE_LIMITS: GovernedRateLimitParseResult = Object.freeze({
  ...EMPTY_RATE_LIMITS,
  state: "INVALID",
});

function safeToken(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u.test(value);
}

function validConfiguration(config: GovernedRequestConfiguration): boolean {
  return Number.isSafeInteger(config.maxAttempts) && config.maxAttempts > 0 &&
    Number.isSafeInteger(config.maxRetries) && config.maxRetries >= 0 &&
    Number.isSafeInteger(config.dailySafetyThreshold) && config.dailySafetyThreshold >= 0 &&
    typeof config.requireDailyRemaining === "boolean" &&
    typeof config.requireMinuteRemaining === "boolean" &&
    Number.isSafeInteger(config.maxConsecutiveRetryableFailures) &&
    config.maxConsecutiveRetryableFailures > 0;
}

function mapClassification(
  classification: GovernedClientErrorClassification,
): ProviderRequestClassification {
  switch (classification) {
    case "RATE_LIMITED":
      return "RATE_LIMITED";
    case "TIMEOUT":
    case "NETWORK_FAILURE":
    case "HTTP_RETRYABLE_FAILURE":
      return "RETRYABLE_FAILURE";
    case "INVALID_JSON":
    case "INVALID_ENVELOPE":
    case "API_ERRORS_PRESENT":
    case "RESPONSE_TOO_LARGE":
      return "INVALID_RESPONSE";
    default:
      return "PERMANENT_FAILURE";
  }
}

function retryCaptureError(
  classification: ProviderRequestClassification,
): CaptureError {
  return new CaptureError({
    code: classification === "RATE_LIMITED"
      ? "CAPTURE_RATE_LIMITED"
      : "CAPTURE_TEMPORARY_FAILURE",
    retryable: true,
    providerKey: "api-football",
    stage: "PREMATCH",
    sanitizedMessage: "governed request may be retried",
  });
}

function breakerReasonForRateLimit(
  reason:
    | "BLOCK_DAILY_THRESHOLD"
    | "BLOCK_DAILY_EXHAUSTED"
    | "BLOCK_MINUTE_EXHAUSTED",
): RunCircuitReason {
  switch (reason) {
    case "BLOCK_DAILY_EXHAUSTED":
      return "QUOTA_EXHAUSTED";
    case "BLOCK_MINUTE_EXHAUSTED":
      return "MINUTE_LIMIT_EXHAUSTED";
    default:
      return "DAILY_SAFETY_THRESHOLD_REACHED";
  }
}

export class GovernedRequestExecutor {
  constructor(
    readonly dependencies: GovernedRequestDependencies,
    readonly configuration: GovernedRequestConfiguration,
  ) {}

  async execute<T>(
    input: GovernedRequestInput,
    operation: () => Promise<GovernedClientResult<T>>,
  ): Promise<GovernedRequestResult<T>> {
    if (!this.#validLocalInput(input, operation)) {
      return this.#terminal("FAILED", "INVALID_REQUEST");
    }
    if (this.dependencies.circuitBreaker.inspect().state === "OPEN") {
      return this.#terminal("CIRCUIT_OPEN", "CIRCUIT_OPEN");
    }

    let operationAttempt = 0;
    while (true) {
      const reservation = this.dependencies.budget.reserve();
      if (reservation.disposition !== "RESERVED") {
        return this.#terminal("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
      }
      if (this.dependencies.circuitBreaker.inspect().state === "OPEN") {
        this.dependencies.budget.release(reservation.reservation);
        return this.#terminal("CIRCUIT_OPEN", "CIRCUIT_OPEN");
      }

      const startedAtUtc = this.dependencies.clock.nowUtc();
      if (!isNormalizedUtcTimestamp(startedAtUtc)) {
        this.dependencies.budget.release(reservation.reservation);
        return this.#terminal("FAILED", "INVALID_REQUEST");
      }
      const committed = this.dependencies.budget.commit(reservation.reservation);
      if (committed.disposition !== "RESERVED") {
        this.dependencies.budget.release(reservation.reservation);
        return this.#terminal("FAILED", "INVALID_REQUEST");
      }
      operationAttempt += 1;

      const result = await this.#invoke(operation);
      const finishedCandidate = this.dependencies.clock.nowUtc();
      const finishedAtUtc = isNormalizedUtcTimestamp(finishedCandidate)
        ? finishedCandidate
        : null;
      const parsedLimits = this.#parseLimits(result);

      if (result.ok) {
        const success = await this.#handleSuccess(
          input,
          result,
          parsedLimits,
          committed.attemptNumber,
          startedAtUtc,
          finishedAtUtc,
        );
        return success;
      }

      const classification = parsedLimits.state === "INVALID"
        ? "INVALID_RESPONSE"
        : mapClassification(result.error.classification);
      const audited = await this.#appendAudit({
        input,
        attemptNumber: committed.attemptNumber,
        startedAtUtc,
        finishedAtUtc,
        httpStatus: result.error.httpStatus ?? result.metadata?.httpStatus ?? null,
        classification,
        sanitizedErrorCode: parsedLimits.state === "INVALID"
          ? "RATE_LIMIT_HEADERS_INVALID"
          : result.error.sanitizedCode ?? result.error.classification,
        parsedLimits,
      });
      if (!audited) return this.#terminal("AUDIT_FAILED", "AUDIT_FAILED");

      if (parsedLimits.state === "INVALID") {
        this.dependencies.circuitBreaker.open("INVALID_RATE_LIMIT_HEADERS");
        return this.#terminal("FAILED", "INVALID_RESPONSE");
      }
      if (result.error.classification === "AUTHENTICATION_REJECTED") {
        this.dependencies.circuitBreaker.open("AUTHENTICATION_REJECTED");
        return this.#terminal("FAILED", "PERMANENT_FAILURE");
      }
      if (classification !== "RETRYABLE_FAILURE" && classification !== "RATE_LIMITED") {
        this.dependencies.circuitBreaker.recordPermanentFailure();
        return this.#terminal("FAILED", classification);
      }

      this.dependencies.circuitBreaker.recordRetryableFailure();
      if (this.dependencies.circuitBreaker.inspect().state === "OPEN") {
        return this.#terminal("FAILED", classification);
      }
      const retryWithinOperationLimit = operationAttempt <= this.configuration.maxRetries;
      const retryAllowedByPolicy = this.dependencies.retryPolicy.shouldRetry(
        retryCaptureError(classification),
        operationAttempt,
      );
      const hasValidRetryAfter = classification !== "RATE_LIMITED" ||
        (parsedLimits.state === "VALID" && parsedLimits.retryAfterSeconds !== null);
      if (!retryWithinOperationLimit || !retryAllowedByPolicy || !hasValidRetryAfter) {
        return this.#terminal("FAILED", classification);
      }
      if (this.dependencies.budget.inspect().remainingAttempts <= 0) {
        return this.#terminal("BUDGET_EXHAUSTED", "BUDGET_EXHAUSTED");
      }
      const retryDelay = this.dependencies.retryPolicy.delayForAttempt(operationAttempt);
      const retryAfterDelay = classification === "RATE_LIMITED"
        ? Math.min(
            Number.MAX_SAFE_INTEGER,
            (parsedLimits.retryAfterSeconds ?? 0) * 1_000,
          )
        : 0;
      await this.dependencies.sleeper.sleep(Math.max(retryDelay, retryAfterDelay));
    }
  }

  #validLocalInput<T>(
    input: GovernedRequestInput,
    operation: () => Promise<GovernedClientResult<T>>,
  ): boolean {
    const budget = this.dependencies.budget.inspect();
    const circuit = this.dependencies.circuitBreaker.inspect();
    return validConfiguration(this.configuration) &&
      budget.maxAttempts === this.configuration.maxAttempts &&
      circuit.maxConsecutiveRetryableFailures ===
        this.configuration.maxConsecutiveRetryableFailures &&
      input.providerKey === "api-football" &&
      /^[0-9a-f]{64}$/u.test(input.requestKeyHash) &&
      safeToken(input.correlationId) &&
      (input.importBatchId === undefined || input.importBatchId === null ||
        safeToken(input.importBatchId)) &&
      typeof operation === "function";
  }

  async #invoke<T>(
    operation: () => Promise<GovernedClientResult<T>>,
  ): Promise<GovernedClientResult<T>> {
    try {
      return await operation();
    } catch {
      return Object.freeze({
        ok: false,
        error: Object.freeze({
          classification: "NETWORK_FAILURE",
          retryable: true,
          sanitizedCode: "OPERATION_REJECTED",
        }),
      });
    }
  }

  #parseLimits<T>(result: GovernedClientResult<T>): GovernedRateLimitParseResult {
    const metadata = result.metadata;
    if (metadata === undefined) return EMPTY_RATE_LIMITS;
    try {
      return this.dependencies.rateLimits.parse({
        ...metadata.rateLimitHeaders,
        retryAfterRaw: metadata.retryAfterRaw,
      });
    } catch {
      return INVALID_RATE_LIMITS;
    }
  }

  async #handleSuccess<T>(
    input: GovernedRequestInput,
    result: Extract<GovernedClientResult<T>, { ok: true }>,
    parsedLimits: GovernedRateLimitParseResult,
    attemptNumber: number,
    startedAtUtc: string,
    finishedAtUtc: string | null,
  ): Promise<GovernedRequestResult<T>> {
    let evaluation: GovernedRateLimitEvaluation;
    try {
      evaluation = this.dependencies.rateLimits.evaluateResponse(parsedLimits, {
        dailySafetyThreshold: this.configuration.dailySafetyThreshold,
        requireDailyRemaining: this.configuration.requireDailyRemaining,
        requireMinuteRemaining: this.configuration.requireMinuteRemaining,
      });
    } catch {
      evaluation = Object.freeze({ outcome: "BLOCK_HEADERS_INVALID" });
    }
    const invalid = evaluation.outcome === "BLOCK_HEADERS_INVALID" ||
      evaluation.outcome === "BLOCK_REQUIRED_HEADERS_ABSENT";
    const responseBlockReason = evaluation.outcome === "ALLOW_AND_STOP_AFTER_RESPONSE"
      ? evaluation.blockReason
      : evaluation.outcome === "BLOCK_DAILY_THRESHOLD" ||
          evaluation.outcome === "BLOCK_DAILY_EXHAUSTED" ||
          evaluation.outcome === "BLOCK_MINUTE_EXHAUSTED"
        ? evaluation.outcome
        : null;
    const classification: ProviderRequestClassification = invalid
      ? "INVALID_RESPONSE"
      : responseBlockReason === "BLOCK_DAILY_EXHAUSTED"
        ? "QUOTA_EXHAUSTED"
        : "SUCCESS";
    const audited = await this.#appendAudit({
      input,
      attemptNumber,
      startedAtUtc,
      finishedAtUtc,
      httpStatus: result.metadata.httpStatus,
      classification,
      sanitizedErrorCode: invalid ? "RATE_LIMIT_HEADERS_INVALID" : null,
      parsedLimits,
    });
    if (!audited) return this.#terminal("AUDIT_FAILED", "AUDIT_FAILED");
    if (invalid) {
      this.dependencies.circuitBreaker.open("INVALID_RATE_LIMIT_HEADERS");
      return this.#terminal("FAILED", "INVALID_RESPONSE");
    }

    this.dependencies.circuitBreaker.recordSuccess();
    if (responseBlockReason !== null) {
      this.dependencies.circuitBreaker.open(breakerReasonForRateLimit(responseBlockReason));
      return this.#success("SUCCESS_RUN_BLOCKED", result.payload, classification);
    }
    return this.#success("SUCCESS", result.payload, "SUCCESS");
  }

  async #appendAudit(details: Readonly<{
    input: GovernedRequestInput;
    attemptNumber: number;
    startedAtUtc: string;
    finishedAtUtc: string | null;
    httpStatus: number | null;
    classification: ProviderRequestClassification;
    sanitizedErrorCode: string | null;
    parsedLimits: GovernedRateLimitParseResult;
  }>): Promise<boolean> {
    const limits = details.parsedLimits.state === "INVALID"
      ? EMPTY_RATE_LIMITS
      : details.parsedLimits;
    const record: ProviderRequestAuditRecord = Object.freeze({
      providerKey: details.input.providerKey,
      importBatchId: details.input.importBatchId ?? null,
      endpointKey: details.input.endpointKey,
      requestKeyHash: details.input.requestKeyHash,
      correlationId: details.input.correlationId,
      attemptNumber: details.attemptNumber,
      startedAtUtc: details.startedAtUtc,
      finishedAtUtc: details.finishedAtUtc,
      httpStatus: details.httpStatus,
      classification: details.classification,
      sanitizedErrorCode: details.sanitizedErrorCode,
      dailyLimit: limits.dailyLimit,
      dailyRemaining: limits.dailyRemaining,
      minuteLimit: limits.minuteLimit,
      minuteRemaining: limits.minuteRemaining,
    });
    try {
      const result = await this.dependencies.auditRepository.append(record);
      if (result.ok) return true;
    } catch {
      // The attempted transport remains consumed; only sanitized state escapes.
    }
    this.dependencies.circuitBreaker.open("AUDIT_PERSISTENCE_FAILURE");
    return false;
  }

  #success<T>(
    status: "SUCCESS" | "SUCCESS_RUN_BLOCKED",
    value: T,
    classification: ProviderRequestClassification,
  ): GovernedRequestResult<T> {
    return Object.freeze({ ...this.#state(classification), status, value });
  }

  #terminal<T>(
    status: "FAILED" | "BUDGET_EXHAUSTED" | "CIRCUIT_OPEN" | "AUDIT_FAILED",
    classification: GovernedRequestClassification,
  ): GovernedRequestResult<T> {
    return Object.freeze({ ...this.#state(classification), status });
  }

  #state(classification: GovernedRequestClassification): GovernedTerminalState {
    const budget = this.dependencies.budget.inspect();
    const circuit = this.dependencies.circuitBreaker.inspect();
    return Object.freeze({
      attemptsUsed: budget.startedAttempts,
      remainingBudget: budget.remainingAttempts,
      circuitState: circuit.state,
      ...(circuit.reason === undefined ? {} : { circuitReason: circuit.reason }),
      classification,
      retryable: false,
    });
  }
}
