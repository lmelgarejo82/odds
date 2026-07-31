import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CaptureOrchestrator } from "./capture-orchestrator";
import { createCaptureRunContext, FixedCaptureClock } from "./capture-run";
import { PacketAssembler, buildSyntheticPrematchDecisions } from "./packet-assembler";
import { AllowAllRateLimitPolicy } from "./rate-limit-policy";
import { FakeSleeper, RetryPolicy } from "./retry-policy";
import { sha256Bytes } from "@/domain/market-v2/capture/evidence";
import type {
  CaptureRunContext,
  CaptureRunResult,
  MarketKey,
  ProspectiveCapturePacket,
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

export type SyntheticCaptureSummary = Readonly<{
  fixtures: number;
  prematchPackets: number;
  closingPackets: number;
  outcomePackets: number;
  retries: number;
  partialFailures: number;
  duplicateCaptures: number;
  evidenceConflictDetected: boolean;
  pythonValidatedPackets: number;
  temporaryRootCleaned: boolean;
}>;

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

function contextFor(
  provider: Readonly<{ providerKey: string; providerVersion: string }>,
  stage: CaptureRunContext["stage"],
  runId: string,
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
    cutoffAtUtc: "2030-02-03T00:00:00.000Z",
    synthetic: true,
    correlationId: `SYNTH_CORRELATION_${runId}`,
    policyVersion: "synthetic-capture-policy/1.0",
  });
}

function assemblerContext(stage: CaptureRunContext["stage"], runId: string): CaptureRunContext {
  return contextFor(
    { providerKey: "SYNTH_PACKET_ASSEMBLER", providerVersion: "synthetic-assembler/1.0" },
    stage,
    runId,
  );
}

function orchestrator(
  store: AppendOnlyEvidenceStore,
  clock: FixedCaptureClock,
  sleeper: FakeSleeper,
): CaptureOrchestrator {
  return new CaptureOrchestrator(
    store,
    clock,
    new RetryPolicy({
      maxAttempts: 3,
      baseDelayMilliseconds: 100,
      maximumDelayMilliseconds: 1000,
      jitterMilliseconds: 10,
      jitterSeed: "SYNTHETIC_EXPLICIT_SEED",
    }),
    sleeper,
    new AllowAllRateLimitPolicy(),
  );
}

async function writeAndValidate(
  writer: TemporaryPacketFileWriter,
  packet: ProspectiveCapturePacket,
): Promise<void> {
  const written = await writer.write(packet);
  const readBack = await writer.read(written);
  if (readBack.packet_hash !== packet.packet_hash) throw new Error("packet read-back mismatch");
  await validateSyntheticPacketWithPython(written.path);
}

export async function runSyntheticCaptureSelfCheck(): Promise<SyntheticCaptureSummary> {
  const temporaryRoot = await mkdtemp(join(tmpdir(), "ou25-market-v2-capture-"));
  let summary: Omit<SyntheticCaptureSummary, "temporaryRootCleaned"> | undefined;
  try {
    const evidenceRoot = join(temporaryRoot, "evidence");
    const packetRoot = join(temporaryRoot, "packets");
    await mkdir(evidenceRoot);
    await mkdir(packetRoot);
    const store = new AppendOnlyEvidenceStore(evidenceRoot);
    const writer = new TemporaryPacketFileWriter(packetRoot);
    await store.initialize();
    await writer.initialize();

    const transport = createSyntheticTransport();
    const forebetProvider = new SyntheticForebetProvider(transport);
    const oddsProvider = new SyntheticOddsProvider(transport);
    const outcomeProvider = new SyntheticOutcomeProvider(transport);
    const clock = new FixedCaptureClock("2030-02-03T00:00:00.000Z");
    const sleeper = new FakeSleeper();
    const forebetOrchestrator = orchestrator(store, clock, sleeper);
    const forebetContext = contextFor(forebetProvider, "PREMATCH", "SYNTH_RUN_FOREBET");
    const forebetRun = await forebetOrchestrator.run(forebetContext, forebetProvider);
    const replayRun = await forebetOrchestrator.run(
      forebetContext,
      forebetProvider,
      forebetRun.data.fixtures,
    );
    const oddsRun = await orchestrator(store, clock, sleeper).run(
      contextFor(oddsProvider, "PREMATCH", "SYNTH_RUN_ODDS"),
      oddsProvider,
    );
    const fixtures = forebetRun.data.fixtures;
    const closingRun = await orchestrator(store, clock, sleeper).run(
      contextFor(oddsProvider, "CLOSING", "SYNTH_RUN_CLOSING"),
      oddsProvider,
      fixtures,
    );
    const outcomeRun = await orchestrator(store, clock, sleeper).run(
      contextFor(outcomeProvider, "OUTCOME", "SYNTH_RUN_OUTCOME"),
      outcomeProvider,
      fixtures,
    );

    const firstEvidenceId = forebetRun.evidenceIds[0];
    if (firstEvidenceId === undefined) throw new Error("synthetic evidence is missing");
    const published = await store.read(firstEvidenceId);
    const conflictingBody = Buffer.from("synthetic-conflicting-evidence", "utf8");
    let evidenceConflictDetected = false;
    try {
      await store.publish(
        Object.freeze({
          ...published.evidence,
          byteSize: conflictingBody.byteLength,
          sha256: sha256Bytes(conflictingBody),
        }),
        conflictingBody,
      );
    } catch {
      evidenceConflictDetected = true;
    }

    const assembler = new PacketAssembler(store);
    const prematchContext = assemblerContext("PREMATCH", "SYNTH_ASSEMBLY_PREMATCH");
    const combinedOdds = oddsRun.data.oddsSnapshots;
    const decisions = buildSyntheticPrematchDecisions(fixtures, combinedOdds, prematchContext.policyVersion);
    const prematchPacket = await assembler.assemble(
      prematchContext,
      [forebetRun, oddsRun],
      decisions,
    );
    const closingPacket = await assembler.assemble(
      assemblerContext("CLOSING", "SYNTH_ASSEMBLY_CLOSING"),
      [closingRun],
    );
    const outcomePacket = await assembler.assemble(
      assemblerContext("OUTCOME", "SYNTH_ASSEMBLY_OUTCOME"),
      [outcomeRun],
    );
    await writeAndValidate(writer, prematchPacket);
    await writeAndValidate(writer, closingPacket);
    await writeAndValidate(writer, outcomePacket);

    const allRuns: readonly CaptureRunResult[] = [forebetRun, oddsRun, closingRun, outcomeRun];
    summary = Object.freeze({
      fixtures: fixtures.length,
      prematchPackets: 1,
      closingPackets: 1,
      outcomePackets: 1,
      retries: allRuns.reduce((sum, run) => sum + run.retryCount, 0),
      partialFailures: allRuns.reduce((sum, run) => sum + run.failedCaptures, 0),
      duplicateCaptures: replayRun.duplicateCaptures,
      evidenceConflictDetected,
      pythonValidatedPackets: 3,
    });
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
  if (summary === undefined) throw new Error("synthetic self-check did not complete");
  return Object.freeze({ ...summary, temporaryRootCleaned: !existsSync(temporaryRoot) });
}
