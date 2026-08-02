import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type {
  RawEvidenceCandidate,
  RawEvidenceDescriptor,
  RawEvidenceStore,
  RawEvidenceStoreResult,
} from "@/application/market-v2/capture/raw-evidence-store";
import { ApiFootballClient, ApiFootballClientError } from "@/infrastructure/market-v2/api-football/client";
import { buildApiFootballConfig } from "@/infrastructure/market-v2/api-football/config";
import {
  mapApiFootballFixture,
  mapApiFootballPrediction,
  mapApiFootballResult,
  type ApiFootballPredictionMappingContext,
} from "@/infrastructure/market-v2/api-football/mappers";
import {
  ApiFootballProvider,
  type ApiFootballProviderClient,
  type ApiFootballProviderMappers,
} from "@/infrastructure/market-v2/api-football/provider";
import type {
  ApiFootballPersistencePort,
  ApiFootballPersistenceResult,
  PersistedFixtureBinding,
  PersistedOutcome,
  PersistedPrediction,
  PersistFixtureCaptureInput,
  PersistOutcomeCaptureInput,
  PersistPredictionCaptureInput,
} from "@/infrastructure/market-v2/persistence/api-football-repositories";
import {
  buildSyntheticFixtureEnvelopeWithArrayErrors,
  buildSyntheticFixtureFtHome,
  buildSyntheticFixturePen,
  buildSyntheticPredictionEnvelope,
} from "@/tests/fixtures/api-football";

const originalGlobalFetch = globalThis.fetch;
let globalFetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_PROVIDER_INTEGRATION_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalGlobalFetch;
  expect(globalFetchCalls).toBe(0);
});

const CAPTURED_AT = "2030-01-01T17:00:00.000Z";
const API_KEY = "SYNTHETIC_PROVIDER_INTEGRATION_KEY";

class FakeRawEvidenceStore implements RawEvidenceStore {
  readonly published: RawEvidenceDescriptor[] = [];
  fail = false;
  conflict = false;
  constructor(readonly order: string[]) {}

  async publish(candidate: RawEvidenceCandidate): Promise<RawEvidenceStoreResult> {
    this.order.push("raw");
    if (this.fail || this.conflict) {
      const classification = this.conflict ? "CONFLICT" : "FAILED";
      return {
        ok: false,
        disposition: classification,
        error: { classification, retryable: false, sanitizedCode: "SYNTHETIC_RAW_FAILURE" },
      };
    }
    const contentHash = createHash("sha256").update(candidate.bytes).digest("hex");
    const descriptor: RawEvidenceDescriptor = Object.freeze({
      providerKey: "api-football",
      endpointKey: candidate.endpointKey,
      capturedAtUtc: candidate.capturedAtUtc,
      mediaType: candidate.mediaType,
      contentHash,
      byteLength: candidate.bytes.byteLength,
      storageReference: `sha256/${contentHash.slice(0, 2)}/${contentHash}.bin`,
      sourceReference: candidate.sourceReference,
    });
    const replay = this.published.some((entry) => entry.contentHash === contentHash);
    this.published.push(descriptor);
    return { ok: true, disposition: replay ? "REPLAYED" : "CREATED", descriptor };
  }
}

class FakePersistence implements ApiFootballPersistencePort {
  readonly fixtures: PersistFixtureCaptureInput[] = [];
  readonly predictions: PersistPredictionCaptureInput[] = [];
  readonly outcomes: PersistOutcomeCaptureInput[] = [];
  fail = false;
  conflict = false;
  constructor(readonly order: string[]) {}

  result<T>(value: T, replay: boolean): ApiFootballPersistenceResult<T> {
    if (this.fail || this.conflict) {
      return {
        ok: false,
        disposition: this.conflict ? "CONFLICT" : "FAILED",
        error: {
          classification: this.conflict ? "CONFLICT" : "FAILED",
          retryable: false,
          sanitizedCode: "SYNTHETIC_PERSISTENCE_FAILURE",
        },
      };
    }
    return { ok: true, disposition: replay ? "REPLAYED" : "CREATED", value };
  }

  async persistFixtureCapture(
    input: PersistFixtureCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedFixtureBinding>> {
    this.order.push("repository");
    const replay = this.fixtures.some(
      (entry) => entry.fixture.providerFixtureId === input.fixture.providerFixtureId,
    );
    if (!this.fail && !this.conflict && !replay) this.fixtures.push(input);
    return this.result(
      {
        id: "synthetic-binding",
        providerId: "synthetic-provider",
        providerFixtureId: input.fixture.providerFixtureId,
        fixtureId: input.canonicalFixtureId,
      },
      replay,
    );
  }

  async persistPredictionCapture(
    input: PersistPredictionCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedPrediction>> {
    this.order.push("repository");
    const sameCapture = this.predictions.find(
      (entry) => entry.snapshot.providerFixtureId === input.snapshot.providerFixtureId &&
        entry.snapshot.capturedAtUtc === input.snapshot.capturedAtUtc,
    );
    if (sameCapture !== undefined && sameCapture.snapshot.contentHash !== input.snapshot.contentHash) {
      return {
        ok: false,
        disposition: "CONFLICT",
        error: { classification: "CONFLICT", retryable: false, sanitizedCode: "CAPTURE_CONFLICT" },
      };
    }
    if (!this.fail && !this.conflict && sameCapture === undefined) this.predictions.push(input);
    return this.result(
      { id: "synthetic-prediction", snapshot: input.snapshot },
      sameCapture !== undefined,
    );
  }

  async persistOutcomeCapture(
    input: PersistOutcomeCaptureInput,
  ): Promise<ApiFootballPersistenceResult<PersistedOutcome>> {
    this.order.push("repository");
    const replay = this.outcomes.some(
      (entry) => entry.evidence.contentHash === input.evidence.contentHash,
    );
    if (!this.fail && !this.conflict && !replay) this.outcomes.push(input);
    return this.result(
      {
        id: "synthetic-outcome",
        fixtureId: input.canonicalFixtureId,
        resolution: input.resolution,
        contentHash: input.evidence.contentHash,
      },
      replay,
    );
  }
}

function realMappers(order: string[]): ApiFootballProviderMappers {
  return {
    fixture(dto, context) {
      order.push("mapper");
      return mapApiFootballFixture(dto, context);
    },
    prediction(dto, context) {
      order.push("mapper");
      return mapApiFootballPrediction(dto, context);
    },
    result(dto, context) {
      order.push("mapper");
      return mapApiFootballResult(dto, context);
    },
  };
}

function clientFor(
  response: Response | (() => Response | Promise<Response>),
  capturedAtUtc = CAPTURED_AT,
  maxResponseBytes = 5_000_000,
): ApiFootballClient {
  return new ApiFootballClient({
    config: buildApiFootballConfig(
      { API_FOOTBALL_KEY: API_KEY },
      { maxResponseBytes },
    ),
    fetchImpl: async () => typeof response === "function" ? response() : response,
    clock: { nowUtc: () => capturedAtUtc },
  });
}

function providerFor(client: ApiFootballProviderClient, order: string[] = []) {
  const raw = new FakeRawEvidenceStore(order);
  const persistence = new FakePersistence(order);
  const provider = new ApiFootballProvider({
    client,
    rawEvidenceStore: raw,
    mappers: realMappers(order),
    persistence,
  });
  return { provider, raw, persistence, order };
}

const predictionContext = (capturedAtUtc = CAPTURED_AT): ApiFootballPredictionMappingContext => ({
  capturedAtUtc,
  requestedProviderFixtureId: "900001",
  expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
  expectedHomeProviderTeamId: "920001",
  expectedHomeName: "Synthetic Home FC",
  expectedAwayProviderTeamId: "920002",
  expectedAwayName: "Synthetic Away FC",
  contentHash: "caller-value-is-replaced-by-evidence",
  parserVersion: "synthetic-parser/1.0",
  policyVersion: "synthetic-policy/1.0",
});

describe("API-Football injectable provider ordering", () => {
  it("executes client, raw publication, fixture mapper, and repository in order", async () => {
    const order: string[] = [];
    const envelope = buildSyntheticFixtureEnvelopeWithArrayErrors();
    const client: ApiFootballProviderClient = {
      async listFixtures(query) {
        order.push("client");
        return clientFor(new Response(JSON.stringify(envelope))).listFixtures(query);
      },
      getPrediction: () => { throw new Error("not used"); },
      getFixtureResult: () => { throw new Error("not used"); },
    };
    const setup = providerFor(client, order);
    const result = await setup.provider.captureFixtures(
      { date: "2030-01-01", timezone: "UTC" },
      {
        mappingContext: { capturedAtUtc: CAPTURED_AT, providerKey: "api-football" },
        canonicalFixtureBindings: { "900001": "canonical-fixture-1" },
      },
    );
    expect(result.ok).toBe(true);
    expect(order).toEqual(["client", "raw", "mapper", "repository"]);
    expect(setup.persistence.fixtures).toHaveLength(1);
  });

  it("persists a prediction with exactly three source probabilities", async () => {
    const setup = providerFor(
      clientFor(new Response(JSON.stringify(buildSyntheticPredictionEnvelope()))),
    );
    const result = await setup.provider.capturePrediction("900001", predictionContext());
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.sanitizedCode);
    expect(result.data.selections.map(({ selection }) => selection)).toEqual([
      "HOME",
      "DRAW",
      "AWAY",
    ]);
    expect(setup.persistence.predictions).toHaveLength(1);
    expect(result.data.contentHash).toBe(result.evidence.contentHash);
  });

  it.each([
    [buildSyntheticFixtureFtHome, "HOME", null],
    [buildSyntheticFixturePen, "DRAW", "HOME"],
  ] as const)("persists terminal results without replacing regulation 1X2", async (
    buildFixture,
    expectedResult,
    expectedShootout,
  ) => {
    const fixture = buildFixture();
    const envelope = { ...buildSyntheticFixtureEnvelopeWithArrayErrors(), response: [fixture] };
    const setup = providerFor(clientFor(new Response(JSON.stringify(envelope))));
    const result = await setup.provider.captureResult(String(fixture.fixture.id), {
      canonicalFixtureId: "canonical-fixture-1",
      mappingContext: {
        capturedAtUtc: "2030-01-02T12:00:00.000Z",
        requestedProviderFixtureId: String(fixture.fixture.id),
        expectedLeagueProviderId: String(fixture.league.id),
        expectedSeason: fixture.league.season,
        expectedHomeProviderTeamId: String(fixture.teams.home.id),
        expectedHomeName: fixture.teams.home.name,
        expectedAwayProviderTeamId: String(fixture.teams.away.id),
        expectedAwayName: fixture.teams.away.name,
        expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
      },
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.sanitizedCode);
    expect(result.data.result1X2).toBe(expectedResult);
    expect(result.data.shootoutWinner).toBe(expectedShootout);
  });

  it("does not map or persist when raw publication fails", async () => {
    const setup = providerFor(
      clientFor(new Response(JSON.stringify(buildSyntheticPredictionEnvelope()))),
    );
    setup.raw.fail = true;
    const result = await setup.provider.capturePrediction("900001", predictionContext());
    expect(result).toMatchObject({ ok: false, classification: "EVIDENCE_FAILURE" });
    expect(setup.order).toEqual(["raw"]);
    expect(setup.persistence.predictions).toHaveLength(0);
  });

  it("keeps raw evidence when mapping fails and skips persistence", async () => {
    const invalid = buildSyntheticFixtureEnvelopeWithArrayErrors();
    invalid.response[0].fixture.timezone = "Europe/Berlin";
    const setup = providerFor(clientFor(new Response(JSON.stringify(invalid))));
    const result = await setup.provider.captureFixtures(
      { date: "2030-01-01", timezone: "UTC" },
      {
        mappingContext: { capturedAtUtc: CAPTURED_AT, providerKey: "api-football" },
        canonicalFixtureBindings: { "900001": "canonical-fixture-1" },
      },
    );
    expect(result).toMatchObject({ ok: false, classification: "MAPPING_FAILURE" });
    expect(setup.raw.published).toHaveLength(1);
    expect(setup.persistence.fixtures).toHaveLength(0);
  });

  it("keeps raw evidence when persistence fails", async () => {
    const setup = providerFor(
      clientFor(new Response(JSON.stringify(buildSyntheticPredictionEnvelope()))),
    );
    setup.persistence.fail = true;
    const result = await setup.provider.capturePrediction("900001", predictionContext());
    expect(result).toMatchObject({ ok: false, classification: "PERSISTENCE_FAILURE" });
    expect(setup.raw.published).toHaveLength(1);
  });
});

describe("API-Football provider failure evidence boundary", () => {
  it.each([
    ["not-json", 200, "INVALID_JSON"],
    [JSON.stringify({ get: "fixtures" }), 200, "INVALID_ENVELOPE"],
    [
      JSON.stringify({
        ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
        errors: ["Synthetic provider error"],
      }),
      200,
      "API_ERRORS_PRESENT",
    ],
    ["synthetic-http-400", 400, "HTTP_PERMANENT_FAILURE"],
    ["synthetic-http-500", 500, "HTTP_RETRYABLE_FAILURE"],
  ] as const)("publishes a complete bounded failure body", async (body, status, classification) => {
    const setup = providerFor(clientFor(new Response(body, { status })));
    const result = await setup.provider.captureResult("900001", {
      canonicalFixtureId: "canonical-fixture-1",
      mappingContext: {
        capturedAtUtc: CAPTURED_AT,
        requestedProviderFixtureId: "900001",
        expectedLeagueProviderId: "910001",
        expectedSeason: 2030,
        expectedHomeProviderTeamId: "920001",
        expectedHomeName: "Synthetic Home FC",
        expectedAwayProviderTeamId: "920002",
        expectedAwayName: "Synthetic Away FC",
      },
    });
    expect(result).toMatchObject({
      ok: false,
      classification: "CLIENT_FAILURE",
      sanitizedCode: classification,
    });
    expect(setup.raw.published).toHaveLength(1);
    expect(setup.persistence.outcomes).toHaveLength(0);
  });

  it.each(["TIMEOUT", "NETWORK_FAILURE"] as const)(
    "does not invent evidence for %s without a body",
    async (classification) => {
      const error = new ApiFootballClientError({
        classification,
        endpointKey: "fixture-result-by-id",
        retryable: true,
      });
      const client: ApiFootballProviderClient = {
        listFixtures: () => { throw new Error("not used"); },
        getPrediction: () => { throw new Error("not used"); },
        async getFixtureResult() { return { ok: false, error }; },
      };
      const setup = providerFor(client);
      const result = await setup.provider.captureResult("900001", {
        canonicalFixtureId: "canonical-fixture-1",
        mappingContext: {
          capturedAtUtc: CAPTURED_AT,
          requestedProviderFixtureId: "900001",
          expectedLeagueProviderId: "910001",
          expectedSeason: 2030,
          expectedHomeProviderTeamId: "920001",
          expectedHomeName: "Synthetic Home FC",
          expectedAwayProviderTeamId: "920002",
          expectedAwayName: "Synthetic Away FC",
        },
      });
      expect(result).toMatchObject({ ok: false, sanitizedCode: classification });
      expect(setup.raw.published).toHaveLength(0);
    },
  );

  it("does not publish a body rejected by the size boundary", async () => {
    const setup = providerFor(clientFor(new Response("x".repeat(65)), CAPTURED_AT, 64));
    const result = await setup.provider.captureResult("900001", {
      canonicalFixtureId: "canonical-fixture-1",
      mappingContext: {
        capturedAtUtc: CAPTURED_AT,
        requestedProviderFixtureId: "900001",
        expectedLeagueProviderId: "910001",
        expectedSeason: 2030,
        expectedHomeProviderTeamId: "920001",
        expectedHomeName: "Synthetic Home FC",
        expectedAwayProviderTeamId: "920002",
        expectedAwayName: "Synthetic Away FC",
      },
    });
    expect(result).toMatchObject({ ok: false, sanitizedCode: "RESPONSE_TOO_LARGE" });
    expect(setup.raw.published).toHaveLength(0);
  });
});

describe("API-Football provider idempotency boundary", () => {
  it("reports exact replay, explicit conflict, and a new capture timestamp", async () => {
    const body = JSON.stringify(buildSyntheticPredictionEnvelope());
    const setup = providerFor(clientFor(() => new Response(body)));
    const first = await setup.provider.capturePrediction("900001", predictionContext());
    const replay = await setup.provider.capturePrediction("900001", predictionContext());
    expect(first.ok && first.persistenceDisposition).toBe("CREATED");
    expect(replay.ok && replay.persistenceDisposition).toBe("REPLAYED");

    setup.persistence.conflict = true;
    const conflict = await setup.provider.capturePrediction("900001", predictionContext());
    expect(conflict).toMatchObject({ ok: false, conflict: true });
    setup.persistence.conflict = false;

    const laterSetup = providerFor(clientFor(() => new Response(body), "2030-01-01T17:05:00.000Z"));
    const later = await laterSetup.provider.capturePrediction(
      "900001",
      predictionContext("2030-01-01T17:05:00.000Z"),
    );
    expect(later.ok && later.persistenceDisposition).toBe("CREATED");
  });

  it("exposes no odds, settlement, outcome-read, or generic request dependency", () => {
    const setup = providerFor(clientFor(new Response("{}")));
    expect("captureOdds" in setup.provider).toBe(false);
    expect("settle" in setup.provider).toBe(false);
    expect("request" in setup.provider).toBe(false);
    expect("theOddsApi" in setup.provider).toBe(false);
  });
});
