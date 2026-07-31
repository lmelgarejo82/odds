import { canonicalJson, sha256Bytes } from "@/domain/market-v2/capture/evidence";
import { CaptureError } from "@/domain/market-v2/capture/errors";
import type {
  CaptureRunContext,
  CaptureRunResult,
  ClosingObservation,
  EvidenceManifestItem,
  ForebetObservation,
  OddsObservation,
  OutcomeObservation,
  PrematchDecision,
  ProspectiveCapturePacket,
  SyntheticFixture,
} from "@/domain/market-v2/capture/types";
import type { AppendOnlyEvidenceStore } from "@/infrastructure/market-v2/capture/evidence-store";

function uniqueSorted<T>(values: readonly T[], key: (value: T) => string): T[] {
  const unique = new Map<string, T>();
  for (const value of values) {
    const identity = key(value);
    const previous = unique.get(identity);
    if (previous !== undefined && canonicalJson(previous) !== canonicalJson(value)) {
      throw new Error(`conflicting packet record ${identity}`);
    }
    unique.set(identity, value);
  }
  return [...unique.values()].sort((left, right) => key(left).localeCompare(key(right)));
}

export function packetPayloadHash(packet: Omit<ProspectiveCapturePacket, "packet_hash">): string {
  return sha256Bytes(canonicalJson(packet));
}

export function buildSyntheticPrematchDecisions(
  fixtures: readonly SyntheticFixture[],
  odds: readonly OddsObservation[],
  policyVersion: string,
): readonly PrematchDecision[] {
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.source_fixture_id));
  const selected = odds.find((snapshot) => snapshot.odds_snapshot_id === "SYNTH_ODDS_A");
  if (selected === undefined) throw new Error("synthetic selected quote is missing");
  const definitions = [
    {
      fixtureId: "SYNTH_FIXTURE_A",
      decidedAtUtc: "2030-02-01T17:30:00.000Z",
      status: "SELECTED" as const,
      reasonCode: "SYNTH_CONCORDANT_CASE",
      selected,
      estimatedProbability: 0.8,
    },
    {
      fixtureId: "SYNTH_FIXTURE_B",
      decidedAtUtc: "2030-02-01T18:30:00.000Z",
      status: "ABSTAINED" as const,
      reasonCode: "SYNTH_DIVERGENCE_REQUIRES_ABSTENTION",
    },
    {
      fixtureId: "SYNTH_FIXTURE_C",
      decidedAtUtc: "2030-02-01T19:30:00.000Z",
      status: "BLOCKED" as const,
      reasonCode: "SYNTH_TECHNICAL_SOURCE_FAILURE",
    },
    {
      fixtureId: "SYNTH_FIXTURE_D",
      decidedAtUtc: "2030-02-01T20:30:00.000Z",
      status: "BLOCKED" as const,
      reasonCode: "SYNTH_MARKET_NOT_ELIGIBLE",
    },
  ];
  return Object.freeze(
    definitions.map((definition) => {
      if (!fixtureIds.has(definition.fixtureId)) throw new Error("decision fixture is missing");
      const exactQuote = definition.selected;
      const breakEven = exactQuote === undefined ? null : 1 / exactQuote.decimal_odds;
      const estimated = definition.estimatedProbability ?? null;
      return Object.freeze({
        decision_id: `SYNTH_DECISION_${definition.fixtureId.slice(-1)}`,
        fixture_id: definition.fixtureId,
        decided_at_utc: definition.decidedAtUtc,
        decision_status: definition.status,
        reason_code: definition.reasonCode,
        selected_market_key: exactQuote?.market_key ?? null,
        selected_selection_key: exactQuote?.selection_key ?? null,
        selected_odds_snapshot_id: exactQuote?.odds_snapshot_id ?? null,
        estimated_probability: estimated,
        break_even_probability: breakEven,
        estimated_edge: estimated === null || breakEven === null ? null : estimated - breakEven,
        policy_version: policyVersion,
        input_hash: sha256Bytes(
          canonicalJson({
            fixtureId: definition.fixtureId,
            decidedAtUtc: definition.decidedAtUtc,
            selectedOddsSnapshotId: exactQuote?.odds_snapshot_id ?? null,
            policyVersion,
          }),
        ),
      });
    }),
  );
}

export class PacketAssembler {
  constructor(readonly evidenceStore: AppendOnlyEvidenceStore) {}

  async assemble(
    context: CaptureRunContext,
    runs: readonly CaptureRunResult[],
    decisions: readonly PrematchDecision[] = [],
  ): Promise<ProspectiveCapturePacket> {
    if (!context.synthetic) throw this.#blocked(context, "only synthetic packets are allowed");
    if (runs.length === 0) throw this.#blocked(context, "at least one capture run is required");
    if (runs.some((run) => run.stage !== context.stage)) {
      throw this.#blocked(context, "capture stages cannot be mixed");
    }
    const fixtures = uniqueSorted(
      runs.flatMap((run) => run.data.fixtures),
      (fixture) => fixture.source_fixture_id,
    );
    const forebet = uniqueSorted(
      runs.flatMap((run) => run.data.forebetSnapshots),
      (snapshot) => snapshot.forebet_snapshot_id,
    );
    const odds = uniqueSorted(
      runs.flatMap((run) => run.data.oddsSnapshots),
      (snapshot) => snapshot.odds_snapshot_id,
    );
    const closing = uniqueSorted(
      runs.flatMap((run) => run.data.closingSnapshots),
      (snapshot) => snapshot.closing_snapshot_id,
    );
    const outcomes = uniqueSorted(
      runs.flatMap((run) => run.data.outcomes),
      (outcome) => outcome.outcome_id,
    );

    this.#assertStageContents(context, forebet, odds, decisions, closing, outcomes);
    const references = uniqueSorted(
      [
        ...fixtures.map((value) => value.source_artifact_reference),
        ...forebet.map((value) => value.source_artifact_reference),
        ...odds.map((value) => value.source_artifact_reference),
        ...closing.map((value) => value.source_artifact_reference),
        ...outcomes.map((value) => value.source_artifact_reference),
      ],
      (reference) => reference,
    );
    const evidenceManifest: EvidenceManifestItem[] = [];
    for (const reference of references) {
      const evidence = await this.evidenceStore.findBySourceReference(reference);
      if (evidence === null) throw this.#blocked(context, "packet contains a broken evidence reference");
      await this.evidenceStore.read(evidence.evidenceId);
      evidenceManifest.push(
        Object.freeze({
          artifact_reference: reference,
          source_name: evidence.providerKey,
          captured_at_utc: evidence.capturedAtUtc,
          content_hash: evidence.sha256,
        }),
      );
    }

    const universe = context.universeSpecification;
    const packetWithoutHash: Omit<ProspectiveCapturePacket, "packet_hash"> = Object.freeze({
      protocol_version: context.protocolVersion,
      packet_id: `SYNTH_PACKET_${context.stage}_${context.runId}`,
      generated_at_utc: context.generatedAtUtc,
      source_metadata: Object.freeze({
        synthetic: true,
        capture_stage: context.stage,
        source_names: Object.freeze(
          [...new Set(runs.flatMap((run) => run.providerSummaries.map((item) => item.providerKey)))].sort(),
        ),
        data_classification: "SYNTHETIC",
      }),
      capture_universe: Object.freeze({
        protocol_version: context.protocolVersion,
        phase: "PILOT",
        competition_allowlist: Object.freeze([...universe.competitionAllowlist]),
        date_from: universe.dateFrom,
        date_to: universe.dateTo,
        required_markets: Object.freeze([...universe.requiredMarkets]),
        allowed_bookmakers: Object.freeze([...universe.allowedBookmakers]),
        snapshot_schedule: Object.freeze(
          universe.snapshotSchedule.map((schedule) =>
            Object.freeze({
              role: schedule.role,
              target_seconds_before_kickoff: schedule.targetSecondsBeforeKickoff,
              tolerance_seconds: schedule.toleranceSeconds,
            }),
          ),
        ),
        postponed_fixture_policy: universe.postponedFixturePolicy,
        unreliable_kickoff_policy: universe.unreliableKickoffPolicy,
      }),
      fixtures: Object.freeze(fixtures),
      forebet_snapshots: Object.freeze(forebet),
      odds_snapshots: Object.freeze(odds),
      decisions: Object.freeze([...decisions].sort((left, right) => left.decision_id.localeCompare(right.decision_id))),
      closing_snapshots: Object.freeze(closing),
      outcomes: Object.freeze(outcomes),
      evidence_manifest: Object.freeze({ items: Object.freeze(evidenceManifest) }),
    });
    return Object.freeze({
      ...packetWithoutHash,
      packet_hash: packetPayloadHash(packetWithoutHash),
    });
  }

  #assertStageContents(
    context: CaptureRunContext,
    forebet: readonly ForebetObservation[],
    odds: readonly OddsObservation[],
    decisions: readonly PrematchDecision[],
    closing: readonly ClosingObservation[],
    outcomes: readonly OutcomeObservation[],
  ): void {
    if (context.stage === "PREMATCH" && (closing.length > 0 || outcomes.length > 0)) {
      throw this.#blocked(context, "PREMATCH cannot include closing or outcomes");
    }
    if (
      context.stage === "CLOSING" &&
      (forebet.length > 0 || odds.length > 0 || decisions.length > 0 || outcomes.length > 0)
    ) {
      throw this.#blocked(context, "CLOSING cannot reconstruct prematch inputs or outcomes");
    }
    if (
      context.stage === "OUTCOME" &&
      (forebet.length > 0 || odds.length > 0 || decisions.length > 0 || closing.length > 0)
    ) {
      throw this.#blocked(context, "OUTCOME cannot reconstruct decision inputs");
    }
  }

  #blocked(context: CaptureRunContext, sanitizedMessage: string): CaptureError {
    return new CaptureError({
      code: "PACKET_ASSEMBLY_BLOCKED",
      retryable: false,
      providerKey: context.providerKey,
      stage: context.stage,
      sanitizedMessage,
    });
  }
}
