import {
  access,
  link,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { CaptureError } from "@/domain/market-v2/capture/errors";
import { canonicalize, sha256Bytes } from "@/domain/market-v2/capture/evidence";
import type { RawCaptureEvidence } from "@/domain/market-v2/capture/types";

export type EvidencePublishDisposition = "PUBLISHED" | "REUSED_BY_HASH" | "REPLAY";

export type EvidencePublishResult = Readonly<{
  disposition: EvidencePublishDisposition;
  evidence: RawCaptureEvidence;
}>;

type EvidenceRecord = Readonly<{
  evidence: RawCaptureEvidence;
  payloadFile: string;
}>;

function isMissing(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isMissing(error)) return false;
    throw error;
  }
}

function safeIdentifier(value: string): string {
  if (!/^[A-Z0-9_-]+$/i.test(value)) throw new Error("unsafe evidence identifier");
  return value;
}

export class AppendOnlyEvidenceStore {
  readonly root: string;
  readonly #payloadRoot: string;
  readonly #recordRoot: string;
  readonly #stagingRoot: string;
  #initialized = false;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error("evidence root must be absolute");
    this.root = resolve(root);
    this.#payloadRoot = resolve(this.root, "payloads");
    this.#recordRoot = resolve(this.root, "records");
    this.#stagingRoot = resolve(this.root, ".staging");
  }

  async initialize(): Promise<void> {
    const rootStat = await lstat(this.root);
    if (rootStat.isSymbolicLink()) throw new Error("evidence root must not be a symlink");
    const actualRoot = await realpath(this.root);
    const actualTemporaryRoot = await realpath(tmpdir());
    const fromTemporary = relative(actualTemporaryRoot, actualRoot);
    if (fromTemporary.startsWith("..") || isAbsolute(fromTemporary)) {
      throw new Error("evidence root must remain below the system temporary root");
    }
    await mkdir(this.#payloadRoot, { recursive: false });
    await mkdir(this.#recordRoot, { recursive: false });
    await mkdir(this.#stagingRoot, { recursive: false });
    this.#initialized = true;
  }

  async publish(
    evidence: RawCaptureEvidence,
    payload: Uint8Array,
  ): Promise<EvidencePublishResult> {
    this.#assertInitialized();
    if (!evidence.synthetic) throw new Error("only synthetic evidence is accepted");
    if (payload.byteLength !== evidence.byteSize || sha256Bytes(payload) !== evidence.sha256) {
      throw new Error("evidence payload does not match declared size and hash");
    }
    const evidenceId = safeIdentifier(evidence.evidenceId);
    const recordPath = resolve(this.#recordRoot, `${evidenceId}.json`);
    if (await exists(recordPath)) {
      const previous = await this.#readRecord(recordPath);
      if (previous.evidence.sha256 !== evidence.sha256) {
        throw new CaptureError({
          code: "CAPTURE_EVIDENCE_CONFLICT",
          retryable: false,
          providerKey: evidence.providerKey,
          stage: evidence.stage,
          sanitizedMessage: "evidence identity already points to different content",
        });
      }
      return Object.freeze({ disposition: "REPLAY", evidence: previous.evidence });
    }

    const payloadFile = `${evidence.sha256}.payload`;
    const payloadPath = resolve(this.#payloadRoot, payloadFile);
    const payloadExists = await exists(payloadPath);
    if (payloadExists) {
      const publishedPayload = await readFile(payloadPath);
      if (sha256Bytes(publishedPayload) !== evidence.sha256) {
        throw new Error("published content-addressed payload is corrupted");
      }
    } else {
      await this.#promoteExclusive(
        resolve(this.#stagingRoot, `${evidenceId}.payload.staging`),
        payloadPath,
        payload,
      );
    }

    const record: EvidenceRecord = Object.freeze({ evidence, payloadFile });
    const metadata = `${JSON.stringify(canonicalize(record), null, 2)}\n`;
    await this.#promoteExclusive(
      resolve(this.#stagingRoot, `${evidenceId}.metadata.staging`),
      recordPath,
      Buffer.from(metadata, "utf8"),
    );
    return Object.freeze({
      disposition: payloadExists ? "REUSED_BY_HASH" : "PUBLISHED",
      evidence,
    });
  }

  async read(evidenceId: string): Promise<Readonly<{ evidence: RawCaptureEvidence; body: Buffer }>> {
    this.#assertInitialized();
    const record = await this.#readRecord(
      resolve(this.#recordRoot, `${safeIdentifier(evidenceId)}.json`),
    );
    const body = await readFile(resolve(this.#payloadRoot, record.payloadFile));
    if (sha256Bytes(body) !== record.evidence.sha256) throw new Error("evidence hash mismatch");
    return Object.freeze({ evidence: Object.freeze(record.evidence), body });
  }

  async findBySourceReference(sourceReference: string): Promise<RawCaptureEvidence | null> {
    this.#assertInitialized();
    const { readdir } = await import("node:fs/promises");
    const names = (await readdir(this.#recordRoot)).sort();
    for (const name of names) {
      const record = await this.#readRecord(resolve(this.#recordRoot, name));
      if (record.evidence.sourceReference === sourceReference) return record.evidence;
    }
    return null;
  }

  async #readRecord(path: string): Promise<EvidenceRecord> {
    const parsed = JSON.parse(await readFile(path, "utf8")) as EvidenceRecord;
    return Object.freeze(parsed);
  }

  async #promoteExclusive(stagingPath: string, targetPath: string, body: Uint8Array): Promise<void> {
    await writeFile(stagingPath, body, { flag: "wx" });
    try {
      await link(stagingPath, targetPath);
    } finally {
      await rm(stagingPath, { force: true });
    }
  }

  #assertInitialized(): void {
    if (!this.#initialized) throw new Error("evidence store must be initialized");
  }
}
