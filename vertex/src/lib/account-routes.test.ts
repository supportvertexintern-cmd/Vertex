// The account routes since users step 8.3: with their flags on (the default)
// FastAPI writes (vertex_be/tests/test_accounts.py, test_users.py) and these
// routes keep the rate limits, the response shapes, the emails FastAPI lists
// and the admin-granted alert. With one flag off, that area's routes run the
// website's own code again and the others still pass on (lib/flags.ts).
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-accounts";
  return {
    user: null as null | { userId: string; email: string; role: string; sid: string; ver: number },
    sent: [] as unknown[][],
    dbUser: null as unknown,
  };
});

const callBackend = vi.fn();
vi.mock("@/lib/backend", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/backend")>()),
  callBackend: (...args: unknown[]) => callBackend(...args),
}));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7" }) }));
vi.mock("@/lib/email", () => {
  const senders = ["sendVerificationLinkEmail", "sendPasswordResetLinkEmail", "sendAccountSetupLinkEmail", "sendPasswordResetEmail", "sendVerificationEmail", "sendAccountSetupInviteEmail"];
  return Object.fromEntries(senders.map((name) => [name, async (...args: unknown[]) => void state.sent.push([name, ...args])]));
});
const alerts = vi.hoisted(() => ({ granted: vi.fn() }));
vi.mock("@/lib/security-monitor", () => ({ onPrivilegeGranted: alerts.granted, onSecurityEvent: async () => undefined }));
vi.mock("@/lib/audit", () => ({ recordSecurityEvent: async () => undefined, emailFingerprint: () => "fp", auditedPrisma: () => ({}) }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: async () => state.dbUser } } }));
vi.mock("@/lib/api-auth", () => ({
  getAuthUser: async () => state.user,
  requireAdmin: (user: { role: string } | null) => (!user ? Response.json({}, { status: 401 }) : user.role === "admin" ? null : Response.json({}, { status: 403 })),
  requireRole: () => null,
}));

import { NextRequest } from "next/server";
import * as register from "@/app/api/auth/register/route";
import * as verify from "@/app/api/auth/verify-email/route";
import * as forgot from "@/app/api/auth/forgot-password/route";
import * as reset from "@/app/api/auth/reset-password/route";
import * as users from "@/app/api/admin/users/route";
import * as oneUser from "@/app/api/admin/users/[id]/route";
import * as adminReset from "@/app/api/admin/users/[id]/reset-password/route";
import { accountsOnFastApi } from "@/lib/flags";

let seq = 0;
// A fresh client address per request, so the per-address limits never trip across tests.
function request(method: string, url: string, body?: unknown) {
  return new NextRequest(`http://localhost${url}`, {
    method,
    headers: { "content-type": "application/json", "x-forwarded-for": `10.8.${seq}.${seq++ % 250}`, "user-agent": "Browser/1" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const ok = (data: unknown, extra: Record<string, unknown> = {}, status = 200) => ({ ok: true, status, body: { data, ...extra } });
const refused = (status: number, code: string, message: string, details?: unknown) => ({ ok: false, status, error: { code, message, details } });
const admin = { userId: "admin1", email: "a@test.invalid", role: "admin", sid: "s", ver: 0 };
const FLAGS = ["REGISTRATION", "RESET", "ADMIN_USERS"] as const;

beforeEach(() => {
  callBackend.mockReset();
  alerts.granted.mockReset();
  state.sent = [];
  state.user = null;
  state.dbUser = null;
  vi.unstubAllEnvs();
});

describe("the flags", () => {
  it("are on unless set to false", () => {
    expect(FLAGS.map(accountsOnFastApi)).toEqual([true, true, true]);
    vi.stubEnv("FLAG_ACCOUNTS_FASTAPI_RESET", " FALSE ");
    vi.stubEnv("FLAG_ACCOUNTS_FASTAPI_ADMIN_USERS", "true");
    expect(FLAGS.map(accountsOnFastApi)).toEqual([true, false, true]);
  });
});

describe("registration and verification (flag on)", () => {
  it("passes an invite registration on, answers as before and sends the verification email", async () => {
    const user = { id: "u1", full_name: "Abebe", email: "a@test.invalid", role: "candidate" };
    const notice = { kind: "email_verification", email: "a@test.invalid", full_name: "Abebe", token: "signed-by-fastapi" };
    callBackend.mockResolvedValueOnce(ok({ message: "Account created successfully. Please check your email to verify your account.", user }, { notify: [notice] }, 201));
    const res = await register.POST(request("POST", "/api/auth/register", { password: "Pass-word-1", invite: "inv" }));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/accounts/register", { method: "POST", body: { password: "Pass-word-1", invite: "inv" }, asUser: false });
    expect([res.status, await res.json()]).toEqual([201, { message: "Account created successfully. Please check your email to verify your account.", user }]);
    expect(state.sent).toEqual([["sendVerificationLinkEmail", "signed-by-fastapi", "a@test.invalid", "Abebe"]]);
  });

  it("sends a setup link's password to the setup endpoint", async () => {
    callBackend.mockResolvedValueOnce(ok({ message: "Your password is set — you can now log in.", user: {} }));
    await register.POST(request("POST", "/api/auth/register", { password: "Pass-word-1", setup: "s" }));
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/accounts/setup");
  });

  it("keeps the older string errors, with details for validation", async () => {
    callBackend.mockResolvedValueOnce(refused(410, "invite_used", "This invite has already been used or is no longer valid."));
    const used = await register.POST(request("POST", "/api/auth/register", { password: "Pass-word-1", invite: "inv" }));
    expect([used.status, await used.json()]).toEqual([410, { error: "This invite has already been used or is no longer valid." }]);
    callBackend.mockResolvedValueOnce(refused(422, "validation_error", "Validation failed", { password: ["Password must be at least 8 characters"] }));
    const weak = await register.POST(request("POST", "/api/auth/register", { password: "x", invite: "inv" }));
    expect(await weak.json()).toEqual({ error: "Validation failed", details: { password: ["Password must be at least 8 characters"] } });
  });

  it("refuses unreadable JSON before calling FastAPI", async () => {
    const res = await register.POST(new NextRequest("http://localhost/api/auth/register", { method: "POST", body: "{nope", headers: { "x-forwarded-for": "10.7.0.1" } }));
    expect([res.status, await res.json(), callBackend.mock.calls.length]).toEqual([400, { error: "Invalid JSON" }, 0]);
  });

  it("passes the verification link on and answers { message }", async () => {
    callBackend.mockResolvedValueOnce(ok({ message: "Email verified successfully! You can now log in." }));
    const res = await verify.GET(request("GET", "/api/auth/verify-email?token=t1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/accounts/verify-email", { method: "POST", body: { token: "t1" }, asUser: false });
    expect(await res.json()).toEqual({ message: "Email verified successfully! You can now log in." });
  });
});

describe("forgot and reset password (flag on)", () => {
  it("passes the address on with the client's, answers the same and sends what FastAPI lists", async () => {
    const notice = { kind: "password_reset", email: "a@test.invalid", full_name: "Abebe", token: "reset-link" };
    callBackend.mockResolvedValueOnce(ok({ message: "If an account exists for that email, we've sent a password reset link." }, { notify: [notice] }));
    const res = await forgot.POST(request("POST", "/api/auth/forgot-password", { email: "a@test.invalid" }));
    const [path, call] = callBackend.mock.calls[0];
    expect([path, call.body, call.asUser, call.forward["X-Forwarded-For"]]).toEqual(["/api/v1/accounts/forgot-password", { email: "a@test.invalid" }, false, "203.0.113.7"]);
    const body = await res.json();
    expect(body).toEqual({ message: "If an account exists for that email, we've sent a password reset link." });
    expect(JSON.stringify(body)).not.toContain("reset-link"); // the link only ever goes by email
    expect(state.sent).toEqual([["sendPasswordResetLinkEmail", "reset-link", "a@test.invalid", "Abebe"]]);
  });

  it("passes a reset on", async () => {
    callBackend.mockResolvedValueOnce(refused(400, "invalid_link", "This reset link is invalid or has expired. Request a new one."));
    const res = await reset.POST(request("POST", "/api/auth/reset-password", { token: "t", password: "Pass-word-1" }));
    expect(callBackend.mock.calls[0][0]).toBe("/api/v1/accounts/reset-password");
    expect([res.status, await res.json()]).toEqual([400, { error: "This reset link is invalid or has expired. Request a new one." }]);
  });

  it("keeps the per-address limit", async () => {
    callBackend.mockResolvedValue(ok({ message: "m" }));
    const same = () => forgot.POST(new NextRequest("http://localhost/api/auth/forgot-password", {
      method: "POST", body: JSON.stringify({ email: "a@test.invalid" }), headers: { "content-type": "application/json", "x-forwarded-for": "10.6.6.6" },
    }));
    const statuses = [];
    for (let i = 0; i < 6; i++) statuses.push((await same()).status);
    expect(statuses).toEqual([200, 200, 200, 200, 200, 429]);
    expect(callBackend).toHaveBeenCalledTimes(5);
  });
});

describe("the admin user pages (flag on)", () => {
  beforeEach(() => {
    state.user = admin;
  });

  it("creates through FastAPI, sends the setup email and answers { data } with 201", async () => {
    const row = { id: "n1", full_name: "New", email: "n@test.invalid", role: "hr" };
    callBackend.mockResolvedValueOnce(ok(row, { notify: [{ kind: "account_setup", email: "n@test.invalid", full_name: "New", token: "setup-link" }], privilege_granted: null }, 201));
    const res = await users.POST(request("POST", "/api/admin/users", { full_name: "New", email: "n@test.invalid", role: "hr" }));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/users", { method: "POST", body: { full_name: "New", email: "n@test.invalid", role: "hr" } });
    expect([res.status, await res.json()]).toEqual([201, { data: row }]);
    expect(state.sent).toEqual([["sendAccountSetupLinkEmail", "setup-link", "n@test.invalid", "New"]]);
    expect(alerts.granted).not.toHaveBeenCalled();
  });

  it("raises the admin-granted alert from FastAPI's answer", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "p1", role: "admin" }, { privilege_granted: { from: "director", to: "admin" } }));
    await oneUser.PATCH(request("PATCH", "/api/admin/users/p1", { role: "admin" }), ctx("p1"));
    expect(callBackend).toHaveBeenCalledWith("/api/v1/users/p1", { method: "PATCH", body: { role: "admin" } });
    expect(alerts.granted).toHaveBeenCalledWith("admin1", "p1", "director", "admin");
  });

  it("keeps FastAPI's errors as { error: { code, message } }", async () => {
    callBackend.mockResolvedValueOnce(refused(400, "self_role_change", "You can't change your own role."));
    const res = await oneUser.PATCH(request("PATCH", "/api/admin/users/admin1", { role: "hr" }), ctx("admin1"));
    expect([res.status, await res.json()]).toEqual([400, { error: { code: "self_role_change", message: "You can't change your own role." } }]);
    expect(alerts.granted).not.toHaveBeenCalled();
  });

  it("deletes, and resets to a temporary password in the older shape", async () => {
    callBackend.mockResolvedValueOnce(ok({ id: "x1" }));
    const del = await oneUser.DELETE(request("DELETE", "/api/admin/users/x1"), ctx("x1"));
    expect([callBackend.mock.calls[0], await del.json()]).toEqual([["/api/v1/users/x1", { method: "DELETE" }], { data: { id: "x1" } }]);
    callBackend.mockResolvedValueOnce(ok({ id: "x1" }, { temporaryPassword: "tmp-pass-123" }));
    const res = await adminReset.POST(request("POST", "/api/admin/users/x1/reset-password"), ctx("x1"));
    expect(callBackend.mock.calls[1][0]).toBe("/api/v1/users/x1/reset-password");
    expect(await res.json()).toEqual({ data: { id: "x1" }, temporaryPassword: "tmp-pass-123" });
  });

  it("refuses non-admins before calling FastAPI", async () => {
    state.user = { ...admin, role: "director" };
    expect((await users.POST(request("POST", "/api/admin/users", {}))).status).toBe(403);
    expect((await oneUser.DELETE(request("DELETE", "/api/admin/users/x1"), ctx("x1"))).status).toBe(403);
    expect(callBackend).not.toHaveBeenCalled();
  });
});

describe("each flag off on its own", () => {
  // One route per area that can run its old code without a database here.
  const probes = {
    REGISTRATION: async () => verify.GET(request("GET", "/api/auth/verify-email?token=not-a-token")),
    RESET: async () => reset.POST(request("POST", "/api/auth/reset-password", { token: "not-a-token", password: "Pass-word-1" })),
    ADMIN_USERS: async () => {
      state.user = admin;
      return oneUser.DELETE(request("DELETE", "/api/admin/users/admin1"), ctx("admin1"));
    },
  };
  // What the website's own code answers to each probe.
  const own = {
    REGISTRATION: [400, { error: "Invalid or expired verification token." }],
    RESET: [400, { error: "This reset link is invalid or has expired. Request a new one." }],
    ADMIN_USERS: [400, { error: { code: "self_delete", message: "You can't remove your own account." } }],
  };

  for (const off of FLAGS) {
    it(`${off} off: its routes run the website's code, the others still pass on`, async () => {
      vi.stubEnv(`FLAG_ACCOUNTS_FASTAPI_${off}`, "false");
      callBackend.mockResolvedValue(ok({ message: "from FastAPI" }));
      for (const area of FLAGS) {
        callBackend.mockClear();
        const res = await probes[area]();
        if (area === off) {
          expect([res.status, await res.json()], area).toEqual(own[area]);
          expect(callBackend, area).not.toHaveBeenCalled();
        } else {
          expect(callBackend, area).toHaveBeenCalledTimes(1);
        }
      }
    });
  }

  it("RESET off: forgot password answers the same and sends nothing for an unknown address", async () => {
    vi.stubEnv("FLAG_ACCOUNTS_FASTAPI_RESET", "false");
    const res = await forgot.POST(request("POST", "/api/auth/forgot-password", { email: "nobody@test.invalid" }));
    expect(await res.json()).toEqual({ message: "If an account exists for that email, we've sent a password reset link." });
    expect([callBackend.mock.calls.length, state.sent]).toEqual([0, []]);
  });
});
