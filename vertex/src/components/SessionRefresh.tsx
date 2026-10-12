"use client";

import { PROTECTED_PATHS } from "@/lib/session-constants";

// Access tokens last 15 minutes (G19, lib/session.ts). When an API call
// comes back 401, renew the session once through /api/auth/refresh and
// replay the call, so pages keep working past the expiry. Concurrent 401s
// share one refresh. If the session has really ended (revoked, expired,
// signed out elsewhere), a portal page goes to sign-in.
//
// Installed when this module loads, before any component's effects run, so
// the first data fetches on a page are covered too.

// Endpoints whose 401 means "wrong credentials", not "session expired".
const NO_RETRY = ["/api/auth/refresh", "/api/auth/login", "/api/auth/logout", "/api/auth/register", "/api/auth/forgot-password", "/api/auth/reset-password", "/api/auth/verify-email"];

declare global {
  interface Window {
    __vertexSessionRefresh?: boolean;
  }
}

function install(): void {
  if (typeof window === "undefined" || window.__vertexSessionRefresh) return;
  window.__vertexSessionRefresh = true;

  const original = window.fetch.bind(window);
  let pending: Promise<boolean> | null = null;
  let redirecting = false;

  const refresh = (): Promise<boolean> => {
    pending ??= original("/api/auth/refresh", { method: "POST", credentials: "same-origin" })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => {
        setTimeout(() => (pending = null), 0);
      });
    return pending;
  };

  const toSignIn = () => {
    const { pathname, search } = window.location;
    if (redirecting || !PROTECTED_PATHS.some((p) => pathname.startsWith(p))) return;
    redirecting = true;
    window.location.assign(`/auth/login?redirect=${encodeURIComponent(pathname + search)}`);
  };

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    let url: URL;
    try {
      url = new URL(raw, window.location.href);
    } catch {
      return original(input, init);
    }
    const eligible = url.origin === window.location.origin && url.pathname.startsWith("/api/") && !NO_RETRY.includes(url.pathname);
    if (!eligible) return original(input, init);

    // A Request's body can be read once; keep a copy for the replay.
    const replay = input instanceof Request ? input.clone() : input;
    const res = await original(input, init);
    if (res.status !== 401) return res;
    if (!(await refresh())) {
      toSignIn();
      return res;
    }
    return original(replay, init);
  };
}

install();

export default function SessionRefresh() {
  return null;
}
