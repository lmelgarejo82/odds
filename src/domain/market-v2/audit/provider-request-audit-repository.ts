export const PROVIDER_REQUEST_CLASSIFICATIONS = [
  "SUCCESS",
  "PERMANENT_FAILURE",
  "RETRYABLE_FAILURE",
  "RATE_LIMITED",
  "QUOTA_EXHAUSTED",
  "INVALID_RESPONSE",
] as const;

export type ProviderRequestClassification =
  (typeof PROVIDER_REQUEST_CLASSIFICATIONS)[number];

export type ProviderRequestAuditRecord = Readonly<{
  providerKey: string;
  importBatchId?: string | null;
  endpointKey: string;
  requestKeyHash: string;
  correlationId: string;
  attemptNumber: number;
  startedAtUtc: string;
  finishedAtUtc?: string | null;
  httpStatus?: number | null;
  classification: ProviderRequestClassification;
  sanitizedErrorCode?: string | null;
  dailyLimit?: number | null;
  dailyRemaining?: number | null;
  minuteLimit?: number | null;
  minuteRemaining?: number | null;
}>;

export type ProviderRequestAuditAppendResult =
  | Readonly<{ ok: true; disposition: "CREATED" | "REPLAYED" }>
  | Readonly<{
      ok: false;
      disposition: "CONFLICT" | "FAILED";
      error: Readonly<{
        classification: "CONFLICT" | "FAILED";
        retryable: false;
        sanitizedCode: string;
      }>;
    }>;

export interface ProviderRequestAuditRepository {
  append(record: ProviderRequestAuditRecord): Promise<ProviderRequestAuditAppendResult>;
}
