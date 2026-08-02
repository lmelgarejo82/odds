import type {
  CapturedFixture,
  CapturedScorePair,
  PredictionSelectionSnapshot,
  PredictionSelections,
  PredictionSnapshot,
} from "@/domain/market-v2/capture/types";
import type {
  OutcomeResult1X2,
  OutcomeShootoutWinner,
  ProviderOutcomeResolution,
} from "@/domain/market-v2/outcome/outcome-repository";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";
import {
  classifyApiFootballStatus,
  type ApiFootballFixtureDto,
  type ApiFootballPredictionDto,
  type ApiFootballScorePair,
} from "./contracts";

export const API_FOOTBALL_MAPPER_POLICY_VERSION = "api-football-mappers/1.0" as const;
export const API_FOOTBALL_PROBABILITY_SUM_TOLERANCE_PERCENTAGE_POINTS =
  "0.01" as const;

export const API_FOOTBALL_MAPPING_ERROR_CLASSIFICATIONS = [
  "INVALID_CAPTURE_TIME",
  "INVALID_KICKOFF",
  "DATE_TIMESTAMP_MISMATCH",
  "UNEXPECTED_TIMEZONE",
  "IDENTITY_MISMATCH",
  "UNKNOWN_OR_BLOCKED_STATUS",
  "INVALID_PROBABILITY",
  "PROBABILITY_SUM_MISMATCH",
  "WINNER_TEAM_MISMATCH",
  "RESULT_NOT_TERMINAL",
  "RESULT_SCORE_INCOMPLETE",
  "INVALID_SCORE_SEMANTICS",
] as const;

export type ApiFootballMappingErrorClassification =
  (typeof API_FOOTBALL_MAPPING_ERROR_CLASSIFICATIONS)[number];
export type ApiFootballMapperKey = "FIXTURE" | "PREDICTION" | "RESULT";

export type ApiFootballMappingError = Readonly<{
  mapper: ApiFootballMapperKey;
  classification: ApiFootballMappingErrorClassification;
  providerFixtureId: string;
  rawStatusCode?: string;
  field?: string;
}>;

export type ApiFootballMappingResult<T> =
  | Readonly<{ ok: true; data: T }>
  | Readonly<{ ok: false; error: ApiFootballMappingError }>;

export type ApiFootballFixtureMappingContext = Readonly<{
  capturedAtUtc: string;
  providerKey: "api-football";
}>;

export type ApiFootballPredictionMappingContext = Readonly<{
  capturedAtUtc: string;
  requestedProviderFixtureId: string;
  expectedKickoffUtc: string;
  expectedHomeProviderTeamId: string;
  expectedHomeName: string;
  expectedAwayProviderTeamId: string;
  expectedAwayName: string;
  contentHash: string;
  parserVersion: string;
  policyVersion: string;
}>;

export type ApiFootballResultMappingContext = Readonly<{
  capturedAtUtc: string;
  requestedProviderFixtureId: string;
  expectedLeagueProviderId: string;
  expectedSeason: string | number;
  expectedHomeProviderTeamId: string;
  expectedHomeName: string;
  expectedAwayProviderTeamId: string;
  expectedAwayName: string;
  expectedKickoffUtc?: string;
}>;

type FixtureStatusState =
  | Readonly<{
      canonicalStatus: "SCHEDULED" | "FINISHED";
      automaticUseBlocked: false;
    }>
  | Readonly<{
      canonicalStatus: "POSTPONED" | "CANCELLED" | "UNKNOWN";
      automaticUseBlocked: true;
    }>;

type ParsedPercentage = Readonly<{
  rawPercentage: string;
  normalizedProbability: string;
  unscaled: bigint;
  scale: number;
}>;

function success<T>(data: T): ApiFootballMappingResult<T> {
  return Object.freeze({ ok: true, data });
}

function failure(
  mapper: ApiFootballMapperKey,
  classification: ApiFootballMappingErrorClassification,
  providerFixtureId: string,
  details: Readonly<{ rawStatusCode?: string; field?: string }> = {},
): ApiFootballMappingResult<never> {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ mapper, classification, providerFixtureId, ...details }),
  });
}

function scorePair(pair: ApiFootballScorePair): CapturedScorePair {
  return Object.freeze({ home: pair.home, away: pair.away });
}

function fixtureStatus(rawStatusCode: string): FixtureStatusState {
  const status = classifyApiFootballStatus(rawStatusCode);
  switch (status.canonicalStatus) {
    case "SCHEDULED":
      return Object.freeze({ canonicalStatus: "SCHEDULED", automaticUseBlocked: false });
    case "FINISHED":
      return Object.freeze({ canonicalStatus: "FINISHED", automaticUseBlocked: false });
    case "POSTPONED":
      return Object.freeze({ canonicalStatus: "POSTPONED", automaticUseBlocked: true });
    case "CANCELLED":
      return Object.freeze({ canonicalStatus: "CANCELLED", automaticUseBlocked: true });
    case "UNKNOWN":
      return Object.freeze({ canonicalStatus: "UNKNOWN", automaticUseBlocked: true });
  }
}

function hasExplicitOffset(value: string): boolean {
  return /(?:Z|[+-]\d{2}:\d{2})$/u.test(value);
}

function fixtureTemporalError(
  fixture: ApiFootballFixtureDto,
  mapper: ApiFootballMapperKey,
  providerFixtureId: string,
): ApiFootballMappingResult<never> | null {
  const { date, timestamp } = fixture.fixture;
  if (
    !hasExplicitOffset(date) ||
    !Number.isSafeInteger(timestamp) ||
    timestamp < 0 ||
    !Number.isSafeInteger(timestamp * 1_000) ||
    !Number.isFinite(Date.parse(date))
  ) {
    return failure(mapper, "INVALID_KICKOFF", providerFixtureId, {
      field: !hasExplicitOffset(date) || !Number.isFinite(Date.parse(date))
        ? "fixture.date"
        : "fixture.timestamp",
    });
  }
  if (Date.parse(date) !== timestamp * 1_000) {
    return failure(mapper, "DATE_TIMESTAMP_MISMATCH", providerFixtureId, {
      field: "fixture.timestamp",
    });
  }
  return null;
}

function normalizedIdentityName(value: string): string {
  return value.trim().normalize("NFC");
}

function identitiesMatch(
  actual: Readonly<{ id: number; name: string }>,
  expectedId: string,
  expectedName: string,
): boolean {
  return (
    String(actual.id) === expectedId &&
    normalizedIdentityName(actual.name) === normalizedIdentityName(expectedName)
  );
}

function powerOfTen(exponent: number): bigint {
  let result = BigInt(1);
  for (let index = 0; index < exponent; index += 1) result *= BigInt(10);
  return result;
}

function canonicalDecimal(unscaled: bigint, scale: number): string {
  const digits = unscaled.toString().padStart(scale + 1, "0");
  if (scale === 0) return digits;
  const whole = digits.slice(0, -scale);
  const fraction = digits.slice(-scale).replace(/0+$/u, "");
  return fraction.length === 0 ? whole : `${whole}.${fraction}`;
}

function parsePercentage(rawValue: string): ParsedPercentage | null {
  const rawPercentage = rawValue.trim();
  const match = /^(100(?:\.0+)?|\d{1,2}(?:\.\d+)?)%$/u.exec(rawPercentage);
  if (match === null) return null;
  const [whole, fraction = ""] = match[1].split(".");
  const unscaled = BigInt(`${whole}${fraction}`);
  const scale = fraction.length;
  if (unscaled > BigInt(100) * powerOfTen(scale)) return null;
  return Object.freeze({
    rawPercentage,
    normalizedProbability: canonicalDecimal(unscaled, scale + 2),
    unscaled,
    scale,
  });
}

function canonicalPercentageTotal(values: readonly ParsedPercentage[]): Readonly<{
  withinTolerance: boolean;
  raw: string;
}> {
  const scale = Math.max(...values.map((value) => value.scale));
  const total = values.reduce(
    (sum, value) => sum + value.unscaled * powerOfTen(scale - value.scale),
    BigInt(0),
  );
  const scaleFactor = powerOfTen(scale);
  const withinTolerance =
    total * BigInt(100) >= BigInt(9_999) * scaleFactor &&
    total * BigInt(100) <= BigInt(10_001) * scaleFactor;
  return Object.freeze({
    withinTolerance,
    raw: `${canonicalDecimal(total, scale)}%`,
  });
}

function completePair(pair: ApiFootballScorePair): pair is Readonly<{
  home: number;
  away: number;
}> {
  return pair.home !== null && pair.away !== null;
}

function consistentPair(pair: ApiFootballScorePair): boolean {
  return (pair.home === null) === (pair.away === null);
}

function result1X2(pair: Readonly<{ home: number; away: number }>): OutcomeResult1X2 {
  if (pair.home > pair.away) return "HOME";
  if (pair.away > pair.home) return "AWAY";
  return "DRAW";
}

export function mapApiFootballFixture(
  fixture: ApiFootballFixtureDto,
  context: ApiFootballFixtureMappingContext,
): ApiFootballMappingResult<CapturedFixture> {
  const providerFixtureId = String(fixture.fixture.id);
  if (!isNormalizedUtcTimestamp(context.capturedAtUtc)) {
    return failure("FIXTURE", "INVALID_CAPTURE_TIME", providerFixtureId, {
      field: "capturedAtUtc",
    });
  }
  if (context.providerKey !== "api-football") {
    return failure("FIXTURE", "IDENTITY_MISMATCH", providerFixtureId, {
      field: "providerKey",
    });
  }
  const temporalError = fixtureTemporalError(fixture, "FIXTURE", providerFixtureId);
  if (temporalError !== null) return temporalError;
  if (fixture.fixture.timezone !== "UTC") {
    return failure("FIXTURE", "UNEXPECTED_TIMEZONE", providerFixtureId, {
      field: "fixture.timezone",
      rawStatusCode: fixture.fixture.status.short,
    });
  }

  const mappedFixture: CapturedFixture = Object.freeze({
      providerKey: "api-football",
      providerFixtureId,
      capturedAtUtc: context.capturedAtUtc,
      sourceDate: fixture.fixture.date,
      sourceTimestamp: String(fixture.fixture.timestamp),
      sourceTimezone: fixture.fixture.timezone,
      rawStatusCode: fixture.fixture.status.short,
      competition: Object.freeze({
        providerCompetitionId: String(fixture.league.id),
        name: fixture.league.name,
        country: fixture.league.country,
      }),
      season: String(fixture.league.season),
      round: fixture.league.round,
      home: Object.freeze({
        providerTeamId: String(fixture.teams.home.id),
        name: fixture.teams.home.name,
      }),
      away: Object.freeze({
        providerTeamId: String(fixture.teams.away.id),
        name: fixture.teams.away.name,
      }),
      goals: scorePair(fixture.goals),
      score: Object.freeze({
        halftime: scorePair(fixture.score.halftime),
        fulltime: scorePair(fixture.score.fulltime),
        extratime: scorePair(fixture.score.extratime),
        penalty: scorePair(fixture.score.penalty),
      }),
      ...fixtureStatus(fixture.fixture.status.short),
    });
  return success(mappedFixture);
}

export function mapApiFootballPrediction(
  prediction: ApiFootballPredictionDto,
  context: ApiFootballPredictionMappingContext,
): ApiFootballMappingResult<PredictionSnapshot> {
  if (!isNormalizedUtcTimestamp(context.capturedAtUtc)) {
    return failure("PREDICTION", "INVALID_CAPTURE_TIME", context.requestedProviderFixtureId, {
      field: "capturedAtUtc",
    });
  }
  if (!isNormalizedUtcTimestamp(context.expectedKickoffUtc)) {
    return failure("PREDICTION", "INVALID_KICKOFF", context.requestedProviderFixtureId, {
      field: "expectedKickoffUtc",
    });
  }
  if (
    !identitiesMatch(
      prediction.teams.home,
      context.expectedHomeProviderTeamId,
      context.expectedHomeName,
    ) ||
    !identitiesMatch(
      prediction.teams.away,
      context.expectedAwayProviderTeamId,
      context.expectedAwayName,
    )
  ) {
    return failure("PREDICTION", "IDENTITY_MISMATCH", context.requestedProviderFixtureId, {
      field: "teams",
    });
  }

  const home = parsePercentage(prediction.predictions.percent.home);
  const draw = parsePercentage(prediction.predictions.percent.draw);
  const away = parsePercentage(prediction.predictions.percent.away);
  if (home === null || draw === null || away === null) {
    return failure("PREDICTION", "INVALID_PROBABILITY", context.requestedProviderFixtureId, {
      field: home === null ? "predictions.percent.home" : draw === null
        ? "predictions.percent.draw"
        : "predictions.percent.away",
    });
  }
  const total = canonicalPercentageTotal([home, draw, away]);
  if (!total.withinTolerance) {
    return failure(
      "PREDICTION",
      "PROBABILITY_SUM_MISMATCH",
      context.requestedProviderFixtureId,
      { field: "predictions.percent" },
    );
  }

  const winner = prediction.predictions.winner;
  if (winner !== null) {
    const winnerId = winner.id === null ? null : String(winner.id);
    const expectedWinnerName = winnerId === context.expectedHomeProviderTeamId
      ? context.expectedHomeName
      : winnerId === context.expectedAwayProviderTeamId
        ? context.expectedAwayName
        : null;
    if (
      (winnerId === null && winner.name !== null) ||
      (winnerId !== null &&
        (expectedWinnerName === null ||
          (winner.name !== null &&
            normalizedIdentityName(winner.name) !== normalizedIdentityName(expectedWinnerName))))
    ) {
      return failure(
        "PREDICTION",
        "WINNER_TEAM_MISMATCH",
        context.requestedProviderFixtureId,
        { field: "predictions.winner" },
      );
    }
  }

  const selection = <Key extends "HOME" | "DRAW" | "AWAY">(
    key: Key,
    value: ParsedPercentage,
  ): PredictionSelectionSnapshot<Key> =>
    Object.freeze({
      selection: key,
      rawPercentage: value.rawPercentage,
      normalizedProbability: value.normalizedProbability,
    });

  const selections: PredictionSelections = Object.freeze([
    selection("HOME", home),
    selection("DRAW", draw),
    selection("AWAY", away),
  ]);
  const snapshot: PredictionSnapshot = Object.freeze({
      providerKey: "api-football",
      providerFixtureId: context.requestedProviderFixtureId,
      capturedAtUtc: context.capturedAtUtc,
      predictionCapturedBeforeKickoff:
        Date.parse(context.capturedAtUtc) < Date.parse(context.expectedKickoffUtc),
      selections,
      probabilityTotalRaw: total.raw,
      predictedWinnerProviderTeamId:
        winner?.id === null || winner === null ? null : String(winner.id),
      predictedWinnerName: winner?.name ?? null,
      winnerComment: winner?.comment ?? null,
      advice: prediction.predictions.advice,
      underOverRaw: prediction.predictions.under_over,
      providerInternalTimestamp: null,
      contentHash: context.contentHash,
      parserVersion: context.parserVersion,
      policyVersion: context.policyVersion,
    });
  return success(snapshot);
}

export function mapApiFootballResult(
  fixture: ApiFootballFixtureDto,
  context: ApiFootballResultMappingContext,
): ApiFootballMappingResult<ProviderOutcomeResolution> {
  const providerFixtureId = String(fixture.fixture.id);
  const rawStatusCode = fixture.fixture.status.short;
  if (!isNormalizedUtcTimestamp(context.capturedAtUtc)) {
    return failure("RESULT", "INVALID_CAPTURE_TIME", context.requestedProviderFixtureId, {
      field: "capturedAtUtc",
      rawStatusCode,
    });
  }
  const temporalError = fixtureTemporalError(
    fixture,
    "RESULT",
    context.requestedProviderFixtureId,
  );
  if (temporalError !== null) return temporalError;
  if (fixture.fixture.timezone !== "UTC") {
    return failure("RESULT", "UNEXPECTED_TIMEZONE", context.requestedProviderFixtureId, {
      field: "fixture.timezone",
      rawStatusCode,
    });
  }
  if (
    providerFixtureId !== context.requestedProviderFixtureId ||
    String(fixture.league.id) !== context.expectedLeagueProviderId ||
    String(fixture.league.season) !== String(context.expectedSeason) ||
    !identitiesMatch(
      fixture.teams.home,
      context.expectedHomeProviderTeamId,
      context.expectedHomeName,
    ) ||
    !identitiesMatch(
      fixture.teams.away,
      context.expectedAwayProviderTeamId,
      context.expectedAwayName,
    )
  ) {
    return failure("RESULT", "IDENTITY_MISMATCH", context.requestedProviderFixtureId, {
      field: "fixtureIdentity",
      rawStatusCode,
    });
  }
  if (context.expectedKickoffUtc !== undefined) {
    if (!isNormalizedUtcTimestamp(context.expectedKickoffUtc)) {
      return failure("RESULT", "INVALID_KICKOFF", context.requestedProviderFixtureId, {
        field: "expectedKickoffUtc",
        rawStatusCode,
      });
    }
    if (Date.parse(context.expectedKickoffUtc) !== Date.parse(fixture.fixture.date)) {
      return failure("RESULT", "IDENTITY_MISMATCH", context.requestedProviderFixtureId, {
        field: "expectedKickoffUtc",
        rawStatusCode,
      });
    }
  }
  if (rawStatusCode !== "FT" && rawStatusCode !== "AET" && rawStatusCode !== "PEN") {
    return failure("RESULT", "RESULT_NOT_TERMINAL", context.requestedProviderFixtureId, {
      rawStatusCode,
      field: "fixture.status.short",
    });
  }
  if (!completePair(fixture.score.fulltime)) {
    return failure("RESULT", "RESULT_SCORE_INCOMPLETE", context.requestedProviderFixtureId, {
      rawStatusCode,
      field: "score.fulltime",
    });
  }
  if (rawStatusCode === "AET" && !completePair(fixture.score.extratime)) {
    return failure("RESULT", "RESULT_SCORE_INCOMPLETE", context.requestedProviderFixtureId, {
      rawStatusCode,
      field: "score.extratime",
    });
  }
  let shootoutWinner: OutcomeShootoutWinner | null = null;
  if (rawStatusCode === "PEN") {
    const penalty = fixture.score.penalty;
    if (!completePair(penalty)) {
      return failure("RESULT", "RESULT_SCORE_INCOMPLETE", context.requestedProviderFixtureId, {
        rawStatusCode,
        field: "score.penalty",
      });
    }
    if (penalty.home === penalty.away) {
      return failure("RESULT", "INVALID_SCORE_SEMANTICS", context.requestedProviderFixtureId, {
        rawStatusCode,
        field: "score.penalty",
      });
    }
    shootoutWinner = penalty.home > penalty.away ? "HOME" : "AWAY";
  }
  if (!consistentPair(fixture.score.extratime) || !consistentPair(fixture.score.penalty)) {
    return failure("RESULT", "INVALID_SCORE_SEMANTICS", context.requestedProviderFixtureId, {
      rawStatusCode,
      field: "score",
    });
  }

  return success(
    Object.freeze({
      providerFixtureId,
      capturedAtUtc: context.capturedAtUtc,
      providerTerminalStatusRaw: rawStatusCode,
      result1X2Scope: "REGULATION_TIME",
      result1X2: result1X2(fixture.score.fulltime),
      regulationHomeScore: fixture.score.fulltime.home,
      regulationAwayScore: fixture.score.fulltime.away,
      extraTimeHomeScore: fixture.score.extratime.home,
      extraTimeAwayScore: fixture.score.extratime.away,
      penaltyHomeScore: fixture.score.penalty.home,
      penaltyAwayScore: fixture.score.penalty.away,
      shootoutWinner,
      goalsHomeScore: fixture.goals.home,
      goalsAwayScore: fixture.goals.away,
    }),
  );
}
