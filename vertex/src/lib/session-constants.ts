// Dependency-free session constants, shared by src/proxy.ts, the browser
// (components/SessionRefresh.tsx) and lib/session.ts.

export const ACCESS_COOKIE = "auth_token";
export const REFRESH_COOKIE = "refresh_token";
// Narrowest path that still covers refresh, logout and the session list.
export const REFRESH_COOKIE_PATH = "/api/auth";

// Portal pages: signed-in users only.
export const PROTECTED_PATHS = ["/dashboard", "/admin", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance"];
