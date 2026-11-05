import { NextRequest, NextResponse } from "next/server";
import { verifyToken, JwtPayload } from "@/lib/jwt";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { recordSecurityEventLater } from "@/lib/audit";
import { log } from "@/lib/log";
import { ACCESS_COOKIE } from "@/lib/session";

/**
 * The signed-in caller, or null: the access token's claims, once its
 * signature (FastAPI's key) and expiry check out. Since reads handover R7d
 * (D2 A) this app reads no data itself, so this decides only which page or
 * early refusal to show. Every data call is FastAPI's, and FastAPI checks
 * the live session on each one (current_user in vertex_be/app/core/auth.py:
 * the user still exists, token_version matches, the family is live), so a
 * revoked, deleted, demoted or re-passworded user gets no data on the next
 * request. Any failure means null.
 *
 * _req is optional and unused: route handlers still pass their request, and
 * Server Components (which have no NextRequest) can call this too; the
 * session always comes from next/headers's cookies().
 */
export async function getAuthUser(_req?: NextRequest): Promise<JwtPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get(ACCESS_COOKIE)?.value;
    if (!token) return null;
    let claims: JwtPayload;
    try {
      claims = verifyToken(token);
    } catch (err) {
      // Expired sessions land here routinely; a run of bad signatures is
      // what to look for.
      log.info("auth.invalid_token", { reason: err instanceof Error ? err.name : "unknown" });
      return null;
    }
    return { userId: claims.userId, email: claims.email, role: claims.role, sid: claims.sid, ver: claims.ver };
  } catch (err) {
    log.warn("auth.session_check_failed", { err });
    return null;
  }
}

export function requireAuth(user: JwtPayload | null): NextResponse | null {
  if (!user) {
    return NextResponse.json(
      { error: "Unauthorized. Please log in." },
      { status: 401 }
    );
  }
  return null;
}

export function requireAdmin(user: JwtPayload | null): NextResponse | null {
  return requireRole(user, ["admin"]);
}

// SRS FR-1.2: least-privilege RBAC enforced on every API route.
export function requireRole(user: JwtPayload | null, roles: Role[]): NextResponse | null {
  const authError = requireAuth(user);
  if (authError) return authError;
  if (!roles.includes(user!.role)) {
    recordSecurityEventLater("access_denied", {
      actorId: user!.userId,
      entityType: "Route",
      entityId: "",
      detail: { reason: "role", role: user!.role, allowed: roles },
    });
    return NextResponse.json(
      { error: "Forbidden. Insufficient role." },
      { status: 403 }
    );
  }
  return null;
}

/**
 * 403 for a caller who passed the role check but may not touch this
 * record (scope, ownership). Returns the response at once; the denial is
 * audited in the background, so an audit failure can't change the answer.
 */
export function forbidden(body: unknown = { error: { code: "forbidden", message: "Forbidden." } }): NextResponse {
  const pending = cookies();
  void pending
    .then((store) => {
      const token = store.get(ACCESS_COOKIE)?.value;
      let actor: JwtPayload | null = null;
      try {
        actor = token ? verifyToken(token) : null;
      } catch {
        actor = null;
      }
      recordSecurityEventLater("access_denied", {
        actorId: actor?.userId ?? null,
        entityType: "Route",
        entityId: "",
        detail: { reason: "record", role: actor?.role ?? null },
      });
    })
    .catch(() => undefined);
  return NextResponse.json(body, { status: 403 });
}
