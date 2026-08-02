import type { CaptureErrorCode } from "./errors";
import type { CaptureStage, ProviderCapability } from "./stages";

export type CaptureClock = Readonly<{ nowUtc(): string }>;

export type UniverseSpecification = Readonly<{
  competitionAllowlist: readonly string[];
  dateFrom: string;
  dateTo: string;
  requiredMarkets: readonly MarketKey[];
  allowedBookmakers: readonly string[];
  snapshotSchedule: readonly Readonly<{
    role: "EARLY" | "DECISION" | "CLOSING";
    targetSecondsBeforeKickoff: number;
    toleranceSeconds: number;
  }>[];
  postponedFixturePolicy: "RECAPTURE_NEW_KICKOFF" | "EXCLUDE";
  unreliableKickoffPolicy: "BLOCK_DECISION" | "EXCLUDE";
}>;

export type CaptureRunContext = Readonly<{
  runId: string;
  protocolVersion: string;
  stage: CaptureStage;
  generatedAtUtc: string;
  universeSpecification: UniverseSpecification;
  providerKey: string;
  providerVersion: string;
  attemptNumber: number;
  allowedCompetitionKeys: readonly string[];
  requestedMarkets: readonly MarketKey[];
  requestedBookmakers: readonly string[];
  cutoffAtUtc?: string;
  synthetic: boolean;
  correlationId: string;
  policyVersion: string;
}>;

export type MarketKey = "MATCH_ODDS_1X2" | "DOUBLE_CHANCE" | "DRAW_NO_BET";
export type SelectionKey =
  | "HOME"
  | "DRAW"
  | "AWAY"
  | "HOME_OR_DRAW"
  | "DRAW_OR_AWAY"
  | "HOME_DNB"
  | "AWAY_DNB";

export const CAPTURED_FIXTURE_CANONICAL_STATUSES = [
  "SCHEDULED",
  "FINISHED",
  "POSTPONED",
  "CANCELLED",
  "UNKNOWN",
] as const;

export type CapturedFixtureCanonicalStatus =
  (typeof CAPTURED_FIXTURE_CANONICAL_STATUSES)[number];

export type ExternalProviderFixtureIdentity = Readonly<{
  providerKey: string;
  providerFixtureId: string;
}>;

export type CapturedScorePair = Readonly<{
  home: number | null;
  away: number | null;
}>;

type CapturedFixtureStatusState =
  | Readonly<{
      canonicalStatus: "SCHEDULED" | "FINISHED";
      automaticUseBlocked: false;
    }>
  | Readonly<{
      canonicalStatus: "POSTPONED" | "CANCELLED" | "UNKNOWN";
      automaticUseBlocked: true;
    }>;

type CapturedFixtureFields = Readonly<{
  providerKey: string;
  providerFixtureId: string;
  capturedAtUtc: string;
  sourceDate: string;
  sourceTimestamp: string;
  sourceTimezone: string;
  rawStatusCode: string;
  competition: Readonly<{
    providerCompetitionId: string;
    name: string;
    country: string;
  }>;
  season: string;
  round: string;
  home: Readonly<{ providerTeamId: string; name: string }>;
  away: Readonly<{ providerTeamId: string; name: string }>;
  goals: CapturedScorePair;
  score: Readonly<{
    halftime: CapturedScorePair;
    fulltime: CapturedScorePair;
    extratime: CapturedScorePair;
    penalty: CapturedScorePair;
  }>;
}>;

export type CapturedFixture = CapturedFixtureFields & CapturedFixtureStatusState;

export const PREDICTION_SELECTION_KEYS = ["HOME", "DRAW", "AWAY"] as const;

export type PredictionSelectionKey = (typeof PREDICTION_SELECTION_KEYS)[number];
export type DecimalProbabilityString = string;

export type PredictionSelectionSnapshot<Key extends PredictionSelectionKey> = Readonly<{
  selection: Key;
  rawPercentage: string;
  normalizedProbability: DecimalProbabilityString;
}>;

export type PredictionSelections = readonly [
  PredictionSelectionSnapshot<"HOME">,
  PredictionSelectionSnapshot<"DRAW">,
  PredictionSelectionSnapshot<"AWAY">,
];

export type PredictionSnapshot = Readonly<{
  providerKey: string;
  providerFixtureId: string;
  capturedAtUtc: string;
  predictionCapturedBeforeKickoff: boolean;
  selections: PredictionSelections;
  probabilityTotalRaw: string;
  predictedWinnerProviderTeamId: string | null;
  predictedWinnerName: string | null;
  winnerComment: string | null;
  advice: string | null;
  underOverRaw: string | null;
  providerInternalTimestamp: string | null;
  contentHash: string;
  parserVersion: string;
  policyVersion: string;
}>;

export type PredictionSelectionsValidation =
  | Readonly<{ valid: true }>
  | Readonly<{
      valid: false;
      errorCode:
        | "PREDICTION_SELECTIONS_INCOMPLETE"
        | "PREDICTION_SELECTION_DUPLICATE"
        | "PREDICTION_SELECTION_INVALID";
    }>;

function isUnknownRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validatePredictionSelections(input: unknown): PredictionSelectionsValidation {
  if (!Array.isArray(input)) {
    return Object.freeze({ valid: false, errorCode: "PREDICTION_SELECTIONS_INCOMPLETE" });
  }
  const selectionKeys: string[] = [];
  for (const item of input) {
    if (!isUnknownRecord(item) || typeof item.selection !== "string") {
      return Object.freeze({ valid: false, errorCode: "PREDICTION_SELECTION_INVALID" });
    }
    selectionKeys.push(item.selection);
  }
  if (new Set(selectionKeys).size !== selectionKeys.length) {
    return Object.freeze({ valid: false, errorCode: "PREDICTION_SELECTION_DUPLICATE" });
  }
  if (
    selectionKeys.length !== PREDICTION_SELECTION_KEYS.length ||
    PREDICTION_SELECTION_KEYS.some((selection) => !selectionKeys.includes(selection))
  ) {
    return Object.freeze({ valid: false, errorCode: "PREDICTION_SELECTIONS_INCOMPLETE" });
  }
  if (
    input.some(
      (item) =>
        !isUnknownRecord(item) ||
        typeof item.rawPercentage !== "string" ||
        item.rawPercentage.length === 0 ||
        typeof item.normalizedProbability !== "string" ||
        item.normalizedProbability.length === 0,
    )
  ) {
    return Object.freeze({ valid: false, errorCode: "PREDICTION_SELECTION_INVALID" });
  }
  return Object.freeze({ valid: true });
}

export type SyntheticFixture = Readonly<{
  source_fixture_id: string;
  source_name: string;
  competition_raw: string;
  competition_key: string;
  home_team_raw: string;
  away_team_raw: string;
  home_team_id: string;
  away_team_id: string;
  kickoff_raw: string;
  kickoff_source_timezone: string;
  kickoff_at_utc: string;
  kickoff_confidence: "CONFIRMED" | "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  fixture_status: "SCHEDULED" | "POSTPONED" | "CANCELLED" | "STARTED" | "FINISHED" | "UNKNOWN";
  captured_at_utc: string;
  source_artifact_reference: string;
  content_hash: string;
}>;

export type ForebetObservation = Readonly<{
  forebet_snapshot_id: string;
  source_fixture_id: string;
  captured_at_utc: string;
  home_probability: number;
  draw_probability: number;
  away_probability: number;
  predicted_home_score: number | null;
  predicted_away_score: number | null;
  source_page_reference: string;
  source_artifact_reference: string;
  parser_version: string;
  content_hash: string;
}>;

export type OddsObservation = Readonly<{
  odds_snapshot_id: string;
  source_fixture_id: string;
  bookmaker_key: string;
  market_key: MarketKey;
  selection_key: SelectionKey;
  captured_at_utc: string;
  decimal_odds: number;
  raw_odds: string | null;
  line_value: number | null;
  market_status: "ACTIVE" | "SUSPENDED" | "CLOSED" | "UNKNOWN";
  is_in_play: boolean;
  source_event_id: string;
  source_market_id: string;
  source_selection_id: string;
  source_artifact_reference: string;
  price_kind: "OFFERED";
  content_hash: string;
}>;

export type ClosingObservation = Readonly<{
  closing_snapshot_id: string;
  fixture_id: string;
  bookmaker_key: string;
  market_key: MarketKey;
  selection_key: SelectionKey;
  captured_at_utc: string;
  decimal_odds: number;
  seconds_before_kickoff: number;
  status: "ACTIVE" | "SUSPENDED" | "CLOSED" | "UNKNOWN";
  source_artifact_reference: string;
  content_hash: string;
}>;

export type OutcomeObservation = Readonly<{
  outcome_id: string;
  fixture_id: string;
  observed_at_utc: string;
  source_name: string;
  home_score: number;
  away_score: number;
  result_1x2: "HOME" | "DRAW" | "AWAY";
  outcome_status: "FINAL" | "CORRECTED" | "VOID";
  supersedes_outcome_id: string | null;
  source_artifact_reference: string;
  content_hash: string;
}>;

export type PrematchDecision = Readonly<{
  decision_id: string;
  fixture_id: string;
  decided_at_utc: string;
  decision_status: "SELECTED" | "ABSTAINED" | "BLOCKED" | "UNRESOLVED";
  reason_code: string;
  selected_market_key: MarketKey | null;
  selected_selection_key: SelectionKey | null;
  selected_odds_snapshot_id: string | null;
  estimated_probability: number | null;
  break_even_probability: number | null;
  estimated_edge: number | null;
  policy_version: string;
  input_hash: string;
}>;

export type SanitizedMetadataValue = string | number | boolean;
export type SanitizedMetadata = Readonly<Record<string, SanitizedMetadataValue>>;

export type TransportRequest = Readonly<{
  providerKey: string;
  stage: CaptureStage;
  capability: ProviderCapability;
  sourceReference: string;
  fixtureId?: string;
  attemptNumber: number;
}>;

export type TransportResponse = Readonly<{
  status: number;
  capturedAtUtc: string;
  mediaType: string;
  body: Uint8Array;
  sourceReference: string;
  providerMetadata: SanitizedMetadata;
  attemptMetadata: SanitizedMetadata;
}>;

export interface CaptureTransport {
  execute(request: TransportRequest): Promise<TransportResponse>;
}

export type RawCaptureEvidence = Readonly<{
  evidenceId: string;
  providerKey: string;
  providerVersion: string;
  stage: CaptureStage;
  sourceReference: string;
  capturedAtUtc: string;
  mediaType: string;
  byteSize: number;
  sha256: string;
  contentEncoding?: string;
  correlationId: string;
  attemptNumber: number;
  synthetic: boolean;
  metadata: SanitizedMetadata;
}>;

export type ProviderCapture<T> = Readonly<{
  response: TransportResponse;
  normalize(): T;
}>;

export type CaptureData = Readonly<{
  fixtures: readonly SyntheticFixture[];
  forebetSnapshots: readonly ForebetObservation[];
  oddsSnapshots: readonly OddsObservation[];
  closingSnapshots: readonly ClosingObservation[];
  outcomes: readonly OutcomeObservation[];
}>;

export type ProviderRunSummary = Readonly<{
  providerKey: string;
  providerVersion: string;
  capabilities: readonly ProviderCapability[];
}>;

export type CaptureRunResult = Readonly<{
  runId: string;
  stage: CaptureStage;
  startedAtUtc: string;
  completedAtUtc: string;
  providerSummaries: readonly ProviderRunSummary[];
  discoveredFixtures: number;
  attemptedCaptures: number;
  successfulCaptures: number;
  duplicateCaptures: number;
  conflictedCaptures: number;
  failedCaptures: number;
  retryCount: number;
  rateLimitedCount: number;
  evidenceIds: readonly string[];
  warningCodes: readonly string[];
  errorCodes: readonly CaptureErrorCode[];
  synthetic: boolean;
  data: CaptureData;
}>;

export type EvidenceManifestItem = Readonly<{
  artifact_reference: string;
  source_name: string;
  captured_at_utc: string;
  content_hash: string;
}>;

export type ProspectiveCapturePacket = Readonly<{
  protocol_version: string;
  packet_id: string;
  generated_at_utc: string;
  source_metadata: Readonly<{
    synthetic: true;
    capture_stage: CaptureStage;
    source_names: readonly string[];
    data_classification: "SYNTHETIC";
  }>;
  capture_universe: Readonly<{
    protocol_version: string;
    phase: "PILOT";
    competition_allowlist: readonly string[];
    date_from: string;
    date_to: string;
    required_markets: readonly MarketKey[];
    allowed_bookmakers: readonly string[];
    snapshot_schedule: readonly Readonly<{
      role: "EARLY" | "DECISION" | "CLOSING";
      target_seconds_before_kickoff: number;
      tolerance_seconds: number;
    }>[];
    postponed_fixture_policy: "RECAPTURE_NEW_KICKOFF" | "EXCLUDE";
    unreliable_kickoff_policy: "BLOCK_DECISION" | "EXCLUDE";
  }>;
  fixtures: readonly SyntheticFixture[];
  forebet_snapshots: readonly ForebetObservation[];
  odds_snapshots: readonly OddsObservation[];
  decisions: readonly PrematchDecision[];
  closing_snapshots: readonly ClosingObservation[];
  outcomes: readonly OutcomeObservation[];
  evidence_manifest: Readonly<{ items: readonly EvidenceManifestItem[] }>;
  packet_hash: string;
}>;
