import { describe, expect, it } from "vitest";
import {
  FOREBET_PROBABILITY_SUM_TOLERANCE,
  isNormalizedUtcTimestamp,
  validateDecisionChronology,
  validateForebetSnapshot,
  validateOddsSnapshot,
  validateOutcomeCorrection,
  validatePreMatchDecision,
  type OddsSnapshotInput,
} from "@/domain/market-v2/validation";

const kickoffAtUtc = "2026-08-01T18:00:00Z";
const decidedAtUtc = "2026-08-01T17:30:00Z";

const activePrematchOdds: OddsSnapshotInput = {
  id: "odds-1",
  fixtureId: "fixture-1",
  capturedAtUtc: "2026-08-01T17:00:00Z",
  decimalOdds: 2.05,
  marketStatus: "ACTIVE",
  isInPlay: false,
};

function issueCodes(result: ReturnType<typeof validatePreMatchDecision>): string[] {
  return result.issues.map(({ code }) => code);
}

describe("Market V2 UTC policy", () => {
  it("accepts normalized timestamps with Z", () => {
    expect(isNormalizedUtcTimestamp("2026-08-01T17:00:00Z")).toBe(true);
    expect(isNormalizedUtcTimestamp("2026-08-01T17:00:00.123Z")).toBe(true);
  });

  it("rejects timestamps without a timezone", () => {
    expect(isNormalizedUtcTimestamp("2026-08-01T17:00:00")).toBe(false);
  });

  it("rejects offsets because the durable policy requires Z", () => {
    expect(isNormalizedUtcTimestamp("2026-08-01T19:00:00+02:00")).toBe(false);
  });
});

describe("Market V2 decision chronology", () => {
  it("allows odds captured exactly when the decision is made", () => {
    expect(
      validateDecisionChronology({
        oddsCapturedAtUtc: decidedAtUtc,
        decidedAtUtc,
        kickoffAtUtc,
      }).valid,
    ).toBe(true);
  });

  it("rejects odds captured after the decision", () => {
    const validation = validateDecisionChronology({
      oddsCapturedAtUtc: "2026-08-01T17:31:00Z",
      decidedAtUtc,
      kickoffAtUtc,
    });
    expect(validation.valid).toBe(false);
    expect(validation.issues).toContainEqual(expect.objectContaining({ code: "ODDS_AFTER_DECISION" }));
  });

  it.each([kickoffAtUtc, "2026-08-01T18:00:01Z"])(
    "rejects a decision at or after kickoff (%s)",
    (invalidDecisionTime) => {
      const validation = validateDecisionChronology({
        oddsCapturedAtUtc: "2026-08-01T17:00:00Z",
        decidedAtUtc: invalidDecisionTime,
        kickoffAtUtc,
      });
      expect(validation.issues).toContainEqual(
        expect.objectContaining({ code: "DECISION_NOT_PREMATCH" }),
      );
    },
  );
});

describe("Market V2 Forebet snapshots", () => {
  it("accepts probabilities in range that sum to one", () => {
    expect(
      validateForebetSnapshot({
        homeProbability: 0.5,
        drawProbability: 0.25,
        awayProbability: 0.25,
      }).valid,
    ).toBe(true);
  });

  it("uses an explicit tolerance", () => {
    expect(FOREBET_PROBABILITY_SUM_TOLERANCE).toBe(0.000_001);
    expect(
      validateForebetSnapshot({
        homeProbability: 0.5,
        drawProbability: 0.25,
        awayProbability: 0.250_000_5,
      }).valid,
    ).toBe(true);
  });

  it("rejects probabilities outside zero and one", () => {
    const validation = validateForebetSnapshot({
      homeProbability: 1.1,
      drawProbability: -0.1,
      awayProbability: 0,
    });
    expect(validation.issues.filter(({ code }) => code === "PROBABILITY_OUT_OF_RANGE")).toHaveLength(2);
  });

  it("rejects sums outside tolerance", () => {
    expect(
      validateForebetSnapshot({
        homeProbability: 0.5,
        drawProbability: 0.3,
        awayProbability: 0.3,
      }).issues,
    ).toContainEqual(expect.objectContaining({ code: "PROBABILITY_SUM_OUTSIDE_TOLERANCE" }));
  });
});

describe("Market V2 odds eligibility", () => {
  it.each([1, 0.99, 0])("rejects decimal odds not greater than one (%s)", (decimalOdds) => {
    expect(validateOddsSnapshot({ ...activePrematchOdds, decimalOdds }, kickoffAtUtc).issues).toContainEqual(
      expect.objectContaining({ code: "INVALID_DECIMAL_ODDS" }),
    );
  });

  it("rejects in-play odds", () => {
    expect(
      validateOddsSnapshot({ ...activePrematchOdds, isInPlay: true }, kickoffAtUtc).issues,
    ).toContainEqual(expect.objectContaining({ code: "IN_PLAY_ODDS" }));
  });

  it.each(["SUSPENDED", "CLOSED"] as const)("rejects a %s market", (marketStatus) => {
    expect(
      validateOddsSnapshot({ ...activePrematchOdds, marketStatus }, kickoffAtUtc).issues,
    ).toContainEqual(expect.objectContaining({ code: "MARKET_NOT_ACTIVE" }));
  });
});

describe("Market V2 pre-match decisions", () => {
  it("rejects SELECTED without an exact odds snapshot", () => {
    const validation = validatePreMatchDecision({
      fixtureId: "fixture-1",
      kickoffAtUtc,
      decidedAtUtc,
      status: "SELECTED",
      reasonCode: "EDGE_ACCEPTED",
    });
    expect(issueCodes(validation)).toContain("SELECTED_ODDS_REQUIRED");
  });

  it("accepts ABSTAINED without an odds snapshot", () => {
    expect(
      validatePreMatchDecision({
        fixtureId: "fixture-1",
        kickoffAtUtc,
        decidedAtUtc,
        status: "ABSTAINED",
        reasonCode: "NO_ELIGIBLE_PRICE",
      }).valid,
    ).toBe(true);
  });

  it("preserves the BLOCKED reason code", () => {
    const decision = Object.freeze({
      fixtureId: "fixture-1",
      kickoffAtUtc,
      decidedAtUtc,
      status: "BLOCKED" as const,
      reasonCode: "SOURCE_EVIDENCE_MISSING",
    });
    expect(validatePreMatchDecision(decision).valid).toBe(true);
    expect(decision.reasonCode).toBe("SOURCE_EVIDENCE_MISSING");
  });

  it("requires selected odds to belong to the same fixture", () => {
    const validation = validatePreMatchDecision({
      fixtureId: "fixture-2",
      kickoffAtUtc,
      decidedAtUtc,
      status: "SELECTED",
      reasonCode: "EDGE_ACCEPTED",
      selectedOddsSnapshot: activePrematchOdds,
    });
    expect(issueCodes(validation)).toContain("ODDS_FIXTURE_MISMATCH");
  });
});

describe("Market V2 outcome corrections", () => {
  const original = {
    id: "outcome-1",
    fixtureId: "fixture-1",
    observedAtUtc: "2026-08-01T20:00:00Z",
  };

  it("accepts a later correction for the same fixture that references the original", () => {
    expect(
      validateOutcomeCorrection(original, {
        id: "outcome-2",
        fixtureId: "fixture-1",
        observedAtUtc: "2026-08-01T20:05:00Z",
        supersedesOutcomeId: "outcome-1",
      }).valid,
    ).toBe(true);
  });

  it("rejects a missing reference, fixture change, or earlier observation", () => {
    const validation = validateOutcomeCorrection(original, {
      id: "outcome-2",
      fixtureId: "fixture-2",
      observedAtUtc: "2026-08-01T19:59:59Z",
    });
    expect(validation.issues.map(({ code }) => code)).toEqual(
      expect.arrayContaining([
        "OUTCOME_FIXTURE_MISMATCH",
        "SUPERSEDED_OUTCOME_REQUIRED",
        "CORRECTION_OBSERVED_TOO_EARLY",
      ]),
    );
  });
});
