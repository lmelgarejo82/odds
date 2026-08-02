import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ProviderOutcomeResolution } from "@/domain/market-v2/outcome/outcome-repository";
import type { ApiFootballFixtureDto } from "@/infrastructure/market-v2/api-football/contracts";
import {
  mapApiFootballResult,
  type ApiFootballMappingResult,
  type ApiFootballResultMappingContext,
} from "@/infrastructure/market-v2/api-football/mappers";
import {
  buildSyntheticFixtureAet,
  buildSyntheticFixtureCanc,
  buildSyntheticFixtureFtAway,
  buildSyntheticFixtureFtDraw,
  buildSyntheticFixtureFtHome,
  buildSyntheticFixtureNs,
  buildSyntheticFixturePen,
  buildSyntheticFixturePst,
} from "@/tests/fixtures/api-football";

const originalGlobalFetch = globalThis.fetch;
let globalFetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_RESULT_MAPPER_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalGlobalFetch;
  expect(globalFetchCalls).toBe(0);
});

function contextFor(fixture: ApiFootballFixtureDto): ApiFootballResultMappingContext {
  return Object.freeze({
    capturedAtUtc: "2030-01-02T12:00:00.000Z",
    requestedProviderFixtureId: String(fixture.fixture.id),
    expectedLeagueProviderId: String(fixture.league.id),
    expectedSeason: fixture.league.season,
    expectedHomeProviderTeamId: String(fixture.teams.home.id),
    expectedHomeName: fixture.teams.home.name,
    expectedAwayProviderTeamId: String(fixture.teams.away.id),
    expectedAwayName: fixture.teams.away.name,
    expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
  });
}

function mapped(
  result: ApiFootballMappingResult<ProviderOutcomeResolution>,
): ProviderOutcomeResolution {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.classification);
  return result.data;
}

function withScore(
  fixture: ApiFootballFixtureDto,
  score: Partial<ApiFootballFixtureDto["score"]>,
): ApiFootballFixtureDto {
  return { ...fixture, score: { ...fixture.score, ...score } };
}

describe("API-Football result mapper", () => {
  it.each([
    [buildSyntheticFixtureFtHome, "HOME"],
    [buildSyntheticFixtureFtDraw, "DRAW"],
    [buildSyntheticFixtureFtAway, "AWAY"],
  ] as const)("maps an FT regulation result", (buildFixture, expected) => {
    const fixture = buildFixture();
    const result = mapped(mapApiFootballResult(fixture, contextFor(fixture)));
    expect(result.result1X2).toBe(expected);
    expect(result.result1X2Scope).toBe("REGULATION_TIME");
    expect(result.providerTerminalStatusRaw).toBe("FT");
    expect(result.shootoutWinner).toBeNull();
  });

  it("uses score.fulltime rather than goals for regulation 1X2", () => {
    const fixture: ApiFootballFixtureDto = {
      ...buildSyntheticFixtureFtHome(),
      goals: { home: 0, away: 9 },
    };
    const result = mapped(mapApiFootballResult(fixture, contextFor(fixture)));
    expect(result.result1X2).toBe("HOME");
    expect(result.goalsHomeScore).toBe(0);
    expect(result.goalsAwayScore).toBe(9);
  });

  it("blocks an incomplete FT regulation score", () => {
    const fixture = withScore(buildSyntheticFixtureFtHome(), {
      fulltime: { home: 2, away: null },
    });
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("RESULT_SCORE_INCOMPLETE");
  });

  it.each([
    buildSyntheticFixtureNs,
    buildSyntheticFixturePst,
    buildSyntheticFixtureCanc,
  ])("blocks a non-terminal status", (buildFixture) => {
    const fixture = buildFixture();
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("RESULT_NOT_TERMINAL");
  });

  it("blocks TBD as non-terminal", () => {
    const base = buildSyntheticFixtureNs();
    const fixture: ApiFootballFixtureDto = {
      ...base,
      fixture: {
        ...base.fixture,
        status: { long: "Synthetic time to be defined", short: "TBD" },
      },
    };
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("RESULT_NOT_TERMINAL");
  });

  it("keeps AET regulation and extra-time scores separate", () => {
    const fixture = buildSyntheticFixtureAet();
    const result = mapped(mapApiFootballResult(fixture, contextFor(fixture)));
    expect(result).toMatchObject({
      providerTerminalStatusRaw: "AET",
      result1X2: "DRAW",
      regulationHomeScore: 1,
      regulationAwayScore: 1,
      extraTimeHomeScore: 2,
      extraTimeAwayScore: 1,
      shootoutWinner: null,
    });
  });

  it("blocks AET without a complete extra-time score", () => {
    const fixture = withScore(buildSyntheticFixtureAet(), {
      extratime: { home: null, away: null },
    });
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("RESULT_SCORE_INCOMPLETE");
  });

  it.each([
    [{ home: 5, away: 4 }, "HOME"],
    [{ home: 3, away: 4 }, "AWAY"],
  ] as const)("derives a separate PEN shootout winner", (penalty, expectedWinner) => {
    const fixture = withScore(buildSyntheticFixturePen(), { penalty: { ...penalty } });
    const result = mapped(mapApiFootballResult(fixture, contextFor(fixture)));
    expect(result.result1X2).toBe("DRAW");
    expect(result.shootoutWinner).toBe(expectedWinner);
    expect(result.penaltyHomeScore).toBe(penalty.home);
    expect(result.penaltyAwayScore).toBe(penalty.away);
  });

  it("blocks a tied penalty shootout", () => {
    const fixture = withScore(buildSyntheticFixturePen(), {
      penalty: { home: 4, away: 4 },
    });
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("INVALID_SCORE_SEMANTICS");
  });

  it("blocks an incomplete penalty shootout", () => {
    const fixture = withScore(buildSyntheticFixturePen(), {
      penalty: { home: 4, away: null },
    });
    const result = mapApiFootballResult(fixture, contextFor(fixture));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("RESULT_SCORE_INCOMPLETE");
  });

  it.each([
    ["fixture ID", { requestedProviderFixtureId: "999001" }],
    ["league ID", { expectedLeagueProviderId: "999002" }],
    ["season", { expectedSeason: 2099 }],
    ["home ID", { expectedHomeProviderTeamId: "999003" }],
    ["away ID", { expectedAwayProviderTeamId: "999004" }],
    ["home name", { expectedHomeName: "Wrong Home" }],
    ["away name", { expectedAwayName: "Wrong Away" }],
  ])("blocks incompatible %s", (_label, override) => {
    const fixture = buildSyntheticFixtureFtHome();
    const result = mapApiFootballResult(fixture, { ...contextFor(fixture), ...override });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });

  it("blocks inverted home and away orientation", () => {
    const base = buildSyntheticFixtureFtHome();
    const fixture: ApiFootballFixtureDto = {
      ...base,
      teams: { home: base.teams.away, away: base.teams.home },
    };
    const result = mapApiFootballResult(fixture, contextFor(base));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });

  it("blocks an incompatible expected kickoff", () => {
    const fixture = buildSyntheticFixtureFtHome();
    const result = mapApiFootballResult(fixture, {
      ...contextFor(fixture),
      expectedKickoffUtc: "2030-01-01T18:00:01.000Z",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });

  it("blocks a non-UTC provider timezone", () => {
    const base = buildSyntheticFixtureFtHome();
    const fixture: ApiFootballFixtureDto = {
      ...base,
      fixture: { ...base.fixture, timezone: "Europe/Berlin" },
    };
    const result = mapApiFootballResult(fixture, contextFor(base));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected result mapping failure");
    expect(result.error.classification).toBe("UNEXPECTED_TIMEZONE");
  });

  it("returns a pure resolution without settlement, odds, or evaluation", () => {
    const fixture = buildSyntheticFixtureFtHome();
    const result = mapped(mapApiFootballResult(fixture, contextFor(fixture)));
    expect(result.providerFixtureId).toBe(String(fixture.fixture.id));
    expect(result.capturedAtUtc).toBe(contextFor(fixture).capturedAtUtc);
    expect(result).not.toHaveProperty("settlement");
    expect(result).not.toHaveProperty("odds");
    expect(result).not.toHaveProperty("evaluation");
  });
});
