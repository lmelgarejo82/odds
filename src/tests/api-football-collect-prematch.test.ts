import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  collectPrematch,
  type CollectPrematchInput,
  type PrematchCaptureProviderPort,
  type PrematchProviderResult,
  type PrematchTarget,
} from "@/application/market-v2/api-football/collect-prematch";
import { GovernedRequestExecutor } from "@/application/market-v2/api-football/governed-request-executor";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import type { ProviderRequestAuditRecord, ProviderRequestAuditRepository } from "@/domain/market-v2/audit/provider-request-audit-repository";
import type { CapturedFixture, PredictionSnapshot } from "@/domain/market-v2/capture/types";
import { evaluateApiFootballRateLimitResponse, parseApiFootballRateLimits } from "@/infrastructure/market-v2/api-football/rate-limit-parser";
import { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
beforeAll(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_PREMATCH_COLLECTOR_TEST");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(fetchCalls).toBe(0);
});

class AuditFake implements ProviderRequestAuditRepository {
  readonly records: ProviderRequestAuditRecord[] = [];
  fail = false;
  async append(record: ProviderRequestAuditRecord) {
    this.records.push(record);
    return this.fail
      ? { ok: false as const, disposition: "FAILED" as const, error: { classification: "FAILED" as const, retryable: false as const, sanitizedCode: "SYNTHETIC_AUDIT_FAILURE" } }
      : { ok: true as const, disposition: "CREATED" as const };
  }
}

const target = (id = "900001"): PrematchTarget => Object.freeze({
  providerKey: "api-football",
  canonicalFixtureId: `canonical-${id}`,
  providerFixtureId: id,
  providerCompetitionId: "910001",
  season: "2030",
  homeProviderTeamId: "920001",
  homeName: "Synthetic Home FC",
  awayProviderTeamId: "920002",
  awayName: "Synthetic Away FC",
  kickoffUtc: "2030-01-01T18:00:00.000Z",
  sourceTimezone: "UTC",
});

function capturedFixture(
  binding: PrematchTarget,
  options: Readonly<{
    capturedAtUtc?: string;
    rawStatusCode?: string;
    canonicalStatus?: "SCHEDULED" | "FINISHED" | "POSTPONED" | "CANCELLED" | "UNKNOWN";
    identityPatch?: Partial<PrematchTarget>;
  }> = {},
): CapturedFixture {
  const identity = { ...binding, ...options.identityPatch };
  const canonicalStatus = options.canonicalStatus ?? "SCHEDULED";
  const fields = {
    providerKey: identity.providerKey,
    providerFixtureId: identity.providerFixtureId,
    capturedAtUtc: options.capturedAtUtc ?? "2030-01-01T17:00:00.000Z",
    sourceDate: identity.kickoffUtc,
    sourceTimestamp: "1893520800",
    sourceTimezone: identity.sourceTimezone,
    rawStatusCode: options.rawStatusCode ?? "NS",
    competition: { providerCompetitionId: identity.providerCompetitionId, name: "Synthetic League", country: "Synthetic" },
    season: identity.season,
    round: "Synthetic Round",
    home: { providerTeamId: identity.homeProviderTeamId, name: identity.homeName },
    away: { providerTeamId: identity.awayProviderTeamId, name: identity.awayName },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null }, fulltime: { home: null, away: null },
      extratime: { home: null, away: null }, penalty: { home: null, away: null },
    },
  } as const;
  return canonicalStatus === "SCHEDULED" || canonicalStatus === "FINISHED"
    ? Object.freeze({ ...fields, canonicalStatus, automaticUseBlocked: false })
    : Object.freeze({ ...fields, canonicalStatus, automaticUseBlocked: true });
}

function prediction(binding: PrematchTarget, capturedAtUtc: string): PredictionSnapshot {
  return Object.freeze({
    providerKey: "api-football", providerFixtureId: binding.providerFixtureId, capturedAtUtc,
    predictionCapturedBeforeKickoff: capturedAtUtc < binding.kickoffUtc,
    selections: Object.freeze([
      Object.freeze({ selection: "HOME", rawPercentage: "45%", normalizedProbability: "0.45" }),
      Object.freeze({ selection: "DRAW", rawPercentage: "30%", normalizedProbability: "0.30" }),
      Object.freeze({ selection: "AWAY", rawPercentage: "25%", normalizedProbability: "0.25" }),
    ] as const),
    probabilityTotalRaw: "100%", predictedWinnerProviderTeamId: binding.homeProviderTeamId,
    predictedWinnerName: binding.homeName, winnerComment: "Synthetic", advice: "Synthetic advice",
    underOverRaw: "Synthetic", providerInternalTimestamp: null, contentHash: "c".repeat(64),
    parserVersion: "synthetic-parser/1", policyVersion: "synthetic-policy/1",
  });
}

type GovernedInput = Parameters<PrematchCaptureProviderPort["captureSelectedFixtureGoverned"]>[0]["governance"];

class FakePrematchProvider implements PrematchCaptureProviderPort {
  readonly order: string[] = [];
  fixtureCalls = 0;
  predictionCalls = 0;
  rawPredictions = 0;
  fixtureOptions: Parameters<typeof capturedFixture>[1] = {};
  fixtureFailure: Readonly<{ classification: string; code: string; conflict?: boolean }> | null = null;
  predictionFailure: Readonly<{ classification: string; code: string; conflict?: boolean }> | null = null;
  predictionCapturedAtUtc = "2030-01-01T17:05:00.000Z";
  fixtureRemaining: string | null = "20";
  fixtureMinuteRemaining: string | null = null;
  predictionRemaining: string | null = "20";
  fixtureRetryOnce = false;
  clientFailure: "AUTHENTICATION_REJECTED" | null = null;
  predictionDisposition: "CREATED" | "REPLAYED" = "CREATED";

  async governed<T>(
    governance: GovernedInput,
    value: T,
    remaining: string | null,
    minuteRemaining: string | null,
    retryOnce: boolean,
  ) {
    let calls = 0;
    return governance.executor.execute(governance.request, async () => {
      calls += 1;
      if (this.clientFailure !== null) {
        return { ok: false as const, error: { classification: this.clientFailure, retryable: false } };
      }
      if (retryOnce && calls === 1) {
        return { ok: false as const, error: { classification: "TIMEOUT" as const, retryable: true } };
      }
      return {
        ok: true as const,
        payload: value,
        metadata: {
          httpStatus: 200,
          rateLimitHeaders: { requestsLimit: null, requestsRemaining: remaining, limit: null, remaining: minuteRemaining },
          retryAfterRaw: null,
        },
      };
    });
  }

  state<T>(
    governed: Awaited<ReturnType<GovernedRequestExecutor["execute"]>>,
    value: T,
    failure: FakePrematchProvider["fixtureFailure"],
    disposition: "CREATED" | "REPLAYED",
  ): PrematchProviderResult<T> {
    const shared = {
      governanceStatus: governed.status,
      attemptsUsed: governed.attemptsUsed,
      remainingBudget: governed.remainingBudget,
      circuitState: governed.circuitState,
      ...(governed.circuitReason === undefined ? {} : { circuitReason: governed.circuitReason }),
    } as const;
    if (governed.status !== "SUCCESS" && governed.status !== "SUCCESS_RUN_BLOCKED") {
      const classification = governed.status === "AUDIT_FAILED" ? "AUDIT_FAILURE"
        : governed.status === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED"
          : governed.status === "CIRCUIT_OPEN" ? "CIRCUIT_OPEN" : "CLIENT_FAILURE";
      return { ...shared, ok: false, classification, sanitizedCode: governed.classification, conflict: false };
    }
    if (failure !== null) {
      return { ...shared, ok: false, classification: failure.classification, sanitizedCode: failure.code, conflict: failure.conflict ?? false };
    }
    return { ...shared, ok: true, data: value, persistenceDisposition: disposition };
  }

  async captureSelectedFixtureGoverned(input: Parameters<PrematchCaptureProviderPort["captureSelectedFixtureGoverned"]>[0]) {
    this.fixtureCalls += 1;
    this.order.push(`fixture:${input.binding.providerFixtureId}`);
    const value = capturedFixture(input.binding, this.fixtureOptions);
    const governed = await this.governed(input.governance, value, this.fixtureRemaining, this.fixtureMinuteRemaining, this.fixtureRetryOnce);
    return this.state(governed, value, this.fixtureFailure, "CREATED");
  }

  async capturePrematchPredictionGoverned(input: Parameters<PrematchCaptureProviderPort["capturePrematchPredictionGoverned"]>[0]) {
    this.predictionCalls += 1;
    this.rawPredictions += 1;
    this.order.push(`prediction:${input.binding.providerFixtureId}`);
    const value = prediction(input.binding, this.predictionCapturedAtUtc);
    const governed = await this.governed(input.governance, value, this.predictionRemaining, null, false);
    const chronologyFailure = value.predictionCapturedBeforeKickoff ? this.predictionFailure : {
      classification: "CHRONOLOGY_FAILURE", code: "POST_KICKOFF_PREDICTION_BLOCKED",
    };
    return this.state(governed, value, chronologyFailure, this.predictionDisposition);
  }
}

function harness(maxAttempts = 8, targets: readonly PrematchTarget[] = [target()]) {
  const budget = new RequestBudget(maxAttempts);
  const circuitBreaker = new RunCircuitBreaker(4);
  const audit = new AuditFake();
  let clockCall = 0;
  const executor = new GovernedRequestExecutor({
    budget, circuitBreaker, auditRepository: audit, sleeper: new FakeSleeper(),
    clock: { nowUtc: () => `2030-01-01T16:00:0${Math.min(++clockCall, 9)}.000Z` },
    retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMilliseconds: 0, maximumDelayMilliseconds: 0 }),
    rateLimits: { parse: parseApiFootballRateLimits, evaluateResponse: evaluateApiFootballRateLimitResponse },
  }, { maxAttempts, maxRetries: 1, dailySafetyThreshold: 20, requireDailyRemaining: false, requireMinuteRemaining: false, maxConsecutiveRetryableFailures: 4 });
  const provider = new FakePrematchProvider();
  const input: CollectPrematchInput = {
    runId: "synthetic-prematch-run", targets, maxTargets: 10, budget, circuitBreaker, executor, provider,
    requestIdentityFactory: ({ operation, ordinal }) => ({ requestKeyHash: (operation === "FIXTURE" ? "a" : "b").repeat(63) + String(ordinal % 10), correlationId: `synthetic-${operation.toLowerCase()}-${ordinal}` }),
    parserVersion: "synthetic-parser/1", policyVersion: "synthetic-policy/1",
  };
  return { input, provider, budget, circuitBreaker, audit, executor };
}

describe("collectPrematch governed workflow", () => {
  it("captures fixture before prediction with shared budget, breaker, and one audit per attempt", async () => {
    const h = harness();
    const result = await collectPrematch(h.input);
    expect(result).toMatchObject({ status: "COMPLETE", attemptsUsed: 2, remainingBudget: 6 });
    expect(result.targets[0]).toMatchObject({ status: "PREMATCH_CAPTURED", canonicalFixtureId: "canonical-900001" });
    expect(h.provider.order).toEqual(["fixture:900001", "prediction:900001"]);
    expect(h.audit.records).toHaveLength(2);
    expect(h.executor.dependencies.budget).toBe(h.budget);
    expect(h.executor.dependencies.circuitBreaker).toBe(h.circuitBreaker);
  });

  it.each([
    ["FIXTURE_NOT_FOUND", "FIXTURE_NOT_FOUND"], ["FIXTURE_AMBIGUOUS", "FIXTURE_AMBIGUOUS"],
  ] as const)("reports exact selection failure %s without prediction", async (code, status) => {
    const h = harness();
    h.provider.fixtureFailure = { classification: "RESPONSE_CARDINALITY_INVALID", code };
    const result = await collectPrematch(h.input);
    expect(result.targets[0].status).toBe(status);
    expect(h.provider.predictionCalls).toBe(0);
  });

  it.each([
    { providerFixtureId: "900009" }, { providerCompetitionId: "999" }, { season: "2029" },
    { homeProviderTeamId: "920002", homeName: "Synthetic Away FC", awayProviderTeamId: "920001", awayName: "Synthetic Home FC" },
    { kickoffUtc: "2030-01-02T18:00:00.000Z" },
  ] as const)("blocks an explicit identity contradiction", async (identityPatch) => {
    const h = harness();
    h.provider.fixtureOptions = { identityPatch };
    const result = await collectPrematch(h.input);
    expect(result.targets[0].status).toBe("IDENTITY_MISMATCH");
    expect(h.provider.predictionCalls).toBe(0);
  });

  it.each([
    ["TBD", "UNKNOWN"], ["FT", "FINISHED"], ["AET", "FINISHED"], ["PEN", "FINISHED"],
    ["PST", "POSTPONED"], ["CANC", "CANCELLED"], ["UNREGISTERED", "UNKNOWN"],
  ] as const)("blocks status %s before prediction", async (rawStatusCode, canonicalStatus) => {
    const h = harness();
    h.provider.fixtureOptions = { rawStatusCode, canonicalStatus };
    const result = await collectPrematch(h.input);
    expect(result.targets[0].status).toBe("STATUS_BLOCKED");
    expect(h.provider.predictionCalls).toBe(0);
  });

  it.each(["2030-01-01T18:00:00.000Z", "2030-01-01T18:01:00.000Z"])(
    "blocks a fixture observed at or after kickoff: %s",
    async (capturedAtUtc) => {
      const h = harness();
      h.provider.fixtureOptions = { capturedAtUtc };
      const result = await collectPrematch(h.input);
      expect(result.targets[0].status).toBe("KICKOFF_NOT_FUTURE");
      expect(h.provider.predictionCalls).toBe(0);
    },
  );

  it.each(["2030-01-01T18:00:00.000Z", "2030-01-01T18:01:00.000Z"])(
    "preserves raw but blocks prediction persistence at/after kickoff: %s",
    async (capturedAtUtc) => {
      const h = harness();
      h.provider.predictionCapturedAtUtc = capturedAtUtc;
      const result = await collectPrematch(h.input);
      expect(result.targets[0].status).toBe("POST_KICKOFF_PREDICTION_BLOCKED");
      expect(h.provider.rawPredictions).toBe(1);
    },
  );

  it("accepts replay and another prematch capture without replacement semantics", async () => {
    const h = harness();
    h.provider.predictionDisposition = "REPLAYED";
    expect((await collectPrematch(h.input)).targets[0].status).toBe("REPLAYED");
    const later = harness();
    later.provider.predictionCapturedAtUtc = "2030-01-01T17:30:00.000Z";
    expect((await collectPrematch(later.input)).targets[0]).toMatchObject({ status: "PREMATCH_CAPTURED", capturedAtUtc: "2030-01-01T17:30:00.000Z" });
  });

  it.each([
    ["19", null, false], ["20", null, true], ["20", "0", false],
  ] as const)("applies fixture limits daily=%s minute=%s", async (daily, minute, predictionRequested) => {
    const h = harness();
    h.provider.fixtureRemaining = daily;
    h.provider.fixtureMinuteRemaining = minute;
    const result = await collectPrematch(h.input);
    expect(h.provider.predictionCalls > 0).toBe(predictionRequested);
    expect(result.status).toBe(predictionRequested ? "COMPLETE" : "BLOCKED");
  });

  it("does not request prediction when the shared budget ends after fixture", async () => {
    const h = harness(1);
    const result = await collectPrematch(h.input);
    expect(result.targets[0].status).toBe("BUDGET_EXHAUSTED");
    expect(h.provider.predictionCalls).toBe(0);
  });

  it("a retry consumes the same run budget and creates another audit", async () => {
    const h = harness();
    h.provider.fixtureRetryOnce = true;
    const result = await collectPrematch(h.input);
    expect(result.attemptsUsed).toBe(3);
    expect(h.audit.records).toHaveLength(3);
  });

  it.each(["AUTH", "AUDIT"] as const)("stops the run on %s failure", async (failure) => {
    const h = harness();
    if (failure === "AUTH") h.provider.clientFailure = "AUTHENTICATION_REJECTED";
    else h.audit.fail = true;
    const result = await collectPrematch(h.input);
    expect(result.status).toBe("BLOCKED");
    expect(result.targets[0].status).toBe(failure === "AUTH" ? "REQUEST_FAILED" : "AUDIT_FAILED");
    expect(h.provider.predictionCalls).toBe(0);
    expect(h.circuitBreaker.inspect().state).toBe("OPEN");
  });

  it("passes remaining budget to a second target", async () => {
    const h = harness(6, [target("900001"), target("900002")]);
    const result = await collectPrematch(h.input);
    expect(result.status).toBe("COMPLETE");
    expect(result.attemptsUsed).toBe(4);
    expect(h.provider.order).toEqual(["fixture:900001", "prediction:900001", "fixture:900002", "prediction:900002"]);
  });

  it("rejects duplicates and maxTargets before IO", async () => {
    const duplicate = harness(8, [target(), target()]);
    expect((await collectPrematch(duplicate.input)).status).toBe("INVALID_INPUT");
    expect(duplicate.provider.fixtureCalls).toBe(0);
    const limited = harness();
    expect((await collectPrematch({ ...limited.input, maxTargets: 0 })).status).toBe("INVALID_INPUT");
    expect(limited.provider.fixtureCalls).toBe(0);
    const invalidTimezone = harness();
    const invalidTarget = { ...target(), sourceTimezone: "Europe/Berlin" as "UTC" };
    expect((await collectPrematch({ ...invalidTimezone.input, targets: [invalidTarget] })).status)
      .toBe("INVALID_INPUT");
    expect(invalidTimezone.provider.fixtureCalls).toBe(0);
  });

  it("returns sanitized partial output and exposes no outcome, odds, decisions, or settlement", async () => {
    const h = harness(4, [target("900001"), target("900002")]);
    h.provider.predictionFailure = { classification: "MAPPING_FAILURE", code: "SYNTHETIC_MAPPING_FAILURE" };
    const result = await collectPrematch(h.input);
    const serialized = JSON.stringify(result);
    expect(result.status).toBe("PARTIAL");
    for (const forbidden of ["rawBytes", "headers", "apiKey", "outcome", "odds", "decision", "settlement", "Double Chance"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(fetchCalls).toBe(0);
  });
});
