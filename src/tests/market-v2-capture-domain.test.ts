import { mkdtemp, mkdir, readdir, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { assertProviderCapabilities } from "@/application/market-v2/capture/capture-provider";
import { buildIdempotencyKey } from "@/application/market-v2/capture/idempotency";
import { BlockingRateLimitPolicy } from "@/application/market-v2/capture/rate-limit-policy";
import { FixedCaptureClock } from "@/application/market-v2/capture/capture-run";
import { RetryPolicy } from "@/application/market-v2/capture/retry-policy";
import { CaptureError } from "@/domain/market-v2/capture/errors";
import { ObservationDeduplicator } from "@/domain/market-v2/capture/deduplication";
import { sha256Bytes } from "@/domain/market-v2/capture/evidence";
import type { RawCaptureEvidence, TransportRequest } from "@/domain/market-v2/capture/types";
import { AppendOnlyEvidenceStore } from "@/infrastructure/market-v2/capture/evidence-store";
import {
  SyntheticForebetProvider,
  SyntheticOddsProvider,
  SyntheticOutcomeProvider,
  createSyntheticTransport,
} from "@/infrastructure/market-v2/capture/synthetic-provider";
import { SyntheticCaptureTransport } from "@/infrastructure/market-v2/capture/synthetic-transport";

const request: TransportRequest = Object.freeze({
  providerKey: "SYNTH_TEST_PROVIDER",
  stage: "PREMATCH",
  capability: "FIXTURES",
  sourceReference: "synth:allowed",
  attemptNumber: 1,
});

function evidence(evidenceId: string, body: Uint8Array): RawCaptureEvidence {
  return Object.freeze({
    evidenceId,
    providerKey: "SYNTH_TEST_PROVIDER",
    providerVersion: "synthetic-test/1.0",
    stage: "PREMATCH",
    sourceReference: `synth:evidence:${evidenceId.toLowerCase()}`,
    capturedAtUtc: "2030-02-01T10:00:00.000Z",
    mediaType: "application/json",
    byteSize: body.byteLength,
    sha256: sha256Bytes(body),
    contentEncoding: "identity",
    correlationId: "SYNTH_CORRELATION_TEST",
    attemptNumber: 1,
    synthetic: true,
    metadata: Object.freeze({ scenario: "test" }),
  });
}

describe("capture provider capability declarations", () => {
  it.each([
    () => new SyntheticForebetProvider(createSyntheticTransport()),
    () => new SyntheticOddsProvider(createSyntheticTransport()),
    () => new SyntheticOutcomeProvider(createSyntheticTransport()),
  ])("accepts explicit capabilities that match implemented methods", (factory) => {
    expect(() => assertProviderCapabilities(factory(), "PREMATCH")).not.toThrow();
  });

  it("rejects a declared capability without an implementation", () => {
    expect(() =>
      assertProviderCapabilities(
        {
          providerKey: "SYNTH_INVALID",
          providerVersion: "1",
          capabilities: ["FOREBET"],
        },
        "PREMATCH",
      ),
    ).toThrowError(CaptureError);
  });

  it("rejects a silently implemented but undeclared capability", () => {
    expect(() =>
      assertProviderCapabilities(
        {
          providerKey: "SYNTH_INVALID",
          providerVersion: "1",
          capabilities: [],
          async discoverFixtures() {
            throw new Error("not called");
          },
        },
        "PREMATCH",
      ),
    ).toThrowError(CaptureError);
  });
});

describe("synthetic transport boundary", () => {
  it.each([
    "http://invalid.example/capture",
    "https://invalid.example/capture",
    "../outside.json",
    "/tmp/outside.json",
    "synth:socket:outside",
    "synth:redirect:outside",
  ])("rejects forbidden reference %s", async (sourceReference) => {
    const transport = new SyntheticCaptureTransport(new Map());
    await expect(transport.execute({ ...request, sourceReference })).rejects.toMatchObject({
      code: "SYNTHETIC_REFERENCE_NOT_ALLOWED",
      retryable: false,
    });
  });

  it("returns only an allowlisted synthetic record", async () => {
    const transport = new SyntheticCaptureTransport(
      new Map([
        [
          "synth:allowed",
          {
            capturedAtUtc: "2030-02-01T10:00:00.000Z",
            body: { synthetic: true },
            metadata: { scenario: "allowed", authorization: "discard-me" },
          },
        ],
      ]),
    );
    const response = await transport.execute(request);
    expect(response.status).toBe(200);
    expect(response.sourceReference).toBe("synth:allowed");
    expect(response.providerMetadata).toEqual(
      expect.objectContaining({ scenario: "allowed", capability: "FIXTURES" }),
    );
    expect(response.providerMetadata).not.toHaveProperty("authorization");
  });
});

describe("append-only evidence store", () => {
  let temporaryRoot: string;
  let store: AppendOnlyEvidenceStore;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(join(tmpdir(), "ou25-evidence-test-"));
    const storeRoot = join(temporaryRoot, "evidence");
    await mkdir(storeRoot);
    store = new AppendOnlyEvidenceStore(storeRoot);
    await store.initialize();
  });

  afterEach(async () => {
    await rm(temporaryRoot, { recursive: true, force: true });
  });

  it("computes and verifies the evidence hash", async () => {
    const body = Buffer.from("synthetic-evidence", "utf8");
    const published = await store.publish(evidence("SYNTH_EVIDENCE_HASH", body), body);
    const readBack = await store.read(published.evidence.evidenceId);
    expect(readBack.evidence.sha256).toBe(sha256Bytes(body));
    expect(readBack.body).toEqual(body);
  });

  it("publishes new evidence append-only", async () => {
    const body = Buffer.from("synthetic-new", "utf8");
    await expect(store.publish(evidence("SYNTH_EVIDENCE_NEW", body), body)).resolves.toMatchObject({
      disposition: "PUBLISHED",
    });
  });

  it("treats the same evidence ID and content as a replay", async () => {
    const body = Buffer.from("synthetic-replay", "utf8");
    const item = evidence("SYNTH_EVIDENCE_REPLAY", body);
    await store.publish(item, body);
    await expect(store.publish(item, body)).resolves.toMatchObject({ disposition: "REPLAY" });
  });

  it("reuses identical content by hash for a distinct evidence ID", async () => {
    const body = Buffer.from("synthetic-shared-content", "utf8");
    await store.publish(evidence("SYNTH_EVIDENCE_SHARED_A", body), body);
    await expect(
      store.publish(evidence("SYNTH_EVIDENCE_SHARED_B", body), body),
    ).resolves.toMatchObject({ disposition: "REUSED_BY_HASH" });
  });

  it("rejects a conflicting evidence ID instead of overwriting", async () => {
    const original = Buffer.from("synthetic-original", "utf8");
    const conflict = Buffer.from("synthetic-conflict", "utf8");
    await store.publish(evidence("SYNTH_EVIDENCE_CONFLICT", original), original);
    await expect(
      store.publish(evidence("SYNTH_EVIDENCE_CONFLICT", conflict), conflict),
    ).rejects.toMatchObject({ code: "CAPTURE_EVIDENCE_CONFLICT" });
    expect((await store.read("SYNTH_EVIDENCE_CONFLICT")).body).toEqual(original);
  });

  it("cleans staging after publishing", async () => {
    const body = Buffer.from("synthetic-staging", "utf8");
    await store.publish(evidence("SYNTH_EVIDENCE_STAGING", body), body);
    expect(await readdir(join(store.root, ".staging"))).toEqual([]);
  });

  it("rejects a symlink evidence root", async () => {
    const actual = join(temporaryRoot, "actual");
    const linked = join(temporaryRoot, "linked");
    await mkdir(actual);
    await symlink(actual, linked);
    await expect(new AppendOnlyEvidenceStore(linked).initialize()).rejects.toThrow(/symlink/);
  });
});

describe("idempotency, deduplication, retry, and rate limits", () => {
  const identity = Object.freeze({
    protocolVersion: "prospective-r0/1.0",
    stage: "PREMATCH" as const,
    providerKey: "SYNTH_PROVIDER",
    providerVersion: "1",
    sourceFixtureId: "SYNTH_FIXTURE_A",
    marketKey: "DOUBLE_CHANCE" as const,
    selectionKey: "HOME_OR_DRAW" as const,
    capturedAtUtc: "2030-02-01T17:00:00.000Z",
    contentHash: "a".repeat(64),
  });

  it("builds a deterministic idempotency key", () => {
    expect(buildIdempotencyKey(identity)).toBe(buildIdempotencyKey({ ...identity }));
  });

  it("does not collapse a legitimate later snapshot", () => {
    expect(buildIdempotencyKey(identity)).not.toBe(
      buildIdempotencyKey({ ...identity, capturedAtUtc: "2030-02-01T17:01:00.000Z" }),
    );
  });

  it("distinguishes exact duplicate, replay, conflict, and new observation", () => {
    const deduplicator = new ObservationDeduplicator();
    const base = {
      kind: "ODDS" as const,
      recordId: "SYNTH_ODDS_A",
      logicalIdentity: { fixture: "SYNTH_FIXTURE_A", capturedAtUtc: identity.capturedAtUtc },
      contentHash: identity.contentHash,
      evidenceAlreadyPublished: false,
    };
    expect(deduplicator.classify(base)).toBe("NEW");
    expect(deduplicator.classify(base)).toBe("EXACT_DUPLICATE");
    expect(deduplicator.classify({ ...base, evidenceAlreadyPublished: true })).toBe("REPLAY");
    expect(deduplicator.classify({ ...base, contentHash: "b".repeat(64) })).toBe("CONFLICT");
  });

  it("keeps a later snapshot as a new observation", () => {
    const deduplicator = new ObservationDeduplicator();
    const first = {
      kind: "FOREBET" as const,
      recordId: "SYNTH_FOREBET_A_1",
      logicalIdentity: {
        fixture: "SYNTH_FIXTURE_A",
        capturedAtUtc: "2030-02-01T12:00:00.000Z",
      },
      contentHash: "a".repeat(64),
      evidenceAlreadyPublished: false,
    };
    expect(deduplicator.classify(first)).toBe("NEW");
    expect(
      deduplicator.classify({
        ...first,
        recordId: "SYNTH_FOREBET_A_2",
        logicalIdentity: {
          fixture: "SYNTH_FIXTURE_A",
          capturedAtUtc: "2030-02-01T12:05:00.000Z",
        },
      }),
    ).toBe("NEW");
  });

  it("uses deterministic bounded backoff with explicit jitter seed", () => {
    const policy = new RetryPolicy({
      maxAttempts: 3,
      baseDelayMilliseconds: 100,
      maximumDelayMilliseconds: 250,
      jitterMilliseconds: 10,
      jitterSeed: "SYNTH_SEED",
    });
    expect(policy.delayForAttempt(1)).toBe(policy.delayForAttempt(1));
    expect(policy.delayForAttempt(3)).toBeLessThanOrEqual(250);
  });

  it("retries only explicitly retryable errors", () => {
    const policy = new RetryPolicy({
      maxAttempts: 3,
      baseDelayMilliseconds: 100,
      maximumDelayMilliseconds: 500,
    });
    const retryable = new CaptureError({
      code: "CAPTURE_TEMPORARY_FAILURE",
      retryable: true,
      providerKey: "SYNTH_PROVIDER",
      stage: "PREMATCH",
      sanitizedMessage: "temporary",
    });
    const permanent = new CaptureError({
      code: "CAPTURE_PERMANENT_FAILURE",
      retryable: false,
      providerKey: "SYNTH_PROVIDER",
      stage: "PREMATCH",
      sanitizedMessage: "permanent",
    });
    expect(policy.shouldRetry(retryable, 1)).toBe(true);
    expect(policy.shouldRetry(retryable, 3)).toBe(false);
    expect(policy.shouldRetry(permanent, 1)).toBe(false);
  });

  it("returns an explicit blocked rate-limit decision", () => {
    const result = new BlockingRateLimitPolicy(750).acquire(
      "SYNTH_PROVIDER",
      "ODDS",
      new FixedCaptureClock("2030-02-01T12:00:00.000Z"),
    );
    expect(result).toEqual({
      allowed: false,
      recommendedDelayMilliseconds: 750,
      reasonCode: "SYNTHETIC_RATE_LIMIT_BLOCKED",
    });
  });
});
