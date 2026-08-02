import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { PredictionSnapshot } from "@/domain/market-v2/capture/types";
import type { ApiFootballPredictionDto } from "@/infrastructure/market-v2/api-football/contracts";
import {
  mapApiFootballPrediction,
  type ApiFootballMappingResult,
  type ApiFootballPredictionMappingContext,
} from "@/infrastructure/market-v2/api-football/mappers";
import { buildSyntheticPrediction } from "@/tests/fixtures/api-football";

const originalGlobalFetch = globalThis.fetch;
let globalFetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = (() => {
    globalFetchCalls += 1;
    throw new Error("GLOBAL_FETCH_FORBIDDEN_IN_PREDICTION_MAPPER_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalGlobalFetch;
  expect(globalFetchCalls).toBe(0);
});

const CONTEXT: ApiFootballPredictionMappingContext = Object.freeze({
  capturedAtUtc: "2030-01-01T17:00:00.000Z",
  requestedProviderFixtureId: "900001",
  expectedKickoffUtc: "2030-01-01T18:00:00.000Z",
  expectedHomeProviderTeamId: "920001",
  expectedHomeName: "Synthetic Home FC",
  expectedAwayProviderTeamId: "920002",
  expectedAwayName: "Synthetic Away FC",
  contentHash: "synthetic-content-hash",
  parserVersion: "synthetic-parser/1.0",
  policyVersion: "synthetic-policy/1.0",
});

function mapped(result: ApiFootballMappingResult<PredictionSnapshot>): PredictionSnapshot {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.classification);
  return result.data;
}

function withPercentages(
  home: string,
  draw: string,
  away: string,
): ApiFootballPredictionDto {
  const source = buildSyntheticPrediction();
  return {
    ...source,
    predictions: {
      ...source.predictions,
      percent: { home, draw, away },
    },
  };
}

describe("API-Football prediction mapper", () => {
  it("maps exactly HOME, DRAW, and AWAY with source percentages", () => {
    const result = mapped(mapApiFootballPrediction(buildSyntheticPrediction(), CONTEXT));
    expect(result.selections).toEqual([
      { selection: "HOME", rawPercentage: "45%", normalizedProbability: "0.45" },
      { selection: "DRAW", rawPercentage: "30%", normalizedProbability: "0.3" },
      { selection: "AWAY", rawPercentage: "25%", normalizedProbability: "0.25" },
    ]);
    expect(result.probabilityTotalRaw).toBe("100%");
    expect(result.selections).toHaveLength(3);
    expect(result.selections.map(({ selection }) => selection)).not.toContain("DRAW_OR_AWAY");
  });

  it("converts decimal percentages exactly without binary-number output", () => {
    const result = mapped(
      mapApiFootballPrediction(withPercentages("33.3%", "33.3%", "33.4%"), CONTEXT),
    );
    expect(result.selections[0].normalizedProbability).toBe("0.333");
    expect(typeof result.selections[0].normalizedProbability).toBe("string");
  });

  it("trims only authorized exterior percentage whitespace", () => {
    const result = mapped(
      mapApiFootballPrediction(withPercentages(" 45% ", "30%", "25%"), CONTEXT),
    );
    expect(result.selections[0]).toEqual({
      selection: "HOME",
      rawPercentage: "45%",
      normalizedProbability: "0.45",
    });
  });

  it.each(["-1%", "100.01%", "1e2%", "NaN%", "Infinity%"])(
    "rejects invalid raw percentage %s",
    (home) => {
      const result = mapApiFootballPrediction(withPercentages(home, "30%", "70%"), CONTEXT);
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("expected prediction mapping failure");
      expect(result.error.classification).toBe("INVALID_PROBABILITY");
    },
  );

  it.each([
    ["40%", "30%", "30%", "100%"],
    ["40%", "30%", "29.99%", "99.99%"],
    ["40%", "30%", "30.01%", "100.01%"],
  ])("accepts the preregistered exact total boundary", (home, draw, away, expectedTotal) => {
    const result = mapped(
      mapApiFootballPrediction(withPercentages(home, draw, away), CONTEXT),
    );
    expect(result.probabilityTotalRaw).toBe(expectedTotal);
  });

  it.each([
    ["40%", "30%", "29.98%"],
    ["40%", "30%", "30.02%"],
  ])("rejects totals outside the exact tolerance", (home, draw, away) => {
    const result = mapApiFootballPrediction(withPercentages(home, draw, away), CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected prediction mapping failure");
    expect(result.error.classification).toBe("PROBABILITY_SUM_MISMATCH");
  });

  it("does not renormalize selections at the accepted lower boundary", () => {
    const result = mapped(
      mapApiFootballPrediction(withPercentages("40%", "30%", "29.99%"), CONTEXT),
    );
    expect(result.selections.map(({ normalizedProbability }) => normalizedProbability)).toEqual([
      "0.4",
      "0.3",
      "0.2999",
    ]);
  });

  it("preserves request association, versions, and raw provider commentary", () => {
    const result = mapped(mapApiFootballPrediction(buildSyntheticPrediction(), CONTEXT));
    expect(result).toMatchObject({
      providerKey: "api-football",
      providerFixtureId: CONTEXT.requestedProviderFixtureId,
      predictedWinnerProviderTeamId: "920001",
      predictedWinnerName: "Synthetic Home FC",
      winnerComment: "Synthetic winner comment",
      advice: "Synthetic advice text",
      underOverRaw: "Synthetic under or over text",
      providerInternalTimestamp: null,
      contentHash: CONTEXT.contentHash,
      parserVersion: CONTEXT.parserVersion,
      policyVersion: CONTEXT.policyVersion,
    });
    expect(result).not.toHaveProperty("outcome");
    expect(result).not.toHaveProperty("odds");
    expect(result).not.toHaveProperty("goals");
  });

  it.each([
    ["home ID", { expectedHomeProviderTeamId: "999001" }],
    ["away ID", { expectedAwayProviderTeamId: "999002" }],
    ["home name", { expectedHomeName: "Different Home" }],
    ["away name", { expectedAwayName: "Different Away" }],
  ])("blocks incompatible %s", (_label, override) => {
    const result = mapApiFootballPrediction(buildSyntheticPrediction(), {
      ...CONTEXT,
      ...override,
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected prediction mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });

  it("blocks inverted home and away orientation", () => {
    const source = buildSyntheticPrediction();
    const inverted: ApiFootballPredictionDto = {
      ...source,
      teams: { home: source.teams.away, away: source.teams.home },
    };
    const result = mapApiFootballPrediction(inverted, CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected prediction mapping failure");
    expect(result.error.classification).toBe("IDENTITY_MISMATCH");
  });

  it("accepts a null winner without inventing an identity", () => {
    const result = mapped(mapApiFootballPrediction(buildSyntheticPrediction(null), CONTEXT));
    expect(result.predictedWinnerProviderTeamId).toBeNull();
    expect(result.predictedWinnerName).toBeNull();
  });

  it("accepts an explicit winner object with no team identity", () => {
    const result = mapped(
      mapApiFootballPrediction(
        buildSyntheticPrediction({ id: null, name: null, comment: "Synthetic draw comment" }),
        CONTEXT,
      ),
    );
    expect(result.predictedWinnerProviderTeamId).toBeNull();
    expect(result.predictedWinnerName).toBeNull();
    expect(result.winnerComment).toBe("Synthetic draw comment");
  });

  it.each([
    [920_001, "Synthetic Home FC", "920001"],
    [920_002, "Synthetic Away FC", "920002"],
  ] as const)("accepts a coherent winner identity", (id, name, expectedId) => {
    const result = mapped(
      mapApiFootballPrediction(
        buildSyntheticPrediction({ id, name, comment: "Synthetic comment" }),
        CONTEXT,
      ),
    );
    expect(result.predictedWinnerProviderTeamId).toBe(expectedId);
    expect(result.predictedWinnerName).toBe(name);
  });

  it.each([
    { id: 999_999, name: "Unknown Synthetic Team", comment: null },
    { id: 920_001, name: "Wrong Synthetic Name", comment: null },
  ])("blocks an incoherent predicted winner", (winner) => {
    const result = mapApiFootballPrediction(buildSyntheticPrediction(winner), CONTEXT);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected prediction mapping failure");
    expect(result.error.classification).toBe("WINNER_TEAM_MISMATCH");
  });

  it.each([
    ["2030-01-01T17:59:59.999Z", true],
    ["2030-01-01T18:00:00.000Z", false],
    ["2030-01-01T18:00:00.001Z", false],
  ] as const)("records prematch chronology explicitly", (capturedAtUtc, expected) => {
    const result = mapped(
      mapApiFootballPrediction(buildSyntheticPrediction(), {
        ...CONTEXT,
        capturedAtUtc,
      }),
    );
    expect(result.predictionCapturedBeforeKickoff).toBe(expected);
  });

  it("rejects invalid capture and kickoff context timestamps", () => {
    const capture = mapApiFootballPrediction(buildSyntheticPrediction(), {
      ...CONTEXT,
      capturedAtUtc: "invalid",
    });
    const kickoff = mapApiFootballPrediction(buildSyntheticPrediction(), {
      ...CONTEXT,
      expectedKickoffUtc: "invalid",
    });
    expect(capture.ok ? null : capture.error.classification).toBe("INVALID_CAPTURE_TIME");
    expect(kickoff.ok ? null : kickoff.error.classification).toBe("INVALID_KICKOFF");
  });
});
