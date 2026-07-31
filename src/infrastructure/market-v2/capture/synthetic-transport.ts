import { isAbsolute } from "node:path";
import { CaptureError } from "@/domain/market-v2/capture/errors";
import { canonicalJson, sanitizeMetadata } from "@/domain/market-v2/capture/evidence";
import type {
  CaptureTransport,
  SanitizedMetadata,
  TransportRequest,
  TransportResponse,
} from "@/domain/market-v2/capture/types";

export type SyntheticTransportFailure = Readonly<{
  code: "CAPTURE_TEMPORARY_FAILURE" | "CAPTURE_PERMANENT_FAILURE";
  retryable: boolean;
  sanitizedMessage: string;
}>;

export type SyntheticTransportRecord = Readonly<{
  capturedAtUtc: string;
  body: unknown;
  mediaType?: string;
  metadata?: Readonly<Record<string, unknown>>;
  failuresByAttempt?: Readonly<Record<number, SyntheticTransportFailure>>;
}>;

export class SyntheticCaptureTransport implements CaptureTransport {
  readonly #records: ReadonlyMap<string, SyntheticTransportRecord>;

  constructor(records: ReadonlyMap<string, SyntheticTransportRecord>) {
    this.#records = records;
  }

  async execute(request: TransportRequest): Promise<TransportResponse> {
    this.#assertReferenceAllowed(request);
    const record = this.#records.get(request.sourceReference);
    if (record === undefined) {
      throw new CaptureError({
        code: "SYNTHETIC_REFERENCE_NOT_ALLOWED",
        retryable: false,
        providerKey: request.providerKey,
        stage: request.stage,
        fixtureId: request.fixtureId,
        sanitizedMessage: "synthetic reference is not allowlisted",
      });
    }
    const failure = record.failuresByAttempt?.[request.attemptNumber];
    if (failure !== undefined) {
      throw new CaptureError({
        ...failure,
        providerKey: request.providerKey,
        stage: request.stage,
        fixtureId: request.fixtureId,
      });
    }
    const body = Buffer.from(canonicalJson(record.body), "utf8");
    const providerMetadata: SanitizedMetadata = sanitizeMetadata({
      ...record.metadata,
      capability: request.capability,
      fixtureKey: request.fixtureId ?? "SYNTH_UNIVERSE",
      statusCode: 200,
    });
    return Object.freeze({
      status: 200,
      capturedAtUtc: record.capturedAtUtc,
      mediaType: record.mediaType ?? "application/json",
      body,
      sourceReference: request.sourceReference,
      providerMetadata,
      attemptMetadata: sanitizeMetadata({ attemptNumber: request.attemptNumber, maxAttempts: 3 }),
    });
  }

  #assertReferenceAllowed(request: TransportRequest): void {
    const reference = request.sourceReference.toLowerCase();
    const forbidden =
      reference.startsWith("http://") ||
      reference.startsWith("https://") ||
      reference.startsWith("file:") ||
      reference.includes("..") ||
      reference.includes("socket") ||
      reference.includes("redirect") ||
      isAbsolute(request.sourceReference) ||
      !reference.startsWith("synth:");
    if (forbidden) {
      throw new CaptureError({
        code: "SYNTHETIC_REFERENCE_NOT_ALLOWED",
        retryable: false,
        providerKey: request.providerKey,
        stage: request.stage,
        fixtureId: request.fixtureId,
        sanitizedMessage: "only allowlisted synthetic references are accepted",
      });
    }
  }
}
