import { NextRequest, NextResponse } from "next/server";
import { verifyToken, JwtPayload } from "@/lib/jwt";
import { cookies } from "next/headers";
import type { Role } from "@prisma/client";
import { recordSecurityEventLater } from "@/lib/audit";
import { log } from "@/lib/log";

export async function getAuthUser(req: NextRequest): Promise<JwtPayload | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("auth_token")?.value;
    if (!token) return null;
    try {
      return verifyToken(token);
    } catch (err) {
      // Expired sessions land here routinely; a run of bad signatures is
      // what to look for.
      log.info("auth.invalid_token", { reason: err instanceof Error ? err.name : "unknown" });
      return null;
    }
  } catch {
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
      const token = store.get("auth_token")?.value;
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
