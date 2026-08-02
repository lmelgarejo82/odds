import type {
  ApiFootballFixtureDto,
  ApiFootballFixtureEnvelope,
  ApiFootballPredictionDto,
  ApiFootballPredictionEnvelope,
  ApiFootballScorePair,
} from "@/infrastructure/market-v2/api-football/contracts";

type SyntheticFixtureOptions = Readonly<{
  providerFixtureId: number;
  statusShort: "NS" | "FT" | "AET" | "PEN" | "PST" | "CANC";
  statusLong: string;
  goals: ApiFootballScorePair;
  halftime: ApiFootballScorePair;
  fulltime: ApiFootballScorePair;
  extratime: ApiFootballScorePair;
  penalty: ApiFootballScorePair;
}>;

const noScore = (): ApiFootballScorePair => ({ home: null, away: null });

function buildSyntheticFixture(options: SyntheticFixtureOptions): ApiFootballFixtureDto {
  return {
    fixture: {
      id: options.providerFixtureId,
      date: "2030-01-01T18:00:00+00:00",
      timestamp: 1_893_520_800,
      timezone: "UTC",
      status: { long: options.statusLong, short: options.statusShort },
    },
    league: {
      id: 910_001,
      name: "Synthetic R0 League",
      country: "Synthetic Country",
      season: 2030,
      round: "Synthetic Round 1",
    },
    teams: {
      home: { id: 920_001, name: "Synthetic Home FC" },
      away: { id: 920_002, name: "Synthetic Away FC" },
    },
    goals: options.goals,
    score: {
      halftime: options.halftime,
      fulltime: options.fulltime,
      extratime: options.extratime,
      penalty: options.penalty,
    },
  };
}

export function buildSyntheticFixtureNs(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_001,
    statusShort: "NS",
    statusLong: "Not Started",
    goals: noScore(),
    halftime: noScore(),
    fulltime: noScore(),
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureFtHome(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_002,
    statusShort: "FT",
    statusLong: "Match Finished",
    goals: { home: 2, away: 1 },
    halftime: { home: 1, away: 0 },
    fulltime: { home: 2, away: 1 },
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureFtDraw(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_003,
    statusShort: "FT",
    statusLong: "Match Finished",
    goals: { home: 1, away: 1 },
    halftime: { home: 0, away: 1 },
    fulltime: { home: 1, away: 1 },
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureFtAway(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_004,
    statusShort: "FT",
    statusLong: "Match Finished",
    goals: { home: 0, away: 3 },
    halftime: { home: 0, away: 2 },
    fulltime: { home: 0, away: 3 },
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureAet(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_005,
    statusShort: "AET",
    statusLong: "Match Finished After Extra Time",
    goals: { home: 2, away: 1 },
    halftime: { home: 0, away: 0 },
    fulltime: { home: 1, away: 1 },
    extratime: { home: 2, away: 1 },
    penalty: noScore(),
  });
}

export function buildSyntheticFixturePen(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_006,
    statusShort: "PEN",
    statusLong: "Match Finished After Penalties",
    goals: { home: 1, away: 1 },
    halftime: { home: 0, away: 0 },
    fulltime: { home: 1, away: 1 },
    extratime: { home: 1, away: 1 },
    penalty: { home: 5, away: 4 },
  });
}

export function buildSyntheticFixturePst(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_007,
    statusShort: "PST",
    statusLong: "Match Postponed",
    goals: noScore(),
    halftime: noScore(),
    fulltime: noScore(),
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureCanc(): ApiFootballFixtureDto {
  return buildSyntheticFixture({
    providerFixtureId: 900_008,
    statusShort: "CANC",
    statusLong: "Match Cancelled",
    goals: noScore(),
    halftime: noScore(),
    fulltime: noScore(),
    extratime: noScore(),
    penalty: noScore(),
  });
}

export function buildSyntheticFixtureEnvelopeWithArrayErrors(): ApiFootballFixtureEnvelope {
  return {
    get: "fixtures",
    parameters: { date: "2030-01-01" },
    errors: [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: [buildSyntheticFixtureNs()],
  };
}

export function buildSyntheticFixtureEnvelopeWithObjectErrors(): ApiFootballFixtureEnvelope {
  return {
    ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
    errors: {},
  };
}

export function buildSyntheticPrediction(
  winner: ApiFootballPredictionDto["predictions"]["winner"] = {
    id: 920_001,
    name: "Synthetic Home FC",
    comment: "Synthetic winner comment",
  },
): ApiFootballPredictionDto {
  return {
    predictions: {
      winner,
      advice: "Synthetic advice text",
      under_over: "Synthetic under or over text",
      goals: { home: "Synthetic home goal range", away: "Synthetic away goal range" },
      percent: { home: "45%", draw: "30%", away: "25%" },
    },
    teams: {
      home: { id: 920_001, name: "Synthetic Home FC" },
      away: { id: 920_002, name: "Synthetic Away FC" },
    },
  };
}

export function buildSyntheticPredictionEnvelope(): ApiFootballPredictionEnvelope {
  return {
    get: "predictions",
    parameters: { fixture: "900001" },
    errors: [],
    results: 1,
    paging: { current: 1, total: 1 },
    response: [buildSyntheticPrediction()],
  };
}
