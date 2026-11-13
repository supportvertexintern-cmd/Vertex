import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CandidateSource, Role } from "@/lib/enums";
import { canSetLifecycleStatus, STATUS_ORDER, type LifecycleStatus } from "./candidateLifecycle";

// Every move canSetLifecycleStatus allows, one line per role, from, to and
// source, ending in " return" for a return. FastAPI's copy of these rules
// (vertex_be/app/services/candidate_lifecycle.py, pipeline handover step
// 6.2) is tested against the same file, so a rule changed on one side only
// fails a test. After changing the rules here, rewrite the file with
// UPDATE_LIFECYCLE_MATRIX=1 npx vitest run candidateLifecycle.matrix
// and port the change to the Python copy.
const MATRIX = join(__dirname, "candidateLifecycle.matrix.json");
const STATUSES: LifecycleStatus[] = [...STATUS_ORDER, "rejected"];
// Every value, or tsc fails: a new role or source can't be left out.
const ROLES: Record<Role, true> = {
  candidate: true,
  regional_recruiter: true,
  country_supervisor: true,
  inhouse_supervisor: true,
  director: true,
  admin: true,
  marketing: true,
  partner: true,
  hr: true,
  operations_team: true,
  operations_director: true,
  finance: true,
  referral_agent: true,
  virtual_assistant: true,
};
const SOURCES: Record<CandidateSource, true> = {
  self_registered: true,
  recruiter_sourced: true,
  partner_sourced: true,
  referral_sourced: true,
};

function allowedMoves(): string[] {
  const moves: string[] = [];
  for (const role of Object.keys(ROLES) as Role[]) {
    for (const from of STATUSES) {
      for (const to of STATUSES) {
        for (const source of Object.keys(SOURCES) as CandidateSource[]) {
          const check = canSetLifecycleStatus(role, from, to, source);
          if (check.allowed) moves.push(`${role} ${from}>${to} ${source}${check.isReturn ? " return" : ""}`);
        }
      }
    }
  }
  return moves.sort();
}

describe("the lifecycle transition table", () => {
  it("matches the rules", () => {
    const moves = allowedMoves();
    if (process.env.UPDATE_LIFECYCLE_MATRIX) writeFileSync(MATRIX, JSON.stringify(moves, null, 1) + "\n");
    expect(moves).toEqual(JSON.parse(readFileSync(MATRIX, "utf-8")));
  });
});
