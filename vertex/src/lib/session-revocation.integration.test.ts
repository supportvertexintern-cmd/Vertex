// Gap G19 (docs/security/phase2-baseline.md): a session token outlives the
// decisions behind it. Identity and role come only from the signed token
// (7-day expiry), never the database, so demotion, deletion and password
// changes don't take effect until the token expires. Zero-trust policy §2
// ("account still exists and is active, credential not revoked") and plan
// 5.2 ("revoked credentials are denied") require them to.
//
// These are STRICT expected failures (`it.fails`): they pass only while the
// gap exists. When revocation is implemented (Phase 4: a token_version
// checked on every request, bumped on role change, deletion and password
// change; plus short-lived access tokens), they start failing: switch them
// to plain `it` then.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-for-g19";
  return { token: "" };
});
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { signToken } from "@/lib/jwt";
import { getAuthUser } from "@/lib/api-auth";

const req = {} as NextRequest;
let userId = "";

beforeEach(async () => {
  const user = await prisma.user.create({
    data: { full_name: "G19 Test Admin", email: `g19-${Date.now()}-${Math.random()}@test.invalid`, role: "admin", password_hash: "x" },
  });
  userId = user.id;
  state.token = signToken({ userId: user.id, email: user.email, role: "admin" });
});

afterEach(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("session revocation (gap G19)", () => {
  it("baseline: a valid token for an existing user is accepted", async () => {
    expect((await getAuthUser(req))?.userId).toBe(userId);
  });

  it.fails("a demoted user loses the old role immediately", async () => {
    await prisma.user.update({ where: { id: userId }, data: { role: "candidate" } });
    expect((await getAuthUser(req))?.role).toBe("candidate");
  });

  it.fails("a deleted user's token is rejected", async () => {
    await prisma.user.delete({ where: { id: userId } });
    expect(await getAuthUser(req)).toBeNull();
  });

  it.fails("changing the password ends existing sessions", async () => {
    await prisma.user.update({ where: { id: userId }, data: { password_hash: "changed" } });
    expect(await getAuthUser(req)).toBeNull();
  });
});
