import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertProviderCapabilities,
  type CaptureProvider,
} from "@/application/market-v2/capture/capture-provider";
import { CAPTURE_ERROR_CODES } from "@/domain/market-v2/capture/errors";
import {
  CAPTURE_STAGES,
  PROVIDER_CAPABILITIES,
  capabilitiesForStage,
} from "@/domain/market-v2/capture/stages";
import type {
  CapturedFixture,
  ExternalProviderFixtureIdentity,
  PredictionSnapshot,
} from "@/domain/market-v2/capture/types";
import { validatePredictionSelections } from "@/domain/market-v2/capture/types";
import type {
  ExternalFixtureIdentityResolution,
  FixturePublicationResult,
  FixtureRepository,
} from "@/domain/market-v2/fixture/fixture-repository";
import type {
  PredictionAppendResult,
  PredictionRepository,
  PrematchPredictionLookup,
} from "@/domain/market-v2/prediction/prediction-repository";
import {
  SyntheticForebetProvider,
  SyntheticOddsProvider,
  SyntheticOutcomeProvider,
  createSyntheticTransport,
} from "@/infrastructure/market-v2/capture/synthetic-provider";
import { SyntheticCaptureTransport } from "@/infrastructure/market-v2/capture/synthetic-transport";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("REAL_FETCH_FORBIDDEN_IN_PROVIDER_DOMAIN_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function capturedFixture(): CapturedFixture {
  return {
    providerKey: "SYNTH_SOURCE_NEUTRAL_PROVIDER",
    providerFixtureId: "SYNTH_EXTERNAL_FIXTURE_001",
    capturedAtUtc: "2030-01-01T10:00:00.000Z",
    sourceDate: "2030-01-01T18:00:00+00:00",
    sourceTimestamp: "1893520800",
    sourceTimezone: "UTC",
    rawStatusCode: "SYNTH_SCHEDULED",
    canonicalStatus: "SCHEDULED",
    automaticUseBlocked: false,
    competition: {
      providerCompetitionId: "SYNTH_COMPETITION_001",
      name: "Synthetic Neutral League",
      country: "Synthetic Country",
    },
    season: "2030",
    round: "Synthetic Round 1",
    home: { providerTeamId: "SYNTH_TEAM_HOME", name: "Synthetic Home FC" },
    away: { providerTeamId: "SYNTH_TEAM_AWAY", name: "Synthetic Away FC" },
    goals: { home: null, away: null },
    score: {
      halftime: { home: null, away: null },
      fulltime: { home: null, away: null },
      extratime: { home: null, away: null },
      penalty: { home: null, away: null },
    },
  };
}

function unknownCapturedFixture(): CapturedFixture {
  return {
    ...capturedFixture(),
    rawStatusCode: "SYNTH_UNREGISTERED_STATUS",
    canonicalStatus: "UNKNOWN",
    automaticUseBlocked: true,
  };
}

function predictionSnapshot(
  capturedAtUtc = "2030-01-01T12:00:00.000Z",
  contentHash = "a".repeat(64),
): PredictionSnapshot {
  return {
    providerKey: "SYNTH_SOURCE_NEUTRAL_PROVIDER",
    providerFixtureId: "SYNTH_EXTERNAL_FIXTURE_001",
    capturedAtUtc,
    predictionCapturedBeforeKickoff: true,
    selections: [
      { selection: "HOME", rawPercentage: "45%", normalizedProbability: "0.45" },
      { selection: "DRAW", rawPercentage: "30%", normalizedProbability: "0.30" },
      { selection: "AWAY", rawPercentage: "25%", normalizedProbability: "0.25" },
    ],
    probabilityTotalRaw: "100%",
    predictedWinnerProviderTeamId: "SYNTH_TEAM_HOME",
    predictedWinnerName: "Synthetic Home FC",
    winnerComment: "Synthetic metadata comment",
    advice: "Synthetic metadata advice",
    underOverRaw: "Synthetic under-over metadata",
    providerInternalTimestamp: null,
    contentHash,
    parserVersion: "synthetic-contract-parser/1.0",
    policyVersion: "source-neutral-policy/1.0",
  };
}

function fixtureIdentity(
  fixture: ExternalProviderFixtureIdentity,
): ExternalProviderFixtureIdentity {
  return {
    providerKey: fixture.providerKey,
    providerFixtureId: fixture.providerFixtureId,
  };
}

function identityKey(identity: ExternalProviderFixtureIdentity): string {
  return `${identity.providerKey}:${identity.providerFixtureId}`;
}

class InMemoryFixtureRepository implements FixtureRepository {
  readonly #fixtures = new Map<string, CapturedFixture>();

  async publish(fixture: CapturedFixture): Promise<FixturePublicationResult> {
    const key = identityKey(fixtureIdentity(fixture));
    const existing = this.#fixtures.get(key);
    if (existing === undefined) {
      this.#fixtures.set(key, fixture);
      return { disposition: "CREATED", fixture };
    }
    if (JSON.stringify(existing) === JSON.stringify(fixture)) {
      return { disposition: "REPLAYED", fixture: existing };
    }
    return { disposition: "CONFLICT", existingFixture: existing, attemptedFixture: fixture };
  }

  async resolveExternalIdentity(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<ExternalFixtureIdentityResolution> {
    const fixture = this.#fixtures.get(identityKey(identity));
    return fixture === undefined ? { status: "UNKNOWN" } : { status: "KNOWN", fixture };
  }

  async findByExternalIdentity(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<CapturedFixture | null> {
    return this.#fixtures.get(identityKey(identity)) ?? null;
  }
}

class InMemoryPredictionRepository implements PredictionRepository {
  readonly #snapshots = new Map<string, PredictionSnapshot[]>();

  async append(snapshot: PredictionSnapshot): Promise<PredictionAppendResult> {
    const key = identityKey(fixtureIdentity(snapshot));
    const snapshots = this.#snapshots.get(key) ?? [];
    const sameCapture = snapshots.find((item) => item.capturedAtUtc === snapshot.capturedAtUtc);
    if (sameCapture !== undefined) {
      return sameCapture.contentHash === snapshot.contentHash
        ? { disposition: "REPLAYED", snapshot: sameCapture }
        : {
            disposition: "CONFLICT",
            existingSnapshot: sameCapture,
            attemptedSnapshot: snapshot,
          };
    }
    snapshots.push(snapshot);
    this.#snapshots.set(key, snapshots);
    return { disposition: "CREATED", snapshot };
  }

  async listByExternalFixture(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<readonly PredictionSnapshot[]> {
    return [...(this.#snapshots.get(identityKey(identity)) ?? [])];
  }

  async findLatestCapturedBeforeKickoff(
    lookup: PrematchPredictionLookup,
  ): Promise<PredictionSnapshot | null> {
    const snapshots = await this.listByExternalFixture(lookup);
    return (
      snapshots
        .filter((snapshot) => snapshot.capturedAtUtc < lookup.kickoffAtUtc)
        .sort((left, right) => right.capturedAtUtc.localeCompare(left.capturedAtUtc))[0] ?? null
    );
  }
}

describe("source-neutral capture taxonomy", () => {
  it("registers PREDICTIONS as a provider capability", () => {
    expect(PROVIDER_CAPABILITIES).toContain("PREDICTIONS");
    expect(capabilitiesForStage("PREMATCH")).toContain("PREDICTIONS");
  });

  it("keeps PREDICTIONS distinct from ODDS", () => {
    expect(PROVIDER_CAPABILITIES.indexOf("PREDICTIONS")).not.toBe(
      PROVIDER_CAPABILITIES.indexOf("ODDS"),
    );
  });

  it("keeps PREDICTIONS distinct from OUTCOMES", () => {
    expect(PROVIDER_CAPABILITIES.indexOf("PREDICTIONS")).not.toBe(
      PROVIDER_CAPABILITIES.indexOf("OUTCOMES"),
    );
  });

  it("retains every pre-existing capture stage and capability", () => {
    expect(CAPTURE_STAGES).toEqual(["PREMATCH", "CLOSING", "OUTCOME", "SYNTHETIC_FULL"]);
    expect(PROVIDER_CAPABILITIES).toEqual([
      "FIXTURES",
      "FOREBET",
      "PREDICTIONS",
      "ODDS",
      "CLOSING",
      "OUTCOMES",
    ]);
  });

  it("represents source-neutral fixtures and predictions at the provider boundary", () => {
    const provider: CaptureProvider = {
      providerKey: "SYNTH_BOUNDARY_ONLY",
      providerVersion: "1.0",
      capabilities: ["FIXTURES", "PREDICTIONS"],
      async discoverCapturedFixtures() {
        throw new Error("type-only boundary must not execute");
      },
      async capturePredictions() {
        throw new Error("type-only boundary must not execute");
      },
    };
    expect(() => assertProviderCapabilities(provider, "PREMATCH")).not.toThrow();
  });
});

describe("CapturedFixture domain contract", () => {
  it("accepts a valid source-neutral external identity", () => {
    expect(fixtureIdentity(capturedFixture())).toEqual({
      providerKey: "SYNTH_SOURCE_NEUTRAL_PROVIDER",
      providerFixtureId: "SYNTH_EXTERNAL_FIXTURE_001",
    });
  });

  it("keeps providerFixtureId external instead of canonicalizing it", () => {
    expect(capturedFixture().providerFixtureId).toBe("SYNTH_EXTERNAL_FIXTURE_001");
    expect(capturedFixture()).not.toHaveProperty("canonicalFixtureId");
  });

  it("preserves home and away orientation", () => {
    const fixture = capturedFixture();
    expect([fixture.home.name, fixture.away.name]).toEqual([
      "Synthetic Home FC",
      "Synthetic Away FC",
    ]);
  });

  it("keeps capturedAtUtc distinct from source date and timestamp", () => {
    const fixture = capturedFixture();
    expect(fixture.capturedAtUtc).not.toBe(fixture.sourceDate);
    expect(fixture.capturedAtUtc).not.toBe(fixture.sourceTimestamp);
  });

  it("preserves rawStatusCode next to canonicalStatus", () => {
    expect(capturedFixture()).toMatchObject({
      rawStatusCode: "SYNTH_SCHEDULED",
      canonicalStatus: "SCHEDULED",
    });
  });

  it("marks UNKNOWN as blocked for automatic use", () => {
    expect(unknownCapturedFixture()).toMatchObject({
      canonicalStatus: "UNKNOWN",
      automaticUseBlocked: true,
    });
  });

  it("allows null goals for a fixture that has not started", () => {
    expect(capturedFixture().goals).toEqual({ home: null, away: null });
  });

  it("keeps fulltime, extra time, and penalties separate", () => {
    const fixture: CapturedFixture = {
      ...capturedFixture(),
      canonicalStatus: "FINISHED",
      automaticUseBlocked: false,
      goals: { home: 2, away: 1 },
      score: {
        halftime: { home: 0, away: 0 },
        fulltime: { home: 1, away: 1 },
        extratime: { home: 2, away: 1 },
        penalty: { home: 5, away: 4 },
      },
    };
    expect(fixture.score.fulltime).toEqual({ home: 1, away: 1 });
    expect(fixture.score.extratime).toEqual({ home: 2, away: 1 });
    expect(fixture.score.penalty).toEqual({ home: 5, away: 4 });
  });

  it("contains no OddsSnapshot fields", () => {
    const fixture = capturedFixture();
    expect(fixture).not.toHaveProperty("decimalOdds");
    expect(fixture).not.toHaveProperty("bookmakerKey");
  });

  it("contains only domain data and requires no persistence metadata", () => {
    const fixture = capturedFixture();
    expect(fixture).not.toHaveProperty("prisma");
    expect(fixture).not.toHaveProperty("databaseId");
  });
});

describe("PredictionSnapshot domain contract", () => {
  it("requires exactly HOME, DRAW, and AWAY selections", () => {
    expect(validatePredictionSelections(predictionSnapshot().selections)).toEqual({ valid: true });
  });

  it("blocks a duplicate selection", () => {
    const selections = predictionSnapshot().selections;
    expect(validatePredictionSelections([selections[0], selections[0], selections[2]])).toEqual({
      valid: false,
      errorCode: "PREDICTION_SELECTION_DUPLICATE",
    });
  });

  it("blocks a missing selection", () => {
    expect(validatePredictionSelections(predictionSnapshot().selections.slice(0, 2))).toEqual({
      valid: false,
      errorCode: "PREDICTION_SELECTIONS_INCOMPLETE",
    });
  });

  it("preserves raw percentages", () => {
    expect(predictionSnapshot().selections.map((item) => item.rawPercentage)).toEqual([
      "45%",
      "30%",
      "25%",
    ]);
  });

  it("keeps normalizedProbability as decimal strings", () => {
    const probabilities = predictionSnapshot().selections.map(
      (item) => item.normalizedProbability,
    );
    expect(probabilities).toEqual(["0.45", "0.30", "0.25"]);
    expect(probabilities.every((probability) => typeof probability === "string")).toBe(true);
  });

  it("allows a null providerInternalTimestamp", () => {
    expect(predictionSnapshot().providerInternalTimestamp).toBeNull();
  });

  it("keeps winnerComment as metadata without adding a selection", () => {
    const snapshot = predictionSnapshot();
    expect(snapshot.winnerComment).toBe("Synthetic metadata comment");
    expect(snapshot.selections).toHaveLength(3);
  });

  it("keeps advice without deriving Double Chance", () => {
    const snapshot = predictionSnapshot();
    expect(snapshot.advice).toBe("Synthetic metadata advice");
    expect(snapshot).not.toHaveProperty("doubleChance");
  });

  it("contains no real outcome", () => {
    expect(predictionSnapshot()).not.toHaveProperty("outcome");
    expect(predictionSnapshot()).not.toHaveProperty("result1X2");
  });

  it("contains no odds", () => {
    expect(predictionSnapshot()).not.toHaveProperty("decimalOdds");
    expect(predictionSnapshot()).not.toHaveProperty("bookmakerKey");
  });

  it("requires its own capturedAtUtc", () => {
    expect(predictionSnapshot().capturedAtUtc).toBe("2030-01-01T12:00:00.000Z");
  });

  it("preserves predictionCapturedBeforeKickoff explicitly", () => {
    expect(predictionSnapshot().predictionCapturedBeforeKickoff).toBe(true);
  });
});

describe("FixtureRepository port semantics", () => {
  it("returns CREATED for the first external identity content", async () => {
    const repository = new InMemoryFixtureRepository();
    await expect(repository.publish(capturedFixture())).resolves.toMatchObject({
      disposition: "CREATED",
    });
  });

  it("returns REPLAYED for exact idempotent content", async () => {
    const repository = new InMemoryFixtureRepository();
    const fixture = capturedFixture();
    await repository.publish(fixture);
    await expect(repository.publish(fixture)).resolves.toMatchObject({ disposition: "REPLAYED" });
  });

  it("returns CONFLICT without reconciling incompatible content", async () => {
    const repository = new InMemoryFixtureRepository();
    const fixture = capturedFixture();
    await repository.publish(fixture);
    await expect(
      repository.publish({ ...fixture, home: { ...fixture.home, name: "Synthetic Conflict FC" } }),
    ).resolves.toMatchObject({ disposition: "CONFLICT" });
  });

  it("exposes no update or delete method", () => {
    const repository = new InMemoryFixtureRepository();
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
  });

  it("looks up and resolves by providerKey plus providerFixtureId", async () => {
    const repository = new InMemoryFixtureRepository();
    const fixture = capturedFixture();
    await repository.publish(fixture);
    const identity = fixtureIdentity(fixture);
    await expect(repository.findByExternalIdentity(identity)).resolves.toEqual(fixture);
    await expect(repository.resolveExternalIdentity(identity)).resolves.toEqual({
      status: "KNOWN",
      fixture,
    });
  });
});

describe("PredictionRepository port semantics", () => {
  it("appends and returns CREATED", async () => {
    const repository = new InMemoryPredictionRepository();
    await expect(repository.append(predictionSnapshot())).resolves.toMatchObject({
      disposition: "CREATED",
    });
  });

  it("finds snapshots by external fixture identity", async () => {
    const repository = new InMemoryPredictionRepository();
    const snapshot = predictionSnapshot();
    await repository.append(snapshot);
    await expect(repository.listByExternalFixture(fixtureIdentity(snapshot))).resolves.toEqual([
      snapshot,
    ]);
  });

  it("uses capturedAtUtc for the latest prematch lookup", async () => {
    const repository = new InMemoryPredictionRepository();
    await repository.append(predictionSnapshot("2030-01-01T11:00:00.000Z", "a".repeat(64)));
    await repository.append(predictionSnapshot("2030-01-01T13:00:00.000Z", "b".repeat(64)));
    await repository.append(predictionSnapshot("2030-01-01T19:00:00.000Z", "c".repeat(64)));
    const found = await repository.findLatestCapturedBeforeKickoff({
      ...fixtureIdentity(predictionSnapshot()),
      kickoffAtUtc: "2030-01-01T18:00:00.000Z",
    });
    expect(found?.capturedAtUtc).toBe("2030-01-01T13:00:00.000Z");
  });

  it("exposes no update or delete method", () => {
    const repository = new InMemoryPredictionRepository();
    expect("update" in repository).toBe(false);
    expect("delete" in repository).toBe(false);
  });

  it("contains no settlement or evaluation operation", () => {
    const repository = new InMemoryPredictionRepository();
    expect("settle" in repository).toBe(false);
    expect("evaluate" in repository).toBe(false);
  });

  it("treats another capturedAtUtc as another immutable capture", async () => {
    const repository = new InMemoryPredictionRepository();
    const first = predictionSnapshot("2030-01-01T12:00:00.000Z", "a".repeat(64));
    const second = predictionSnapshot("2030-01-01T12:05:00.000Z", "a".repeat(64));
    await expect(repository.append(first)).resolves.toMatchObject({ disposition: "CREATED" });
    await expect(repository.append(second)).resolves.toMatchObject({ disposition: "CREATED" });
    await expect(repository.listByExternalFixture(fixtureIdentity(first))).resolves.toHaveLength(2);
  });

  it("distinguishes replay and conflict at the same capturedAtUtc", async () => {
    const repository = new InMemoryPredictionRepository();
    const first = predictionSnapshot();
    await repository.append(first);
    await expect(repository.append(first)).resolves.toMatchObject({ disposition: "REPLAYED" });
    await expect(
      repository.append(predictionSnapshot(first.capturedAtUtc, "b".repeat(64))),
    ).resolves.toMatchObject({ disposition: "CONFLICT" });
  });
});

describe("synthetic compatibility and isolated boundaries", () => {
  it.each([
    () => new SyntheticForebetProvider(createSyntheticTransport()),
    () => new SyntheticOddsProvider(createSyntheticTransport()),
    () => new SyntheticOutcomeProvider(createSyntheticTransport()),
  ])("keeps each synthetic provider capability declaration valid", (factory) => {
    expect(() => assertProviderCapabilities(factory(), "PREMATCH")).not.toThrow();
  });

  it("keeps the synthetic transport constructible without network", () => {
    expect(new SyntheticCaptureTransport(new Map())).toBeInstanceOf(SyntheticCaptureTransport);
  });

  it("adds only source-neutral domain error codes", () => {
    expect(CAPTURE_ERROR_CODES).toEqual(
      expect.arrayContaining([
        "EXTERNAL_FIXTURE_IDENTITY_INVALID",
        "PROVIDER_STATUS_BLOCKED",
        "PREDICTION_SNAPSHOT_INCOMPLETE",
      ]),
    );
    expect(CAPTURE_ERROR_CODES).not.toEqual(
      expect.arrayContaining(["HTTP_ERROR", "AUTH_ERROR", "QUOTA_EXHAUSTED"]),
    );
  });
});
