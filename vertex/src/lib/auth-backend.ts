import type { NextRequest } from "next/server";
import type { BackendError, BackendResult } from "@/lib/backend";
import { currentRequest } from "@/lib/request-context";
import { onPrivilegeGranted, onSecurityEvent } from "@/lib/security-monitor";
import type { IssuedSession } from "@/lib/session";

/**
 * Sign-in, refresh, sign-out and the session lists are FastAPI's since users
 * and sessions step 8.2 (vertex_be/app/api/v1/sessions.py;
 * docs/architecture/users-handover.md). The /api/auth routes keep what only
 * this app can do: the per-address rate limits (D2), the cookies or the
 * app's token body, Google's state cookie, and the security monitor's
 * alerts. FastAPI records the security events; the alerts are raised here
 * from what it reports, as for malware (onMalwareFound).
 */

/** A session as FastAPI issues it. */
export interface BackendSession {
  family_id: string;
  access_token: string;
  refresh_token: string;
  refresh_expires_at: string;
}

export interface SignedIn {
  user: { id: string; full_name: string; email: string; role: string };
  session: BackendSession;
}

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

/**
 * Raises the security monitor's alerts for a refused sign-in or refresh:
 * brute force on one account or from one address (counted from the
 * login_failed rows FastAPI wrote, which carry the fingerprint and the
 * address), and a reused refresh token.
 */
export async function alertOnRefusal(result: BackendResult<unknown>): Promise<void> {
  if (result.ok || result.status !== 401 && result.status !== 403) return;
  const d = details(result.error);
  if (d.email_fp) {
    const { ip } = await currentRequest();
    await onSecurityEvent("login_failed", null, "login", { email_fp: d.email_fp, ip });
  } else if (d.reason === "reused" && d.session) {
    await onSecurityEvent("refresh_token_reused", d.user_id ?? null, d.session, { used_at: d.used_at });
  }
}

/**
 * The admin user pages are FastAPI's since users step 8.3
 * (vertex_be/app/api/v1/users.py). When a write makes someone an admin, its
 * answer says so in privilege_granted, and the alert auditedPrisma() used to
 * raise is raised here.
 */
export function alertOnPrivilegeGranted(result: BackendResult<unknown>, actorId: string): void {
  if (!result.ok) return;
  const granted = result.body.privilege_granted as { from: string | null; to: string } | null | undefined;
  const userId = (result.body.data as { id?: string } | undefined)?.id;
  if (granted && userId) onPrivilegeGranted(actorId, userId, granted.from, granted.to);
}

/** A refusal as the older routes answered it: { error: message }, with details only for a validation error. */
export function legacyError(error: BackendError, status: number): { error: string; details?: unknown } {
  return status === 422 && error.details !== undefined ? { error: error.message, details: error.details } : { error: error.message };
}
