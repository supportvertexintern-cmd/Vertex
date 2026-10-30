import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Role } from "@prisma/client";
import { prisma } from "./prisma";
import { signToken } from "./jwt";
import type { IssuedSession } from "./session";

// Tests only. Since G19 an access token is accepted only for an existing
// user with a live session, so tests need a real session row. FastAPI issues
// sessions since users step 8.2 and the website's tests don't run it, so
// this writes one directly, as FastAPI does (the tests connect as the
// superuser; vertex_web can't write RefreshToken).

export function hashRefreshToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/** A live session for user, as FastAPI's start_session() makes one. */
export async function startTestSession(user: { id: string; email: string; role: Role; token_version: number }): Promise<IssuedSession> {
  const familyId = randomUUID();
  const refreshToken = randomBytes(32).toString("base64url");
  const refreshExpiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000);
  await prisma.refreshToken.create({
    data: { user_id: user.id, family_id: familyId, token_hash: hashRefreshToken(refreshToken), token_version: user.token_version, expires_at: refreshExpiresAt },
  });
  const accessToken = signToken({ userId: user.id, email: user.email, role: user.role, sid: familyId, ver: user.token_version });
  return { familyId, accessToken, refreshToken, refreshExpiresAt };
}

/** Creates the user if needed, starts a session and returns its access token. */
export async function sessionToken(who: { userId: string; email: string; role: Role }): Promise<string> {
  const user = await prisma.user.upsert({
    where: { id: who.userId },
    update: {},
    create: { id: who.userId, full_name: `Session test ${who.userId}`, email: who.email, role: who.role },
  });
  return (await startTestSession(user)).accessToken;
}
