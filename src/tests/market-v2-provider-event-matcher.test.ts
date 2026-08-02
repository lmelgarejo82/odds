import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  matchProviderEvent,
  type ProviderEventDescriptor,
  type ProviderEventMatchPolicy,
  type ProviderEventMatchResult,
} from "@/domain/market-v2/matching/provider-event-matcher";

const source = (overrides: Partial<ProviderEventDescriptor> = {}): ProviderEventDescriptor => ({
  providerKey: "provider-alpha",
  providerEventId: "source-event",
  kickoffAtUtc: "2026-08-03T18:00:00.000Z",
  normalizedCompetitionKey: "synthetic-premier",
  normalizedHomeTeamKey: "synthetic-home",
  normalizedAwayTeamKey: "synthetic-away",
  ...overrides,
});

const candidate = (overrides: Partial<ProviderEventDescriptor> = {}): ProviderEventDescriptor => ({
  providerKey: "provider-beta",
  providerEventId: "candidate-event",
  kickoffAtUtc: "2026-08-03T18:00:00.000Z",
  normalizedCompetitionKey: "synthetic-premier",
  normalizedHomeTeamKey: "synthetic-home",
  normalizedAwayTeamKey: "synthetic-away",
  ...overrides,
});

const policy = (overrides: Partial<ProviderEventMatchPolicy> = {}): ProviderEventMatchPolicy => ({
  policyVersion: "synthetic-policy-v1",
  kickoffToleranceSeconds: 60,
  ...overrides,
});

const result = (
  candidates: unknown = [candidate()],
  sourceInput: unknown = source(),
  policyInput: unknown = policy(),
): ProviderEventMatchResult => matchProviderEvent(sourceInput, candidates, policyInput);

function classificationOf(matchResult: ProviderEventMatchResult): string {
  if (matchResult.status !== "INVALID_INPUT") throw new Error("Expected INVALID_INPUT");
  return matchResult.error.classification;
}

function outputKeys(matchResult: ProviderEventMatchResult): readonly string[] {
  return Object.keys(matchResult).sort();
}

const originalFetch = globalThis.fetch;
let fetchCalls = 0;

beforeAll(() => {
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("Network access is forbidden in provider-event matcher tests");
  };
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("Market V2 provider-neutral deterministic event matcher", () => {
  describe("policy and input validation", () => {
    it("1 accepts a policy with an explicit tolerance", () => {
      expect(result().status).toBe("MATCHED");
    });

    it("2 accepts zero tolerance", () => {
      expect(result([candidate()], source(), policy({ kickoffToleranceSeconds: 0 })).status).toBe("MATCHED");
    });

    it("3 rejects an empty policyVersion", () => {
      expect(classificationOf(result([], source(), policy({ policyVersion: "" })))).toBe("INVALID_POLICY");
    });

    it("4 rejects a negative tolerance", () => {
      expect(classificationOf(result([], source(), policy({ kickoffToleranceSeconds: -1 })))).toBe("INVALID_POLICY");
    });

    it("5 rejects a decimal tolerance", () => {
      expect(classificationOf(result([], source(), policy({ kickoffToleranceSeconds: 0.5 })))).toBe("INVALID_POLICY");
    });

    it("6 rejects an infinite tolerance", () => {
      expect(classificationOf(result([], source(), policy({ kickoffToleranceSeconds: Infinity })))).toBe("INVALID_POLICY");
    });

    it("7 rejects an unsafe integer tolerance", () => {
      expect(classificationOf(result([], source(), policy({ kickoffToleranceSeconds: Number.MAX_SAFE_INTEGER + 1 })))).toBe("INVALID_POLICY");
    });

    it("8 rejects an invalid source kickoff", () => {
      expect(classificationOf(result([], source({ kickoffAtUtc: "not-a-date" })))).toBe("INVALID_KICKOFF");
    });

    it("9 rejects a non-UTC source kickoff", () => {
      expect(classificationOf(result([], source({ kickoffAtUtc: "2026-08-03T20:00:00+02:00" })))).toBe("NON_UTC_KICKOFF");
    });

    it("10 rejects an invalid candidate kickoff", () => {
      expect(classificationOf(result([candidate({ kickoffAtUtc: "2026-02-30T18:00:00Z" })]))).toBe("INVALID_KICKOFF");
    });

    it("11 rejects a non-UTC candidate kickoff", () => {
      expect(classificationOf(result([candidate({ kickoffAtUtc: "2026-08-03T19:00:00+01:00" })]))).toBe("NON_UTC_KICKOFF");
    });

    it("12 rejects an empty normalized key", () => {
      expect(classificationOf(result([candidate({ normalizedCompetitionKey: "" })]))).toBe("INVALID_NORMALIZED_KEY");
    });

    it("13 rejects equal home and away keys", () => {
      expect(classificationOf(result([candidate({ normalizedAwayTeamKey: "synthetic-home" })]))).toBe("INVALID_ORIENTATION_INPUT");
    });

    it("14 rejects a duplicate provider-local candidate identity", () => {
      const duplicate = candidate({ kickoffAtUtc: "2026-08-03T18:00:30Z" });
      expect(classificationOf(result([candidate(), duplicate]))).toBe("DUPLICATE_CANDIDATE_IDENTITY");
    });

    it("15 does not modify the candidate array", () => {
      const candidates = [candidate({ providerEventId: "z" }), candidate({ providerEventId: "a" })];
      const before = [...candidates];
      result(candidates);
      expect(candidates).toEqual(before);
    });
  });

  describe("temporal matching", () => {
    it("16 matches an exact kickoff with zero tolerance", () => {
      expect(result([candidate()], source(), policy({ kickoffToleranceSeconds: 0 })).status).toBe("MATCHED");
    });

    it("17 includes the exact tolerance boundary", () => {
      expect(result([candidate({ kickoffAtUtc: "2026-08-03T18:01:00Z" })]).status).toBe("MATCHED");
    });

    it("18 rejects one millisecond beyond the boundary", () => {
      expect(result([candidate({ kickoffAtUtc: "2026-08-03T18:01:00.001Z" })]).status).toBe("UNRESOLVED");
    });

    it("19 leaves an outside-tolerance candidate unresolved", () => {
      const matchResult = result([candidate({ kickoffAtUtc: "2026-08-03T18:02:00Z" })]);
      expect(matchResult.status).toBe("UNRESOLVED");
      if (matchResult.status !== "INVALID_INPUT") {
        expect(matchResult.evaluations[0].classification).toBe("KICKOFF_OUTSIDE_TOLERANCE");
      }
    });

    it("20 never expands the configured tolerance", () => {
      expect(result([candidate({ kickoffAtUtc: "2026-08-03T18:00:02Z" })], source(), policy({ kickoffToleranceSeconds: 1 })).status).toBe("UNRESOLVED");
    });

    it("21 does not select the nearest kickoff when all are outside tolerance", () => {
      const matchResult = result([
        candidate({ providerEventId: "near", kickoffAtUtc: "2026-08-03T18:01:01Z" }),
        candidate({ providerEventId: "far", kickoffAtUtc: "2026-08-03T20:00:00Z" }),
      ]);
      expect(matchResult.status).toBe("UNRESOLVED");
    });

    it("22 preserves the exact temporal delta in milliseconds", () => {
      const matchResult = result([candidate({ kickoffAtUtc: "2026-08-03T18:00:00.123Z" })]);
      if (matchResult.status === "INVALID_INPUT") throw new Error("Expected a valid result");
      expect(matchResult.evaluations[0].kickoffDeltaMilliseconds).toBe(123);
    });

    it("23 treats Z and +00:00 as the same instant", () => {
      expect(result([candidate({ kickoffAtUtc: "2026-08-03T18:00:00+00:00" })], source(), policy({ kickoffToleranceSeconds: 0 })).status).toBe("MATCHED");
    });

    it("24 blocks a parseable nonzero offset", () => {
      expect(classificationOf(result([candidate({ kickoffAtUtc: "2026-08-03T20:00:00+02:00" })]))).toBe("NON_UTC_KICKOFF");
    });
  });

  describe("teams and orientation", () => {
    it("25 matches exact home/home and away/away keys", () => {
      expect(result().status).toBe("MATCHED");
    });

    it("26 reports reversed home and away as conflict", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "synthetic-away", normalizedAwayTeamKey: "synthetic-home" })]).status).toBe("CONFLICT");
    });

    it("27 never reports a reversed orientation as matched", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "synthetic-away", normalizedAwayTeamKey: "synthetic-home" })]).status).not.toBe("MATCHED");
    });

    it("28 does not select reversed orientation outside tolerance", () => {
      const matchResult = result([candidate({
        kickoffAtUtc: "2026-08-03T20:00:00Z",
        normalizedHomeTeamKey: "synthetic-away",
        normalizedAwayTeamKey: "synthetic-home",
      })]);
      expect(matchResult.status).toBe("UNRESOLVED");
    });

    it("29 does not match when only home agrees", () => {
      expect(result([candidate({ normalizedAwayTeamKey: "another-away" })]).status).toBe("UNRESOLVED");
    });

    it("30 does not match when only away agrees", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "another-home" })]).status).toBe("UNRESOLVED");
    });

    it("31 does not equate similar team keys", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "synthetic-hom" })]).status).toBe("UNRESOLVED");
    });

    it("32 does not normalize case, accents, or spaces internally", () => {
      const candidates = [
        candidate({ providerEventId: "case", normalizedHomeTeamKey: "Synthetic-Home" }),
        candidate({ providerEventId: "accent", normalizedHomeTeamKey: "sýnthetic-home" }),
        candidate({ providerEventId: "space", normalizedHomeTeamKey: "synthetic home" }),
      ];
      expect(result(candidates).status).toBe("UNRESOLVED");
    });

    it("33 preserves the candidate orientation", () => {
      const reversed = candidate({ normalizedHomeTeamKey: "synthetic-away", normalizedAwayTeamKey: "synthetic-home" });
      const matchResult = result([reversed]);
      if (matchResult.status === "INVALID_INPUT") throw new Error("Expected a valid result");
      expect(matchResult.evaluations[0].candidate).toEqual(reversed);
    });
  });

  describe("competition", () => {
    it("34 allows an exact competition", () => {
      expect(result().status).toBe("MATCHED");
    });

    it("35 blocks compatible teams and time with an incompatible competition", () => {
      expect(result([candidate({ normalizedCompetitionKey: "synthetic-second" })]).status).toBe("CONFLICT");
    });

    it("36 does not let an unrelated different-competition event block a unique match", () => {
      const matchResult = result([
        candidate({ providerEventId: "valid" }),
        candidate({
          providerEventId: "unrelated",
          normalizedCompetitionKey: "synthetic-second",
          normalizedHomeTeamKey: "unrelated-home",
          normalizedAwayTeamKey: "unrelated-away",
        }),
      ]);
      expect(matchResult.status).toBe("MATCHED");
    });

    it("37 does not accept a merely similar competition", () => {
      expect(result([candidate({ normalizedCompetitionKey: "synthetic-premier-reserve" })]).status).toBe("CONFLICT");
    });

    it("38 does not use fuzzy competition matching", () => {
      expect(result([candidate({ normalizedCompetitionKey: "synthetic premier" })]).status).toBe("CONFLICT");
    });
  });

  describe("aggregate results", () => {
    it("39 returns unresolved for zero candidates", () => {
      expect(result([]).status).toBe("UNRESOLVED");
    });

    it("40 returns unresolved for zero eligible candidates", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "elsewhere" })]).status).toBe("UNRESOLVED");
    });

    it("41 returns matched for exactly one eligible candidate", () => {
      expect(result().status).toBe("MATCHED");
    });

    it("42 returns ambiguous for two eligible candidates", () => {
      expect(result([candidate({ providerEventId: "one" }), candidate({ providerEventId: "two" })]).status).toBe("AMBIGUOUS");
    });

    it("43 returns ambiguous for three eligible candidates", () => {
      expect(result([
        candidate({ providerEventId: "one" }),
        candidate({ providerEventId: "two" }),
        candidate({ providerEventId: "three" }),
      ]).status).toBe("AMBIGUOUS");
    });

    it("44 does not choose the eligible candidate with the smaller delta", () => {
      const matchResult = result([
        candidate({ providerEventId: "near", kickoffAtUtc: "2026-08-03T18:00:01Z" }),
        candidate({ providerEventId: "far", kickoffAtUtc: "2026-08-03T18:00:59Z" }),
      ]);
      expect(matchResult.status).toBe("AMBIGUOUS");
    });

    it("45 does not choose the lexicographically smaller event ID", () => {
      expect(result([candidate({ providerEventId: "a" }), candidate({ providerEventId: "z" })]).status).toBe("AMBIGUOUS");
    });

    it("46 does not choose the first candidate", () => {
      expect(result([candidate({ providerEventId: "first" }), candidate({ providerEventId: "second" })]).status).toBe("AMBIGUOUS");
    });

    it("47 lets a reversed conflict override an otherwise valid candidate", () => {
      expect(result([
        candidate({ providerEventId: "valid" }),
        candidate({ providerEventId: "reversed", normalizedHomeTeamKey: "synthetic-away", normalizedAwayTeamKey: "synthetic-home" }),
      ]).status).toBe("CONFLICT");
    });

    it("48 lets a competition conflict override an otherwise valid candidate", () => {
      expect(result([
        candidate({ providerEventId: "valid" }),
        candidate({ providerEventId: "competition", normalizedCompetitionKey: "synthetic-second" }),
      ]).status).toBe("CONFLICT");
    });

    it("49 ignores unrelated candidates when one unique candidate is valid", () => {
      expect(result([
        candidate({ providerEventId: "unrelated", normalizedHomeTeamKey: "other-home", normalizedAwayTeamKey: "other-away" }),
        candidate({ providerEventId: "valid" }),
      ]).status).toBe("MATCHED");
    });

    it("50 returns conflicts explicitly", () => {
      const matchResult = result([candidate({ normalizedCompetitionKey: "synthetic-second" })]);
      if (matchResult.status !== "CONFLICT") throw new Error("Expected CONFLICT");
      expect(matchResult.conflicts.map((item) => item.classification)).toEqual(["COMPETITION_CONFLICT"]);
    });

    it("51 retains all eligible candidates when ambiguous", () => {
      const matchResult = result([candidate({ providerEventId: "one" }), candidate({ providerEventId: "two" })]);
      if (matchResult.status !== "AMBIGUOUS") throw new Error("Expected AMBIGUOUS");
      expect(matchResult.eligibleCandidates.map((item) => item.providerEventId)).toEqual(["one", "two"]);
    });

    it("52 retains source and matched candidate as separate identities", () => {
      const matchResult = result();
      if (matchResult.status !== "MATCHED") throw new Error("Expected MATCHED");
      expect([matchResult.source.providerKey, matchResult.matchedCandidate.providerKey]).toEqual(["provider-alpha", "provider-beta"]);
    });
  });

  describe("determinism", () => {
    const unorderedCandidates = [
      candidate({ providerKey: "provider-zeta", providerEventId: "z", normalizedHomeTeamKey: "unrelated-z" }),
      candidate({ providerKey: "provider-beta", providerEventId: "valid" }),
      candidate({ providerKey: "provider-beta", providerEventId: "a", normalizedHomeTeamKey: "unrelated-a" }),
    ];

    it("53 preserves status across candidate permutations", () => {
      expect(result(unorderedCandidates).status).toBe(result([...unorderedCandidates].reverse()).status);
    });

    it("54 preserves the matched candidate across candidate permutations", () => {
      const forward = result(unorderedCandidates);
      const reverse = result([...unorderedCandidates].reverse());
      if (forward.status !== "MATCHED" || reverse.status !== "MATCHED") throw new Error("Expected MATCHED");
      expect(forward.matchedCandidate).toEqual(reverse.matchedCandidate);
    });

    it("55 preserves final diagnostic order across permutations", () => {
      const forward = result(unorderedCandidates);
      const reverse = result([...unorderedCandidates].reverse());
      if (forward.status === "INVALID_INPUT" || reverse.status === "INVALID_INPUT") throw new Error("Expected valid results");
      expect(forward.evaluations).toEqual(reverse.evaluations);
    });

    it("56 does not mutate descriptors", () => {
      const inputSource = source();
      const inputCandidate = candidate();
      const beforeSource = { ...inputSource };
      const beforeCandidate = { ...inputCandidate };
      result([inputCandidate], inputSource);
      expect([inputSource, inputCandidate]).toEqual([beforeSource, beforeCandidate]);
    });

    it("57 preserves policyVersion", () => {
      const matchResult = result([], source(), policy({ policyVersion: "synthetic-policy-v9" }));
      if (matchResult.status === "INVALID_INPUT") throw new Error("Expected valid result");
      expect(matchResult.policyVersion).toBe("synthetic-policy-v9");
    });

    it("58 produces deeply equivalent repeated output", () => {
      expect(result(unorderedCandidates)).toEqual(result(unorderedCandidates));
    });
  });

  describe("provider-neutral identities", () => {
    it("59 does not match equal event IDs with incompatible teams", () => {
      expect(result([candidate({ providerEventId: "source-event", normalizedHomeTeamKey: "other-home" })]).status).toBe("UNRESOLVED");
    });

    it("60 does not match equal event IDs with incompatible kickoff", () => {
      expect(result([candidate({ providerEventId: "source-event", kickoffAtUtc: "2026-08-04T18:00:00Z" })]).status).toBe("UNRESOLVED");
    });

    it("61 allows different event IDs to match", () => {
      expect(result([candidate({ providerEventId: "totally-different-id" })]).status).toBe("MATCHED");
    });

    it("62 never creates a canonicalFixtureId", () => {
      expect(JSON.stringify(result())).not.toContain("canonicalFixtureId");
    });

    it("63 treats providerKey plus providerEventId as source-local identity", () => {
      const matchResult = result([candidate({ providerEventId: "source-event" })]);
      if (matchResult.status !== "MATCHED") throw new Error("Expected MATCHED");
      expect(matchResult.source.providerKey).not.toBe(matchResult.matchedCandidate.providerKey);
    });

    it("64 does not depend on concrete provider names", () => {
      const matchResult = result(
        [candidate({ providerKey: "synthetic-source-delta" })],
        source({ providerKey: "synthetic-source-gamma" }),
      );
      expect(matchResult.status).toBe("MATCHED");
    });
  });

  describe("pure domain boundaries", () => {
    it("65 never invokes globalThis.fetch", () => {
      result();
      expect(fetchCalls).toBe(0);
    });

    it("66 needs no environment-derived input", () => {
      expect(result([], source(), policy()).status).toBe("UNRESOLVED");
    });

    it("67 exposes a synchronous value without filesystem handles", () => {
      expect(result([])).not.toBeInstanceOf(Promise);
    });

    it("68 exposes no Prisma object", () => {
      expect(JSON.stringify(result()).toLowerCase()).not.toContain("prisma");
    });

    it("69 exposes no SQLite object", () => {
      expect(JSON.stringify(result()).toLowerCase()).not.toContain("sqlite");
    });

    it("70 exposes no persistence operation", () => {
      expect(outputKeys(result())).not.toEqual(expect.arrayContaining(["save", "create", "update", "delete"]));
    });

    it("71 contains no odds data", () => {
      expect(JSON.stringify(result()).toLowerCase()).not.toContain("odds");
    });

    it("72 contains no predictions", () => {
      expect(JSON.stringify(result()).toLowerCase()).not.toContain("prediction");
    });

    it("73 contains no outcomes", () => {
      expect(JSON.stringify(result()).toLowerCase()).not.toContain("outcome");
    });

    it("74 performs no fuzzy auto-selection", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "synthetic home" })]).status).toBe("UNRESOLVED");
    });

    it("75 does not inherit the existing Forebet/Statarea matcher's institutional equivalence", () => {
      expect(result([candidate({ normalizedHomeTeamKey: "synthetic-home-fc" })]).status).toBe("UNRESOLVED");
    });
  });
});
