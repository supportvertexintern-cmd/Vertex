// Gap G19 / exception E6 (docs/security/session-management.md): a session
// must not outlive the decisions behind it. Every request this app serves
// checks the access token against the database (getAuthUser), tested here.
// Issuing, rotating, reuse detection and revoking are FastAPI's since users
// step 8.2: vertex_be/tests/test_sessions.py; the routes that pass them on
// are in lib/auth-routes.test.ts.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-g19";
  return { token: "" };
});
vi.mock("next/headers", () => ({
  headers: async () => new Headers(),
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));

import jwt from "jsonwebtoken";
import { NextRequest } from "next/server";
import type { Role } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser } from "@/lib/api-auth";
import type { IssuedSession } from "@/lib/session";
import { startTestSession } from "@/lib/test-session";

const req = {} as NextRequest;
const tag = `g19-${Date.now()}`;
let seq = 0;
const created: string[] = [];

async function makeUser(role: Role = "admin") {
  const user = await prisma.user.create({
    data: { full_name: "G19 Test", email: `${tag}-${seq++}@test.invalid`, role, password_hash: "x" },
  });
  created.push(user.id);
  return user;
}

async function signIn(user: Awaited<ReturnType<typeof makeUser>>): Promise<IssuedSession> {
  const fresh = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
  const session = await startTestSession(fresh);
  state.token = session.accessToken;
  return session;
}

let user: Awaited<ReturnType<typeof makeUser>>;
let session: IssuedSession;

beforeEach(async () => {
  user = await makeUser();
  session = await signIn(user);
});

afterEach(async () => {
  state.token = "";
  await prisma.user.deleteMany({ where: { id: { in: created } } });
});

describe("every request re-checks the session (G19)", () => {
  it("baseline: a live session is accepted, with role and email from the database", async () => {
    const me = await getAuthUser(req);
    expect(me?.userId).toBe(user.id);
    expect(me?.role).toBe("admin");
    expect(me?.sid).toBe(session.familyId);
  });

  it("a demoted user's session ends immediately", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { role: "candidate" } });
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a deleted user's token is rejected", async () => {
    await prisma.user.delete({ where: { id: user.id } });
    expect(await getAuthUser(req)).toBeNull();
  });

  it("changing the password ends existing sessions", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { password_hash: "changed" } });
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a revoked session is refused on the next request (offboarding)", async () => {
    await prisma.refreshToken.updateMany({ where: { user_id: user.id }, data: { revoked_at: new Date(), revoke_reason: "revoked_by_admin" } });
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a token from before G19 (no session id) is refused", async () => {
    state.token = jwt.sign({ userId: user.id, email: user.email, role: "admin" }, "irrelevant");
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a validly signed token for a session that never existed is refused", async () => {
    const forged = await startTestSession(user);
    await prisma.refreshToken.deleteMany({ where: { family_id: forged.familyId } });
    state.token = forged.accessToken;
    expect(await getAuthUser(req)).toBeNull();
  });
});
