import { canonicalJson, sha256Bytes } from "@/domain/market-v2/capture/evidence";
import type { MarketKey, SelectionKey } from "@/domain/market-v2/capture/types";
import type { CaptureStage } from "@/domain/market-v2/capture/stages";

export type IdempotencyIdentity = Readonly<{
  protocolVersion: string;
  stage: CaptureStage;
  providerKey: string;
  providerVersion: string;
  sourceFixtureId: string;
  marketKey?: MarketKey;
  selectionKey?: SelectionKey;
  capturedAtUtc: string;
  contentHash: string;
}>;

export function buildIdempotencyKey(identity: IdempotencyIdentity): string {
  return sha256Bytes(canonicalJson(identity));
}
