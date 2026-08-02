import { constants } from "node:fs";
import {
  chmod,
  link,
  lstat,
  mkdir,
  open,
  realpath,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  RawEvidenceCandidate,
  RawEvidenceDescriptor,
  RawEvidenceStore,
  RawEvidenceStoreResult,
} from "@/application/market-v2/capture/raw-evidence-store";
import { isNormalizedUtcTimestamp } from "@/domain/market-v2/validation";

const SAFE_LOGICAL_REFERENCE = /^[a-z0-9][a-z0-9:_.-]{0,191}$/iu;
const SAFE_MEDIA_TYPE = /^[\x20-\x7e]{1,200}$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export class OperationalEvidenceStoreInitializationError extends Error {
  readonly classification = "FAILED" as const;
  readonly sanitizedCode: string;

  constructor(sanitizedCode: string) {
    super("Operational evidence store initialization failed");
    this.name = "OperationalEvidenceStoreInitializationError";
    this.sanitizedCode = sanitizedCode;
  }
}

function sha256(bytes: Readonly<Uint8Array>): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function failed(sanitizedCode: string): RawEvidenceStoreResult {
  return Object.freeze({
    ok: false,
    disposition: "FAILED",
    error: Object.freeze({ classification: "FAILED", retryable: false, sanitizedCode }),
  });
}

function conflict(sanitizedCode: string): RawEvidenceStoreResult {
  return Object.freeze({
    ok: false,
    disposition: "CONFLICT",
    error: Object.freeze({ classification: "CONFLICT", retryable: false, sanitizedCode }),
  });
}

async function assertPrivateDirectory(path: string): Promise<void> {
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isDirectory() || (stat.mode & 0o077) !== 0) {
    throw new OperationalEvidenceStoreInitializationError("UNSAFE_DIRECTORY_COMPONENT");
  }
}

async function ensurePrivateDirectory(path: string): Promise<void> {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertPrivateDirectory(path);
}

export class OperationalRawEvidenceStore implements RawEvidenceStore {
  readonly #root: string;
  readonly #artifactRoot: string;
  readonly #temporaryRoot: string;
  #initialized = false;
  #temporarySequence = 0;

  constructor(root: string) {
    if (!isAbsolute(root)) {
      throw new OperationalEvidenceStoreInitializationError("ABSOLUTE_ROOT_REQUIRED");
    }
    this.#root = resolve(root);
    this.#artifactRoot = resolve(this.#root, "sha256");
    this.#temporaryRoot = resolve(this.#root, ".temporary");
  }

  async initialize(): Promise<void> {
    try {
      await assertPrivateDirectory(this.#root);
      const canonicalRoot = await realpath(this.#root);
      if (canonicalRoot !== this.#root) {
        throw new OperationalEvidenceStoreInitializationError("ROOT_ALIAS_BLOCKED");
      }
      await ensurePrivateDirectory(this.#artifactRoot);
      await ensurePrivateDirectory(this.#temporaryRoot);
      this.#initialized = true;
    } catch (error) {
      if (error instanceof OperationalEvidenceStoreInitializationError) throw error;
      throw new OperationalEvidenceStoreInitializationError("INITIALIZATION_IO_FAILED");
    }
  }

  async publish(candidate: RawEvidenceCandidate): Promise<RawEvidenceStoreResult> {
    if (!this.#initialized) return failed("STORE_NOT_INITIALIZED");
    if (
      candidate.providerKey !== "api-football" ||
      !SAFE_LOGICAL_REFERENCE.test(candidate.endpointKey) ||
      !SAFE_LOGICAL_REFERENCE.test(candidate.sourceReference) ||
      !SAFE_MEDIA_TYPE.test(candidate.mediaType) ||
      !isNormalizedUtcTimestamp(candidate.capturedAtUtc) ||
      candidate.bytes.byteLength === 0
    ) {
      return failed("EVIDENCE_CANDIDATE_INVALID");
    }

    const contentHash = sha256(candidate.bytes);
    if (!SHA256_PATTERN.test(contentHash)) return failed("CONTENT_HASH_INVALID");
    const prefix = contentHash.slice(0, 2);
    const prefixRoot = resolve(this.#artifactRoot, prefix);
    const storageReference = `sha256/${prefix}/${contentHash}.bin`;
    const finalPath = resolve(this.#root, storageReference);
    const relativeFinalPath = relative(this.#root, finalPath);
    if (
      relativeFinalPath !== storageReference ||
      relativeFinalPath.startsWith("..") ||
      isAbsolute(relativeFinalPath)
    ) {
      return failed("STORAGE_REFERENCE_INVALID");
    }

    const descriptor: RawEvidenceDescriptor = Object.freeze({
      providerKey: candidate.providerKey,
      endpointKey: candidate.endpointKey,
      capturedAtUtc: candidate.capturedAtUtc,
      mediaType: candidate.mediaType,
      contentHash,
      byteLength: candidate.bytes.byteLength,
      storageReference,
      sourceReference: candidate.sourceReference,
    });

    let temporaryPath: string | null = null;
    try {
      await ensurePrivateDirectory(prefixRoot);
      await assertPrivateDirectory(this.#artifactRoot);
      await assertPrivateDirectory(prefixRoot);
      await assertPrivateDirectory(this.#temporaryRoot);

      try {
        const existing = await this.#readPublished(finalPath);
        return sha256(existing) === contentHash && Buffer.from(existing).equals(Buffer.from(candidate.bytes))
          ? Object.freeze({ ok: true, disposition: "REPLAYED", descriptor })
          : conflict("CONTENT_ADDRESS_OCCUPIED");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }

      this.#temporarySequence += 1;
      temporaryPath = resolve(
        this.#temporaryRoot,
        `${contentHash}.${process.pid}.${this.#temporarySequence}.tmp`,
      );
      const temporary = await open(
        temporaryPath,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        0o600,
      );
      try {
        await temporary.writeFile(candidate.bytes);
        await temporary.sync();
      } finally {
        await temporary.close();
      }
      await chmod(temporaryPath, 0o400);
      try {
        await link(temporaryPath, finalPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        const existing = await this.#readPublished(finalPath);
        return sha256(existing) === contentHash && Buffer.from(existing).equals(Buffer.from(candidate.bytes))
          ? Object.freeze({ ok: true, disposition: "REPLAYED", descriptor })
          : conflict("CONTENT_ADDRESS_OCCUPIED");
      }
      return Object.freeze({ ok: true, disposition: "CREATED", descriptor });
    } catch {
      return failed("EVIDENCE_IO_FAILED");
    } finally {
      if (temporaryPath !== null) await rm(temporaryPath, { force: true }).catch(() => undefined);
    }
  }

  async #readPublished(path: string): Promise<Uint8Array> {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new OperationalEvidenceStoreInitializationError("UNSAFE_ARTIFACT_COMPONENT");
    }
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      return new Uint8Array(await handle.readFile());
    } finally {
      await handle.close();
    }
  }
}
