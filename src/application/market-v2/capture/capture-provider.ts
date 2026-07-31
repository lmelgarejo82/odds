import { CaptureError } from "@/domain/market-v2/capture/errors";
import type {
  CaptureRunContext,
  ClosingObservation,
  ForebetObservation,
  OddsObservation,
  OutcomeObservation,
  ProviderCapture,
  SyntheticFixture,
} from "@/domain/market-v2/capture/types";
import type { ProviderCapability } from "@/domain/market-v2/capture/stages";

export type EvidenceDraft<T extends { source_artifact_reference: string; content_hash: string }> =
  Omit<T, "source_artifact_reference" | "content_hash">;

export interface CaptureProvider {
  readonly providerKey: string;
  readonly providerVersion: string;
  readonly capabilities: readonly ProviderCapability[];
  discoverFixtures?(
    context: CaptureRunContext,
  ): Promise<ProviderCapture<readonly EvidenceDraft<SyntheticFixture>[]>>;
  captureForebet?(
    context: CaptureRunContext,
    fixture: SyntheticFixture,
  ): Promise<ProviderCapture<EvidenceDraft<ForebetObservation>>>;
  captureOdds?(
    context: CaptureRunContext,
    fixture: SyntheticFixture,
  ): Promise<ProviderCapture<EvidenceDraft<OddsObservation>>>;
  captureClosing?(
    context: CaptureRunContext,
    fixture: SyntheticFixture,
  ): Promise<ProviderCapture<EvidenceDraft<ClosingObservation>>>;
  captureOutcomes?(
    context: CaptureRunContext,
    fixture: SyntheticFixture,
  ): Promise<ProviderCapture<readonly EvidenceDraft<OutcomeObservation>[]>>;
}

const CAPABILITY_METHODS = {
  FIXTURES: "discoverFixtures",
  FOREBET: "captureForebet",
  ODDS: "captureOdds",
  CLOSING: "captureClosing",
  OUTCOMES: "captureOutcomes",
} as const satisfies Record<ProviderCapability, keyof CaptureProvider>;

export function assertProviderCapabilities(
  provider: CaptureProvider,
  stage: CaptureRunContext["stage"],
): void {
  const declared = new Set(provider.capabilities);
  if (declared.size !== provider.capabilities.length) {
    throw new CaptureError({
      code: "PROVIDER_CAPABILITY_UNAVAILABLE",
      retryable: false,
      providerKey: provider.providerKey,
      stage,
      sanitizedMessage: "provider capabilities must be unique",
    });
  }
  for (const [capability, method] of Object.entries(CAPABILITY_METHODS) as [
    ProviderCapability,
    (typeof CAPABILITY_METHODS)[ProviderCapability],
  ][]) {
    const implemented = typeof provider[method] === "function";
    if (declared.has(capability) !== implemented) {
      throw new CaptureError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        retryable: false,
        providerKey: provider.providerKey,
        stage,
        sanitizedMessage: `capability ${capability} must match its implementation`,
      });
    }
  }
}

export function requireProviderCapability(
  provider: CaptureProvider,
  capability: ProviderCapability,
  context: CaptureRunContext,
): void {
  if (!provider.capabilities.includes(capability)) {
    throw new CaptureError({
      code: "PROVIDER_CAPABILITY_UNAVAILABLE",
      retryable: false,
      providerKey: provider.providerKey,
      stage: context.stage,
      sanitizedMessage: `provider does not declare ${capability}`,
    });
  }
}
