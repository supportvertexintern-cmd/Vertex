import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { canAccessPortal, homeFor } from "@/lib/rbac";
import { checkRequestSize } from "@/lib/request-size";
import { REQUEST_ID_HEADER, REQUEST_PATH_HEADER, resolveRequestId } from "@/lib/request-context";

const PROTECTED_PATHS = ["/dashboard", "/admin", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance"];

// Every matched request gets a correlation ID (lib/request-context.ts): it
// is passed to the handler as a request header and returned to the caller.
export function proxy(req: NextRequest) {
  const requestId = resolveRequestId(req.headers.get(REQUEST_ID_HEADER));
  const res = route(req, requestId);
  res.headers.set(REQUEST_ID_HEADER, requestId);
  return res;
}

function next(req: NextRequest, requestId: string): NextResponse {
  const headers = new Headers(req.headers);
  headers.set(REQUEST_ID_HEADER, requestId);
  headers.set(REQUEST_PATH_HEADER, req.nextUrl.pathname);
  return NextResponse.next({ request: { headers } });
}

function route(req: NextRequest, requestId: string): NextResponse {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return checkRequestSize(req) ?? next(req, requestId);

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));

  if (!isProtected) return next(req, requestId);

  const token = req.cookies.get("auth_token")?.value;

  if (!token) {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }

  try {
    const payload = verifyToken(token);

    if (!canAccessPortal(payload.role, pathname)) {
      return NextResponse.redirect(new URL(homeFor(payload.role), req.url));
    }

    return next(req, requestId);
  } catch {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    "/api/:path*",
    "/auth/:path*",
    "/dashboard/:path*",
    "/admin/:path*",
    "/recruiter/:path*",
    "/supervisor/:path*",
    "/inhouse/:path*",
    "/management/:path*",
    "/marketing/:path*",
    "/partner/:path*",
    "/hr/:path*",
    "/operations/:path*",
    "/finance/:path*",
  ],
};
