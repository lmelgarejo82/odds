import type {
  CapturedFixture,
  ExternalProviderFixtureIdentity,
} from "../capture/types";

export type FixturePublicationResult =
  | Readonly<{ disposition: "CREATED"; fixture: CapturedFixture }>
  | Readonly<{ disposition: "REPLAYED"; fixture: CapturedFixture }>
  | Readonly<{
      disposition: "CONFLICT";
      existingFixture: CapturedFixture;
      attemptedFixture: CapturedFixture;
    }>;

export type ExternalFixtureIdentityResolution =
  | Readonly<{ status: "KNOWN"; fixture: CapturedFixture }>
  | Readonly<{ status: "UNKNOWN" }>;

export interface FixtureRepository {
  publish(fixture: CapturedFixture): Promise<FixturePublicationResult>;
  resolveExternalIdentity(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<ExternalFixtureIdentityResolution>;
  findByExternalIdentity(
    identity: ExternalProviderFixtureIdentity,
  ): Promise<CapturedFixture | null>;
}
