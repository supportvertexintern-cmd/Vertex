import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { ACCESS_COOKIE, PROTECTED_PATHS } from "@/lib/session-constants";
import { canAccessPortal, homeFor } from "@/lib/rbac";
import { checkRequestSize } from "@/lib/request-size";
import { REQUEST_ID_HEADER, REQUEST_PATH_HEADER, resolveRequestId } from "@/lib/request-context";
import { newNonce, NONCE_HEADER, pageCsp } from "@/lib/csp";

// Every matched request gets a correlation ID (lib/request-context.ts): it
// is passed to the handler as a request header and returned to the caller.
//
// Every page response also gets a fresh CSP nonce and its policy (E3,
// lib/csp.ts). Next.js reads the nonce from the CSP request header set
// here and puts it on every script it renders. A client-sent CSP or nonce
// header is always replaced, so the caller can't choose the nonce.
export function proxy(req: NextRequest) {
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
  const isApi = req.nextUrl.pathname.startsWith("/api/");
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const csp = isApi ? null : pageCsp(newNonce(), { https });

  const res = route(req, requestId, csp?.request ?? {});
  res.headers.set(REQUEST_ID_HEADER, requestId);
  // API and other responses keep next.config.ts's static policy.
  if (csp) for (const [name, value] of Object.entries(csp.response)) res.headers.set(name, value);
  return res;
}

function next(req: NextRequest, requestId: string, extra: Record<string, string>): NextResponse {
  const headers = new Headers(req.headers);
  for (const name of ["content-security-policy", "content-security-policy-report-only", NONCE_HEADER]) headers.delete(name);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(REQUEST_PATH_HEADER, req.nextUrl.pathname);
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return NextResponse.next({ request: { headers } });
}

function route(req: NextRequest, requestId: string, extra: Record<string, string>): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return checkRequestSize(req) ?? next(req, requestId, extra);

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));

  if (!isProtected) return next(req, requestId, extra);

  // A portal page with no usable access token goes through
  // /api/auth/refresh, which renews the 15-minute token from the refresh
  // cookie (scoped to /api/auth, so not visible here) or sends the visitor
  // to sign in. Only the signature is checked here, for routing; every API
  // call re-checks the session against the database (lib/api-auth.ts).
  const token = req.cookies.get(ACCESS_COOKIE)?.value;
  if (!token) return toRefresh(req, pathname);

  try {
    const payload = verifyToken(token);

    if (!canAccessPortal(payload.role, pathname)) {
      return NextResponse.redirect(new URL(homeFor(payload.role), req.url));
    }

    return next(req, requestId, extra);
  } catch {
    return toRefresh(req, pathname);
  }
}

function toRefresh(req: NextRequest, pathname: string): NextResponse {
  const url = new URL("/api/auth/refresh", req.url);
  url.searchParams.set("redirect", pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

// Everything except build assets and public files, which aren't documents.
export const config = {
  matcher: ["/((?!_next/static|_next/image|js/|favicon\\.ico|icon\\.svg|.*\\.(?:png|jpe?g|gif|svg|webp|ico|txt|xml|woff2?|css|map)$).*)"],
};
