// `next start` compiles next.config.ts again at run time, and the runtime
// image holds only what the Dockerfile copies into it. A relative import the
// image lacks crash-loops the container (dev deploy of f1f9f4e, 2026-10-13:
// "Cannot find module './src/lib/csp'").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

describe("next.config.ts in the runtime image", () => {
  const imports = [...read("next.config.ts").matchAll(/from\s+["'](\.{1,2}\/[^"']+)["']/g)].map((m) =>
    path.posix.normalize(m[1])
  );
  const runtime = read("Dockerfile").split(/^FROM /m).at(-1)!;

  it("finds the config's relative imports", () => {
    expect(imports).toContain("src/lib/csp");
  });

  it.each(imports)("the runtime image copies %s", (imp) => {
    expect(runtime).toMatch(new RegExp(`COPY --from=build /app/${imp}(\\.ts)? `));
  });
});
