import { createHash } from "node:crypto";
import type {
  RawCaptureEvidence,
  SanitizedMetadata,
  SanitizedMetadataValue,
  TransportResponse,
} from "./types";
import type { CaptureRunContext } from "./types";

const ALLOWED_METADATA_KEYS = new Set([
  "capability",
  "fixtureKey",
  "scenario",
  "statusCode",
  "attemptNumber",
  "maxAttempts",
]);

export function sha256Bytes(value: Uint8Array | string): string {
  return createHash("sha256").update(value).digest("hex");
}

export function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sanitizeMetadata(metadata: Readonly<Record<string, unknown>>): SanitizedMetadata {
  const sanitized: Record<string, SanitizedMetadataValue> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
      sanitized[key] = value;
    }
  }
  return Object.freeze(sanitized);
}

export function createRawEvidence(
  context: CaptureRunContext,
  response: TransportResponse,
): RawCaptureEvidence {
  const sha256 = sha256Bytes(response.body);
  const identity = canonicalJson({
    providerKey: context.providerKey,
    providerVersion: context.providerVersion,
    sourceReference: response.sourceReference,
    capturedAtUtc: response.capturedAtUtc,
  });
  return Object.freeze({
    evidenceId: `SYNTH_EVIDENCE_${sha256Bytes(identity).slice(0, 24).toUpperCase()}`,
    providerKey: context.providerKey,
    providerVersion: context.providerVersion,
    stage: context.stage,
    sourceReference: response.sourceReference,
    capturedAtUtc: response.capturedAtUtc,
    mediaType: response.mediaType,
    byteSize: response.body.byteLength,
    sha256,
    contentEncoding: "identity",
    correlationId: context.correlationId,
    attemptNumber: context.attemptNumber,
    synthetic: context.synthetic,
    metadata: sanitizeMetadata({ ...response.providerMetadata, ...response.attemptMetadata }),
  });
}
