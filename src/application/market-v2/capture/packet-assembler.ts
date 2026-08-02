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
  PredictionSnapshot,
  ProspectiveCapturePacket,
  SyntheticFixture,
} from "@/domain/market-v2/capture/types";
import type { AppendOnlyEvidenceStore } from "@/infrastructure/market-v2/capture/evidence-store";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";

export const SOURCE_NEUTRAL_PACKET_SCHEMA_VERSION = "2" as const;

export type PersistedPredictionPacketInput = Readonly<{
  snapshot: PredictionSnapshot;
  kickoffUtc: string;
}>;

export type PacketPredictionSelection = Readonly<{
  selection: "HOME" | "DRAW" | "AWAY";
  raw_percentage: string;
  normalized_probability: string;
}>;

export type PacketPredictionSnapshot = Readonly<{
  provider_key: string;
  provider_fixture_id: string;
  captured_at_utc: string;
  kickoff_at_utc: string;
  prediction_captured_before_kickoff: true;
  selections: readonly [
    PacketPredictionSelection & Readonly<{ selection: "HOME" }>,
    PacketPredictionSelection & Readonly<{ selection: "DRAW" }>,
    PacketPredictionSelection & Readonly<{ selection: "AWAY" }>,
  ];
  probability_total_raw: string;
  predicted_winner_provider_team_id: string | null;
  predicted_winner_name: string | null;
  winner_comment: string | null;
  advice: string | null;
  under_over_raw: string | null;
  provider_internal_timestamp: string | null;
  content_hash: string;
  parser_version: string;
  policy_version: string;
}>;

export type SourceNeutralProspectiveCapturePacket = ProspectiveCapturePacket &
  Readonly<{
    packet_schema_version: typeof SOURCE_NEUTRAL_PACKET_SCHEMA_VERSION;
    prediction_snapshots: readonly PacketPredictionSnapshot[];
  }>;

export type PacketEvidenceStore = Pick<
  AppendOnlyEvidenceStore,
  "findBySourceReference" | "read"
>;

type ExactDecimal = Readonly<{ unscaled: bigint; scale: number }>;

const PREDICTION_SNAPSHOT_FIELDS = Object.freeze([
  "providerKey",
  "providerFixtureId",
  "capturedAtUtc",
  "predictionCapturedBeforeKickoff",
  "selections",
  "probabilityTotalRaw",
  "predictedWinnerProviderTeamId",
  "predictedWinnerName",
  "winnerComment",
  "advice",
  "underOverRaw",
  "providerInternalTimestamp",
  "contentHash",
  "parserVersion",
  "policyVersion",
]);
const PREDICTION_SELECTION_FIELDS = Object.freeze([
  "selection",
  "rawPercentage",
  "normalizedProbability",
]);

function asciiCompare(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function sameFields(value: object, allowed: readonly string[]): boolean {
  const actual = Object.keys(value).sort(asciiCompare);
  const expected = [...allowed].sort(asciiCompare);
  return actual.length === expected.length && actual.every((field, index) => field === expected[index]);
}

function exactDecimal(value: string): ExactDecimal | null {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?$/u.exec(value);
  if (match === null || value.length > 64) return null;
  const fraction = match[2] ?? "";
  return Object.freeze({ unscaled: BigInt(`${match[1]}${fraction}`), scale: fraction.length });
}

function exactPercentage(value: string): ExactDecimal | null {
  if (!/^(?:100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/u.test(value)) return null;
  return exactDecimal(value.slice(0, -1));
}

function exactPercentageTotal(value: string): ExactDecimal | null {
  if (!/^\d{1,3}(?:\.\d+)?%$/u.test(value)) return null;
  return exactDecimal(value.slice(0, -1));
}

function powerOfTen(scale: number): bigint {
  return BigInt(10) ** BigInt(scale);
}

function decimalEquals(left: ExactDecimal, right: ExactDecimal): boolean {
  return left.unscaled * powerOfTen(right.scale) === right.unscaled * powerOfTen(left.scale);
}

function probabilityMatchesPercentage(probability: ExactDecimal, percentage: ExactDecimal): boolean {
  return (
    percentage.unscaled * powerOfTen(probability.scale) ===
    probability.unscaled * BigInt(100) * powerOfTen(percentage.scale)
  );
}

function percentageTotal(values: readonly ExactDecimal[]): ExactDecimal {
  const scale = Math.max(...values.map((value) => value.scale));
  return Object.freeze({
    unscaled: values.reduce(
      (total, value) => total + value.unscaled * powerOfTen(scale - value.scale),
      BigInt(0),
    ),
    scale,
  });
}

function percentageWithinAllowedTotal(value: ExactDecimal): boolean {
  const scaleFactor = powerOfTen(value.scale);
  return value.unscaled * BigInt(100) >= BigInt(9_999) * scaleFactor &&
    value.unscaled * BigInt(100) <= BigInt(10_001) * scaleFactor;
}

function nonempty(value: string): boolean {
  return value.length > 0 && value.trim() === value && !/[\u0000-\u001f\u007f]/u.test(value);
}

function nullableMetadata(value: string | null): boolean {
  return value === null || (value.length <= 1_000 && !/[\u0000-\u001f\u007f]/u.test(value));
}

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

export function packetPayloadHash(
  packet:
    | Omit<ProspectiveCapturePacket, "packet_hash">
    | Omit<SourceNeutralProspectiveCapturePacket, "packet_hash">,
): string {
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
  constructor(readonly evidenceStore: PacketEvidenceStore) {}

  async assemble(
    context: CaptureRunContext,
    runs: readonly CaptureRunResult[],
    decisions?: readonly PrematchDecision[],
  ): Promise<ProspectiveCapturePacket>;
  async assemble(
    context: CaptureRunContext,
    runs: readonly CaptureRunResult[],
    decisions: readonly PrematchDecision[],
    predictionInputs: readonly PersistedPredictionPacketInput[],
  ): Promise<SourceNeutralProspectiveCapturePacket>;
  async assemble(
    context: CaptureRunContext,
    runs: readonly CaptureRunResult[],
    decisions: readonly PrematchDecision[] = [],
    predictionInputs?: readonly PersistedPredictionPacketInput[],
  ): Promise<ProspectiveCapturePacket | SourceNeutralProspectiveCapturePacket> {
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
    if (predictionInputs === undefined) {
      return Object.freeze({
        ...packetWithoutHash,
        packet_hash: packetPayloadHash(packetWithoutHash),
      });
    }

    const predictionSnapshots = this.#predictionSnapshots(context, predictionInputs);
    const sourceNeutralPacketWithoutHash: Omit<SourceNeutralProspectiveCapturePacket, "packet_hash"> =
      Object.freeze({
        ...packetWithoutHash,
        packet_schema_version: SOURCE_NEUTRAL_PACKET_SCHEMA_VERSION,
        prediction_snapshots: predictionSnapshots,
      });
    return Object.freeze({
      ...sourceNeutralPacketWithoutHash,
      packet_hash: packetPayloadHash(sourceNeutralPacketWithoutHash),
    });
  }

  #predictionSnapshots(
    context: CaptureRunContext,
    inputs: readonly PersistedPredictionPacketInput[],
  ): readonly PacketPredictionSnapshot[] {
    if (context.stage !== "PREMATCH" && context.stage !== "SYNTHETIC_FULL" && inputs.length > 0) {
      throw this.#blocked(context, "prediction snapshots are only valid in prematch packets");
    }

    const candidates = inputs
      .map((input) => this.#validatePredictionInput(context, input))
      .filter((item): item is PacketPredictionSnapshot => item !== null);
    const grouped = new Map<string, PacketPredictionSnapshot[]>();
    for (const item of candidates) {
      const identity = `${item.provider_key}\u0000${item.provider_fixture_id}`;
      const values = grouped.get(identity) ?? [];
      values.push(item);
      grouped.set(identity, values);
    }

    const selected: PacketPredictionSnapshot[] = [];
    for (const values of grouped.values()) {
      if (new Set(values.map((item) => item.kickoff_at_utc)).size !== 1) {
        throw this.#blocked(context, "prediction fixture kickoff is ambiguous");
      }
      const chronological = [...values].sort((left, right) =>
        asciiCompare(left.captured_at_utc, right.captured_at_utc) ||
        asciiCompare(left.content_hash, right.content_hash),
      );
      const unique: PacketPredictionSnapshot[] = [];
      for (const value of chronological) {
        const sameCapture = unique.find(
          (item) => item.captured_at_utc === value.captured_at_utc,
        );
        if (sameCapture !== undefined) {
          if (canonicalJson(sameCapture) !== canonicalJson(value)) {
            throw this.#blocked(context, "prediction snapshot capture is ambiguous");
          }
          continue;
        }
        unique.push(value);
      }
      const latest = unique.at(-1);
      if (latest !== undefined) selected.push(latest);
    }

    return Object.freeze(
      selected.sort((left, right) =>
        asciiCompare(left.provider_key, right.provider_key) ||
        asciiCompare(left.provider_fixture_id, right.provider_fixture_id) ||
        asciiCompare(left.captured_at_utc, right.captured_at_utc) ||
        asciiCompare(left.content_hash, right.content_hash),
      ),
    );
  }

  #validatePredictionInput(
    context: CaptureRunContext,
    input: PersistedPredictionPacketInput,
  ): PacketPredictionSnapshot | null {
    const snapshot = input.snapshot;
    if (!sameFields(snapshot, PREDICTION_SNAPSHOT_FIELDS)) {
      throw this.#blocked(context, "prediction snapshot contains unsupported fields");
    }
    if (
      !nonempty(snapshot.providerKey) ||
      !nonempty(snapshot.providerFixtureId) ||
      !nonempty(snapshot.parserVersion) ||
      !nonempty(snapshot.policyVersion) ||
      !/^[a-f0-9]{64}$/u.test(snapshot.contentHash)
    ) {
      throw this.#blocked(context, "prediction snapshot identity or provenance is invalid");
    }
    if (
      !nullableMetadata(snapshot.predictedWinnerProviderTeamId) ||
      !nullableMetadata(snapshot.predictedWinnerName) ||
      !nullableMetadata(snapshot.winnerComment) ||
      !nullableMetadata(snapshot.advice) ||
      !nullableMetadata(snapshot.underOverRaw) ||
      !nullableMetadata(snapshot.providerInternalTimestamp)
    ) {
      throw this.#blocked(context, "prediction snapshot metadata is invalid");
    }

    const capturedMilliseconds = Date.parse(snapshot.capturedAtUtc);
    const kickoffMilliseconds = Date.parse(input.kickoffUtc);
    if (
      !isNormalizedUtcTimestamp(snapshot.capturedAtUtc) ||
      !isNormalizedUtcTimestamp(input.kickoffUtc) ||
      !Number.isFinite(capturedMilliseconds) ||
      !Number.isFinite(kickoffMilliseconds)
    ) {
      throw this.#blocked(context, "prediction snapshot chronology is invalid");
    }
    const actuallyBeforeKickoff = capturedMilliseconds < kickoffMilliseconds;
    if (snapshot.predictionCapturedBeforeKickoff !== actuallyBeforeKickoff) {
      throw this.#blocked(context, "prediction prematch flag contradicts chronology");
    }

    if (snapshot.selections.length !== 3) {
      throw this.#blocked(context, "prediction snapshot requires exactly three selections");
    }
    const expectedSelections = ["HOME", "DRAW", "AWAY"] as const;
    const percentages: ExactDecimal[] = [];
    const packetSelections: PacketPredictionSelection[] = [];
    for (let index = 0; index < snapshot.selections.length; index += 1) {
      const selection = snapshot.selections[index];
      if (
        !sameFields(selection, PREDICTION_SELECTION_FIELDS) ||
        selection.selection !== expectedSelections[index]
      ) {
        throw this.#blocked(context, "prediction selections must be canonical HOME DRAW AWAY");
      }
      const percentage = exactPercentage(selection.rawPercentage);
      const probability = exactDecimal(selection.normalizedProbability);
      if (
        percentage === null ||
        probability === null ||
        probability.unscaled > powerOfTen(probability.scale) ||
        !probabilityMatchesPercentage(probability, percentage)
      ) {
        throw this.#blocked(context, "prediction probability is invalid");
      }
      percentages.push(percentage);
      packetSelections.push(Object.freeze({
        selection: selection.selection,
        raw_percentage: selection.rawPercentage,
        normalized_probability: selection.normalizedProbability,
      }));
    }
    const total = percentageTotal(percentages);
    const reportedTotal = exactPercentageTotal(snapshot.probabilityTotalRaw);
    if (
      !percentageWithinAllowedTotal(total) ||
      reportedTotal === null ||
      !decimalEquals(total, reportedTotal)
    ) {
      throw this.#blocked(context, "prediction probability total is invalid");
    }

    if (!actuallyBeforeKickoff) {
      return null;
    }
    return this.#packetPredictionSnapshot(snapshot, input.kickoffUtc, packetSelections);
  }

  #packetPredictionSnapshot(
    snapshot: PredictionSnapshot,
    kickoffUtc: string,
    selections: readonly PacketPredictionSelection[],
  ): PacketPredictionSnapshot {
    return Object.freeze({
      provider_key: snapshot.providerKey,
      provider_fixture_id: snapshot.providerFixtureId,
      captured_at_utc: snapshot.capturedAtUtc,
      kickoff_at_utc: kickoffUtc,
      prediction_captured_before_kickoff: true,
      selections: Object.freeze(selections) as PacketPredictionSnapshot["selections"],
      probability_total_raw: snapshot.probabilityTotalRaw,
      predicted_winner_provider_team_id: snapshot.predictedWinnerProviderTeamId,
      predicted_winner_name: snapshot.predictedWinnerName,
      winner_comment: snapshot.winnerComment,
      advice: snapshot.advice,
      under_over_raw: snapshot.underOverRaw,
      provider_internal_timestamp: snapshot.providerInternalTimestamp,
      content_hash: snapshot.contentHash,
      parser_version: snapshot.parserVersion,
      policy_version: snapshot.policyVersion,
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
