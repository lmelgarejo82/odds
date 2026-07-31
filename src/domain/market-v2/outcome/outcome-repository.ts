export type OutcomeRecord = Readonly<{
  id: string;
  fixtureId: string;
  observedAtUtc: string;
  homeScore: number;
  awayScore: number;
  result1X2: "HOME" | "DRAW" | "AWAY";
  status: "PROVISIONAL" | "CONFIRMED" | "CORRECTED" | "VOID";
  supersedesOutcomeId?: string;
  contentHash: string;
}>;

export interface OutcomeRepository {
  append(outcome: OutcomeRecord): Promise<void>;
  listVersions(fixtureId: string): Promise<readonly OutcomeRecord[]>;
}
