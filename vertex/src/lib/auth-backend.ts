import type { NextRequest } from "next/server";
import type { components } from "@/lib/api.generated";
import type { BackendError, BackendResult } from "@/lib/backend";
import { currentRequest } from "@/lib/request-context";
import type { IssuedSession } from "@/lib/session";

/**
 * Sign-in, refresh, sign-out and the session lists are FastAPI's since users
 * and sessions step 8.2 (vertex_be/app/api/v1/sessions.py;
 * docs/architecture/users-handover.md). The /api/auth routes keep what only
 * this app can do: the per-address rate limits (D2), the cookies or the
 * app's token body, and Google's state cookie. FastAPI records the security
 * events and, since reads handover R7a, raises the alerts on them
 * (vertex_be/app/services/security_monitor.py).
 */

/** A session as FastAPI issues it (generated from its schema, D.3). */
export type BackendSession = components["schemas"]["SessionOut"];

export type SignedIn = components["schemas"]["SignedIn"];

export function issued(session: BackendSession): IssuedSession {
  return {
    familyId: session.family_id,
    accessToken: session.access_token,
    refreshToken: session.refresh_token,
    refreshExpiresAt: new Date(session.refresh_expires_at),
  };
}

/**
 * The browser's address and device, for FastAPI's security events and
 * session records. FastAPI reads them only alongside this app's credential.
 */
export async function clientHeaders(req: NextRequest): Promise<{ "X-Forwarded-For": string | null; "User-Agent": string | null }> {
  const { ip } = await currentRequest();
  return { "X-Forwarded-For": ip, "User-Agent": req.headers.get("user-agent") };
}

type Details = { reason?: string; email_fp?: string; session?: string; user_id?: string; used_at?: string };

const details = (error: BackendError): Details => (error.details && typeof error.details === "object" ? (error.details as Details) : {});

/** The reason FastAPI refused a refresh ("superseded", "reused", ...), if it did. */
export function refreshRefusal(result: BackendResult<unknown>): string | null {
  return !result.ok && result.status === 401 ? (details(result.error).reason ?? "unknown") : null;
}

/** A refusal as the older routes answered it: { error: message }, with details only for a validation error. */
export function legacyError(error: BackendError, status: number): { error: string; details?: unknown } {
  return status === 422 && error.details !== undefined ? { error: error.message, details: error.details } : { error: error.message };
}
