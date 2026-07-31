export type DecisionFixture = Readonly<{
  id: string;
  competitionKey: string;
  kickoffAtUtc: string;
  status: string;
}>;

export type DecisionForebetSnapshot = Readonly<{
  id: string;
  fixtureId: string;
  capturedAtUtc: string;
  homeProbability: string;
  drawProbability: string;
  awayProbability: string;
  contentHash: string;
}>;

export type DecisionOddsSnapshot = Readonly<{
  id: string;
  fixtureId: string;
  capturedAtUtc: string;
  decimalOdds: string;
  marketStatus: string;
  isInPlay: boolean;
  contentHash: string;
}>;

export type DecisionMarketProbabilitySnapshot = Readonly<{
  id: string;
  fixtureId: string;
  probability: string;
  calculatedAtUtc: string;
  version: string;
  inputSetHash: string;
}>;

export type PreMatchDecisionRecord = Readonly<{
  id: string;
  fixtureId: string;
  decidedAtUtc: string;
  status: "SELECTED" | "ABSTAINED" | "UNRESOLVED" | "BLOCKED";
  reasonCode: string;
  policyVersion: string;
  inputHash: string;
  selectedOddsSnapshotId?: string;
}>;
