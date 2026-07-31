export const FOREBET_PROBABILITY_SUM_TOLERANCE = 0.000_001;

export type ValidationIssue = Readonly<{
  code: string;
  field: string;
  message: string;
}>;

export type ValidationResult =
  | Readonly<{ valid: true; issues: readonly [] }>
  | Readonly<{ valid: false; issues: readonly ValidationIssue[] }>;

export type MarketStatus = "ACTIVE" | "SUSPENDED" | "CLOSED" | "UNKNOWN";
export type DecisionStatus = "SELECTED" | "ABSTAINED" | "UNRESOLVED" | "BLOCKED";

export type ForebetSnapshotInput = Readonly<{
  homeProbability: number;
  drawProbability: number;
  awayProbability: number;
}>;

export type OddsSnapshotInput = Readonly<{
  id: string;
  fixtureId: string;
  capturedAtUtc: string;
  decimalOdds: number;
  marketStatus: MarketStatus;
  isInPlay: boolean;
}>;

export type PreMatchDecisionInput = Readonly<{
  fixtureId: string;
  kickoffAtUtc: string;
  decidedAtUtc: string;
  status: DecisionStatus;
  reasonCode: string;
  selectedOddsSnapshot?: OddsSnapshotInput;
}>;

export type OutcomeVersionInput = Readonly<{
  id: string;
  fixtureId: string;
  observedAtUtc: string;
  supersedesOutcomeId?: string;
}>;

const NORMALIZED_UTC_PATTERN =
  /^\d{4}-(0[1-9]|1[0-2])-([0-2]\d|3[01])T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/;

function result(issues: ValidationIssue[]): ValidationResult {
  return issues.length === 0
    ? { valid: true, issues: [] }
    : { valid: false, issues: Object.freeze(issues) };
}

function issue(code: string, field: string, message: string): ValidationIssue {
  return { code, field, message };
}

function append(resultToAppend: ValidationResult, issues: ValidationIssue[]): void {
  if (!resultToAppend.valid) issues.push(...resultToAppend.issues);
}

export function isNormalizedUtcTimestamp(value: string): boolean {
  if (!NORMALIZED_UTC_PATTERN.test(value)) return false;
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch)) return false;

  const [datePart] = value.split("T");
  return new Date(epoch).toISOString().startsWith(`${datePart}T`);
}

export function validateUtcTimestamp(value: string, field = "timestamp"): ValidationResult {
  return result(
    isNormalizedUtcTimestamp(value)
      ? []
      : [
          issue(
            "UTC_TIMESTAMP_REQUIRED",
            field,
            `${field} must be a valid RFC 3339 timestamp normalized to UTC with Z`,
          ),
        ],
  );
}

export function validateDecisionChronology(input: Readonly<{
  oddsCapturedAtUtc: string;
  decidedAtUtc: string;
  kickoffAtUtc: string;
}>): ValidationResult {
  const issues: ValidationIssue[] = [];
  append(validateUtcTimestamp(input.oddsCapturedAtUtc, "oddsCapturedAtUtc"), issues);
  append(validateUtcTimestamp(input.decidedAtUtc, "decidedAtUtc"), issues);
  append(validateUtcTimestamp(input.kickoffAtUtc, "kickoffAtUtc"), issues);
  if (issues.length > 0) return result(issues);

  const captured = Date.parse(input.oddsCapturedAtUtc);
  const decided = Date.parse(input.decidedAtUtc);
  const kickoff = Date.parse(input.kickoffAtUtc);

  if (captured > decided) {
    issues.push(
      issue(
        "ODDS_AFTER_DECISION",
        "oddsCapturedAtUtc",
        "odds must be captured at or before the decision",
      ),
    );
  }
  if (decided >= kickoff) {
    issues.push(
      issue(
        "DECISION_NOT_PREMATCH",
        "decidedAtUtc",
        "decision must be strictly before kickoff",
      ),
    );
  }

  return result(issues);
}

export function validateForebetSnapshot(
  input: ForebetSnapshotInput,
  tolerance = FOREBET_PROBABILITY_SUM_TOLERANCE,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  const probabilities = [
    ["homeProbability", input.homeProbability],
    ["drawProbability", input.drawProbability],
    ["awayProbability", input.awayProbability],
  ] as const;

  for (const [field, probability] of probabilities) {
    if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
      issues.push(
        issue("PROBABILITY_OUT_OF_RANGE", field, `${field} must be between 0 and 1`),
      );
    }
  }

  const sum = probabilities.reduce((total, [, probability]) => total + probability, 0);
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    issues.push(
      issue("INVALID_PROBABILITY_TOLERANCE", "tolerance", "tolerance must be non-negative"),
    );
  } else if (Number.isFinite(sum) && Math.abs(sum - 1) > tolerance) {
    issues.push(
      issue(
        "PROBABILITY_SUM_OUTSIDE_TOLERANCE",
        "probabilities",
        `probabilities must sum to 1 within tolerance ${tolerance}`,
      ),
    );
  }

  return result(issues);
}

export function validateOddsSnapshot(
  input: OddsSnapshotInput,
  kickoffAtUtc: string,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  append(validateUtcTimestamp(input.capturedAtUtc, "capturedAtUtc"), issues);
  append(validateUtcTimestamp(kickoffAtUtc, "kickoffAtUtc"), issues);

  if (!Number.isFinite(input.decimalOdds) || input.decimalOdds <= 1) {
    issues.push(
      issue("INVALID_DECIMAL_ODDS", "decimalOdds", "decimal odds must be greater than 1"),
    );
  }
  if (input.isInPlay) {
    issues.push(issue("IN_PLAY_ODDS", "isInPlay", "pre-match decisions cannot use in-play odds"));
  }
  if (input.marketStatus !== "ACTIVE") {
    issues.push(
      issue("MARKET_NOT_ACTIVE", "marketStatus", "pre-match decisions require an active market"),
    );
  }
  if (
    isNormalizedUtcTimestamp(input.capturedAtUtc) &&
    isNormalizedUtcTimestamp(kickoffAtUtc) &&
    Date.parse(input.capturedAtUtc) >= Date.parse(kickoffAtUtc)
  ) {
    issues.push(
      issue(
        "ODDS_NOT_PREMATCH",
        "capturedAtUtc",
        "odds must be captured strictly before kickoff",
      ),
    );
  }

  return result(issues);
}

export function validatePreMatchDecision(input: PreMatchDecisionInput): ValidationResult {
  const issues: ValidationIssue[] = [];
  append(validateUtcTimestamp(input.decidedAtUtc, "decidedAtUtc"), issues);
  append(validateUtcTimestamp(input.kickoffAtUtc, "kickoffAtUtc"), issues);

  if (input.reasonCode.trim().length === 0) {
    issues.push(issue("REASON_CODE_REQUIRED", "reasonCode", "reasonCode must not be empty"));
  }
  if (input.status === "SELECTED" && input.selectedOddsSnapshot === undefined) {
    issues.push(
      issue(
        "SELECTED_ODDS_REQUIRED",
        "selectedOddsSnapshot",
        "SELECTED decisions require an exact odds snapshot",
      ),
    );
  }
  if (
    isNormalizedUtcTimestamp(input.decidedAtUtc) &&
    isNormalizedUtcTimestamp(input.kickoffAtUtc) &&
    Date.parse(input.decidedAtUtc) >= Date.parse(input.kickoffAtUtc)
  ) {
    issues.push(
      issue(
        "DECISION_NOT_PREMATCH",
        "decidedAtUtc",
        "decision must be strictly before kickoff",
      ),
    );
  }

  const selectedOdds = input.selectedOddsSnapshot;
  if (selectedOdds !== undefined) {
    if (selectedOdds.fixtureId !== input.fixtureId) {
      issues.push(
        issue(
          "ODDS_FIXTURE_MISMATCH",
          "selectedOddsSnapshot.fixtureId",
          "selected odds must belong to the decision fixture",
        ),
      );
    }
    append(validateOddsSnapshot(selectedOdds, input.kickoffAtUtc), issues);
    append(
      validateDecisionChronology({
        oddsCapturedAtUtc: selectedOdds.capturedAtUtc,
        decidedAtUtc: input.decidedAtUtc,
        kickoffAtUtc: input.kickoffAtUtc,
      }),
      issues,
    );
  }

  return result(issues);
}

export function validateOutcomeCorrection(
  previous: OutcomeVersionInput,
  correction: OutcomeVersionInput,
): ValidationResult {
  const issues: ValidationIssue[] = [];
  append(validateUtcTimestamp(previous.observedAtUtc, "previous.observedAtUtc"), issues);
  append(validateUtcTimestamp(correction.observedAtUtc, "correction.observedAtUtc"), issues);

  if (correction.fixtureId !== previous.fixtureId) {
    issues.push(
      issue(
        "OUTCOME_FIXTURE_MISMATCH",
        "correction.fixtureId",
        "an outcome correction must use the same fixture",
      ),
    );
  }
  if (correction.supersedesOutcomeId !== previous.id) {
    issues.push(
      issue(
        "SUPERSEDED_OUTCOME_REQUIRED",
        "correction.supersedesOutcomeId",
        "a correction must reference the outcome it supersedes",
      ),
    );
  }
  if (
    isNormalizedUtcTimestamp(previous.observedAtUtc) &&
    isNormalizedUtcTimestamp(correction.observedAtUtc) &&
    Date.parse(correction.observedAtUtc) < Date.parse(previous.observedAtUtc)
  ) {
    issues.push(
      issue(
        "CORRECTION_OBSERVED_TOO_EARLY",
        "correction.observedAtUtc",
        "a correction cannot be observed before the superseded outcome",
      ),
    );
  }

  return result(issues);
}
