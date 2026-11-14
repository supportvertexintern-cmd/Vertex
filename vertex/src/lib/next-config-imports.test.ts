// `next start` compiles next.config.ts again at run time, and the runtime
// image holds only what the Dockerfile copies into it. A relative import the
// image lacks crash-loops the container (dev deploy of f1f9f4e, 2026-10-13:
// "Cannot find module './src/lib/csp'").
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

// The config's local imports and theirs, all the way down: csp.ts importing
// ./media crash-looped dev and staging on 69baeb0 (2026-11-14), one level
// below what the first version of this test looked at.
function localImports(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    for (const m of read(file).matchAll(/(?:from|import)\s+["']((?:\.{1,2}|@)\/[^"']+)["']/g)) {
      const spec = m[1];
      const imp = spec.startsWith("@/")
        ? path.posix.join("src", spec.slice(2))
        : path.posix.normalize(path.posix.join(path.posix.dirname(file), spec));
      if (seen.has(imp)) continue;
      seen.add(imp);
      visit(`${imp}.ts`);
    }
  };
  visit(entry);
  return [...seen];
}

describe("next.config.ts in the runtime image", () => {
  const imports = localImports("next.config.ts");
  const runtime = read("Dockerfile").split(/^FROM /m).at(-1)!;

  it("finds the config's relative imports", () => {
    expect(imports).toContain("src/lib/csp");
  });

  it.each(imports)("the runtime image copies %s", (imp) => {
    expect(runtime).toMatch(new RegExp(`COPY --from=build /app/${imp}(\\.ts)? `));
  });
});
