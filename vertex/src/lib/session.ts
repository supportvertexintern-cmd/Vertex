import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import type { Prisma, Role } from "@prisma/client";
import { prisma } from "./prisma";
import { signToken } from "./jwt";
import { log } from "./log";
import { recordSecurityEvent } from "./audit";

// Sessions (gap G19, exception E6; docs/security/session-management.md).
//
// A session is a refresh-token *family*: the RefreshToken rows sharing one
// family_id. The browser holds two HttpOnly cookies:
//
//   auth_token     15-minute access JWT, sent everywhere. Carries the user,
//                  the family (sid) and the user's token_version (ver).
//   refresh_token  opaque random value, sent only to /api/auth/*. Stored as
//                  a SHA-256 hash. Each use rotates it.
//
// Every API request checks the access token against the database
// (getAuthUser in api-auth.ts): the user must still exist, token_version
// must match, and the family must still have a live token. So revoking a
// family, deleting a user or changing a password or role (a database
// trigger bumps token_version) stops access on the very next request, not
// when the token expires. Postgres serves as the denylist; there is no
// Redis in this stack.

import { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH } from "./session-constants";
export { ACCESS_COOKIE, REFRESH_COOKIE, REFRESH_COOKIE_PATH };

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// Absolute session lifetime (rotation doesn't extend it). Staff and admins
// can reach many candidates' personal data, so theirs is a working day.
const STAFF_SESSION_SECONDS = 12 * 60 * 60;
const SESSION_SECONDS = 14 * 24 * 60 * 60;
// Two tabs refreshing at once both present the same token: the loser's is
// already used. Within this window that is a race, not theft, so it is
// refused without revoking the family.
const REUSE_GRACE_MS = 30_000;

export type RevokeReason =
  | "logout"
  | "logout_everywhere"
  | "revoked_by_user"
  | "revoked_by_admin"
  | "reuse_detected"
  | "token_version_changed"
  | "kill_switch";

export interface SessionUser {
  id: string;
  email: string;
  role: Role;
  token_version: number;
}

export interface IssuedSession {
  familyId: string;
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
}

// Candidates and partners hold only their own data; every other role is
// internal staff.
export function sessionLifetimeSeconds(role: Role): number {
  return role === "candidate" || role === "partner" ? SESSION_SECONDS : STAFF_SESSION_SECONDS;
}

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function newRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

function deviceInfo(req: NextRequest | null): string | null {
  const ua = req?.headers.get("user-agent");
  return ua ? ua.slice(0, 200) : null;
}

function accessTokenFor(user: SessionUser, familyId: string): string {
  return signToken({ userId: user.id, email: user.email, role: user.role, sid: familyId, ver: user.token_version });
}

/** Starts a new session (sign-in). */
export async function startSession(user: SessionUser, req: NextRequest | null): Promise<IssuedSession> {
  const familyId = randomUUID();
  const refreshToken = newRefreshToken();
  const refreshExpiresAt = new Date(Date.now() + sessionLifetimeSeconds(user.role) * 1000);
  await prisma.refreshToken.create({
    data: {
      user_id: user.id,
      family_id: familyId,
      token_hash: hashRefreshToken(refreshToken),
      token_version: user.token_version,
      device_info: deviceInfo(req),
      expires_at: refreshExpiresAt,
    },
  });
  // Housekeeping: this user's long-dead rows.
  await prisma.refreshToken
    .deleteMany({ where: { user_id: user.id, expires_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } })
    .catch(() => undefined);
  log.info("session.issued", { user_id: user.id, sid: familyId, expires_at: refreshExpiresAt.toISOString() });
  return { familyId, accessToken: accessTokenFor(user, familyId), refreshToken, refreshExpiresAt };
}

export type RefreshOutcome =
  | { ok: true; session: IssuedSession; user: SessionUser }
  | { ok: false; reason: "missing" | "unknown" | "revoked" | "expired" | "superseded" | "reused" | "version_changed" };

/**
 * Exchanges a refresh token for a new access token and a new refresh token.
 * The presented token is spent. Presenting a spent token again (outside the
 * race window) is treated as theft: the whole family is revoked and an
 * alert raised.
 */
export async function refreshSession(raw: string | undefined, req: NextRequest | null): Promise<RefreshOutcome> {
  if (!raw) return { ok: false, reason: "missing" };
  const row = await prisma.refreshToken.findUnique({
    where: { token_hash: hashRefreshToken(raw) },
    include: { user: { select: { id: true, email: true, role: true, token_version: true } } },
  });
  if (!row) {
    log.info("session.refresh_rejected", { reason: "unknown" });
    return { ok: false, reason: "unknown" };
  }
  const fail = (reason: Exclude<RefreshOutcome, { ok: true }>["reason"]): RefreshOutcome => {
    log.info("session.refresh_rejected", { reason, user_id: row.user_id, sid: row.family_id });
    return { ok: false, reason };
  };

  if (row.revoked_at) return fail("revoked");
  if (row.used_at) {
    if (Date.now() - row.used_at.getTime() < REUSE_GRACE_MS) return fail("superseded");
    await revokeFamily(row.family_id, "reuse_detected");
    await recordSecurityEvent("refresh_token_reused", {
      actorId: row.user_id,
      entityType: "Session",
      entityId: row.family_id,
      detail: { used_at: row.used_at.toISOString(), device: deviceInfo(req) },
    });
    return fail("reused");
  }
  if (row.expires_at.getTime() <= Date.now()) return fail("expired");
  if (row.token_version !== row.user.token_version) {
    await revokeFamily(row.family_id, "token_version_changed");
    return fail("version_changed");
  }

  const refreshToken = newRefreshToken();
  const rotated = await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
    // Only one caller can spend a token: the conditional update is the lock.
    const spent = await tx.refreshToken.updateMany({ where: { id: row.id, used_at: null, revoked_at: null }, data: { used_at: new Date() } });
    if (spent.count !== 1) return false;
    await tx.refreshToken.create({
      data: {
        user_id: row.user_id,
        family_id: row.family_id,
        token_hash: hashRefreshToken(refreshToken),
        token_version: row.token_version,
        device_info: deviceInfo(req) ?? row.device_info,
        expires_at: row.expires_at,
      },
    });
    return true;
  });
  if (!rotated) return fail("superseded");

  log.info("session.refreshed", { user_id: row.user_id, sid: row.family_id });
  return {
    ok: true,
    user: row.user,
    session: {
      familyId: row.family_id,
      accessToken: accessTokenFor(row.user, row.family_id),
      refreshToken,
      refreshExpiresAt: row.expires_at,
    },
  };
}

/** The family a refresh token belongs to, if the token is known. */
export async function familyOfRefreshToken(raw: string | undefined): Promise<{ familyId: string; userId: string } | null> {
  if (!raw) return null;
  const row = await prisma.refreshToken.findUnique({ where: { token_hash: hashRefreshToken(raw) }, select: { family_id: true, user_id: true } });
  return row ? { familyId: row.family_id, userId: row.user_id } : null;
}

/** Ends one session. Returns how many live tokens were revoked. */
export async function revokeFamily(familyId: string, reason: RevokeReason, userId?: string): Promise<number> {
  const { count } = await prisma.refreshToken.updateMany({
    where: { family_id: familyId, revoked_at: null, ...(userId ? { user_id: userId } : {}) },
    data: { revoked_at: new Date(), revoke_reason: reason },
  });
  log.info("session.revoked", { sid: familyId, reason, tokens: count });
  return count;
}

/** Ends every session of a user. Returns the number of sessions ended. */
export async function revokeAllForUser(userId: string, reason: RevokeReason): Promise<number> {
  const live = await activeFamilies(userId);
  await prisma.refreshToken.updateMany({
    where: { user_id: userId, revoked_at: null },
    data: { revoked_at: new Date(), revoke_reason: reason },
  });
  log.info("session.revoked_all", { user_id: userId, reason, sessions: live.length });
  return live.length;
}

async function activeFamilies(userId: string) {
  return prisma.refreshToken.findMany({
    where: { user_id: userId, revoked_at: null, used_at: null, expires_at: { gt: new Date() } },
    select: { family_id: true, device_info: true, created_at: true, expires_at: true },
    orderBy: { created_at: "desc" },
  });
}

export interface SessionSummary {
  id: string;
  device: string | null;
  started_at: string;
  last_active_at: string;
  expires_at: string;
  current: boolean;
}

/** A user's live sessions, newest activity first. */
export async function listSessions(userId: string, currentFamilyId: string | null): Promise<SessionSummary[]> {
  const live: { family_id: string; device_info: string | null; created_at: Date; expires_at: Date }[] = await activeFamilies(userId);
  if (!live.length) return [];
  const starts: { family_id: string; _min: { created_at: Date | null } }[] = await prisma.refreshToken.groupBy({
    by: ["family_id"],
    where: { family_id: { in: live.map((r) => r.family_id) } },
    _min: { created_at: true },
  });
  const startOf = new Map(starts.map((s) => [s.family_id, s._min.created_at]));
  return live.map((r) => ({
    id: r.family_id,
    device: r.device_info,
    started_at: (startOf.get(r.family_id) ?? r.created_at).toISOString(),
    last_active_at: r.created_at.toISOString(),
    expires_at: r.expires_at.toISOString(),
    current: r.family_id === currentFamilyId,
  }));
}

/**
 * The live session behind an access token: the user as the database has
 * them now, or null if the user is gone, the version moved on, or the
 * family has no live token.
 */
export async function loadSession(userId: string, familyId: string, version: number) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      role: true,
      token_version: true,
      refresh_tokens: {
        where: { family_id: familyId, revoked_at: null, used_at: null, expires_at: { gt: new Date() } },
        select: { id: true },
        take: 1,
      },
    },
  });
  if (!user) return { user: null, reason: "user_gone" as const };
  if (user.token_version !== version) return { user: null, reason: "version_changed" as const };
  if (!user.refresh_tokens.length) return { user: null, reason: "session_ended" as const };
  return { user, reason: null };
}

// --- cookies ---------------------------------------------------------------

function secure(): boolean {
  return process.env.NODE_ENV === "production";
}

export function setSessionCookies(res: NextResponse, session: IssuedSession): void {
  res.cookies.set(ACCESS_COOKIE, session.accessToken, {
    httpOnly: true,
    secure: secure(),
    sameSite: "strict",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
    path: "/",
  });
  res.cookies.set(REFRESH_COOKIE, session.refreshToken, {
    httpOnly: true,
    secure: secure(),
    sameSite: "strict",
    maxAge: Math.max(0, Math.floor((session.refreshExpiresAt.getTime() - Date.now()) / 1000)),
    path: REFRESH_COOKIE_PATH,
  });
}

export function clearSessionCookies(res: NextResponse): void {
  res.cookies.set(ACCESS_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: "/" });
  res.cookies.set(REFRESH_COOKIE, "", { httpOnly: true, secure: secure(), sameSite: "strict", maxAge: 0, path: REFRESH_COOKIE_PATH });
}
