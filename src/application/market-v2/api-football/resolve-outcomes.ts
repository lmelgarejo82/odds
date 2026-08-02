import type { GovernedRequestExecutor, GovernedRequestInput } from "./governed-request-executor";
import type { RequestBudget } from "@/infrastructure/market-v2/api-football/request-budget";
import type { RunCircuitBreaker } from "@/infrastructure/market-v2/api-football/run-circuit-breaker";
import type { ProviderOutcomeResolution } from "@/domain/market-v2/outcome/outcome-repository";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";

export type OutcomeTarget = Readonly<{
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

export type OutcomeRequestIdentityFactory = (input: Readonly<{
  runId: string;
  operation: "OUTCOME";
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

export type OutcomeProviderResult = ProviderGovernanceState & (
  | Readonly<{
      ok: true;
      data: ProviderOutcomeResolution;
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

export interface OutcomeCaptureProviderPort {
  captureOutcomeGoverned(input: Readonly<{
    governance: Readonly<{
      executor: GovernedRequestExecutor;
      request: GovernedRequestInput;
    }>;
    binding: OutcomeTarget;
  }>): Promise<OutcomeProviderResult>;
}

export type OutcomeTargetStatus =
  | "RESOLVED_CREATED"
  | "RESOLVED_REPLAYED"
  | "PENDING_NOT_TERMINAL"
  | "IDENTITY_MISMATCH"
  | "RESULT_SCORE_INCOMPLETE"
  | "INVALID_SCORE_SEMANTICS"
  | "PERSISTENCE_CONFLICT"
  | "BUDGET_EXHAUSTED"
  | "CIRCUIT_OPEN"
  | "REQUEST_FAILED"
  | "EVIDENCE_FAILED"
  | "MAPPING_FAILED"
  | "AUDIT_FAILED";

export type OutcomeTargetResult = Readonly<{
  providerFixtureId: string;
  canonicalFixtureId: string;
  status: OutcomeTargetStatus;
  terminalStatus?: string;
  persistenceDisposition?: "CREATED" | "REPLAYED";
  result1X2?: "HOME" | "DRAW" | "AWAY";
  regulationHomeScore?: number;
  regulationAwayScore?: number;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  penaltyAwayScore?: number | null;
  shootoutWinner?: "HOME" | "AWAY" | null;
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

export type ResolveOutcomesInput = Readonly<{
  runId: string;
  importBatchId?: string | null;
  targets: readonly OutcomeTarget[];
  maxTargets: number;
  budget: RequestBudget;
  circuitBreaker: RunCircuitBreaker;
  executor: GovernedRequestExecutor;
  provider: OutcomeCaptureProviderPort;
  requestIdentityFactory: OutcomeRequestIdentityFactory;
}>;

export type ResolveOutcomesResult = Readonly<{
  status: "COMPLETE" | "PARTIAL" | "BLOCKED" | "FAILED" | "INVALID_INPUT";
  targets: readonly OutcomeTargetResult[];
  attemptsUsed: number;
  remainingBudget: number;
  circuitState: "CLOSED" | "OPEN";
  circuitReason?: string;
}>;

function validTarget(target: OutcomeTarget): boolean {
  return target.providerKey === "api-football" && target.canonicalFixtureId.length > 0 &&
    /^[1-9]\d*$/u.test(target.providerFixtureId) &&
    /^[1-9]\d*$/u.test(target.providerCompetitionId) && target.season.length > 0 &&
    target.homeProviderTeamId.length > 0 && target.homeName.trim().length > 0 &&
    target.awayProviderTeamId.length > 0 && target.awayName.trim().length > 0 &&
    target.sourceTimezone === "UTC" && isNormalizedUtcTimestamp(target.kickoffUtc);
}

function state(input: ResolveOutcomesInput) {
  const budget = input.budget.inspect();
  const circuit = input.circuitBreaker.inspect();
  return Object.freeze({
    attemptsUsed: budget.startedAttempts,
    remainingBudget: budget.remainingAttempts,
    circuitState: circuit.state,
    ...(circuit.reason === undefined ? {} : { circuitReason: circuit.reason }),
  });
}

function requestFor(
  input: ResolveOutcomesInput,
  target: OutcomeTarget,
  ordinal: number,
): GovernedRequestInput {
  const identity = input.requestIdentityFactory({
    runId: input.runId,
    operation: "OUTCOME",
    providerFixtureId: target.providerFixtureId,
    ordinal,
  });
  return Object.freeze({
    providerKey: "api-football",
    importBatchId: input.importBatchId ?? null,
    endpointKey: "fixture-result-by-id",
    requestKeyHash: identity.requestKeyHash,
    correlationId: identity.correlationId,
  });
}

function targetResult(
  input: ResolveOutcomesInput,
  target: OutcomeTarget,
  status: OutcomeTargetStatus,
  details: Partial<OutcomeTargetResult> = {},
): OutcomeTargetResult {
  return Object.freeze({
    providerFixtureId: target.providerFixtureId,
    canonicalFixtureId: target.canonicalFixtureId,
    status,
    ...details,
    ...state(input),
  });
}

function failureStatus(result: Extract<OutcomeProviderResult, { ok: false }>): OutcomeTargetStatus {
  if (result.sanitizedCode === "RESULT_NOT_TERMINAL") return "PENDING_NOT_TERMINAL";
  if (result.sanitizedCode === "RESULT_SCORE_INCOMPLETE") return "RESULT_SCORE_INCOMPLETE";
  if (result.sanitizedCode === "INVALID_SCORE_SEMANTICS") return "INVALID_SCORE_SEMANTICS";
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

function invalidResult(input: ResolveOutcomesInput): ResolveOutcomesResult {
  return Object.freeze({ status: "INVALID_INPUT", targets: Object.freeze([]), ...state(input) });
}

export async function resolveOutcomes(
  input: ResolveOutcomesInput,
): Promise<ResolveOutcomesResult> {
  const unique = new Set(input.targets.map(
    (target) => `${target.providerKey}\u0000${target.providerFixtureId}`,
  ));
  if (
    !Number.isSafeInteger(input.maxTargets) || input.maxTargets <= 0 ||
    input.targets.length === 0 || input.targets.length > input.maxTargets ||
    unique.size !== input.targets.length || input.targets.some((target) => !validTarget(target)) ||
    input.executor.dependencies.budget !== input.budget ||
    input.executor.dependencies.circuitBreaker !== input.circuitBreaker ||
    input.runId.trim().length === 0
  ) {
    return invalidResult(input);
  }

  const results: OutcomeTargetResult[] = [];
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
    const captured = await input.provider.captureOutcomeGoverned({
      governance: {
        executor: input.executor,
        request: requestFor(input, target, index),
      },
      binding: target,
    });
    if (!captured.ok) {
      results.push(targetResult(input, target, failureStatus(captured), {
        ...(captured.rawStatusCode === undefined
          ? {}
          : { terminalStatus: captured.rawStatusCode }),
        ...(captured.completedPersistenceDisposition === undefined
          ? {}
          : { persistenceDisposition: captured.completedPersistenceDisposition }),
      }));
      if (captured.circuitState === "OPEN" || captured.classification === "BUDGET_EXHAUSTED") {
        runBlocked = true;
      }
      continue;
    }
    const resolution = captured.data;
    results.push(targetResult(
      input,
      target,
      captured.persistenceDisposition === "CREATED" ? "RESOLVED_CREATED" : "RESOLVED_REPLAYED",
      {
        terminalStatus: resolution.providerTerminalStatusRaw,
        persistenceDisposition: captured.persistenceDisposition,
        result1X2: resolution.result1X2,
        regulationHomeScore: resolution.regulationHomeScore,
        regulationAwayScore: resolution.regulationAwayScore,
        extraTimeHomeScore: resolution.extraTimeHomeScore,
        extraTimeAwayScore: resolution.extraTimeAwayScore,
        penaltyHomeScore: resolution.penaltyHomeScore,
        penaltyAwayScore: resolution.penaltyAwayScore,
        shootoutWinner: resolution.shootoutWinner,
      },
    ));
    if (captured.governanceStatus === "SUCCESS_RUN_BLOCKED") runBlocked = true;
  }

  const resolved = results.filter(
    (result) => result.status === "RESOLVED_CREATED" || result.status === "RESOLVED_REPLAYED",
  ).length;
  const status = runBlocked
    ? "BLOCKED"
    : resolved === results.length
      ? "COMPLETE"
      : resolved > 0 || results.some((result) => result.status === "PENDING_NOT_TERMINAL")
        ? "PARTIAL"
        : "FAILED";
  return Object.freeze({ status, targets: Object.freeze(results), ...state(input) });
}
