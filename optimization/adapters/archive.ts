import { join, resolve } from "node:path";
import { CURVE_DIR } from "../../curve2/curve.ts";

export function readArchive<T>(kind: "truss" | "frame", directory: string): T {
  const script = join(CURVE_DIR, "..", "optimization", "adapters", "read_archive.py");
  const load = Bun.spawnSync(["python3", script, kind, resolve(directory)], { maxBuffer: 32 * 1024 * 1024 });
  if (load.exitCode !== 0) throw new Error(load.stderr.toString().trim() || "Could not verify archive");
  return JSON.parse(load.stdout.toString()) as T;
}
