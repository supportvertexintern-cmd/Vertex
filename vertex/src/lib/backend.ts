import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { signServiceToken } from "@/lib/jwt";
import { log } from "@/lib/log";
import { REQUEST_ID_HEADER, currentRequest } from "@/lib/request-context";
import { ACCESS_COOKIE } from "@/lib/session";

/**
 * Calls the FastAPI backend from the server (backend plan step 0.5; gap
 * G18, zero-trust policy §6). Every call carries:
 *
 * - X-Vertex-Service: Next.js's own credential, a one-minute token keyed
 *   from SERVICE_AUTH_SECRET. FastAPI refuses a bad one on any route.
 * - Authorization: the signed-in user's session token (from the auth_token
 *   cookie), unless asUser is false. FastAPI checks that session and the
 *   user's role itself: it never takes Next.js's word for what the user
 *   may do.
 * - X-Request-ID: this request's ID, so one ID follows the call through
 *   both services' logs and audit rows.
 *
 * FastAPI answers in the same shapes as this app's routes ({data} or
 * {error: {code, message, details?}}, vertex_be/app/core/api.py), so a
 * handler can pass the result straight on with backendResponse().
 *
 * Fails closed and never throws: no BACKEND_URL or SERVICE_AUTH_SECRET, a
 * network failure or a timeout is an error result, logged as
 * backend.call_failed.
 */

const TIMEOUT_MS = 10_000;

export interface BackendError {
  code: string;
  message: string;
  details?: unknown;
}

export type BackendResult<T> =
  | { ok: true; status: number; body: { data: T } & Record<string, unknown> }
  | { ok: false; status: number; error: BackendError };

export interface CallBackendOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  /** Sent as JSON. */
  body?: unknown;
  /** Query string parameters; undefined values are left out. */
  query?: Record<string, string | number | boolean | undefined>;
  /** Send the signed-in user's session (default). False only for calls Next.js makes for itself. */
  asUser?: boolean;
}

const UNAVAILABLE: BackendError = { code: "backend_unavailable", message: "The service is unavailable. Please try again." };

export async function callBackend<T = unknown>(path: string, options: CallBackendOptions = {}): Promise<BackendResult<T>> {
  const { method = "GET", body, query, asUser = true } = options;
  const base = process.env.BACKEND_URL;
  if (!base) {
    log.error("backend.call_failed", { path, reason: "BACKEND_URL is not set" });
    return { ok: false, status: 503, error: UNAVAILABLE };
  }
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`callBackend() takes a path like /api/v1/..., not ${path}`);
  }

  const url = new URL(path, base);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) url.searchParams.set(key, String(value));
  }

  let headers: Record<string, string>;
  try {
    const { requestId } = await currentRequest();
    headers = { "X-Vertex-Service": signServiceToken(), Accept: "application/json" };
    if (requestId) headers[REQUEST_ID_HEADER] = requestId;
    if (asUser) {
      const session = (await cookies()).get(ACCESS_COOKIE)?.value;
      if (!session) return { ok: false, status: 401, error: { code: "unauthorized", message: "Unauthorized. Please log in." } };
      headers.Authorization = `Bearer ${session}`;
    }
    if (body !== undefined) headers["Content-Type"] = "application/json";
  } catch (err) {
    // SERVICE_AUTH_SECRET missing or too short.
    log.error("backend.call_failed", { path, reason: "service credential", err });
    return { ok: false, status: 503, error: UNAVAILABLE };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const timedOut = err instanceof Error && err.name === "TimeoutError";
    log.warn("backend.call_failed", { path, method, reason: timedOut ? "timeout" : "network", err });
    return { ok: false, status: timedOut ? 504 : 502, error: UNAVAILABLE };
  }

  if (res.status === 204) return { ok: true, status: 204, body: { data: null as T } };

  let parsed: unknown = null;
  try {
    parsed = await res.json();
  } catch {
    parsed = null;
  }
  const envelope = (parsed ?? {}) as { data?: T; error?: BackendError };

  if (res.ok && parsed !== null && "data" in (parsed as object)) {
    return { ok: true, status: res.status, body: parsed as { data: T } & Record<string, unknown> };
  }
  if (!res.ok && envelope.error && typeof envelope.error.code === "string") {
    return { ok: false, status: res.status, error: envelope.error };
  }
  log.warn("backend.call_failed", { path, method, reason: "unexpected response", status: res.status });
  return { ok: false, status: 502, error: UNAVAILABLE };
}

/** Passes a backend result on as this route's response: same status, same envelope. */
export function backendResponse<T>(result: BackendResult<T>): NextResponse {
  return result.ok
    ? NextResponse.json(result.body, { status: result.status })
    : NextResponse.json({ error: result.error }, { status: result.status });
}
