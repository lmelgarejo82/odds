import type {
  DecisionFixture,
  DecisionForebetSnapshot,
  DecisionMarketProbabilitySnapshot,
  DecisionOddsSnapshot,
} from "./types";

export interface DecisionInputRepository {
  getFixture(fixtureId: string): Promise<DecisionFixture | null>;
  listForebetSnapshots(fixtureId: string): Promise<readonly DecisionForebetSnapshot[]>;
  listOddsSnapshots(fixtureId: string): Promise<readonly DecisionOddsSnapshot[]>;
  listMarketProbabilitySnapshots(
    fixtureId: string,
  ): Promise<readonly DecisionMarketProbabilitySnapshot[]>;
}
