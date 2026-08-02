import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  resolveOutcomes,
  type OutcomeCaptureProviderPort,
  type OutcomeProviderResult,
  type OutcomeTarget,
  type ResolveOutcomesInput,
} from "@/application/market-v2/api-football/resolve-outcomes";
import { GovernedRequestExecutor } from "@/application/market-v2/api-football/governed-request-executor";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import type { ProviderRequestAuditRecord, ProviderRequestAuditRepository } from "@/domain/market-v2/audit/provider-request-audit-repository";
import type { ProviderOutcomeResolution } from "@/domain/market-v2/outcome/outcome-repository";
import { evaluateApiFootballRateLimitResponse, parseApiFootballRateLimits } from "@/infrastructure/market-v2/api-football/rate-limit-parser";
import { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";

const originalFetch = globalThis.fetch;
let fetchCalls = 0;
beforeAll(() => {
  globalThis.fetch = (async () => {
    fetchCalls += 1;
    throw new Error("NETWORK_FORBIDDEN_IN_OUTCOME_RESOLVER_TEST");
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

const target = (id = "900002"): OutcomeTarget => Object.freeze({
  providerKey: "api-football", canonicalFixtureId: `canonical-${id}`, providerFixtureId: id,
  providerCompetitionId: "910001", season: "2030", homeProviderTeamId: "920001",
  homeName: "Synthetic Home FC", awayProviderTeamId: "920002", awayName: "Synthetic Away FC",
  kickoffUtc: "2030-01-01T18:00:00.000Z", sourceTimezone: "UTC",
});

function resolution(
  result1X2: "HOME" | "DRAW" | "AWAY" = "HOME",
  terminal: "FT" | "AET" | "PEN" = "FT",
): ProviderOutcomeResolution {
  const regulation = result1X2 === "HOME" ? [2, 1] as const
    : result1X2 === "AWAY" ? [0, 2] as const : [1, 1] as const;
  return Object.freeze({
    providerFixtureId: "900002", capturedAtUtc: "2030-01-02T12:00:00.000Z",
    providerTerminalStatusRaw: terminal, result1X2Scope: "REGULATION_TIME", result1X2,
    regulationHomeScore: regulation[0], regulationAwayScore: regulation[1],
    extraTimeHomeScore: terminal === "AET" || terminal === "PEN" ? 2 : null,
    extraTimeAwayScore: terminal === "AET" || terminal === "PEN" ? 2 : null,
    penaltyHomeScore: terminal === "PEN" ? 5 : null,
    penaltyAwayScore: terminal === "PEN" ? 4 : null,
    shootoutWinner: terminal === "PEN" ? "HOME" : null,
    goalsHomeScore: terminal === "PEN" ? 2 : regulation[0], goalsAwayScore: terminal === "PEN" ? 2 : regulation[1],
  });
}

type OutcomeInput = Parameters<OutcomeCaptureProviderPort["captureOutcomeGoverned"]>[0];

class FakeOutcomeProvider implements OutcomeCaptureProviderPort {
  calls = 0;
  transportCalls = 0;
  value: ProviderOutcomeResolution = resolution();
  failure: Readonly<{ classification: string; code: string; rawStatusCode?: string; conflict?: boolean }> | null = null;
  disposition: "CREATED" | "REPLAYED" = "CREATED";
  dailyRemaining: string | null = "20";
  minuteRemaining: string | null = null;
  retryOnce = false;

  async captureOutcomeGoverned(input: OutcomeInput): Promise<OutcomeProviderResult> {
    this.calls += 1;
    let attempt = 0;
    const governed = await input.governance.executor.execute(input.governance.request, async () => {
      attempt += 1;
      this.transportCalls += 1;
      if (this.retryOnce && attempt === 1) {
        return { ok: false as const, error: { classification: "TIMEOUT" as const, retryable: true } };
      }
      return {
        ok: true as const, payload: this.value,
        metadata: { httpStatus: 200, rateLimitHeaders: { requestsLimit: null, requestsRemaining: this.dailyRemaining, limit: null, remaining: this.minuteRemaining }, retryAfterRaw: null },
      };
    });
    const shared = {
      governanceStatus: governed.status, attemptsUsed: governed.attemptsUsed,
      remainingBudget: governed.remainingBudget, circuitState: governed.circuitState,
      ...(governed.circuitReason === undefined ? {} : { circuitReason: governed.circuitReason }),
    } as const;
    if (governed.status !== "SUCCESS" && governed.status !== "SUCCESS_RUN_BLOCKED") {
      const classification = governed.status === "AUDIT_FAILED" ? "AUDIT_FAILURE"
        : governed.status === "BUDGET_EXHAUSTED" ? "BUDGET_EXHAUSTED"
          : governed.status === "CIRCUIT_OPEN" ? "CIRCUIT_OPEN" : "CLIENT_FAILURE";
      return { ...shared, ok: false, classification, sanitizedCode: governed.classification, conflict: false };
    }
    if (this.failure !== null) {
      return { ...shared, ok: false, classification: this.failure.classification, sanitizedCode: this.failure.code, rawStatusCode: this.failure.rawStatusCode, conflict: this.failure.conflict ?? false };
    }
    return { ...shared, ok: true, data: { ...this.value, providerFixtureId: input.binding.providerFixtureId }, persistenceDisposition: this.disposition };
  }
}

function harness(maxAttempts = 6, targets: readonly OutcomeTarget[] = [target()]) {
  const budget = new RequestBudget(maxAttempts);
  const circuitBreaker = new RunCircuitBreaker(4);
  const audit = new AuditFake();
  let clockCall = 0;
  const executor = new GovernedRequestExecutor({
    budget, circuitBreaker, auditRepository: audit, sleeper: new FakeSleeper(),
    clock: { nowUtc: () => `2030-01-02T12:00:0${Math.min(++clockCall, 9)}.000Z` },
    retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMilliseconds: 0, maximumDelayMilliseconds: 0 }),
    rateLimits: { parse: parseApiFootballRateLimits, evaluateResponse: evaluateApiFootballRateLimitResponse },
  }, { maxAttempts, maxRetries: 1, dailySafetyThreshold: 20, requireDailyRemaining: false, requireMinuteRemaining: false, maxConsecutiveRetryableFailures: 4 });
  const provider = new FakeOutcomeProvider();
  const input: ResolveOutcomesInput = {
    runId: "synthetic-outcome-run", targets, maxTargets: 10, budget, circuitBreaker, executor, provider,
    requestIdentityFactory: ({ ordinal }) => ({ requestKeyHash: "d".repeat(63) + String(ordinal % 10), correlationId: `synthetic-outcome-${ordinal}` }),
  };
  return { input, provider, budget, circuitBreaker, audit };
}

describe("resolveOutcomes governed workflow", () => {
  it.each([
    ["HOME", "FT"], ["DRAW", "FT"], ["AWAY", "FT"], ["DRAW", "AET"], ["DRAW", "PEN"],
  ] as const)("resolves %s at terminal status %s", async (result1X2, terminal) => {
    const h = harness();
    h.provider.value = resolution(result1X2, terminal);
    const result = await resolveOutcomes(h.input);
    expect(result.targets[0]).toMatchObject({ status: "RESOLVED_CREATED", result1X2, terminalStatus: terminal });
    if (terminal === "PEN") {
      expect(result.targets[0]).toMatchObject({ result1X2: "DRAW", shootoutWinner: "HOME", regulationHomeScore: 1, regulationAwayScore: 1, penaltyHomeScore: 5, penaltyAwayScore: 4 });
    }
    expect(h.audit.records).toHaveLength(1);
  });

  it.each(["NS", "TBD", "PST", "CANC", "UNREGISTERED"])(
    "treats %s as non-terminal without polling or persistence",
    async (rawStatusCode) => {
      const h = harness();
      h.provider.failure = { classification: "MAPPING_FAILURE", code: "RESULT_NOT_TERMINAL", rawStatusCode };
      const result = await resolveOutcomes(h.input);
      expect(result.targets[0]).toMatchObject({ status: "PENDING_NOT_TERMINAL", terminalStatus: rawStatusCode });
      expect(h.provider.calls).toBe(1);
      expect(h.provider.transportCalls).toBe(1);
    },
  );

  it.each([
    ["RESULT_SCORE_INCOMPLETE", "RESULT_SCORE_INCOMPLETE"],
    ["INVALID_SCORE_SEMANTICS", "INVALID_SCORE_SEMANTICS"],
  ] as const)("blocks invalid terminal score: %s", async (code, status) => {
    const h = harness();
    h.provider.failure = { classification: "MAPPING_FAILURE", code, rawStatusCode: "PEN" };
    expect((await resolveOutcomes(h.input)).targets[0].status).toBe(status);
  });

  it.each(["fixture", "league", "season", "home", "away", "orientation", "kickoff", "timezone"])(
    "reports identity mismatch for %s contradiction",
    async () => {
      const h = harness();
      h.provider.failure = { classification: "IDENTITY_MISMATCH", code: "EXPLICIT_FIXTURE_BINDING_MISMATCH" };
      expect((await resolveOutcomes(h.input)).targets[0].status).toBe("IDENTITY_MISMATCH");
    },
  );

  it("preserves CREATED, REPLAYED, and reports conflict without update/delete", async () => {
    const created = harness();
    expect((await resolveOutcomes(created.input)).targets[0].status).toBe("RESOLVED_CREATED");
    const replay = harness();
    replay.provider.disposition = "REPLAYED";
    expect((await resolveOutcomes(replay.input)).targets[0].status).toBe("RESOLVED_REPLAYED");
    const conflict = harness();
    conflict.provider.failure = { classification: "PERSISTENCE_FAILURE", code: "OUTCOME_CONFLICT", conflict: true };
    expect((await resolveOutcomes(conflict.input)).targets[0].status).toBe("PERSISTENCE_CONFLICT");
    expect("update" in conflict.provider).toBe(false);
    expect("delete" in conflict.provider).toBe(false);
  });

  it("bounds retry, consumes shared budget, and audits each attempt", async () => {
    const h = harness();
    h.provider.retryOnce = true;
    const result = await resolveOutcomes(h.input);
    expect(result).toMatchObject({ status: "COMPLETE", attemptsUsed: 2 });
    expect(h.provider.transportCalls).toBe(2);
    expect(h.audit.records).toHaveLength(2);
  });

  it("shares budget across targets", async () => {
    const h = harness(3, [target("900002"), target("900003")]);
    const result = await resolveOutcomes(h.input);
    expect(result.attemptsUsed).toBe(2);
    expect(result.remainingBudget).toBe(1);
    expect(h.provider.calls).toBe(2);
  });

  it.each([
    ["19", null], ["20", "0"],
  ] as const)("processes current result then blocks later target at daily=%s minute=%s", async (daily, minute) => {
    const h = harness(4, [target("900002"), target("900003")]);
    h.provider.dailyRemaining = daily;
    h.provider.minuteRemaining = minute;
    const result = await resolveOutcomes(h.input);
    expect(result.status).toBe("BLOCKED");
    expect(result.targets[0].status).toBe("RESOLVED_CREATED");
    expect(result.targets[1].status).toBe("CIRCUIT_OPEN");
    expect(h.provider.calls).toBe(1);
  });

  it("prevents transport when budget or breaker is unavailable", async () => {
    const exhausted = harness(1, [target("900002"), target("900003")]);
    const budgetResult = await resolveOutcomes(exhausted.input);
    expect(budgetResult.targets[1].status).toBe("BUDGET_EXHAUSTED");
    expect(exhausted.provider.calls).toBe(1);
    const open = harness();
    open.circuitBreaker.open("QUOTA_EXHAUSTED");
    expect((await resolveOutcomes(open.input)).targets[0].status).toBe("CIRCUIT_OPEN");
    expect(open.provider.calls).toBe(0);
  });

  it("stops on audit failure", async () => {
    const h = harness();
    h.audit.fail = true;
    const result = await resolveOutcomes(h.input);
    expect(result).toMatchObject({ status: "BLOCKED", circuitReason: "AUDIT_PERSISTENCE_FAILURE" });
    expect(result.targets[0].status).toBe("AUDIT_FAILED");
  });

  it("rejects duplicate targets and maxTargets before IO", async () => {
    const duplicate = harness(4, [target(), target()]);
    expect((await resolveOutcomes(duplicate.input)).status).toBe("INVALID_INPUT");
    expect(duplicate.provider.calls).toBe(0);
    const limited = harness();
    expect((await resolveOutcomes({ ...limited.input, maxTargets: 0 })).status).toBe("INVALID_INPUT");
    expect(limited.provider.calls).toBe(0);
  });

  it("exposes no prediction, advice, odds, raw, credentials, decisions, or settlement", async () => {
    const h = harness();
    const serialized = JSON.stringify(await resolveOutcomes(h.input));
    for (const forbidden of ["prediction", "advice", "odds", "rawBytes", "headers", "apiKey", "decision", "settlement", "payout"]) {
      expect(serialized).not.toContain(forbidden);
    }
    expect(fetchCalls).toBe(0);
  });
});
