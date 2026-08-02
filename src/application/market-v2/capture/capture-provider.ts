import { CaptureError } from "@/domain/market-v2/capture/errors";
import type {
  CapturedFixture,
  CaptureRunContext,
  ClosingObservation,
  ForebetObservation,
  OddsObservation,
  OutcomeObservation,
  PredictionSnapshot,
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
  discoverCapturedFixtures?(
    context: CaptureRunContext,
  ): Promise<ProviderCapture<readonly CapturedFixture[]>>;
  captureForebet?(
    context: CaptureRunContext,
    fixture: SyntheticFixture,
  ): Promise<ProviderCapture<EvidenceDraft<ForebetObservation>>>;
  capturePredictions?(
    context: CaptureRunContext,
    fixture: CapturedFixture,
  ): Promise<ProviderCapture<PredictionSnapshot>>;
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
  FOREBET: "captureForebet",
  PREDICTIONS: "capturePredictions",
  ODDS: "captureOdds",
  CLOSING: "captureClosing",
  OUTCOMES: "captureOutcomes",
} as const satisfies Record<Exclude<ProviderCapability, "FIXTURES">, keyof CaptureProvider>;

function capabilityImplementationCount(
  provider: CaptureProvider,
  capability: ProviderCapability,
): number {
  if (capability === "FIXTURES") {
    return [provider.discoverFixtures, provider.discoverCapturedFixtures].filter(
      (method) => typeof method === "function",
    ).length;
  }
  return typeof provider[CAPABILITY_METHODS[capability]] === "function" ? 1 : 0;
}

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
  for (const capability of ["FIXTURES", ...Object.keys(CAPABILITY_METHODS)] as ProviderCapability[]) {
    const implementationCount = capabilityImplementationCount(provider, capability);
    if (capability === "FIXTURES" && implementationCount > 1) {
      throw new CaptureError({
        code: "PROVIDER_CAPABILITY_UNAVAILABLE",
        retryable: false,
        providerKey: provider.providerKey,
        stage,
        sanitizedMessage: "provider must expose only one fixture discovery contract",
      });
    }
    const implemented = implementationCount === 1;
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
