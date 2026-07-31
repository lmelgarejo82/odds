import { canonicalJson, sha256Bytes } from "./evidence";

export type DeduplicationDisposition = "NEW" | "EXACT_DUPLICATE" | "REPLAY" | "CONFLICT";

export type DeduplicationInput = Readonly<{
  kind: "FIXTURE" | "FOREBET" | "ODDS" | "CLOSING" | "OUTCOME";
  recordId: string;
  logicalIdentity: Readonly<Record<string, unknown>>;
  contentHash: string;
  evidenceAlreadyPublished: boolean;
}>;

export class ObservationDeduplicator {
  readonly #recordHashes = new Map<string, string>();
  readonly #logicalHashes = new Map<string, string>();

  classify(input: DeduplicationInput): DeduplicationDisposition {
    const recordKey = `${input.kind}:${input.recordId}`;
    const knownRecordHash = this.#recordHashes.get(recordKey);
    if (knownRecordHash !== undefined) {
      return knownRecordHash === input.contentHash
        ? input.evidenceAlreadyPublished
          ? "REPLAY"
          : "EXACT_DUPLICATE"
        : "CONFLICT";
    }

    const logicalKey = `${input.kind}:${sha256Bytes(canonicalJson(input.logicalIdentity))}`;
    const knownLogicalHash = this.#logicalHashes.get(logicalKey);
    if (knownLogicalHash !== undefined) {
      return knownLogicalHash === input.contentHash ? "EXACT_DUPLICATE" : "CONFLICT";
    }

    this.#recordHashes.set(recordKey, input.contentHash);
    this.#logicalHashes.set(logicalKey, input.contentHash);
    return "NEW";
  }
}
