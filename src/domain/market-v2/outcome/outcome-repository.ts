export type OutcomeResult1X2 = "HOME" | "DRAW" | "AWAY";
export type OutcomeShootoutWinner = "HOME" | "AWAY";

export type ProviderOutcomeResolution = Readonly<{
  providerFixtureId: string;
  capturedAtUtc: string;
  providerTerminalStatusRaw: string;
  result1X2Scope: "REGULATION_TIME";
  result1X2: OutcomeResult1X2;
  regulationHomeScore: number;
  regulationAwayScore: number;
  extraTimeHomeScore: number | null;
  extraTimeAwayScore: number | null;
  penaltyHomeScore: number | null;
  penaltyAwayScore: number | null;
  shootoutWinner: OutcomeShootoutWinner | null;
  goalsHomeScore: number | null;
  goalsAwayScore: number | null;
}>;

export type OutcomeRecord = Readonly<{
  id: string;
  fixtureId: string;
  observedAtUtc: string;
  homeScore: number;
  awayScore: number;
  result1X2: OutcomeResult1X2;
  providerTerminalStatusRaw?: string | null;
  result1X2Scope?: "REGULATION_TIME" | null;
  regulationHomeScore?: number | null;
  regulationAwayScore?: number | null;
  extraTimeHomeScore?: number | null;
  extraTimeAwayScore?: number | null;
  penaltyHomeScore?: number | null;
  penaltyAwayScore?: number | null;
  shootoutWinner?: OutcomeShootoutWinner | null;
  status: "PROVISIONAL" | "CONFIRMED" | "CORRECTED" | "VOID";
  supersedesOutcomeId?: string;
  contentHash: string;
}>;

export interface OutcomeRepository {
  append(outcome: OutcomeRecord): Promise<void>;
  listVersions(fixtureId: string): Promise<readonly OutcomeRecord[]>;
}
