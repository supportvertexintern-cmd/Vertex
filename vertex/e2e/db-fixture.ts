import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

// The journeys' fixtures and lookups live with the backend, which owns the
// database (vertex_be/scripts/seed/e2e.py, reads handover R8). It refuses
// anything but a local database.
const BACKEND = path.resolve(__dirname, "../../vertex_be");

function python(): string {
  // CI has no venv: its setup-python puts `python` on the PATH.
  const venv = ["env/Scripts/python.exe", "env/bin/python"].map((p) => path.join(BACKEND, p)).find(existsSync);
  return venv ?? "python";
}

export function dbFixture<T = unknown>(command: string, ...args: string[]): T {
  const out = execFileSync(python(), ["-m", "scripts.seed.e2e", command, ...args], {
    cwd: BACKEND,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return JSON.parse(out.trim().split("\n").pop() as string) as T;
}
