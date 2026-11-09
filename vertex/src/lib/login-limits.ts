import { callBackend } from "./backend";
import { log } from "./log";

// Login protection PR 6 (2026-11-09): the website's per-address sign-in
// limit is an admin's setting (Monitoring → Login Protection), read from
// FastAPI at most once a minute. LOGIN_RATE_LIMIT_MAX still overrides it, for
// the end-to-end suite only. If FastAPI can't be asked, the last value
// stands, or the default (10).

const DEFAULT = 10;
const REFRESH_MS = 60_000;

let value: number | null = null;
let fetchedAt = 0;
let pending: Promise<void> | null = null;

async function refresh(): Promise<void> {
  const res = await callBackend<{ ip_login_max_per_minute: number }>("/api/v1/login-protection", { asUser: false, timeoutMs: 1500 });
  fetchedAt = Date.now();
  if (!res.ok) {
    log.error("login_limits.unavailable", { status: res.status, code: res.error.code });
    return;
  }
  value = res.body.data.ip_login_max_per_minute;
}

/** Sign-in attempts allowed per address per minute. */
export async function loginAttemptsPerMinute(): Promise<number> {
  const override = Number(process.env.LOGIN_RATE_LIMIT_MAX);
  if (override) return override;
  if (!process.env.BACKEND_URL) return DEFAULT;
  if (Date.now() - fetchedAt >= REFRESH_MS) {
    pending ??= refresh().finally(() => {
      pending = null;
    });
    await pending;
  }
  return value ?? DEFAULT;
}

/** Tests only. */
export function resetLoginLimits(): void {
  value = null;
  fetchedAt = 0;
  pending = null;
}
