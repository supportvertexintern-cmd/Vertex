import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/jwt";
import { canAccessPortal, homeFor } from "@/lib/rbac";
import { checkRequestSize } from "@/lib/request-size";

const PROTECTED_PATHS = ["/dashboard", "/admin", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance"];

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/api/")) return checkRequestSize(req) ?? NextResponse.next();

  const isProtected = PROTECTED_PATHS.some((p) => pathname.startsWith(p));

  if (!isProtected) return NextResponse.next();

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

    return NextResponse.next();
  } catch {
    const loginUrl = new URL("/auth/login", req.url);
    loginUrl.searchParams.set("redirect", pathname);
    return NextResponse.redirect(loginUrl);
  }
}

export const config = {
  matcher: [
    "/api/:path*",
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
