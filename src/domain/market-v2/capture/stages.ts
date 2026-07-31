export const CAPTURE_STAGES = ["PREMATCH", "CLOSING", "OUTCOME", "SYNTHETIC_FULL"] as const;

export type CaptureStage = (typeof CAPTURE_STAGES)[number];

export const PROVIDER_CAPABILITIES = [
  "FIXTURES",
  "FOREBET",
  "ODDS",
  "CLOSING",
  "OUTCOMES",
] as const;

export type ProviderCapability = (typeof PROVIDER_CAPABILITIES)[number];

export function capabilitiesForStage(stage: CaptureStage): readonly ProviderCapability[] {
  switch (stage) {
    case "PREMATCH":
      return ["FIXTURES", "FOREBET", "ODDS"];
    case "CLOSING":
      return ["FIXTURES", "CLOSING"];
    case "OUTCOME":
      return ["OUTCOMES"];
    case "SYNTHETIC_FULL":
      return PROVIDER_CAPABILITIES;
  }
}
