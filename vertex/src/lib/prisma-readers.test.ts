// The website files still allowed to use the database through Prisma
// (docs/architecture/reads-handover.md, D6). Every step of the handover
// moves its files' reads to FastAPI and takes them off this list; R8 ends
// with an empty list and no Prisma client. A new file that imports Prisma
// fails here, and so does a listed file that no longer does, so the list
// is always exactly what is left.

import { readdirSync, readFileSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const SRC = path.resolve(__dirname, "..");

const STILL_READING: Record<string, string[]> = {};

const IMPORTS_PRISMA = /from\s+["'](?:@\/lib\/prisma|(?:\.\.?\/)+(?:lib\/)?prisma)["']/;
const IS_TEST = /\.test\.tsx?$|(^|\/)test-[\w-]+\.ts$/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(name) ? [full] : [];
  });
}

describe("Prisma readers (reads handover)", () => {
  const importing = sourceFiles(SRC)
    .map((f) => path.relative(SRC, f).split(path.sep).join("/"))
    .filter((f) => f !== "lib/prisma.ts" && !IS_TEST.test(f))
    .filter((f) => IMPORTS_PRISMA.test(readFileSync(path.join(SRC, f), "utf8")))
    .sort();

  it("only the files still listed use Prisma, and every listed file still does", () => {
    expect(importing).toEqual(Object.values(STILL_READING).flat().sort());
  });
});
