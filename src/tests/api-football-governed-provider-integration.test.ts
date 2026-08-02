import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { GovernedRequestExecutor, type GovernedRequestInput } from "@/application/market-v2/api-football/governed-request-executor";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import type { RawEvidenceCandidate, RawEvidenceDescriptor, RawEvidenceStore, RawEvidenceStoreResult } from "@/application/market-v2/capture/raw-evidence-store";
import type { ProviderRequestAuditAppendResult, ProviderRequestAuditRecord, ProviderRequestAuditRepository } from "@/domain/market-v2/audit/provider-request-audit-repository";
import { ApiFootballClient, ApiFootballClientError } from "@/infrastructure/market-v2/api-football/client";
import { buildApiFootballConfig } from "@/infrastructure/market-v2/api-football/config";
import { mapApiFootballFixture, mapApiFootballPrediction, mapApiFootballResult } from "@/infrastructure/market-v2/api-football/mappers";
import { ApiFootballProvider, type ApiFootballExplicitFixtureBinding, type ApiFootballProviderClient, type ApiFootballProviderMappers } from "@/infrastructure/market-v2/api-football/provider";
import { evaluateApiFootballRateLimitResponse, parseApiFootballRateLimits } from "@/infrastructure/market-v2/api-football/rate-limit-parser";
import { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";
import type { ApiFootballPersistencePort, ApiFootballPersistenceResult, PersistedFixtureBinding, PersistedOutcome, PersistedPrediction, PersistFixtureCaptureInput, PersistOutcomeCaptureInput, PersistPredictionCaptureInput } from "@/infrastructure/market-v2/persistence/api-football-repositories";
import { buildSyntheticFixtureEnvelopeWithArrayErrors, buildSyntheticFixtureFtHome, buildSyntheticFixturePen, buildSyntheticPredictionEnvelope } from "@/tests/fixtures/api-football";

const originalFetch = globalThis.fetch;
let globalFetchCalls = 0;
beforeAll(() => {
  globalThis.fetch = (async () => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_GOVERNED_PROVIDER_TEST");
  }) as typeof fetch;
});
afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(globalFetchCalls).toBe(0);
});

class AuditFake implements ProviderRequestAuditRepository {
  readonly records: ProviderRequestAuditRecord[] = [];
  fail: "NONE" | "CONFLICT" | "FAILED" = "NONE";
  constructor(readonly order: string[]) {}
  async append(record: ProviderRequestAuditRecord): Promise<ProviderRequestAuditAppendResult> {
    this.order.push("audit");
    this.records.push(record);
    return this.fail === "NONE"
      ? { ok: true, disposition: "CREATED" }
      : { ok: false, disposition: this.fail, error: { classification: this.fail, retryable: false, sanitizedCode: "SYNTHETIC_AUDIT_FAILURE" } };
  }
}

class RawFake implements RawEvidenceStore {
  readonly published: RawEvidenceDescriptor[] = [];
  fail = false;
  constructor(readonly order: string[]) {}
  async publish(candidate: RawEvidenceCandidate): Promise<RawEvidenceStoreResult> {
    this.order.push("raw");
    if (this.fail) return { ok: false, disposition: "FAILED", error: { classification: "FAILED", retryable: false, sanitizedCode: "SYNTHETIC_RAW_FAILURE" } };
    const contentHash = createHash("sha256").update(candidate.bytes).digest("hex");
    const descriptor = Object.freeze({
      providerKey: "api-football" as const, endpointKey: candidate.endpointKey,
      capturedAtUtc: candidate.capturedAtUtc, mediaType: candidate.mediaType, contentHash,
      byteLength: candidate.bytes.byteLength, storageReference: `sha256/${contentHash}.bin`,
      sourceReference: candidate.sourceReference,
    });
    this.published.push(descriptor);
    return { ok: true, disposition: "CREATED", descriptor };
  }
}

class PersistenceFake implements ApiFootballPersistencePort {
  readonly fixtures: PersistFixtureCaptureInput[] = [];
  readonly predictions: PersistPredictionCaptureInput[] = [];
  readonly outcomes: PersistOutcomeCaptureInput[] = [];
  fail = false;
  conflict = false;
  constructor(readonly order: string[]) {}
  response<T>(value: T): ApiFootballPersistenceResult<T> {
    return this.fail || this.conflict
      ? { ok: false, disposition: this.conflict ? "CONFLICT" : "FAILED", error: { classification: this.conflict ? "CONFLICT" : "FAILED", retryable: false, sanitizedCode: "SYNTHETIC_PERSISTENCE_FAILURE" } }
      : { ok: true, disposition: "CREATED", value };
  }
  async persistFixtureCapture(input: PersistFixtureCaptureInput): Promise<ApiFootballPersistenceResult<PersistedFixtureBinding>> {
    this.order.push("repository");
    if (!this.fail && !this.conflict) this.fixtures.push(input);
    return this.response({ id: "binding", providerId: "provider", providerFixtureId: input.fixture.providerFixtureId, fixtureId: input.canonicalFixtureId });
  }
  async persistPredictionCapture(input: PersistPredictionCaptureInput): Promise<ApiFootballPersistenceResult<PersistedPrediction>> {
    this.order.push("repository");
    if (!this.fail && !this.conflict) this.predictions.push(input);
    return this.response({ id: "prediction", snapshot: input.snapshot });
  }
  async persistOutcomeCapture(input: PersistOutcomeCaptureInput): Promise<ApiFootballPersistenceResult<PersistedOutcome>> {
    this.order.push("repository");
    if (!this.fail && !this.conflict) this.outcomes.push(input);
    return this.response({ id: "outcome", fixtureId: input.canonicalFixtureId, resolution: input.resolution, contentHash: input.evidence.contentHash });
  }
}

const predictionBinding: ApiFootballExplicitFixtureBinding = Object.freeze({
  providerKey: "api-football", canonicalFixtureId: "canonical-900001", providerFixtureId: "900001",
  providerCompetitionId: "910001", season: "2030", homeProviderTeamId: "920001",
  homeName: "Synthetic Home FC", awayProviderTeamId: "920002", awayName: "Synthetic Away FC",
  kickoffUtc: "2030-01-01T18:00:00.000Z", sourceTimezone: "UTC",
});

function bindingForFixture(fixture: ReturnType<typeof buildSyntheticFixtureFtHome>): ApiFootballExplicitFixtureBinding {
  return Object.freeze({
    providerKey: "api-football", canonicalFixtureId: `canonical-${fixture.fixture.id}`,
    providerFixtureId: String(fixture.fixture.id), providerCompetitionId: String(fixture.league.id),
    season: String(fixture.league.season), homeProviderTeamId: String(fixture.teams.home.id),
    homeName: fixture.teams.home.name, awayProviderTeamId: String(fixture.teams.away.id),
    awayName: fixture.teams.away.name, kickoffUtc: "2030-01-01T18:00:00.000Z", sourceTimezone: "UTC",
  });
}

function mappers(order: string[]): ApiFootballProviderMappers {
  return {
    fixture(dto, context) { order.push("mapper"); return mapApiFootballFixture(dto, context); },
    prediction(dto, context) { order.push("mapper"); return mapApiFootballPrediction(dto, context); },
    result(dto, context) { order.push("mapper"); return mapApiFootballResult(dto, context); },
  };
}

function harness(
  responses: Array<Response | Error>,
  options: Readonly<{ maxAttempts?: number; capturedAtUtc?: string }> = {},
) {
  const order: string[] = [];
  const maxAttempts = options.maxAttempts ?? 6;
  const client = new ApiFootballClient({
    config: buildApiFootballConfig({ API_FOOTBALL_KEY: "SYNTHETIC_GOVERNED_KEY" }, { maxResponseBytes: 5_000_000 }),
    fetchImpl: async () => {
      order.push("client");
      const next = responses.shift();
      if (next instanceof Error) throw next;
      if (next === undefined) throw new Error("SYNTHETIC_RESPONSE_QUEUE_EMPTY");
      return next;
    },
    clock: { nowUtc: () => options.capturedAtUtc ?? "2030-01-01T17:00:00.000Z" },
  });
  const raw = new RawFake(order);
  const persistence = new PersistenceFake(order);
  const provider = new ApiFootballProvider({ client, rawEvidenceStore: raw, mappers: mappers(order), persistence });
  const budget = new RequestBudget(maxAttempts);
  const breaker = new RunCircuitBreaker(4);
  const audit = new AuditFake(order);
  let clock = 0;
  const executor = new GovernedRequestExecutor({
    budget, circuitBreaker: breaker, auditRepository: audit, sleeper: new FakeSleeper(),
    clock: { nowUtc: () => `2030-01-01T16:00:0${Math.min(++clock, 9)}.000Z` },
    retryPolicy: new RetryPolicy({ maxAttempts: 2, baseDelayMilliseconds: 0, maximumDelayMilliseconds: 0 }),
    rateLimits: { parse: parseApiFootballRateLimits, evaluateResponse: evaluateApiFootballRateLimitResponse },
  }, { maxAttempts, maxRetries: 1, dailySafetyThreshold: 20, requireDailyRemaining: false, requireMinuteRemaining: false, maxConsecutiveRetryableFailures: 4 });
  return { order, provider, raw, persistence, budget, breaker, audit, executor };
}

function request(executor: GovernedRequestExecutor, endpointKey: GovernedRequestInput["endpointKey"], marker: string) {
  return { executor, request: { providerKey: "api-football" as const, endpointKey, requestKeyHash: marker.repeat(64), correlationId: `synthetic-${marker}` } };
}

function jsonResponse(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { "content-type": "application/json", ...headers } });
}

describe("ApiFootballProvider governed composition", () => {
  it("orders fixture client, raw, mapper, repository, and audit exactly once", async () => {
    const h = harness([jsonResponse(buildSyntheticFixtureEnvelopeWithArrayErrors())]);
    const result = await h.provider.captureSelectedFixtureGoverned({ governance: request(h.executor, "fixtures-by-date", "a"), binding: predictionBinding });
    expect(result.ok).toBe(true);
    expect(h.order).toEqual(["client", "raw", "mapper", "repository", "audit"]);
    expect(h.audit.records).toHaveLength(1);
    expect(h.persistence.fixtures).toHaveLength(1);
  });

  it("orders governed prediction and outcome without extra audits", async () => {
    const predictionHarness = harness([jsonResponse(buildSyntheticPredictionEnvelope())]);
    const predicted = await predictionHarness.provider.capturePrematchPredictionGoverned({ governance: request(predictionHarness.executor, "prediction-by-fixture", "b"), binding: predictionBinding, parserVersion: "synthetic-parser/1", policyVersion: "synthetic-policy/1" });
    expect(predicted.ok).toBe(true);
    expect(predictionHarness.order).toEqual(["client", "raw", "mapper", "repository", "audit"]);
    const fixture = buildSyntheticFixturePen();
    const envelope = { ...buildSyntheticFixtureEnvelopeWithArrayErrors(), response: [fixture] };
    const outcomeHarness = harness([jsonResponse(envelope)], { capturedAtUtc: "2030-01-02T12:00:00.000Z" });
    const resolved = await outcomeHarness.provider.captureOutcomeGoverned({ governance: request(outcomeHarness.executor, "fixture-result-by-id", "c"), binding: bindingForFixture(fixture) });
    expect(resolved.ok).toBe(true);
    if (resolved.ok) expect(resolved.data).toMatchObject({ result1X2: "DRAW", shootoutWinner: "HOME" });
    expect(outcomeHarness.order).toEqual(["client", "raw", "mapper", "repository", "audit"]);
  });

  it("retries only a failed client attempt and never retries after persistence", async () => {
    const envelope = buildSyntheticPredictionEnvelope();
    const retry = harness([new Error("SYNTHETIC_NETWORK_FAILURE"), jsonResponse(envelope)]);
    const result = await retry.provider.capturePrematchPredictionGoverned({ governance: request(retry.executor, "prediction-by-fixture", "d"), binding: predictionBinding, parserVersion: "p", policyVersion: "q" });
    expect(result.ok).toBe(true);
    expect(retry.audit.records).toHaveLength(2);
    expect(retry.persistence.predictions).toHaveLength(1);
    expect(retry.order).toEqual(["client", "audit", "client", "raw", "mapper", "repository", "audit"]);
  });

  it("raw failure prevents mapper and repository", async () => {
    const h = harness([jsonResponse(buildSyntheticPredictionEnvelope())]);
    h.raw.fail = true;
    const result = await h.provider.capturePrematchPredictionGoverned({ governance: request(h.executor, "prediction-by-fixture", "e"), binding: predictionBinding, parserVersion: "p", policyVersion: "q" });
    expect(result).toMatchObject({ ok: false, classification: "EVIDENCE_FAILURE" });
    expect(h.order).toEqual(["client", "raw", "audit"]);
    expect(h.persistence.predictions).toHaveLength(0);
  });

  it("mapper and repository failures preserve raw without retry", async () => {
    const invalid = buildSyntheticFixtureEnvelopeWithArrayErrors();
    invalid.response[0].fixture.timezone = "Europe/Berlin";
    const mapperFailure = harness([jsonResponse(invalid)]);
    expect(await mapperFailure.provider.captureSelectedFixtureGoverned({ governance: request(mapperFailure.executor, "fixtures-by-date", "f"), binding: predictionBinding })).toMatchObject({ ok: false, classification: "MAPPING_FAILURE" });
    expect(mapperFailure.raw.published).toHaveLength(1);
    expect(mapperFailure.persistence.fixtures).toHaveLength(0);
    const repositoryFailure = harness([jsonResponse(buildSyntheticPredictionEnvelope())]);
    repositoryFailure.persistence.fail = true;
    expect(await repositoryFailure.provider.capturePrematchPredictionGoverned({ governance: request(repositoryFailure.executor, "prediction-by-fixture", "1"), binding: predictionBinding, parserVersion: "p", policyVersion: "q" })).toMatchObject({ ok: false, classification: "PERSISTENCE_FAILURE" });
    expect(repositoryFailure.raw.published).toHaveLength(1);
  });

  it.each([
    ["not-json", "INVALID_JSON"],
    [JSON.stringify({ ...buildSyntheticFixtureEnvelopeWithArrayErrors(), errors: ["Synthetic"] }), "API_ERRORS_PRESENT"],
  ] as const)("publishes complete body and audits %s", async (body, classification) => {
    const h = harness([new Response(body, { headers: { "content-type": "application/json" } })]);
    const result = await h.provider.captureOutcomeGoverned({ governance: request(h.executor, "fixture-result-by-id", "2"), binding: predictionBinding });
    expect(result).toMatchObject({ ok: false, sanitizedCode: classification });
    expect(h.raw.published).toHaveLength(1);
    expect(h.audit.records[0].classification).toBe("INVALID_RESPONSE");
  });

  it.each(["TIMEOUT", "NETWORK_FAILURE"] as const)("creates no evidence for %s without body", async (classification) => {
    const error = new ApiFootballClientError({ classification, endpointKey: "fixture-result-by-id", retryable: false });
    const client: ApiFootballProviderClient = {
      listFixtures: () => { throw new Error("unused"); }, getPrediction: () => { throw new Error("unused"); },
      async getFixtureResult() { return { ok: false, error }; },
    };
    const h = harness([]);
    const provider = new ApiFootballProvider({ client, rawEvidenceStore: h.raw, mappers: mappers(h.order), persistence: h.persistence });
    expect(await provider.captureOutcomeGoverned({ governance: request(h.executor, "fixture-result-by-id", "3"), binding: predictionBinding })).toMatchObject({ ok: false, sanitizedCode: classification });
    expect(h.raw.published).toHaveLength(0);
  });

  it("does not publish a response rejected by size boundary", async () => {
    const h = harness([new Response("x".repeat(5_000_001))]);
    const result = await h.provider.captureOutcomeGoverned({ governance: request(h.executor, "fixture-result-by-id", "4"), binding: predictionBinding });
    expect(result).toMatchObject({ ok: false, sanitizedCode: "RESPONSE_TOO_LARGE" });
    expect(h.raw.published).toHaveLength(0);
  });

  it("shares rate-limit breaker and budget across provider operations", async () => {
    const firstBody = jsonResponse(buildSyntheticFixtureEnvelopeWithArrayErrors(), { "x-ratelimit-requests-remaining": "19" });
    const h = harness([firstBody, jsonResponse(buildSyntheticPredictionEnvelope())], { maxAttempts: 2 });
    const first = await h.provider.captureSelectedFixtureGoverned({ governance: request(h.executor, "fixtures-by-date", "5"), binding: predictionBinding });
    expect(first).toMatchObject({ ok: true, governanceStatus: "SUCCESS_RUN_BLOCKED", circuitState: "OPEN" });
    const second = await h.provider.capturePrematchPredictionGoverned({ governance: request(h.executor, "prediction-by-fixture", "6"), binding: predictionBinding, parserVersion: "p", policyVersion: "q" });
    expect(second).toMatchObject({ ok: false, classification: "CIRCUIT_OPEN" });
    expect(h.order.filter((item) => item === "client")).toHaveLength(1);
    expect(h.budget.inspect().startedAttempts).toBe(1);
  });

  it("audit conflict blocks run and retains completed persistence disposition", async () => {
    const h = harness([jsonResponse(buildSyntheticPredictionEnvelope())]);
    h.audit.fail = "CONFLICT";
    const result = await h.provider.capturePrematchPredictionGoverned({ governance: request(h.executor, "prediction-by-fixture", "7"), binding: predictionBinding, parserVersion: "p", policyVersion: "q" });
    expect(result).toMatchObject({ ok: false, classification: "AUDIT_FAILURE", completedPersistenceDisposition: "CREATED", circuitState: "OPEN" });
    expect(h.persistence.predictions).toHaveLength(1);
  });

  it("has no hidden budget, breaker, environment, global fetch, Prisma, matching, odds, or settlement surface", () => {
    const h = harness([]);
    const source = String(ApiFootballProvider);
    for (const forbidden of ["new RequestBudget", "new RunCircuitBreaker", "process.env", "globalThis.fetch", "new PrismaClient", "The Odds API", "captureOdds", "settlement", "fuzzy"]) {
      expect(source).not.toContain(forbidden);
    }
    expect(h.executor.dependencies.budget).toBe(h.budget);
    expect(h.executor.dependencies.circuitBreaker).toBe(h.breaker);
    expect(globalFetchCalls).toBe(0);
  });
});
