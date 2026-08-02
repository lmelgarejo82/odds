import type { GovernedRequestExecutor, GovernedRequestInput } from "./governed-request-executor";
import type { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import type { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";
import type { CapturedFixture, PredictionSnapshot } from "@/domain/market-v2/capture/types";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";

export type PrematchTarget = Readonly<{
  providerKey: "api-football";
  canonicalFixtureId: string;
  providerFixtureId: string;
  providerCompetitionId: string;
  season: string;
  homeProviderTeamId: string;
  homeName: string;
  awayProviderTeamId: string;
  awayName: string;
  kickoffUtc: string;
  sourceTimezone: "UTC";
}>;

export type RequestIdentityFactory = (input: Readonly<{
  runId: string;
  operation: "FIXTURE" | "PREDICTION" | "OUTCOME";
  providerFixtureId: string;
  ordinal: number;
}>) => Readonly<{ requestKeyHash: string; correlationId: string }>;

type ProviderGovernanceState = Readonly<{
  governanceStatus:
    | "SUCCESS"
    | "SUCCESS_RUN_BLOCKED"
    | "FAILED"
    | "BUDGET_EXHAUSTED"
    | "CIRCUIT_OPEN"
    | "AUDIT_FAILED";
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

export type PrematchProviderResult<T> = ProviderGovernanceState & (
  | Readonly<{
      ok: true;
      data: T;
      persistenceDisposition: "CREATED" | "REPLAYED";
    }>
  | Readonly<{
      ok: false;
      classification: string;
      sanitizedCode: string;
      conflict: boolean;
      rawStatusCode?: string;
      completedPersistenceDisposition?: "CREATED" | "REPLAYED";
    }>
);

export interface PrematchCaptureProviderPort {
  captureSelectedFixtureGoverned(input: Readonly<{
    governance: Readonly<{
      executor: GovernedRequestExecutor;
      request: GovernedRequestInput;
    }>;
    binding: PrematchTarget;
  }>): Promise<PrematchProviderResult<CapturedFixture>>;
  capturePrematchPredictionGoverned(input: Readonly<{
    governance: Readonly<{
      executor: GovernedRequestExecutor;
      request: GovernedRequestInput;
    }>;
    binding: PrematchTarget;
    parserVersion: string;
    policyVersion: string;
  }>): Promise<PrematchProviderResult<PredictionSnapshot>>;
}

export type PrematchTargetStatus =
  | "PREMATCH_CAPTURED"
  | "REPLAYED"
  | "FIXTURE_CAPTURED_PREDICTION_NOT_REQUESTED"
  | "FIXTURE_NOT_FOUND"
  | "FIXTURE_AMBIGUOUS"
  | "IDENTITY_MISMATCH"
  | "STATUS_BLOCKED"
  | "KICKOFF_NOT_FUTURE"
  | "POST_KICKOFF_PREDICTION_BLOCKED"
  | "BUDGET_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "REQUEST_FAILED"
  | "EVIDENCE_FAILED"
  | "MAPPING_FAILED"
  | "PERSISTENCE_CONFLICT"
  | "AUDIT_FAILED";

export type PrematchTargetResult = Readonly<{
  providerFixtureId: string;
  canonicalFixtureId: string;
  status: PrematchTargetStatus;
  fixtureCaptureStatus?: "CREATED" | "REPLAYED";
  predictionCaptureStatus?: "CREATED" | "REPLAYED";
  capturedAtUtc?: string;
  kickoffUtc: string;
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

export type CollectPrematchResult = Readonly<{
  status: "COMPLETE" | "PARTIAL" | "BLOCKED" | "FAILED" | "INVALID_INPUT";
  targets: readonly PrematchTargetResult[];
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

export type CollectPrematchInput = Readonly<{
  runId: string;
  importBatchId?: string | null;
  targets: readonly PrematchTarget[];
  maxTargets: number;
  budget: RequestBudget;
  circuitBreaker: RunCircuitBreaker;
  executor: GovernedRequestExecutor;
  provider: PrematchCaptureProviderPort;
  requestIdentityFactory: RequestIdentityFactory;
  parserVersion: string;
  policyVersion: string;
}>;

function validTarget(target: PrematchTarget): boolean {
  return target.providerKey === "api-football" &&
    target.canonicalFixtureId.length > 0 &&
    /^[1-9]\d*$/u.test(target.providerFixtureId) &&
    /^[1-9]\d*$/u.test(target.providerCompetitionId) &&
    target.season.length > 0 &&
    target.homeProviderTeamId.length > 0 &&
    target.homeName.trim().length > 0 &&
    target.awayProviderTeamId.length > 0 &&
    target.awayName.trim().length > 0 &&
    target.sourceTimezone === "UTC" &&
    isNormalizedUtcTimestamp(target.kickoffUtc);
}

function requestFor(
  input: CollectPrematchInput,
  target: PrematchTarget,
  operation: "FIXTURE" | "PREDICTION",
  ordinal: number,
): GovernedRequestInput {
  const identity = input.requestIdentityFactory({
    runId: input.runId,
    operation,
    providerFixtureId: target.providerFixtureId,
    ordinal,
  });
  return Object.freeze({
    providerKey: "api-football",
    importBatchId: input.importBatchId ?? null,
    endpointKey: operation === "FIXTURE" ? "fixtures-by-date" : "prediction-by-fixture",
    requestKeyHash: identity.requestKeyHash,
    correlationId: identity.correlationId,
  });
}

function state(input: CollectPrematchInput) {
  const budget = input.budget.inspect();
  const circuit = input.circuitBreaker.inspect();
  return Object.freeze({
    attemptsUsed: budget.startedAttempts,
    remainingBudget: budget.remainingAttempts,
    circuitState: circuit.state,
    ...(circuit.reason === undefined ? {} : { circuitReason: circuit.reason }),
  });
}

function targetResult(
  input: CollectPrematchInput,
  target: PrematchTarget,
  status: PrematchTargetStatus,
  details: Readonly<{
    fixtureCaptureStatus?: "CREATED" | "REPLAYED";
    predictionCaptureStatus?: "CREATED" | "REPLAYED";
    capturedAtUtc?: string;
  }> = {},
): PrematchTargetResult {
  return Object.freeze({
    providerFixtureId: target.providerFixtureId,
    canonicalFixtureId: target.canonicalFixtureId,
    status,
    kickoffUtc: target.kickoffUtc,
    ...details,
    ...state(input),
  });
}

function failureStatus(result: Extract<PrematchProviderResult<unknown>, { ok: false }>): PrematchTargetStatus {
  if (result.sanitizedCode === "FIXTURE_NOT_FOUND") return "FIXTURE_NOT_FOUND";
  if (result.sanitizedCode === "FIXTURE_AMBIGUOUS") return "FIXTURE_AMBIGUOUS";
  if (result.sanitizedCode === "POST_KICKOFF_PREDICTION_BLOCKED") {
    return "POST_KICKOFF_PREDICTION_BLOCKED";
  }
  switch (result.classification) {
    case "IDENTITY_MISMATCH":
      return "IDENTITY_MISMATCH";
    case "EVIDENCE_FAILURE":
      return "EVIDENCE_FAILED";
    case "MAPPING_FAILURE":
      return "MAPPING_FAILED";
    case "PERSISTENCE_FAILURE":
      return result.conflict ? "PERSISTENCE_CONFLICT" : "REQUEST_FAILED";
    case "BUDGET_EXHAUSTED":
      return "BUDGET_EXHAUSTED";
    case "CIRCUIT_OPEN":
      return "CIRCUIT_OPEN";
    case "AUDIT_FAILURE":
      return "AUDIT_FAILED";
    default:
      return "REQUEST_FAILED";
  }
}

function exactFixture(fixture: CapturedFixture, target: PrematchTarget): boolean {
  return fixture.providerKey === target.providerKey &&
    fixture.providerFixtureId === target.providerFixtureId &&
    fixture.competition.providerCompetitionId === target.providerCompetitionId &&
    fixture.season === target.season &&
    fixture.home.providerTeamId === target.homeProviderTeamId &&
    fixture.home.name.trim().normalize("NFC") === target.homeName.trim().normalize("NFC") &&
    fixture.away.providerTeamId === target.awayProviderTeamId &&
    fixture.away.name.trim().normalize("NFC") === target.awayName.trim().normalize("NFC") &&
    Date.parse(fixture.sourceDate) === Date.parse(target.kickoffUtc) &&
    fixture.sourceTimezone === target.sourceTimezone;
}

function invalidResult(input: CollectPrematchInput): CollectPrematchResult {
  return Object.freeze({ status: "INVALID_INPUT", targets: Object.freeze([]), ...state(input) });
}

export async function collectPrematch(
  input: CollectPrematchInput,
): Promise<CollectPrematchResult> {
  const unique = new Set(input.targets.map(
    (target) => `${target.providerKey}\u0000${target.providerFixtureId}`,
  ));
  if (
    !Number.isSafeInteger(input.maxTargets) || input.maxTargets <= 0 ||
    input.targets.length === 0 || input.targets.length > input.maxTargets ||
    unique.size !== input.targets.length || input.targets.some((target) => !validTarget(target)) ||
    input.executor.dependencies.budget !== input.budget ||
    input.executor.dependencies.circuitBreaker !== input.circuitBreaker ||
    input.runId.trim().length === 0 || input.parserVersion.trim().length === 0 ||
    input.policyVersion.trim().length === 0
  ) {
    return invalidResult(input);
  }

  const results: PrematchTargetResult[] = [];
  let runBlocked = false;
  for (let index = 0; index < input.targets.length; index += 1) {
    const target = input.targets[index];
    if (input.circuitBreaker.inspect().state === "OPEN") {
      results.push(targetResult(input, target, "CIRCUIT_OPEN"));
      runBlocked = true;
      continue;
    }
    if (input.budget.inspect().remainingAttempts === 0) {
      results.push(targetResult(input, target, "BUDGET_EXHAUSTED"));
      runBlocked = true;
      continue;
    }
    const fixture = await input.provider.captureSelectedFixtureGoverned({
      governance: {
        executor: input.executor,
        request: requestFor(input, target, "FIXTURE", index),
      },
      binding: target,
    });
    if (!fixture.ok) {
      results.push(targetResult(input, target, failureStatus(fixture)));
      if (fixture.circuitState === "OPEN" || fixture.classification === "BUDGET_EXHAUSTED") {
        runBlocked = true;
      }
      continue;
    }
    const fixtureDetails = Object.freeze({
      fixtureCaptureStatus: fixture.persistenceDisposition,
      capturedAtUtc: fixture.data.capturedAtUtc,
    });
    if (!exactFixture(fixture.data, target)) {
      results.push(targetResult(input, target, "IDENTITY_MISMATCH", fixtureDetails));
      continue;
    }
    if (
      fixture.data.canonicalStatus !== "SCHEDULED" ||
      fixture.data.automaticUseBlocked || fixture.data.rawStatusCode !== "NS"
    ) {
      results.push(targetResult(input, target, "STATUS_BLOCKED", fixtureDetails));
      continue;
    }
    if (Date.parse(fixture.data.capturedAtUtc) >= Date.parse(target.kickoffUtc)) {
      results.push(targetResult(input, target, "KICKOFF_NOT_FUTURE", fixtureDetails));
      continue;
    }
    if (
      fixture.governanceStatus === "SUCCESS_RUN_BLOCKED" ||
      input.circuitBreaker.inspect().state === "OPEN"
    ) {
      results.push(targetResult(
        input,
        target,
        "FIXTURE_CAPTURED_PREDICTION_NOT_REQUESTED",
        fixtureDetails,
      ));
      runBlocked = true;
      continue;
    }
    if (input.budget.inspect().remainingAttempts === 0) {
      results.push(targetResult(input, target, "BUDGET_EXHAUSTED", fixtureDetails));
      runBlocked = true;
      continue;
    }
    const prediction = await input.provider.capturePrematchPredictionGoverned({
      governance: {
        executor: input.executor,
        request: requestFor(input, target, "PREDICTION", index),
      },
      binding: target,
      parserVersion: input.parserVersion,
      policyVersion: input.policyVersion,
    });
    if (!prediction.ok) {
      results.push(targetResult(input, target, failureStatus(prediction), fixtureDetails));
      if (prediction.circuitState === "OPEN" || prediction.classification === "BUDGET_EXHAUSTED") {
        runBlocked = true;
      }
      continue;
    }
    results.push(targetResult(
      input,
      target,
      prediction.persistenceDisposition === "REPLAYED" ? "REPLAYED" : "PREMATCH_CAPTURED",
      {
        ...fixtureDetails,
        predictionCaptureStatus: prediction.persistenceDisposition,
        capturedAtUtc: prediction.data.capturedAtUtc,
      },
    ));
    if (prediction.governanceStatus === "SUCCESS_RUN_BLOCKED") runBlocked = true;
  }

  const completed = results.filter(
    (result) => result.status === "PREMATCH_CAPTURED" || result.status === "REPLAYED",
  ).length;
  const status = runBlocked
    ? "BLOCKED"
    : completed === results.length
      ? "COMPLETE"
      : completed > 0
        ? "PARTIAL"
        : results.some((result) => ["REQUEST_FAILED", "AUDIT_FAILED"].includes(result.status))
          ? "FAILED"
          : "PARTIAL";
  return Object.freeze({ status, targets: Object.freeze(results), ...state(input) });
}
