import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ApiFootballFixtureDto } from "@/infrastructure/market-v2/api-football/contracts";
import {
  mapApiFootballFixture,
  type ApiFootballFixtureMappingContext,
  type ApiFootballMappingResult,
} from "@/infrastructure/market-v2/api-football/mappers";
import {
  buildSyntheticFixtureAet,
  buildSyntheticFixtureCanc,
  buildSyntheticFixtureFtHome,
  buildSyntheticFixtureNs,
  buildSyntheticFixturePen,
  buildSyntheticFixturePst,
} from "@/tests/fixtures/api-football";
import type { CapturedFixture } from "@/domain/market-v2/capture/types";

const originalGlobalFetch = globalThis.fetch;
let globalFetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_FIXTURE_MAPPER_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalGlobalFetch;
  expect(globalFetchCalls).toBe(0);
});

const CONTEXT: ApiFootballFixtureMappingContext = Object.freeze({
  capturedAtUtc: "2030-01-01T12:00:00.000Z",
  providerKey: "api-football",
});

function mapped(result: ApiFootballMappingResult<CapturedFixture>): CapturedFixture {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.classification);
  return result.data;
}

function withFixture(
  fixture: ApiFootballFixtureDto,
  overrides: Partial<ApiFootballFixtureDto["fixture"]>,
): ApiFootballFixtureDto {
  return { ...fixture, fixture: { ...fixture.fixture, ...overrides } };
}

describe("API-Football fixture mapper", () => {
  it("maps a validated NS fixture without losing source identity or chronology", () => {
    const source = buildSyntheticFixtureNs();
    const result = mapped(mapApiFootballFixture(source, CONTEXT));

    expect(result).toMatchObject({
      providerKey: "api-football",
      providerFixtureId: "900001",
      capturedAtUtc: CONTEXT.capturedAtUtc,
      sourceDate: source.fixture.date,
      sourceTimestamp: String(source.fixture.timestamp),
      sourceTimezone: "UTC",
      rawStatusCode: "NS",
      canonicalStatus: "SCHEDULED",
      automaticUseBlocked: false,
      competition: {
        providerCompetitionId: "910001",
        name: source.league.name,
        country: source.league.country,
      },
      season: "2030",
      round: source.league.round,
      home: { providerTeamId: "920001", name: source.teams.home.name },
      away: { providerTeamId: "920002", name: source.teams.away.name },
      goals: { home: null, away: null },
    });
    expect(result.capturedAtUtc).not.toBe(result.sourceDate);
    expect(result).not.toHaveProperty("id");
    expect(result).not.toHaveProperty("odds");
  });

  it("preserves every score scope independently", () => {
    const source = buildSyntheticFixtureAet();
    const result = mapped(mapApiFootballFixture(source, CONTEXT));
    expect(result.score).toEqual(source.score);
    expect(result.goals).toEqual(source.goals);
    expect(result.score.halftime).not.toBe(result.score.fulltime);
  });

  it.each([
    ["TBD", "UNKNOWN", true],
    ["FT", "FINISHED", false],
    ["AET", "FINISHED", false],
    ["PEN", "FINISHED", false],
    ["PST", "POSTPONED", true],
    ["CANC", "CANCELLED", true],
  ] as const)("maps status %s without inference", (rawStatusCode, canonicalStatus, blocked) => {
    const sources: Record<string, ApiFootballFixtureDto> = {
      FT: buildSyntheticFixtureFtHome(),
      AET: buildSyntheticFixtureAet(),
      PEN: buildSyntheticFixturePen(),
      PST: buildSyntheticFixturePst(),
      CANC: buildSyntheticFixtureCanc(),
      TBD: withFixture(buildSyntheticFixtureNs(), {
        status: { long: "Synthetic time to be defined", short: "TBD" },
      }),
    };
    const result = mapped(mapApiFootballFixture(sources[rawStatusCode], CONTEXT));
    expect(result).toMatchObject({
      rawStatusCode,
      canonicalStatus,
      automaticUseBlocked: blocked,
    });
  });

  it("blocks an unknown status while preserving its raw code", () => {
    const source = withFixture(buildSyntheticFixtureNs(), {
      status: { long: "Synthetic unsupported status", short: "ZZZ" },
    });
    const result = mapped(mapApiFootballFixture(source, CONTEXT));
    expect(result).toMatchObject({
      rawStatusCode: "ZZZ",
      canonicalStatus: "UNKNOWN",
      automaticUseBlocked: true,
    });
  });

  it("rejects an invalid capture timestamp", () => {
    const result = mapApiFootballFixture(buildSyntheticFixtureNs(), {
      ...CONTEXT,
      capturedAtUtc: "2030-01-01T12:00:00+01:00",
    });
    expect(result).toEqual({
      ok: false,
      error: {
        mapper: "FIXTURE",
        classification: "INVALID_CAPTURE_TIME",
        providerFixtureId: "900001",
        field: "capturedAtUtc",
      },
    });
  });

  it("rejects a source date without an explicit offset", () => {
    const source = withFixture(buildSyntheticFixtureNs(), {
      date: "2030-01-01T18:00:00",
    });
    const result = mapApiFootballFixture(source, CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected fixture mapping failure");
    expect(result.error.classification).toBe("INVALID_KICKOFF");
  });

  it("rejects an exact date and Unix timestamp contradiction", () => {
    const source = withFixture(buildSyntheticFixtureNs(), {
      timestamp: buildSyntheticFixtureNs().fixture.timestamp + 1,
    });
    const result = mapApiFootballFixture(source, CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected fixture mapping failure");
    expect(result.error.classification).toBe("DATE_TIMESTAMP_MISMATCH");
  });

  it("rejects a non-UTC operational timezone", () => {
    const source = withFixture(buildSyntheticFixtureNs(), { timezone: "Europe/Berlin" });
    const result = mapApiFootballFixture(source, CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected fixture mapping failure");
    expect(result.error).toMatchObject({
      classification: "UNEXPECTED_TIMEZONE",
      field: "fixture.timezone",
    });
  });

  it("rejects a caller context for another provider", () => {
    const result = mapApiFootballFixture(buildSyntheticFixtureNs(), {
      ...CONTEXT,
      providerKey: "another-provider",
    } as unknown as ApiFootballFixtureMappingContext);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected fixture mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });
});
