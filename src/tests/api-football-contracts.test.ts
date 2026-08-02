import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  apiFootballFixtureSchema,
  apiFootballPredictionSchema,
  classifyApiFootballStatus,
  decodeApiFootballFixtureEnvelope,
  decodeApiFootballPredictionEnvelope,
  deriveApiFootballRegulationOutcome,
} from "@/infrastructure/market-v2/api-football/contracts";
import {
  buildSyntheticFixtureAet,
  buildSyntheticFixtureCanc,
  buildSyntheticFixtureEnvelopeWithArrayErrors,
  buildSyntheticFixtureEnvelopeWithObjectErrors,
  buildSyntheticFixtureFtAway,
  buildSyntheticFixtureFtDraw,
  buildSyntheticFixtureFtHome,
  buildSyntheticFixtureNs,
  buildSyntheticFixturePen,
  buildSyntheticFixturePst,
  buildSyntheticPrediction,
  buildSyntheticPredictionEnvelope,
} from "@/tests/fixtures/api-football";

const originalFetch = globalThis.fetch;

beforeAll(() => {
  globalThis.fetch = (() => {
    throw new Error("REAL_FETCH_FORBIDDEN_IN_API_FOOTBALL_CONTRACT_TESTS");
  }) as typeof globalThis.fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("API-Football envelope contracts", () => {
  it("accepts an empty errors array", () => {
    const result = decodeApiFootballFixtureEnvelope(
      buildSyntheticFixtureEnvelopeWithArrayErrors(),
    );
    expect(result.ok).toBe(true);
  });

  it("accepts an empty errors object", () => {
    const result = decodeApiFootballFixtureEnvelope(
      buildSyntheticFixtureEnvelopeWithObjectErrors(),
    );
    expect(result.ok).toBe(true);
  });

  it("blocks a non-empty errors object", () => {
    const envelope = {
      ...buildSyntheticFixtureEnvelopeWithObjectErrors(),
      errors: { requests: "Synthetic provider error" },
    };
    const result = decodeApiFootballFixtureEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a provider error");
    expect(result.error.code).toBe("API_ERRORS_PRESENT");
    expect(result.error.message).not.toContain("Synthetic provider error");
  });

  it("blocks a non-empty errors array", () => {
    const envelope = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
      errors: ["Synthetic provider error"],
    };
    const result = decodeApiFootballFixtureEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a provider error");
    expect(result.error.code).toBe("API_ERRORS_PRESENT");
  });

  it("rejects an incomplete envelope", () => {
    const incomplete: Record<string, unknown> = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
    };
    delete incomplete.response;
    const result = decodeApiFootballFixtureEnvelope(incomplete);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid envelope");
    expect(result.error.code).toBe("INVALID_ENVELOPE");
  });

  it("rejects a negative results count", () => {
    const envelope = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
      results: -1,
    };
    const result = decodeApiFootballFixtureEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid envelope");
    expect(result.error.code).toBe("INVALID_ENVELOPE");
  });

  it("accepts results zero with an empty response", () => {
    const envelope = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
      results: 0,
      response: [],
    };
    const result = decodeApiFootballFixtureEnvelope(envelope);
    expect(result.ok).toBe(true);
    if (!result.ok) throw result.error;
    expect(result.data.response).toEqual([]);
  });

  it("rejects a response of the wrong requested contract", () => {
    const envelope = {
      ...buildSyntheticFixtureEnvelopeWithArrayErrors(),
      response: [buildSyntheticPrediction()],
    };
    const result = decodeApiFootballFixtureEnvelope(envelope);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected an invalid fixture response");
    expect(result.error.code).toBe("INVALID_ENVELOPE");
  });
});

describe("API-Football fixture DTO", () => {
  it("accepts a valid minimal fixture", () => {
    expect(apiFootballFixtureSchema.safeParse(buildSyntheticFixtureNs()).success).toBe(true);
  });

  it("rejects an invalid provider fixture id", () => {
    const fixture = buildSyntheticFixtureNs();
    const invalid = { ...fixture, fixture: { ...fixture.fixture, id: 0 } };
    expect(apiFootballFixtureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a fixture date without an offset", () => {
    const fixture = buildSyntheticFixtureNs();
    const invalid = {
      ...fixture,
      fixture: { ...fixture.fixture, date: "2030-01-01T18:00:00" },
    };
    expect(apiFootballFixtureSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a non-integer Unix timestamp", () => {
    const fixture = buildSyntheticFixtureNs();
    const invalid = { ...fixture, fixture: { ...fixture.fixture, timestamp: 1.5 } };
    expect(apiFootballFixtureSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves provider home and away ordering", () => {
    const parsed = apiFootballFixtureSchema.parse(buildSyntheticFixtureNs());
    expect(parsed.teams.home.name).toBe("Synthetic Home FC");
    expect(parsed.teams.away.name).toBe("Synthetic Away FC");
  });

  it("accepts null goals for NS", () => {
    const parsed = apiFootballFixtureSchema.parse(buildSyntheticFixtureNs());
    expect(parsed.goals).toEqual({ home: null, away: null });
  });

  it("accepts partial score blocks containing null", () => {
    const fixture = buildSyntheticFixtureFtHome();
    const partial = {
      ...fixture,
      score: { ...fixture.score, halftime: { home: 1, away: null } },
    };
    const parsed = apiFootballFixtureSchema.safeParse(partial);
    expect(parsed.success).toBe(true);
  });
});

describe("API-Football prediction DTO", () => {
  it("accepts a valid minimal prediction", () => {
    const result = decodeApiFootballPredictionEnvelope(buildSyntheticPredictionEnvelope());
    expect(result.ok).toBe(true);
  });

  it("accepts a null winner", () => {
    const prediction = buildSyntheticPrediction(null);
    expect(apiFootballPredictionSchema.safeParse(prediction).success).toBe(true);
  });

  it("rejects percentages without a percent sign", () => {
    const prediction = buildSyntheticPrediction();
    const invalid = {
      ...prediction,
      predictions: {
        ...prediction.predictions,
        percent: { ...prediction.predictions.percent, home: "45" },
      },
    };
    expect(apiFootballPredictionSchema.safeParse(invalid).success).toBe(false);
  });

  it("rejects a missing HOME, DRAW, or AWAY percentage", () => {
    const prediction = buildSyntheticPrediction();
    const percent: Record<string, string> = { ...prediction.predictions.percent };
    delete percent.draw;
    const invalid = {
      ...prediction,
      predictions: { ...prediction.predictions, percent },
    };
    expect(apiFootballPredictionSchema.safeParse(invalid).success).toBe(false);
  });

  it("preserves advice, under_over, and predicted goals as raw strings", () => {
    const parsed = apiFootballPredictionSchema.parse(buildSyntheticPrediction());
    expect(parsed.predictions.advice).toBe("Synthetic advice text");
    expect(parsed.predictions.under_over).toBe("Synthetic under or over text");
    expect(parsed.predictions.goals).toEqual({
      home: "Synthetic home goal range",
      away: "Synthetic away goal range",
    });
  });

  it("does not derive Double Chance fields", () => {
    const parsed = apiFootballPredictionSchema.parse(buildSyntheticPrediction());
    expect("doubleChance" in parsed.predictions).toBe(false);
    expect("winOrDraw" in parsed.predictions).toBe(false);
  });

  it("explicitly trims outer percentage whitespace without numeric conversion", () => {
    const prediction = buildSyntheticPrediction();
    const withWhitespace = {
      ...prediction,
      predictions: {
        ...prediction.predictions,
        percent: { ...prediction.predictions.percent, home: " 45% " },
      },
    };
    const parsed = apiFootballPredictionSchema.parse(withWhitespace);
    expect(parsed.predictions.percent.home).toBe("45%");
    expect(typeof parsed.predictions.percent.home).toBe("string");
  });
});

describe("API-Football R0 statuses and result semantics", () => {
  it.each([
    ["NS", "SCHEDULED", false, false],
    ["TBD", "UNKNOWN", false, true],
    ["FT", "FINISHED", true, false],
    ["AET", "FINISHED", true, false],
    ["PEN", "FINISHED", true, false],
    ["PST", "POSTPONED", false, true],
    ["CANC", "CANCELLED", false, true],
  ] as const)(
    "classifies preregistered status %s",
    (rawCode, canonicalStatus, terminal, blocked) => {
      expect(classifyApiFootballStatus(rawCode)).toEqual({
        rawCode,
        canonicalStatus,
        terminal,
        blocked,
        preregistered: true,
      });
    },
  );

  it("blocks an unknown status while preserving its raw code", () => {
    expect(classifyApiFootballStatus("SYNTH_UNKNOWN")).toEqual({
      rawCode: "SYNTH_UNKNOWN",
      canonicalStatus: "UNKNOWN",
      terminal: false,
      blocked: true,
      preregistered: false,
    });
  });

  it("derives HOME from the regulation fulltime score", () => {
    const fixture = buildSyntheticFixtureFtHome();
    expect(deriveApiFootballRegulationOutcome("FT", fixture.score).result1X2).toBe("HOME");
  });

  it("derives DRAW from the regulation fulltime score", () => {
    const fixture = buildSyntheticFixtureFtDraw();
    expect(deriveApiFootballRegulationOutcome("FT", fixture.score).result1X2).toBe("DRAW");
  });

  it("derives AWAY from the regulation fulltime score", () => {
    const fixture = buildSyntheticFixtureFtAway();
    expect(deriveApiFootballRegulationOutcome("FT", fixture.score).result1X2).toBe("AWAY");
  });

  it("blocks an outcome with an incomplete fulltime score", () => {
    const fixture = buildSyntheticFixtureFtHome();
    const result = deriveApiFootballRegulationOutcome("FT", {
      ...fixture.score,
      fulltime: { home: 2, away: null },
    });
    expect(result.resolutionCode).toBe("FULLTIME_SCORE_INCOMPLETE");
    expect(result.result1X2).toBeNull();
  });

  it("blocks outcome derivation for a non-terminal status", () => {
    const fixture = buildSyntheticFixtureNs();
    const result = deriveApiFootballRegulationOutcome("NS", fixture.score);
    expect(result.resolutionCode).toBe("NON_TERMINAL_STATUS");
    expect(result.result1X2).toBeNull();
  });

  it("preserves extra-time scores separately from regulation", () => {
    const fixture = buildSyntheticFixtureAet();
    const result = deriveApiFootballRegulationOutcome("AET", fixture.score);
    expect(result.result1X2).toBe("DRAW");
    expect(result.extratime).toEqual({ home: 2, away: 1 });
    expect(result.shootoutWinner).toBeNull();
  });

  it("keeps a regulation DRAW for a fixture decided on penalties", () => {
    const fixture = buildSyntheticFixturePen();
    const result = deriveApiFootballRegulationOutcome("PEN", fixture.score);
    expect(result.result1X2).toBe("DRAW");
  });

  it("calculates the shootout winner separately", () => {
    const fixture = buildSyntheticFixturePen();
    const result = deriveApiFootballRegulationOutcome("PEN", fixture.score);
    expect(result.shootoutWinner).toBe("HOME");
  });

  it("never replaces result1X2 with shootoutWinner", () => {
    const fixture = buildSyntheticFixturePen();
    const result = deriveApiFootballRegulationOutcome("PEN", fixture.score);
    expect(result).toMatchObject({ result1X2: "DRAW", shootoutWinner: "HOME" });
    expect(result.result1X2).not.toBe(result.shootoutWinner);
  });

  it("provides synthetic PST and CANC fixtures for blocked states", () => {
    expect(buildSyntheticFixturePst().fixture.status.short).toBe("PST");
    expect(buildSyntheticFixtureCanc().fixture.status.short).toBe("CANC");
  });
});
