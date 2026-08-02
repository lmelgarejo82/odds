import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PacketAssembler,
  SOURCE_NEUTRAL_PACKET_SCHEMA_VERSION,
  type PacketEvidenceStore,
  type PersistedPredictionPacketInput,
} from "@/application/market-v2/capture/packet-assembler";
import type {
  CaptureRunContext,
  CaptureRunResult,
  PredictionSnapshot,
  RawCaptureEvidence,
  SyntheticFixture,
} from "@/domain/market-v2/capture/types";

const FIXTURE_HASH = "a".repeat(64);
const PREDICTION_HASH = "b".repeat(64);
const KICKOFF = "2031-04-05T18:00:00.000Z";
const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_PACKET_TESTS");
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
  expect(fetchCalls).toBe(0);
});

const fixture: SyntheticFixture = Object.freeze({
  source_fixture_id: "SYNTH_PACKET_FIXTURE",
  source_name: "synthetic-fixture-provider",
  competition_raw: "Synthetic Packet Competition",
  competition_key: "synthetic-packet-competition",
  home_team_raw: "Synthetic Packet Home",
  away_team_raw: "Synthetic Packet Away",
  home_team_id: "SYNTH_PACKET_HOME",
  away_team_id: "SYNTH_PACKET_AWAY",
  kickoff_raw: "2031-04-05 18:00 UTC",
  kickoff_source_timezone: "UTC",
  kickoff_at_utc: KICKOFF,
  kickoff_confidence: "CONFIRMED",
  fixture_status: "SCHEDULED",
  captured_at_utc: "2031-04-05T10:00:00.000Z",
  source_artifact_reference: "synth:evidence:packet-fixture",
  content_hash: FIXTURE_HASH,
});

const evidence: RawCaptureEvidence = Object.freeze({
  evidenceId: "SYNTH_PACKET_EVIDENCE",
  providerKey: "synthetic-fixture-provider",
  providerVersion: "synthetic/1",
  stage: "PREMATCH",
  sourceReference: fixture.source_artifact_reference,
  capturedAtUtc: fixture.captured_at_utc,
  mediaType: "application/json",
  byteSize: 2,
  sha256: FIXTURE_HASH,
  correlationId: "SYNTH_PACKET_CORRELATION",
  attemptNumber: 1,
  synthetic: true,
  metadata: Object.freeze({}),
});

const evidenceStore: PacketEvidenceStore = {
  async findBySourceReference(reference) {
    return reference === fixture.source_artifact_reference ? evidence : null;
  },
  async read(evidenceId) {
    if (evidenceId !== evidence.evidenceId) throw new Error("unknown synthetic evidence");
    return Object.freeze({ evidence, body: Buffer.from("{}") });
  },
};

const context: CaptureRunContext = Object.freeze({
  runId: "SYNTH_PACKET_RUN",
  protocolVersion: "prospective-r0/2.0",
  stage: "PREMATCH",
  generatedAtUtc: "2031-04-05T19:00:00.000Z",
  universeSpecification: Object.freeze({
    competitionAllowlist: Object.freeze(["synthetic-packet-competition"]),
    dateFrom: "2031-04-05",
    dateTo: "2031-04-05",
    requiredMarkets: Object.freeze(["MATCH_ODDS_1X2"] as const),
    allowedBookmakers: Object.freeze(["SYNTH_BOOK"]),
    snapshotSchedule: Object.freeze([
      Object.freeze({ role: "DECISION", targetSecondsBeforeKickoff: 3_600, toleranceSeconds: 60 }),
    ]),
    postponedFixturePolicy: "EXCLUDE",
    unreliableKickoffPolicy: "BLOCK_DECISION",
  }),
  providerKey: "synthetic-packet-assembler",
  providerVersion: "synthetic/1",
  attemptNumber: 1,
  allowedCompetitionKeys: Object.freeze(["synthetic-packet-competition"]),
  requestedMarkets: Object.freeze(["MATCH_ODDS_1X2"] as const),
  requestedBookmakers: Object.freeze(["SYNTH_BOOK"]),
  synthetic: true,
  correlationId: "SYNTH_PACKET_CORRELATION",
  policyVersion: "synthetic-packet-policy/1",
});

const run: CaptureRunResult = Object.freeze({
  runId: context.runId,
  stage: "PREMATCH",
  startedAtUtc: "2031-04-05T10:00:00.000Z",
  completedAtUtc: "2031-04-05T10:00:01.000Z",
  providerSummaries: Object.freeze([
    Object.freeze({
      providerKey: "synthetic-fixture-provider",
      providerVersion: "synthetic/1",
      capabilities: Object.freeze(["FIXTURES"] as const),
    }),
  ]),
  discoveredFixtures: 1,
  attemptedCaptures: 1,
  successfulCaptures: 1,
  duplicateCaptures: 0,
  conflictedCaptures: 0,
  failedCaptures: 0,
  retryCount: 0,
  rateLimitedCount: 0,
  evidenceIds: Object.freeze([evidence.evidenceId]),
  warningCodes: Object.freeze([]),
  errorCodes: Object.freeze([]),
  synthetic: true,
  data: Object.freeze({
    fixtures: Object.freeze([fixture]),
    forebetSnapshots: Object.freeze([]),
    oddsSnapshots: Object.freeze([]),
    closingSnapshots: Object.freeze([]),
    outcomes: Object.freeze([]),
  }),
});

function prediction(overrides: Partial<PredictionSnapshot> = {}): PredictionSnapshot {
  return {
    providerKey: "synthetic-prediction-provider",
    providerFixtureId: "SYNTH_EXTERNAL_EVENT",
    capturedAtUtc: "2031-04-05T17:00:00.000Z",
    predictionCapturedBeforeKickoff: true,
    selections: [
      { selection: "HOME", rawPercentage: "45%", normalizedProbability: "0.45" },
      { selection: "DRAW", rawPercentage: "30%", normalizedProbability: "0.3" },
      { selection: "AWAY", rawPercentage: "25%", normalizedProbability: "0.25" },
    ],
    probabilityTotalRaw: "100%",
    predictedWinnerProviderTeamId: "SYNTH_PACKET_HOME",
    predictedWinnerName: "Synthetic Packet Home",
    winnerComment: "Synthetic winner metadata",
    advice: "Synthetic advice metadata only",
    underOverRaw: "Synthetic under-over metadata only",
    providerInternalTimestamp: null,
    contentHash: PREDICTION_HASH,
    parserVersion: "synthetic-prediction-parser/1",
    policyVersion: "synthetic-prediction-policy/1",
    ...overrides,
  };
}

function input(
  snapshot: PredictionSnapshot = prediction(),
  kickoffUtc = KICKOFF,
): PersistedPredictionPacketInput {
  return Object.freeze({ snapshot, kickoffUtc });
}

async function assemble(inputs: readonly PersistedPredictionPacketInput[] = [input()]) {
  return new PacketAssembler(evidenceStore).assemble(context, [run], [], inputs);
}

function probabilities(
  home: readonly [string, string],
  draw: readonly [string, string],
  away: readonly [string, string],
  total: string,
): PredictionSnapshot {
  return prediction({
    selections: [
      { selection: "HOME", rawPercentage: home[0], normalizedProbability: home[1] },
      { selection: "DRAW", rawPercentage: draw[0], normalizedProbability: draw[1] },
      { selection: "AWAY", rawPercentage: away[0], normalizedProbability: away[1] },
    ],
    probabilityTotalRaw: total,
  });
}

describe("Market V2 source-neutral prediction packet", () => {
  it("1 includes a source-neutral prediction snapshot", async () => {
    expect((await assemble()).prediction_snapshots).toHaveLength(1);
  });

  it("2 preserves providerKey", async () => {
    expect((await assemble()).prediction_snapshots[0].provider_key).toBe("synthetic-prediction-provider");
  });

  it("3 preserves the external providerFixtureId", async () => {
    expect((await assemble()).prediction_snapshots[0].provider_fixture_id).toBe("SYNTH_EXTERNAL_EVENT");
  });

  it("4 preserves capturedAtUtc", async () => {
    expect((await assemble()).prediction_snapshots[0].captured_at_utc).toBe("2031-04-05T17:00:00.000Z");
  });

  it("5 preserves the explicit prematch flag", async () => {
    expect((await assemble()).prediction_snapshots[0].prediction_captured_before_kickoff).toBe(true);
  });

  it("6 preserves canonical HOME DRAW AWAY", async () => {
    expect((await assemble()).prediction_snapshots[0].selections.map((item) => item.selection)).toEqual(["HOME", "DRAW", "AWAY"]);
  });

  it("7 preserves rawPercentage literally", async () => {
    expect((await assemble()).prediction_snapshots[0].selections.map((item) => item.raw_percentage)).toEqual(["45%", "30%", "25%"]);
  });

  it("8 preserves normalizedProbability as strings", async () => {
    const values = (await assemble()).prediction_snapshots[0].selections.map((item) => item.normalized_probability);
    expect(values).toEqual(["0.45", "0.3", "0.25"]);
    expect(values.every((value) => typeof value === "string")).toBe(true);
  });

  it("9 preserves probabilityTotalRaw", async () => {
    expect((await assemble()).prediction_snapshots[0].probability_total_raw).toBe("100%");
  });

  it("10 preserves winner metadata", async () => {
    expect((await assemble()).prediction_snapshots[0]).toMatchObject({
      predicted_winner_provider_team_id: "SYNTH_PACKET_HOME",
      predicted_winner_name: "Synthetic Packet Home",
      winner_comment: "Synthetic winner metadata",
    });
  });

  it("11 preserves advice as metadata", async () => {
    expect((await assemble()).prediction_snapshots[0].advice).toBe("Synthetic advice metadata only");
  });

  it("12 preserves underOverRaw as metadata", async () => {
    expect((await assemble()).prediction_snapshots[0].under_over_raw).toBe("Synthetic under-over metadata only");
  });

  it("13 preserves a null providerInternalTimestamp", async () => {
    expect((await assemble()).prediction_snapshots[0].provider_internal_timestamp).toBeNull();
  });

  it("14 preserves contentHash", async () => {
    expect((await assemble()).prediction_snapshots[0].content_hash).toBe(PREDICTION_HASH);
  });

  it("15 preserves parserVersion", async () => {
    expect((await assemble()).prediction_snapshots[0].parser_version).toBe("synthetic-prediction-parser/1");
  });

  it("16 preserves policyVersion", async () => {
    expect((await assemble()).prediction_snapshots[0].policy_version).toBe("synthetic-prediction-policy/1");
  });

  it("17 does not transform predictions into odds", async () => {
    expect((await assemble()).prediction_snapshots[0]).not.toHaveProperty("decimal_odds");
  });

  it("18 does not derive Double Chance", async () => {
    expect((await assemble()).prediction_snapshots[0].selections.map((item) => item.selection)).not.toContain("DRAW_OR_AWAY");
  });

  it("19 includes no outcome in PREMATCH", async () => {
    expect(await assemble()).toMatchObject({ outcomes: [], prediction_snapshots: [expect.not.objectContaining({ outcome: expect.anything() })] });
  });

  it("20 includes no final score", async () => {
    expect((await assemble()).prediction_snapshots[0]).not.toHaveProperty("score");
  });

  it("21 includes no settlement", async () => {
    expect((await assemble()).prediction_snapshots[0]).not.toHaveProperty("settlement");
  });

  it("22 includes a snapshot strictly before kickoff", async () => {
    expect((await assemble()).prediction_snapshots[0].kickoff_at_utc).toBe(KICKOFF);
  });

  it("23 excludes a snapshot captured exactly at kickoff when its flag is coherent", async () => {
    const snapshot = prediction({ capturedAtUtc: KICKOFF, predictionCapturedBeforeKickoff: false });
    expect((await assemble([input(snapshot)])).prediction_snapshots).toEqual([]);
  });

  it("24 excludes a post-kickoff snapshot when its flag is coherent", async () => {
    const snapshot = prediction({ capturedAtUtc: "2031-04-05T18:00:00.001Z", predictionCapturedBeforeKickoff: false });
    expect((await assemble([input(snapshot)])).prediction_snapshots).toEqual([]);
  });

  it("25 blocks a prematch boolean that contradicts timestamps", async () => {
    await expect(assemble([input(prediction({ predictionCapturedBeforeKickoff: false }))])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("26 selects the latest strictly prematch snapshot", async () => {
    const older = prediction({ capturedAtUtc: "2031-04-05T16:00:00.000Z", contentHash: "c".repeat(64) });
    const latest = prediction({ capturedAtUtc: "2031-04-05T17:30:00.000Z", contentHash: "d".repeat(64) });
    expect((await assemble([input(latest), input(older)])).prediction_snapshots[0].content_hash).toBe("d".repeat(64));
  });

  it("27 never lets providerInternalTimestamp control selection", async () => {
    const older = prediction({ capturedAtUtc: "2031-04-05T16:00:00.000Z", providerInternalTimestamp: "2999-01-01", contentHash: "c".repeat(64) });
    const latest = prediction({ capturedAtUtc: "2031-04-05T17:30:00.000Z", providerInternalTimestamp: null, contentHash: "d".repeat(64) });
    expect((await assemble([input(older), input(latest)])).prediction_snapshots[0].content_hash).toBe("d".repeat(64));
  });

  it("28 blocks incompatible snapshots tied at capturedAtUtc", async () => {
    await expect(assemble([input(prediction()), input(prediction({ contentHash: "c".repeat(64) }))])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("29 orders final predictions deterministically", async () => {
    const zeta = prediction({ providerKey: "synthetic-zeta", providerFixtureId: "z", contentHash: "c".repeat(64) });
    const alpha = prediction({ providerKey: "synthetic-alpha", providerFixtureId: "a", contentHash: "d".repeat(64) });
    const packet = await assemble([input(zeta), input(alpha)]);
    expect(packet.prediction_snapshots.map((item) => item.provider_key)).toEqual(["synthetic-alpha", "synthetic-zeta"]);
  });

  it("30 does not mutate repository inputs", async () => {
    const inputs = [input()];
    const before = JSON.stringify(inputs);
    await assemble(inputs);
    expect(JSON.stringify(inputs)).toBe(before);
  });

  it("31 blocks duplicated HOME", async () => {
    const base = prediction();
    const invalid = { ...base, selections: [base.selections[0], base.selections[0], base.selections[2]] } as unknown as PredictionSnapshot;
    await expect(assemble([input(invalid)])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("32 blocks missing DRAW", async () => {
    const base = prediction();
    const invalid = { ...base, selections: [base.selections[0], base.selections[2]] } as unknown as PredictionSnapshot;
    await expect(assemble([input(invalid)])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("33 blocks an additional selection", async () => {
    const base = prediction();
    const invalid = { ...base, selections: [...base.selections, { selection: "DRAW_OR_AWAY", rawPercentage: "0%", normalizedProbability: "0" }] } as unknown as PredictionSnapshot;
    await expect(assemble([input(invalid)])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("34 accepts the 99.99 lower sum boundary", async () => {
    expect((await assemble([input(probabilities(["40%", "0.4"], ["30%", "0.3"], ["29.99%", "0.2999"], "99.99%"))])).prediction_snapshots).toHaveLength(1);
  });

  it("35 accepts the 100.01 upper sum boundary", async () => {
    expect((await assemble([input(probabilities(["40%", "0.4"], ["30%", "0.3"], ["30.01%", "0.3001"], "100.01%"))])).prediction_snapshots).toHaveLength(1);
  });

  it("36 blocks 99.98", async () => {
    await expect(assemble([input(probabilities(["40%", "0.4"], ["30%", "0.3"], ["29.98%", "0.2998"], "99.98%"))])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("37 blocks 100.02", async () => {
    await expect(assemble([input(probabilities(["40%", "0.4"], ["30%", "0.3"], ["30.02%", "0.3002"], "100.02%"))])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("38 blocks a contradictory probabilityTotalRaw", async () => {
    await expect(assemble([input(prediction({ probabilityTotalRaw: "99.99%" }))])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("39 rejects outcome fields instead of consulting outcomes", async () => {
    const invalid = { ...prediction(), outcome: "HOME" } as unknown as PredictionSnapshot;
    await expect(assemble([input(invalid)])).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("40 exposes no evaluation data", async () => {
    expect((await assemble()).prediction_snapshots[0]).not.toHaveProperty("evaluation");
  });

  it("41 exposes no settlement data", async () => {
    expect((await assemble()).prediction_snapshots[0]).not.toHaveProperty("payout");
  });

  it("42 does not use fetch", async () => {
    await assemble();
    expect(fetchCalls).toBe(0);
  });

  it("43 needs no filesystem service", async () => {
    expect(outputKeys(await assemble())).not.toContain("filesystem");
  });

  it("44 needs no Prisma service", async () => {
    expect(outputKeys(await assemble())).not.toContain("prisma");
  });

  it("45 needs no environment-derived input", async () => {
    expect((await assemble()).packet_schema_version).toBe(SOURCE_NEUTRAL_PACKET_SCHEMA_VERSION);
  });

  it("46 consumes the source-neutral domain snapshot rather than API-Football DTOs", async () => {
    expect((await assemble()).prediction_snapshots[0].provider_key).toBe(prediction().providerKey);
  });

  it("47 preserves the historical packet when prediction input is omitted", async () => {
    const historical = await new PacketAssembler(evidenceStore).assemble(context, [run]);
    expect(historical).not.toHaveProperty("packet_schema_version");
    expect(historical).not.toHaveProperty("prediction_snapshots");
  });
});

function outputKeys(value: object): readonly string[] {
  return Object.keys(value).map((key) => key.toLowerCase());
}
