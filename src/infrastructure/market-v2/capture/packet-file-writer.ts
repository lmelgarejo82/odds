import { access, link, lstat, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, relative, resolve } from "node:path";
import { canonicalize, sha256Bytes } from "@/domain/market-v2/capture/evidence";
import type { ProspectiveCapturePacket } from "@/domain/market-v2/capture/types";

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}

export type WrittenPacket = Readonly<{ path: string; fileSha256: string }>;

export class TemporaryPacketFileWriter {
  readonly root: string;
  readonly #stagingRoot: string;
  #initialized = false;

  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error("packet root must be absolute");
    this.root = resolve(root);
    this.#stagingRoot = resolve(this.root, ".staging");
  }

  async initialize(): Promise<void> {
    const stat = await lstat(this.root);
    if (stat.isSymbolicLink()) throw new Error("packet root must not be a symlink");
    const actualRoot = await realpath(this.root);
    const actualTmp = await realpath(tmpdir());
    const fromTmp = relative(actualTmp, actualRoot);
    if (fromTmp.startsWith("..") || isAbsolute(fromTmp)) {
      throw new Error("packet root must remain below the temporary root");
    }
    const { mkdir } = await import("node:fs/promises");
    await mkdir(this.#stagingRoot, { recursive: false });
    this.#initialized = true;
  }

  async write(packet: ProspectiveCapturePacket): Promise<WrittenPacket> {
    if (!this.#initialized) throw new Error("packet writer must be initialized");
    if (!packet.source_metadata.synthetic) throw new Error("only synthetic packets are accepted");
    const safePacketId = packet.packet_id.replace(/[^A-Za-z0-9_-]/g, "_");
    const filename = `${safePacketId}-${packet.packet_hash}.json`;
    const target = resolve(this.root, filename);
    if (await exists(target)) throw new Error("packet overwrite is forbidden");
    const staging = resolve(this.#stagingRoot, `${filename}.staging`);
    const body = Buffer.from(`${JSON.stringify(canonicalize(packet), null, 2)}\n`, "utf8");
    await writeFile(staging, body, { flag: "wx" });
    try {
      await link(staging, target);
    } finally {
      await rm(staging, { force: true });
    }
    return Object.freeze({ path: target, fileSha256: sha256Bytes(body) });
  }

  async read(written: WrittenPacket): Promise<ProspectiveCapturePacket> {
    const body = await readFile(written.path);
    if (sha256Bytes(body) !== written.fileSha256) throw new Error("packet file hash mismatch");
    return Object.freeze(JSON.parse(body.toString("utf8")) as ProspectiveCapturePacket);
  }
}
