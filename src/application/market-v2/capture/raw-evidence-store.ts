export type RawEvidenceEndpointKey =
  | "fixtures-by-date"
  | "fixtures-by-competition-window"
  | "prediction-by-fixture"
  | "fixture-result-by-id"
  | "odds-upcoming"
  | "odds-by-sport";

export type RawEvidenceCandidate = Readonly<{
  providerKey: "api-football" | "the-odds-api";
  endpointKey: RawEvidenceEndpointKey;
  capturedAtUtc: string;
  mediaType: string;
  bytes: Readonly<Uint8Array>;
  sourceReference: string;
}>;

export type RawEvidenceDescriptor = Readonly<{
  providerKey: "api-football" | "the-odds-api";
  endpointKey: RawEvidenceEndpointKey;
  capturedAtUtc: string;
  mediaType: string;
  contentHash: string;
  byteLength: number;
  storageReference: string;
  sourceReference: string;
}>;

export type RawEvidenceStoreError = Readonly<{
  classification: "CONFLICT" | "FAILED";
  retryable: false;
  sanitizedCode: string;
}>;

export type RawEvidenceStoreResult =
  | Readonly<{
      ok: true;
      disposition: "CREATED" | "REPLAYED";
      descriptor: RawEvidenceDescriptor;
    }>
  | Readonly<{
      ok: false;
      disposition: "CONFLICT" | "FAILED";
      error: RawEvidenceStoreError;
    }>;

export interface RawEvidenceStore {
  publish(candidate: RawEvidenceCandidate): Promise<RawEvidenceStoreResult>;
}
