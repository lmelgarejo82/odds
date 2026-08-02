export type ProviderEventDescriptor = Readonly<{
  providerKey: string;
  providerEventId: string;
  kickoffAtUtc: string;
  normalizedCompetitionKey: string;
  normalizedHomeTeamKey: string;
  normalizedAwayTeamKey: string;
}>;

export type ProviderEventMatchPolicy = Readonly<{
  policyVersion: string;
  kickoffToleranceSeconds: number;
}>;

export const PROVIDER_EVENT_MATCH_ERROR_CLASSIFICATIONS = [
  "INVALID_POLICY",
  "INVALID_SOURCE",
  "INVALID_CANDIDATE",
  "DUPLICATE_CANDIDATE_IDENTITY",
  "INVALID_KICKOFF",
  "NON_UTC_KICKOFF",
  "INVALID_NORMALIZED_KEY",
  "INVALID_ORIENTATION_INPUT",
] as const;

export type ProviderEventMatchErrorClassification =
  (typeof PROVIDER_EVENT_MATCH_ERROR_CLASSIFICATIONS)[number];

export type ProviderEventMatchError = Readonly<{
  classification: ProviderEventMatchErrorClassification;
  field?: string;
  providerKey?: string;
  providerEventId?: string;
  policyVersion?: string;
}>;

export const PROVIDER_EVENT_CANDIDATE_CLASSIFICATIONS = [
  "ELIGIBLE",
  "KICKOFF_OUTSIDE_TOLERANCE",
  "TEAM_MISMATCH",
  "REVERSED_ORIENTATION_CONFLICT",
  "COMPETITION_CONFLICT",
] as const;

export type ProviderEventCandidateClassification =
  (typeof PROVIDER_EVENT_CANDIDATE_CLASSIFICATIONS)[number];

export type ProviderEventCandidateEvaluation = Readonly<{
  candidate: ProviderEventDescriptor;
  classification: ProviderEventCandidateClassification;
  kickoffDeltaMilliseconds: number;
}>;

type ValidMatchResultBase = Readonly<{
  policyVersion: string;
  source: ProviderEventDescriptor;
  evaluations: readonly ProviderEventCandidateEvaluation[];
}>;

export type ProviderEventMatchResult =
  | Readonly<{
      status: "INVALID_INPUT";
      error: ProviderEventMatchError;
    }>
  | (ValidMatchResultBase &
      Readonly<{
        status: "MATCHED";
        matchedCandidate: ProviderEventDescriptor;
        eligibleCandidates: readonly ProviderEventDescriptor[];
        conflicts: readonly ProviderEventCandidateEvaluation[];
      }>)
  | (ValidMatchResultBase &
      Readonly<{
        status: "UNRESOLVED";
        eligibleCandidates: readonly ProviderEventDescriptor[];
        conflicts: readonly ProviderEventCandidateEvaluation[];
      }>)
  | (ValidMatchResultBase &
      Readonly<{
        status: "AMBIGUOUS";
        eligibleCandidates: readonly ProviderEventDescriptor[];
        conflicts: readonly ProviderEventCandidateEvaluation[];
      }>)
  | (ValidMatchResultBase &
      Readonly<{
        status: "CONFLICT";
        eligibleCandidates: readonly ProviderEventDescriptor[];
        conflicts: readonly ProviderEventCandidateEvaluation[];
      }>);

type DescriptorValidation =
  | Readonly<{ valid: true; descriptor: ProviderEventDescriptor; kickoffMilliseconds: number }>
  | Readonly<{ valid: false; error: ProviderEventMatchError }>;

const ISO_WITH_EXPLICIT_OFFSET =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const CONTROL_CHARACTER = /[\u0000-\u001f\u007f]/;

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function compareAscii(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function compareDescriptors(left: ProviderEventDescriptor, right: ProviderEventDescriptor): number {
  return (
    compareAscii(left.providerKey, right.providerKey) ||
    compareAscii(left.providerEventId, right.providerEventId) ||
    compareAscii(left.kickoffAtUtc, right.kickoffAtUtc)
  );
}

function isSafeNonemptyString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 256 &&
    value.trim() === value &&
    !CONTROL_CHARACTER.test(value)
  );
}

function freezeError(error: ProviderEventMatchError): ProviderEventMatchError {
  return Object.freeze({ ...error });
}

function invalidResult(error: ProviderEventMatchError): ProviderEventMatchResult {
  return Object.freeze({ status: "INVALID_INPUT", error: freezeError(error) });
}

function identityMetadata(
  record: Readonly<Record<string, unknown>>,
): Pick<ProviderEventMatchError, "providerKey" | "providerEventId"> {
  const metadata: { providerKey?: string; providerEventId?: string } = {};
  if (isSafeNonemptyString(record.providerKey)) metadata.providerKey = record.providerKey;
  if (isSafeNonemptyString(record.providerEventId)) metadata.providerEventId = record.providerEventId;
  return metadata;
}

function validateKickoff(
  value: unknown,
  metadata: Pick<ProviderEventMatchError, "providerKey" | "providerEventId">,
): Readonly<{ valid: true; milliseconds: number }> | Readonly<{ valid: false; error: ProviderEventMatchError }> {
  const parts = typeof value === "string" ? ISO_WITH_EXPLICIT_OFFSET.exec(value) : null;
  if (typeof value !== "string" || parts === null) {
    return {
      valid: false,
      error: freezeError({ classification: "INVALID_KICKOFF", field: "kickoffAtUtc", ...metadata }),
    };
  }

  const milliseconds = Date.parse(value);
  const parsed = new Date(milliseconds);
  if (!Number.isFinite(milliseconds)) {
    return {
      valid: false,
      error: freezeError({ classification: "INVALID_KICKOFF", field: "kickoffAtUtc", ...metadata }),
    };
  }

  if (!(value.endsWith("Z") || value.endsWith("+00:00"))) {
    return {
      valid: false,
      error: freezeError({ classification: "NON_UTC_KICKOFF", field: "kickoffAtUtc", ...metadata }),
    };
  }

  if (
    parsed.getUTCFullYear() !== Number(parts[1]) ||
    parsed.getUTCMonth() + 1 !== Number(parts[2]) ||
    parsed.getUTCDate() !== Number(parts[3]) ||
    parsed.getUTCHours() !== Number(parts[4]) ||
    parsed.getUTCMinutes() !== Number(parts[5]) ||
    parsed.getUTCSeconds() !== Number(parts[6])
  ) {
    return {
      valid: false,
      error: freezeError({ classification: "INVALID_KICKOFF", field: "kickoffAtUtc", ...metadata }),
    };
  }

  return { valid: true, milliseconds };
}

function validateDescriptor(value: unknown, role: "source" | "candidate"): DescriptorValidation {
  if (!isRecord(value)) {
    return {
      valid: false,
      error: freezeError({ classification: role === "source" ? "INVALID_SOURCE" : "INVALID_CANDIDATE" }),
    };
  }

  const metadata = identityMetadata(value);
  for (const field of ["providerKey", "providerEventId"] as const) {
    if (!isSafeNonemptyString(value[field])) {
      return {
        valid: false,
        error: freezeError({
          classification: role === "source" ? "INVALID_SOURCE" : "INVALID_CANDIDATE",
          field,
          ...metadata,
        }),
      };
    }
  }

  for (const field of [
    "normalizedCompetitionKey",
    "normalizedHomeTeamKey",
    "normalizedAwayTeamKey",
  ] as const) {
    if (!isSafeNonemptyString(value[field])) {
      return {
        valid: false,
        error: freezeError({ classification: "INVALID_NORMALIZED_KEY", field, ...metadata }),
      };
    }
  }

  if (value.normalizedHomeTeamKey === value.normalizedAwayTeamKey) {
    return {
      valid: false,
      error: freezeError({
        classification: "INVALID_ORIENTATION_INPUT",
        field: "normalizedHomeTeamKey",
        ...metadata,
      }),
    };
  }

  const kickoff = validateKickoff(value.kickoffAtUtc, metadata);
  if (!kickoff.valid) return kickoff;

  const descriptor: ProviderEventDescriptor = Object.freeze({
    providerKey: value.providerKey as string,
    providerEventId: value.providerEventId as string,
    kickoffAtUtc: value.kickoffAtUtc as string,
    normalizedCompetitionKey: value.normalizedCompetitionKey as string,
    normalizedHomeTeamKey: value.normalizedHomeTeamKey as string,
    normalizedAwayTeamKey: value.normalizedAwayTeamKey as string,
  });

  return Object.freeze({ valid: true, descriptor, kickoffMilliseconds: kickoff.milliseconds });
}

function errorSortKey(error: ProviderEventMatchError): string {
  return [
    error.providerKey ?? "",
    error.providerEventId ?? "",
    error.field ?? "",
    error.classification,
  ].join("\u0000");
}

function freezeDescriptorArray(
  descriptors: readonly ProviderEventDescriptor[],
): readonly ProviderEventDescriptor[] {
  return Object.freeze([...descriptors]);
}

function freezeEvaluationArray(
  evaluations: readonly ProviderEventCandidateEvaluation[],
): readonly ProviderEventCandidateEvaluation[] {
  return Object.freeze([...evaluations]);
}

function classifyCandidate(
  source: ProviderEventDescriptor,
  candidate: ProviderEventDescriptor,
  kickoffDeltaMilliseconds: number,
  toleranceMilliseconds: number,
): ProviderEventCandidateClassification {
  const directOrientation =
    candidate.normalizedHomeTeamKey === source.normalizedHomeTeamKey &&
    candidate.normalizedAwayTeamKey === source.normalizedAwayTeamKey;
  const reversedOrientation =
    candidate.normalizedHomeTeamKey === source.normalizedAwayTeamKey &&
    candidate.normalizedAwayTeamKey === source.normalizedHomeTeamKey;
  const competitionMatches =
    candidate.normalizedCompetitionKey === source.normalizedCompetitionKey;
  const withinTolerance = kickoffDeltaMilliseconds <= toleranceMilliseconds;

  if (withinTolerance && competitionMatches && reversedOrientation) {
    return "REVERSED_ORIENTATION_CONFLICT";
  }
  if (withinTolerance && directOrientation && !competitionMatches) {
    return "COMPETITION_CONFLICT";
  }
  if (withinTolerance && competitionMatches && directOrientation) return "ELIGIBLE";
  if (!withinTolerance && competitionMatches && (directOrientation || reversedOrientation)) {
    return "KICKOFF_OUTSIDE_TOLERANCE";
  }
  return "TEAM_MISMATCH";
}

export function matchProviderEvent(
  sourceInput: unknown,
  candidateInputs: unknown,
  policyInput: unknown,
): ProviderEventMatchResult {
  if (!isRecord(policyInput)) {
    return invalidResult({ classification: "INVALID_POLICY" });
  }
  const policyVersion = isSafeNonemptyString(policyInput.policyVersion)
    ? policyInput.policyVersion
    : undefined;
  if (
    policyVersion === undefined ||
    !Number.isSafeInteger(policyInput.kickoffToleranceSeconds) ||
    (policyInput.kickoffToleranceSeconds as number) < 0
  ) {
    return invalidResult({
      classification: "INVALID_POLICY",
      field:
        policyVersion === undefined ? "policyVersion" : "kickoffToleranceSeconds",
      ...(policyVersion === undefined ? {} : { policyVersion }),
    });
  }

  const sourceValidation = validateDescriptor(sourceInput, "source");
  if (!sourceValidation.valid) return invalidResult(sourceValidation.error);
  if (!Array.isArray(candidateInputs)) {
    return invalidResult({ classification: "INVALID_CANDIDATE" });
  }

  const candidateValidations = candidateInputs.map((candidate) =>
    validateDescriptor(candidate, "candidate"),
  );
  const candidateErrors = candidateValidations
    .filter((validation): validation is Extract<DescriptorValidation, { valid: false }> => !validation.valid)
    .map((validation) => validation.error)
    .sort((left, right) => compareAscii(errorSortKey(left), errorSortKey(right)));
  if (candidateErrors.length > 0) return invalidResult(candidateErrors[0]);

  const candidates = candidateValidations
    .filter((validation): validation is Extract<DescriptorValidation, { valid: true }> => validation.valid)
    .sort((left, right) => compareDescriptors(left.descriptor, right.descriptor));

  for (let index = 1; index < candidates.length; index += 1) {
    const previous = candidates[index - 1].descriptor;
    const current = candidates[index].descriptor;
    if (
      previous.providerKey === current.providerKey &&
      previous.providerEventId === current.providerEventId
    ) {
      return invalidResult({
        classification: "DUPLICATE_CANDIDATE_IDENTITY",
        providerKey: current.providerKey,
        providerEventId: current.providerEventId,
        policyVersion,
      });
    }
  }

  const toleranceMilliseconds =
    (policyInput.kickoffToleranceSeconds as number) * 1_000;
  const evaluations = candidates.map((validation) => {
    const kickoffDeltaMilliseconds = Math.abs(
      validation.kickoffMilliseconds - sourceValidation.kickoffMilliseconds,
    );
    return Object.freeze({
      candidate: validation.descriptor,
      classification: classifyCandidate(
        sourceValidation.descriptor,
        validation.descriptor,
        kickoffDeltaMilliseconds,
        toleranceMilliseconds,
      ),
      kickoffDeltaMilliseconds,
    });
  });
  const frozenEvaluations = freezeEvaluationArray(evaluations);
  const eligibleCandidates = freezeDescriptorArray(
    evaluations
      .filter((evaluation) => evaluation.classification === "ELIGIBLE")
      .map((evaluation) => evaluation.candidate),
  );
  const conflicts = freezeEvaluationArray(
    evaluations.filter(
      (evaluation) =>
        evaluation.classification === "REVERSED_ORIENTATION_CONFLICT" ||
        evaluation.classification === "COMPETITION_CONFLICT",
    ),
  );
  const common = {
    policyVersion,
    source: sourceValidation.descriptor,
    evaluations: frozenEvaluations,
    eligibleCandidates,
    conflicts,
  };

  if (conflicts.length > 0) return Object.freeze({ status: "CONFLICT", ...common });
  if (eligibleCandidates.length === 0) return Object.freeze({ status: "UNRESOLVED", ...common });
  if (eligibleCandidates.length > 1) return Object.freeze({ status: "AMBIGUOUS", ...common });
  return Object.freeze({
    status: "MATCHED",
    ...common,
    matchedCandidate: eligibleCandidates[0],
  });
}
