import { readFileSync, readdirSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { CaptureProvider } from "@/application/market-v2/capture/capture-provider";
import { CaptureOrchestrator } from "@/application/market-v2/capture/capture-orchestrator";
import { createCaptureRunContext, FixedCaptureClock } from "@/application/market-v2/capture/capture-run";
import { buildSyntheticPrematchDecisions, PacketAssembler } from "@/application/market-v2/capture/packet-assembler";
import {
  AllowAllRateLimitPolicy,
  BlockingRateLimitPolicy,
  type RateLimitPolicy,
} from "@/application/market-v2/capture/rate-limit-policy";
import { FakeSleeper, RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import { runSyntheticCaptureSelfCheck } from "@/application/market-v2/capture/synthetic-self-check";
import { CaptureError } from "@/domain/market-v2/capture/errors";
import type {
  CaptureRunContext,
  CaptureTransport,
  MarketKey,
  SyntheticFixture,
  TransportRequest,
  TransportResponse,
  UniverseSpecification,
} from "@/domain/market-v2/capture/types";
import { AppendOnlyEvidenceStore } from "@/infrastructure/market-v2/capture/evidence-store";
import { TemporaryPacketFileWriter } from "@/infrastructure/market-v2/capture/packet-file-writer";
import { validateSyntheticPacketWithPython } from "@/infrastructure/market-v2/capture/python-packet-validator";
import {
  SyntheticForebetProvider,
  SyntheticOddsProvider,
  SyntheticOutcomeProvider,
  createSyntheticTransport,
} from "@/infrastructure/market-v2/capture/synthetic-provider";

const universe: UniverseSpecification = Object.freeze({
  competitionAllowlist: Object.freeze(["SYNTH_COMP_ALPHA"]),
  dateFrom: "2030-02-01",
  dateTo: "2030-02-01",
  requiredMarkets: Object.freeze([
    "MATCH_ODDS_1X2",
    "DOUBLE_CHANCE",
    "DRAW_NO_BET",
  ] satisfies MarketKey[]),
  allowedBookmakers: Object.freeze(["SYNTH_BOOK_A"]),
  snapshotSchedule: Object.freeze([
    Object.freeze({ role: "EARLY", targetSecondsBeforeKickoff: 21600, toleranceSeconds: 1800 }),
    Object.freeze({ role: "DECISION", targetSecondsBeforeKickoff: 3600, toleranceSeconds: 900 }),
    Object.freeze({ role: "CLOSING", targetSecondsBeforeKickoff: 300, toleranceSeconds: 180 }),
  ]),
  postponedFixturePolicy: "RECAPTURE_NEW_KICKOFF",
  unreliableKickoffPolicy: "BLOCK_DECISION",
});

function context(
  provider: Readonly<{ providerKey: string; providerVersion: string }>,
  stage: CaptureRunContext["stage"],
  runId = `SYNTH_RUN_${stage}`,
): CaptureRunContext {
  return createCaptureRunContext({
    runId,
    protocolVersion: "prospective-r0/1.0",
    stage,
    generatedAtUtc: "2030-02-03T00:00:00.000Z",
    universeSpecification: universe,
    providerKey: provider.providerKey,
    providerVersion: provider.providerVersion,
    allowedCompetitionKeys: universe.competitionAllowlist,
    requestedMarkets: universe.requiredMarkets,
    requestedBookmakers: universe.allowedBookmakers,
    synthetic: true,
    correlationId: `SYNTH_CORRELATION_${runId}`,
    policyVersion: "synthetic-capture-policy/1.0",
  });
}

class RecordingTransport implements CaptureTransport {
  readonly requests: TransportRequest[] = [];
  constructor(readonly delegate: CaptureTransport) {}
  async execute(request: TransportRequest): Promise<TransportResponse> {
    this.requests.push(request);
    return this.delegate.execute(request);
  }
}

describe("synthetic capture orchestration and packet boundary", () => {
  let temporaryRoot: string;
  let store: AppendOnlyEvidenceStore;
  let writer: TemporaryPacketFileWriter;
  let clock: FixedCaptureClock;
  let sleeper: FakeSleeper;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "ou25-capture-integration-"));
    const evidenceRoot = join(temporaryRoot, "evidence");
    const packetRoot = join(temporaryRoot, "packets");
    await mkdir(evidenceRoot);
    await mkdir(packetRoot);
    store = new AppendOnlyEvidenceStore(evidenceRoot);
    writer = new TemporaryPacketFileWriter(packetRoot);
    await store.initialize();
    await writer.initialize();
    clock = new FixedCaptureClock("2030-02-03T00:00:00.000Z");
    sleeper = new FakeSleeper();
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  function orchestrator(rateLimit: RateLimitPolicy = new AllowAllRateLimitPolicy()) {
    return new CaptureOrchestrator(
      store,
      clock,
      new RetryPolicy({
        maxAttempts: 3,
        baseDelayMilliseconds: 100,
        maximumDelayMilliseconds: 500,
      }),
      sleeper,
      rateLimit,
    );
  }

  async function prematchRuns() {
    const transport = createSyntheticTransport();
    const forebet = new SyntheticForebetProvider(transport);
    const odds = new SyntheticOddsProvider(transport);
    const forebetRun = await orchestrator().run(context(forebet, "PREMATCH", "SYNTH_FOREBET"), forebet);
    const oddsRun = await orchestrator().run(context(odds, "PREMATCH", "SYNTH_ODDS"), odds);
    return { forebetRun, oddsRun, forebet, odds };
  }

  it("preserves the complete four-fixture universe despite partial failures", async () => {
    const provider = new SyntheticForebetProvider(createSyntheticTransport());
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(run.discoveredFixtures).toBe(4);
    expect(run.data.fixtures).toHaveLength(4);
    expect(run.failedCaptures).toBe(1);
  });

  it("retries a temporary fixture failure without sleeping for real", async () => {
    const provider = new SyntheticForebetProvider(createSyntheticTransport());
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(run.retryCount).toBe(1);
    expect(sleeper.delays).toEqual([100]);
    expect(run.data.forebetSnapshots.map((item) => item.source_fixture_id)).toContain(
      "SYNTH_FIXTURE_B",
    );
  });

  it("does not retry a permanent failure", async () => {
    const provider = new SyntheticForebetProvider(createSyntheticTransport());
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(run.errorCodes).toContain("CAPTURE_PERMANENT_FAILURE");
    expect(run.retryCount).toBe(1);
  });

  it("reports retry exhaustion as a typed partial failure", async () => {
    const provider: CaptureProvider = {
      providerKey: "SYNTH_EXHAUSTED",
      providerVersion: "1",
      capabilities: ["FIXTURES"],
      async discoverFixtures(runContext) {
        throw new CaptureError({
          code: "CAPTURE_TEMPORARY_FAILURE",
          retryable: true,
          providerKey: "SYNTH_EXHAUSTED",
          stage: runContext.stage,
          sanitizedMessage: "always temporary",
        });
      },
    };
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(run.retryCount).toBe(2);
    expect(run.errorCodes).toContain("CAPTURE_RETRY_EXHAUSTED");
  });

  it("records a blocked rate limit without timers", async () => {
    const provider = new SyntheticForebetProvider(createSyntheticTransport());
    const run = await orchestrator(new BlockingRateLimitPolicy(500)).run(
      context(provider, "PREMATCH"),
      provider,
    );
    expect(run.rateLimitedCount).toBe(1);
    expect(run.errorCodes).toContain("CAPTURE_RATE_LIMITED");
    expect(sleeper.delays).toEqual([]);
  });

  it("isolates invalid in-play and suspended odds by fixture", async () => {
    const provider = new SyntheticOddsProvider(createSyntheticTransport());
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(run.data.oddsSnapshots).toHaveLength(2);
    expect(run.failedCaptures).toBe(2);
    expect(run.warningCodes).toEqual(
      expect.arrayContaining([
        "TECHNICAL_ABSTENTION_SYNTH_FIXTURE_C",
        "TECHNICAL_ABSTENTION_SYNTH_FIXTURE_D",
      ]),
    );
  });

  it("never calls closing or outcomes during PREMATCH", async () => {
    const transport = new RecordingTransport(createSyntheticTransport());
    const provider = new SyntheticOddsProvider(transport);
    const run = await orchestrator().run(context(provider, "PREMATCH"), provider);
    expect(transport.requests.map((item) => item.capability)).not.toContain("CLOSING");
    expect(transport.requests.map((item) => item.capability)).not.toContain("OUTCOMES");
    expect(run.data.closingSnapshots).toEqual([]);
    expect(run.data.outcomes).toEqual([]);
  });

  it("CLOSING captures no prematch inputs and modifies no decisions", async () => {
    const { forebetRun } = await prematchRuns();
    const provider = new SyntheticOddsProvider(createSyntheticTransport());
    const run = await orchestrator().run(
      context(provider, "CLOSING"),
      provider,
      forebetRun.data.fixtures,
    );
    expect(run.data.closingSnapshots).toHaveLength(4);
    expect(run.data.forebetSnapshots).toEqual([]);
    expect(run.data.oddsSnapshots).toEqual([]);
    expect(run.data.outcomes).toEqual([]);
  });

  it("OUTCOME reconstructs no Forebet, odds, closing, or decisions", async () => {
    const { forebetRun } = await prematchRuns();
    const provider = new SyntheticOutcomeProvider(createSyntheticTransport());
    const run = await orchestrator().run(
      context(provider, "OUTCOME"),
      provider,
      forebetRun.data.fixtures,
    );
    expect(run.data.outcomes).toHaveLength(5);
    expect(run.data.outcomes).toContainEqual(
      expect.objectContaining({
        outcome_id: "SYNTH_OUTCOME_B_V2",
        supersedes_outcome_id: "SYNTH_OUTCOME_B_V1",
      }),
    );
    expect(run.data.forebetSnapshots).toEqual([]);
    expect(run.data.oddsSnapshots).toEqual([]);
    expect(run.data.closingSnapshots).toEqual([]);
  });

  it("assembles a deterministic PREMATCH packet with valid evidence references", async () => {
    const { forebetRun, oddsRun } = await prematchRuns();
    const assemblyContext = context(
      { providerKey: "SYNTH_ASSEMBLER", providerVersion: "1" },
      "PREMATCH",
      "SYNTH_PACKET_PREMATCH",
    );
    const decisions = buildSyntheticPrematchDecisions(
      forebetRun.data.fixtures,
      oddsRun.data.oddsSnapshots,
      assemblyContext.policyVersion,
    );
    const assembler = new PacketAssembler(store);
    const first = await assembler.assemble(assemblyContext, [forebetRun, oddsRun], decisions);
    const second = await assembler.assemble(assemblyContext, [forebetRun, oddsRun], decisions);
    expect(first.packet_hash).toBe(second.packet_hash);
    expect(first.fixtures).toHaveLength(4);
    expect(first.evidence_manifest.items.length).toBeGreaterThan(0);
    expect(first.closing_snapshots).toEqual([]);
    expect(first.outcomes).toEqual([]);
  });

  it("rejects stage mixing during packet assembly", async () => {
    const { forebetRun } = await prematchRuns();
    await expect(
      new PacketAssembler(store).assemble(
        context({ providerKey: "SYNTH_ASSEMBLER", providerVersion: "1" }, "CLOSING"),
        [forebetRun],
      ),
    ).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("rejects a broken evidence reference", async () => {
    const { forebetRun } = await prematchRuns();
    const brokenFixture: SyntheticFixture = Object.freeze({
      ...forebetRun.data.fixtures[0]!,
      source_artifact_reference: "synth:evidence:missing",
    });
    const brokenRun = Object.freeze({
      ...forebetRun,
      data: Object.freeze({ ...forebetRun.data, fixtures: Object.freeze([brokenFixture]) }),
    });
    await expect(
      new PacketAssembler(store).assemble(
        context({ providerKey: "SYNTH_ASSEMBLER", providerVersion: "1" }, "PREMATCH"),
        [brokenRun],
      ),
    ).rejects.toMatchObject({ code: "PACKET_ASSEMBLY_BLOCKED" });
  });

  it("writes packets append-only and rejects overwrite", async () => {
    const { forebetRun, oddsRun } = await prematchRuns();
    const assemblyContext = context(
      { providerKey: "SYNTH_ASSEMBLER", providerVersion: "1" },
      "PREMATCH",
      "SYNTH_PACKET_WRITER",
    );
    const packet = await new PacketAssembler(store).assemble(
      assemblyContext,
      [forebetRun, oddsRun],
      buildSyntheticPrematchDecisions(
        forebetRun.data.fixtures,
        oddsRun.data.oddsSnapshots,
        assemblyContext.policyVersion,
      ),
    );
    const written = await writer.write(packet);
    expect((await writer.read(written)).packet_hash).toBe(packet.packet_hash);
    await expect(writer.write(packet)).rejects.toThrow(/overwrite/);
  });

  it("generates a TypeScript packet that Python validates without mutation", async () => {
    const { forebetRun, oddsRun } = await prematchRuns();
    const assemblyContext = context(
      { providerKey: "SYNTH_ASSEMBLER", providerVersion: "1" },
      "PREMATCH",
      "SYNTH_PACKET_PYTHON",
    );
    const packet = await new PacketAssembler(store).assemble(
      assemblyContext,
      [forebetRun, oddsRun],
      buildSyntheticPrematchDecisions(
        forebetRun.data.fixtures,
        oddsRun.data.oddsSnapshots,
        assemblyContext.policyVersion,
      ),
    );
    const written = await writer.write(packet);
    await expect(validateSyntheticPacketWithPython(written.path)).resolves.toEqual({
      exitCode: 0,
      unchanged: true,
      markersPresent: true,
    });
  });
});

describe("synthetic capture self-check and static isolation", () => {
  it("validates three separate packets and removes every temporary", async () => {
    const summary = await runSyntheticCaptureSelfCheck();
    expect(summary).toEqual(
      expect.objectContaining({
        fixtures: 4,
        prematchPackets: 1,
        closingPackets: 1,
        outcomePackets: 1,
        retries: 1,
        evidenceConflictDetected: true,
        pythonValidatedPackets: 3,
        temporaryRootCleaned: true,
      }),
    );
    expect(summary.partialFailures).toBeGreaterThan(0);
    expect(summary.duplicateCaptures).toBeGreaterThan(0);
  }, 30_000);

  it("uses explicit synthetic identifiers and labels", () => {
    const roots = [
      resolve(process.cwd(), "src/application/market-v2/capture"),
      resolve(process.cwd(), "src/domain/market-v2/capture"),
      resolve(process.cwd(), "src/infrastructure/market-v2/capture"),
    ];
    const source = roots
      .flatMap((root) => readdirSync(root).map((name) => readFileSync(resolve(root, name), "utf8")))
      .join("\n");
    expect(source).toContain("SYNTH_FIXTURE_A");
    expect(source).toContain("Synthetic Competition Alpha");
    expect(source).toContain("Synthetic Home");
    expect(source).toContain("Synthetic Away");
  });

  it("has no network, database, Prisma, or hidden wall-clock imports", () => {
    const roots = [
      resolve(process.cwd(), "src/application/market-v2/capture"),
      resolve(process.cwd(), "src/domain/market-v2/capture"),
      resolve(process.cwd(), "src/infrastructure/market-v2/capture"),
    ];
    const source = roots
      .flatMap((root) => readdirSync(root).map((name) => readFileSync(resolve(root, name), "utf8")))
      .join("\n");
    expect(source).not.toMatch(/from ["']node:(http|https|net|tls|dgram)|@prisma|sqlite3|Date\.now\(/);
  });
});
