import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { sha256Bytes } from "@/domain/market-v2/capture/evidence";

const UV_BINARY = "/home/yvaforma/.local/bin/uv";

export type PythonPacketValidation = Readonly<{
  exitCode: number;
  unchanged: boolean;
  markersPresent: boolean;
}>;

export async function validateSyntheticPacketWithPython(
  packetPath: string,
): Promise<PythonPacketValidation> {
  const before = sha256Bytes(await readFile(packetPath));
  const result = await new Promise<Readonly<{ exitCode: number; stdout: string }>>(
    (resolve, reject) => {
      const child = spawn(
        UV_BINARY,
        [
          "run",
          "python",
          "-m",
          "ou25_analytics.cli",
          "validate-prospective-packet",
          packetPath,
        ],
        {
          cwd: `${process.cwd()}/analytics`,
          env: {
            ...process.env,
            UV_OFFLINE: "1",
            UV_NO_PROGRESS: "1",
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );
      let stdout = "";
      child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
        stdout += chunk;
      });
      child.stderr.resume();
      child.once("error", reject);
      child.once("close", (code) => resolve({ exitCode: code ?? -1, stdout }));
    },
  );
  const after = sha256Bytes(await readFile(packetPath));
  const markers = [
    "SYNTHETIC_PROSPECTIVE_PACKET",
    "NO_REAL_DATA",
    "NO_REAL_PERFORMANCE_CLAIM",
  ];
  const validation = Object.freeze({
    exitCode: result.exitCode,
    unchanged: before === after,
    markersPresent: markers.every((marker) => result.stdout.includes(marker)),
  });
  if (validation.exitCode !== 0 || !validation.unchanged || !validation.markersPresent) {
    throw new Error("Python packet validation failed");
  }
  return validation;
}
