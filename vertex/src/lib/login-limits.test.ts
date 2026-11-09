// Login protection PR 6: the website's per-address sign-in limit is an
// admin's setting, read from FastAPI at most once a minute; the e2e override
// wins; without FastAPI, or when it can't be asked, the default (10) or the
// last value stands.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ value: 20, fail: false, calls: 0 }));
vi.mock("./backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./backend")>()),
  callBackend: async () => {
    state.calls += 1;
    return state.fail
      ? { ok: false, status: 503, error: { code: "backend_unavailable", message: "down" } }
      : { ok: true, status: 200, body: { data: { ip_login_max_per_minute: state.value } } };
  },
}));
vi.mock("./log", () => ({ log: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { loginAttemptsPerMinute, resetLoginLimits } from "./login-limits";

beforeEach(() => {
  vi.stubEnv("BACKEND_URL", "http://backend:8000");
  vi.stubEnv("LOGIN_RATE_LIMIT_MAX", "");
  state.value = 20;
  state.fail = false;
  state.calls = 0;
  resetLoginLimits();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("the per-address sign-in limit", () => {
  it("is the admin's setting, read at most once a minute", async () => {
    vi.useFakeTimers();
    expect(await loginAttemptsPerMinute()).toBe(20);
    state.value = 30;
    expect(await loginAttemptsPerMinute()).toBe(20);
    expect(state.calls).toBe(1);
    vi.advanceTimersByTime(61_000);
    expect(await loginAttemptsPerMinute()).toBe(30);
  });

  it("keeps the last value, or the default, when FastAPI can't be asked", async () => {
    vi.useFakeTimers();
    state.fail = true;
    expect(await loginAttemptsPerMinute()).toBe(10);
    state.fail = false;
    vi.advanceTimersByTime(61_000);
    expect(await loginAttemptsPerMinute()).toBe(20);
    state.fail = true;
    vi.advanceTimersByTime(61_000);
    expect(await loginAttemptsPerMinute()).toBe(20);
  });

  it("the end-to-end override wins; without FastAPI it is 10", async () => {
    vi.stubEnv("LOGIN_RATE_LIMIT_MAX", "1000");
    expect(await loginAttemptsPerMinute()).toBe(1000);
    vi.stubEnv("LOGIN_RATE_LIMIT_MAX", "");
    vi.stubEnv("BACKEND_URL", "");
    expect(await loginAttemptsPerMinute()).toBe(10);
    expect(state.calls).toBe(0);
  });
});
