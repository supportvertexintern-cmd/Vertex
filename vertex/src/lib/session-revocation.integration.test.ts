// Gap G19 / exception E6 (docs/security/session-management.md): a session
// must not outlive the decisions behind it. Every request checks the access
// token against the database, refresh tokens rotate, and a reused refresh
// token kills its family. These were strict expected failures until the
// fix; they are plain tests now.
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
import { hashRefreshToken, refreshSession, revokeAllForUser, revokeFamily, sessionLifetimeSeconds, startSession, type IssuedSession } from "@/lib/session";
import { POST as refreshRoute } from "@/app/api/auth/refresh/route";
import { POST as logoutRoute } from "@/app/api/auth/logout/route";
import { GET as listMine, DELETE as logoutEverywhere } from "@/app/api/auth/sessions/route";
import { DELETE as endMine } from "@/app/api/auth/sessions/[id]/route";
import { DELETE as adminRevoke } from "@/app/api/admin/users/[id]/sessions/route";

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
  const session = await startSession(fresh, null);
  state.token = session.accessToken;
  return session;
}

function refreshRequest(raw: string | null, url = "http://localhost/api/auth/refresh") {
  return new NextRequest(url, { method: "POST", headers: raw ? { cookie: `refresh_token=${raw}` } : {} });
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

  it("changing the password ends existing sessions, and their refresh tokens", async () => {
    await prisma.user.update({ where: { id: user.id }, data: { password_hash: "changed" } });
    expect(await getAuthUser(req)).toBeNull();
    expect(await refreshSession(session.refreshToken, null)).toEqual({ ok: false, reason: "version_changed" });
  });

  it("a revoked session is refused on the next request (offboarding)", async () => {
    await revokeAllForUser(user.id, "revoked_by_admin");
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a token from before G19 (no session id) is refused", async () => {
    state.token = jwt.sign({ userId: user.id, email: user.email, role: "admin" }, "irrelevant");
    expect(await getAuthUser(req)).toBeNull();
  });

  it("a validly signed token for a session that never existed is refused", async () => {
    const forged = await startSession(user, null);
    await prisma.refreshToken.deleteMany({ where: { family_id: forged.familyId } });
    state.token = forged.accessToken;
    expect(await getAuthUser(req)).toBeNull();
  });
});

describe("refresh-token rotation and reuse detection", () => {
  it("a refresh issues new tokens and spends the old refresh token", async () => {
    const out = await refreshSession(session.refreshToken, null);
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.familyId).toBe(session.familyId);
    expect(out.session.refreshToken).not.toBe(session.refreshToken);
    const old = await prisma.refreshToken.findUnique({ where: { token_hash: hashRefreshToken(session.refreshToken) } });
    expect(old?.used_at).not.toBeNull();
    state.token = out.session.accessToken;
    expect((await getAuthUser(req))?.userId).toBe(user.id);
  });

  it("only the hash of a refresh token is stored", async () => {
    const rows = await prisma.refreshToken.findMany({ where: { user_id: user.id } });
    expect(JSON.stringify(rows)).not.toContain(session.refreshToken);
  });

  it("reusing a spent refresh token revokes the whole family and raises an alert", async () => {
    const first = await refreshSession(session.refreshToken, null);
    expect(first.ok).toBe(true);
    // Past the race window: this is a second party holding the old token.
    await prisma.refreshToken.updateMany({ where: { token_hash: hashRefreshToken(session.refreshToken) }, data: { used_at: new Date(Date.now() - 60_000) } });

    expect(await refreshSession(session.refreshToken, null)).toEqual({ ok: false, reason: "reused" });

    // The legitimate holder's newer tokens die with the family.
    if (first.ok) {
      state.token = first.session.accessToken;
      expect(await getAuthUser(req)).toBeNull();
      expect((await refreshSession(first.session.refreshToken, null)).ok).toBe(false);
    }
    const events = await prisma.auditLog.findMany({ where: { entity_id: { contains: session.familyId } } });
    expect(events.map((e: { action: string }) => e.action)).toEqual(expect.arrayContaining(["refresh_token_reused", "alert_raised"]));
  });

  it("two tabs refreshing at once is a race, not theft: the family survives", async () => {
    const first = await refreshSession(session.refreshToken, null);
    expect(await refreshSession(session.refreshToken, null)).toEqual({ ok: false, reason: "superseded" });
    if (first.ok) {
      state.token = first.session.accessToken;
      expect((await getAuthUser(req))?.userId).toBe(user.id);
    }
  });

  it("a revoked refresh token is rejected", async () => {
    await revokeFamily(session.familyId, "logout");
    expect(await refreshSession(session.refreshToken, null)).toEqual({ ok: false, reason: "revoked" });
  });

  it("an expired refresh token is rejected", async () => {
    await prisma.refreshToken.updateMany({ where: { family_id: session.familyId }, data: { expires_at: new Date(Date.now() - 1000) } });
    expect(await refreshSession(session.refreshToken, null)).toEqual({ ok: false, reason: "expired" });
  });

  it("an unknown or missing refresh token is rejected", async () => {
    expect(await refreshSession("not-a-real-token", null)).toEqual({ ok: false, reason: "unknown" });
    expect(await refreshSession(undefined, null)).toEqual({ ok: false, reason: "missing" });
  });
});

describe("lifetimes and cookies", () => {
  it("access tokens last 15 minutes", () => {
    const claims = jwt.decode(session.accessToken) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(15 * 60);
  });

  it("staff sessions last 12 hours; candidate and partner sessions 14 days", () => {
    for (const role of ["admin", "regional_recruiter", "country_supervisor", "director", "marketing"] as Role[]) {
      expect(sessionLifetimeSeconds(role)).toBe(12 * 3600);
    }
    expect(sessionLifetimeSeconds("candidate")).toBe(14 * 86400);
    expect(sessionLifetimeSeconds("partner")).toBe(14 * 86400);
  });

  it("the refresh endpoint rotates and sets HttpOnly, SameSite=Strict cookies, the refresh one scoped to /api/auth", async () => {
    const res = await refreshRoute(refreshRequest(session.refreshToken));
    expect(res.status).toBe(200);
    const cookies = res.headers.getSetCookie();
    const access = cookies.find((c) => c.startsWith("auth_token="))!;
    const refresh = cookies.find((c) => c.startsWith("refresh_token="))!;
    expect(access).toMatch(/HttpOnly/i);
    expect(access).toMatch(/SameSite=strict/i);
    expect(access).toMatch(/Max-Age=900/);
    expect(refresh).toMatch(/HttpOnly/i);
    expect(refresh).toMatch(/SameSite=strict/i);
    expect(refresh).toMatch(/Path=\/api\/auth/);
  });

  it("a failed refresh clears the cookies and answers 401", async () => {
    const res = await refreshRoute(refreshRequest("bogus"));
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie().some((c) => c.startsWith("refresh_token=;"))).toBe(true);
  });
});

describe("user and admin surfaces", () => {
  it("logout ends this session server-side", async () => {
    const res = await logoutRoute(refreshRequest(session.refreshToken, "http://localhost/api/auth/logout"));
    expect(res.status).toBe(200);
    expect(await getAuthUser(req)).toBeNull();
    expect((await refreshSession(session.refreshToken, null)).ok).toBe(false);
  });

  it("lists the user's sessions and ends one, but not another user's", async () => {
    const other = await signIn(user); // a second browser
    const list = await (await listMine(req)).json();
    expect(list.data.map((s: { id: string }) => s.id)).toEqual(expect.arrayContaining([session.familyId, other.familyId]));
    expect(list.data.find((s: { id: string }) => s.id === other.familyId).current).toBe(true);

    expect((await endMine(req, { params: Promise.resolve({ id: session.familyId }) })).status).toBe(200);
    expect((await refreshSession(session.refreshToken, null)).ok).toBe(false);
    expect((await getAuthUser(req))?.userId).toBe(user.id); // this browser is untouched

    const stranger = await makeUser("candidate");
    const theirs = await startSession(stranger, null);
    expect((await endMine(req, { params: Promise.resolve({ id: theirs.familyId }) })).status).toBe(404);
    expect((await refreshSession(theirs.refreshToken, null)).ok).toBe(true);
  });

  it("log out everywhere ends every session of the user", async () => {
    const other = await startSession(user, null);
    const res = await logoutEverywhere(req);
    expect((await res.json()).data.ended).toBe(2);
    expect(await getAuthUser(req)).toBeNull();
    expect((await refreshSession(other.refreshToken, null)).ok).toBe(false);
  });

  it("an admin can sign a user out everywhere; the user is refused on the next request", async () => {
    const target = await makeUser("regional_recruiter");
    const targetSession = await startSession(target, null);
    const res = await adminRevoke(req, { params: Promise.resolve({ id: target.id }) });
    expect(res.status).toBe(200);
    state.token = targetSession.accessToken;
    expect(await getAuthUser(req)).toBeNull();
    const audit = await prisma.auditLog.findFirst({ where: { action: "sessions_revoked", entity_id: target.id } });
    expect(audit?.actor_id).toBe(user.id);
  });

  it("only admins can revoke another user's sessions", async () => {
    const recruiter = await makeUser("regional_recruiter");
    await signIn(recruiter);
    expect((await adminRevoke(req, { params: Promise.resolve({ id: user.id }) })).status).toBe(403);
  });
});
