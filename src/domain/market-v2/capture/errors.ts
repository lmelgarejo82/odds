import type { CaptureStage } from "./stages";

export const CAPTURE_ERROR_CODES = [
  "PROVIDER_CAPABILITY_UNAVAILABLE",
  "SYNTHETIC_REFERENCE_NOT_ALLOWED",
  "CAPTURE_TEMPORARY_FAILURE",
  "CAPTURE_PERMANENT_FAILURE",
  "CAPTURE_CONTENT_INVALID",
  "CAPTURE_EVIDENCE_CONFLICT",
  "CAPTURE_RATE_LIMITED",
  "CAPTURE_RETRY_EXHAUSTED",
  "EXTERNAL_FIXTURE_IDENTITY_INVALID",
  "FIXTURE_IDENTITY_CONFLICT",
  "PROVIDER_STATUS_BLOCKED",
  "PREDICTION_SNAPSHOT_INCOMPLETE",
  "PACKET_ASSEMBLY_BLOCKED",
] as const;

export type CaptureErrorCode = (typeof CAPTURE_ERROR_CODES)[number];

export type CaptureErrorDetails = Readonly<{
  code: CaptureErrorCode;
  retryable: boolean;
  providerKey: string;
  stage: CaptureStage;
  fixtureId?: string;
  sanitizedMessage: string;
}>;

export class CaptureError extends Error {
  readonly code: CaptureErrorCode;
  readonly retryable: boolean;
  readonly providerKey: string;
  readonly stage: CaptureStage;
  readonly fixtureId?: string;
  readonly sanitizedMessage: string;

  constructor(details: CaptureErrorDetails) {
    super(details.sanitizedMessage);
    this.name = "CaptureError";
    this.code = details.code;
    this.retryable = details.retryable;
    this.providerKey = details.providerKey;
    this.stage = details.stage;
    this.fixtureId = details.fixtureId;
    this.sanitizedMessage = details.sanitizedMessage;
  }

  toJSON(): CaptureErrorDetails {
    return Object.freeze({
      code: this.code,
      retryable: this.retryable,
      providerKey: this.providerKey,
      stage: this.stage,
      ...(this.fixtureId === undefined ? {} : { fixtureId: this.fixtureId }),
      sanitizedMessage: this.sanitizedMessage,
    });
  }
}

export function asCaptureError(
  error: unknown,
  fallback: Omit<CaptureErrorDetails, "sanitizedMessage"> & { sanitizedMessage?: string },
): CaptureError {
  if (error instanceof CaptureError) return error;
  return new CaptureError({
    ...fallback,
    sanitizedMessage: fallback.sanitizedMessage ?? "capture operation failed",
  });
}
