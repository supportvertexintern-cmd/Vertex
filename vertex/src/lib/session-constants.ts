// Dependency-free session constants, shared by src/proxy.ts, the browser
// (components/SessionRefresh.tsx) and lib/session.ts.

export const ACCESS_COOKIE = "auth_token";
export const REFRESH_COOKIE = "refresh_token";
// Narrowest path that still covers refresh, logout and the session list.
export const REFRESH_COOKIE_PATH = "/api/auth";
// "This browser has a session to refresh" (auth hardening plan A.4). The
// refresh cookie is invisible outside /api/auth, so without this the proxy
// and the browser sent every signed-out visit through a refresh call. Set
// and cleared with the session cookies; its value is just "1": it is not a
// credential and signs nobody in. Readable by the page's script on purpose.
export const SIGNED_IN_COOKIE = "vertex_signed_in";

// Portal pages: signed-in users only.
export const PROTECTED_PATHS = ["/dashboard", "/admin", "/recruiter", "/supervisor", "/inhouse", "/management", "/marketing", "/partner", "/hr", "/operations", "/finance", "/referral-agent"];
