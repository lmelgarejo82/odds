import type {
  ExternalProviderFixtureIdentity,
  PredictionSnapshot,
} from "../capture/types";

export type PredictionAppendResult =
  | Readonly<{ disposition: "CREATED"; snapshot: PredictionSnapshot }>
  | Readonly<{ disposition: "REPLAYED"; snapshot: PredictionSnapshot }>
  | Readonly<{
      disposition: "CONFLICT";
      existingSnapshot: PredictionSnapshot;
      attemptedSnapshot: PredictionSnapshot;
    }>;

export type PrematchPredictionLookup = ExternalProviderFixtureIdentity &
  Readonly<{ kickoffAtUtc: string }>;

export interface PredictionRepository {
  // Append never replaces a frozen snapshot; a later capturedAtUtc is another capture.
  append(snapshot: PredictionSnapshot): Promise<PredictionAppendResult>;
  listByExternalFixture(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<readonly PredictionSnapshot[]>;
  findLatestCapturedBeforeKickoff(
    lookup: PrematchPredictionLookup,
  ): Promise<PredictionSnapshot | null>;
}
