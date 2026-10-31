import { clientIp } from "./client-ip";
import { headers } from "next/headers";

// Request correlation (Phase 10). src/proxy.ts gives every request an ID:
// the caller's X-Request-ID if it is well-formed (so a trace can start at a
// load balancer or another service), otherwise a fresh UUID. The ID goes
// back on the response, into every log line and into audit rows, and is
// the header any future service-to-service call must forward.
export const REQUEST_ID_HEADER = "x-request-id";
// Set by the proxy only (any client-sent value is overwritten).
export const REQUEST_PATH_HEADER = "x-vertex-path";

const VALID_REQUEST_ID = /^[A-Za-z0-9._:-]{8,128}$/;

export function resolveRequestId(incoming: string | null | undefined): string {
  return incoming && VALID_REQUEST_ID.test(incoming) ? incoming : crypto.randomUUID();
}

export interface RequestContext {
  requestId: string | null;
  path: string | null;
  ip: string | null;
}

/** The current request's ID, path and client IP, or nulls outside a request. Never throws. */
export async function currentRequest(): Promise<RequestContext> {
  try {
    const h = await headers();
    return {
      requestId: h.get(REQUEST_ID_HEADER),
      path: h.get(REQUEST_PATH_HEADER),
      ip: clientIpFrom(h),
    };
  } catch {
    return { requestId: null, path: null, ip: null };
  }
}

// The address the edge proxy reports (lib/client-ip.ts), as the rate limiter
// uses; recorded as evidence, not identity.
export function clientIpFrom(h: Headers): string | null {
  return clientIp(h);
}
