// Phase 10, against the database: security events are recorded with the
// request's correlation ID, credentials stay out of the trail, the agreed
// alerts fire once per window, and a logging or audit failure never
// changes an access decision.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => {
  process.env.JWT_SECRET ??= "test-only-signing-value-not-a-real-secret-phase10";
  process.env.LOGIN_RATE_LIMIT_MAX = "1000";
  process.env.SMTP_HOST = "smtp.test.invalid"; // the mailer itself is mocked below
  process.env.SECURITY_ALERT_EMAILS = "security@test.invalid";
  return { headers: new Headers(), token: "", sent: [] as { to: string[]; subject: string; text: string }[] };
});
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (name: string) => (name === "auth_token" && state.token ? { value: state.token } : undefined) }),
}));
// Sign-in is FastAPI's since users step 8.2: it checks the password and
// records login_failed (vertex_be/tests/test_sessions.py covers what it
// records). This stand-in writes the row as FastAPI does, with the
// fingerprint and address the website's monitor counts.
vi.mock("@/lib/backend", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/backend")>();
  const { prisma } = await import("@/lib/prisma");
  const { emailFingerprint } = await import("@/lib/audit");
  return {
    ...real,
    callBackend: async (path: string, call: { body: { email: string }; forward: Record<string, string | null> }) => {
      if (path !== "/api/v1/auth/login") return real.callBackend(path, call as never);
      const email_fp = emailFingerprint(call.body.email);
      await prisma.auditLog.create({
        data: { entity_type: "Auth", entity_id: "unknown_account", action: "login_failed", after: { reason: "bad_password", method: "password", email_fp, ip: call.forward["X-Forwarded-For"] } },
      });
      return { ok: false, status: 401, error: { code: "invalid_credentials", message: "Invalid email or password.", details: { email_fp } } };
    },
  };
});
vi.mock("@/lib/email", () => ({
  sendSecurityAlertEmail: async (to: string[], subject: string, text: string) => {
    state.sent.push({ to, subject, text });
  },
}));

import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/lib/auth";
import { sessionToken } from "@/lib/test-session";
import { auditAccess, auditedPrisma, emailFingerprint, recordSecurityEvent } from "@/lib/audit";
import { forbidden, getAuthUser, requireRole } from "@/lib/api-auth";
import { setLogSink } from "@/lib/log";
import { resetAlertDedupe } from "@/lib/security-monitor";
import { POST as login } from "@/app/api/auth/login/route";
import { GET as issueLink } from "@/app/api/documents/[id]/signed-url/route";
import { GET as openFile } from "@/app/api/documents/file/route";
// As behind the stack's edge proxy (lib/client-ip.ts).
process.env.TRUST_PROXY_HEADERS = "true";


const tag = `p10-${Date.now()}`;
const email = `${tag}@test.invalid`;
const PASSWORD = "correct-horse-battery-staple";
let userId = "";
let lines: Record<string, unknown>[] = [];

function inRequest(requestId: string, path = "/api/auth/login", ip = "203.0.113.7") {
  state.headers = new Headers({ "x-request-id": requestId, "x-vertex-path": path, "x-real-ip": ip });
}

function loginRequest(password: string, as = email) {
  return new NextRequest("http://localhost/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: as, password }),
  });
}

// Security events are written after the response in some paths; wait for them.
async function settle() {
  await new Promise((r) => setTimeout(r, 150));
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { full_name: "Phase 10", email, role: "candidate", email_verified: true, password_hash: await hashPassword(PASSWORD) },
    })
  ).id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: tag } } });
});

beforeEach(() => {
  resetAlertDedupe();
  state.sent = [];
  state.token = "";
  lines = [];
  setLogSink((line) => lines.push(JSON.parse(line)));
});

afterEach(() => {
  setLogSink(null);
  vi.restoreAllMocks();
});

describe("tracing (item 8)", () => {
  it("one request ID links the response, the log line and the audit row", async () => {
    const rid = `${tag}-trace-1`;
    // Sign-in events are FastAPI's since users step 8.2, under the same ID
    // (callBackend() passes X-Request-ID on); this app's own events here.
    inRequest(rid, "/api/admin/users");
    expect(requireRole({ userId, email, role: "candidate", sid: "test", ver: 0 }, ["admin"])?.status).toBe(403);
    await settle();

    const row = await prisma.auditLog.findFirst({ where: { request_id: rid } });
    expect(row).toMatchObject({ action: "access_denied", entity_type: "Route", entity_id: "/api/admin/users" });
    expect(row?.after).toMatchObject({ ip: "203.0.113.7", path: "/api/admin/users" });

    const logged = lines.find((l) => l.event === "security.access_denied");
    expect(logged).toMatchObject({ request_id: rid, level: "warn" });
  });

  it("audited data changes carry the request ID too", async () => {
    const rid = `${tag}-trace-2`;
    inRequest(rid, "/api/admin/users/x");
    await auditedPrisma("admin-actor").user.update({ where: { id: userId }, data: { phone: "+10000000000" } });
    expect(await prisma.auditLog.findFirst({ where: { request_id: rid, entity_type: "User", action: "update" } })).not.toBeNull();
  });
});

describe("what gets recorded (items 3, 4)", () => {
  it("records denials", async () => {
    inRequest(`${tag}-deny`, "/api/admin/users");
    const denied = requireRole({ userId, email, role: "candidate", sid: "test", ver: 0 }, ["admin"]);
    expect(denied?.status).toBe(403);
    await settle();

    const actions = await prisma.auditLog.findMany({
      where: { request_id: `${tag}-deny` },
      select: { action: true, entity_id: true, actor_id: true },
    });
    expect(actions).toEqual([{ action: "access_denied", entity_id: "/api/admin/users", actor_id: userId }]);
  });

  it("records who opened a candidate document, and refused links (G21)", async () => {
    const candidate = await prisma.candidate.create({ data: { full_name: `${tag} candidate` } });
    const doc = await prisma.document.create({ data: { candidate_id: candidate.id, type: "passport", storage_path: `passport/${tag}.pdf` } });
    try {
      state.token = await sessionToken({ userId: "p10-admin", email: "admin@test.invalid", role: "admin" });
      inRequest(`${tag}-doc`, `/api/documents/${doc.id}/signed-url`);
      const res = await issueLink(new NextRequest(`http://localhost/api/documents/${doc.id}/signed-url`), { params: Promise.resolve({ id: doc.id }) });
      expect(res.status).toBe(200);
      const row = await prisma.auditLog.findFirst({ where: { request_id: `${tag}-doc` } });
      expect(row).toMatchObject({ action: "document_link_issued", entity_type: "Document", entity_id: doc.id, actor_id: "p10-admin" });
      expect(row?.after).toMatchObject({ type: "passport", candidate_id: candidate.id });

      inRequest(`${tag}-badlink`, "/api/documents/file");
      expect((await openFile(new NextRequest("http://localhost/api/documents/file?token=forged"))).status).toBe(401);
      const rejected = await prisma.auditLog.findFirst({ where: { request_id: `${tag}-badlink` } });
      expect(rejected?.action).toBe("document_link_rejected");
      expect(JSON.stringify(rejected)).not.toContain("forged");
    } finally {
      await prisma.document.delete({ where: { id: doc.id } });
      await prisma.candidate.delete({ where: { id: candidate.id } });
    }
  });

  it("strips tokens and connection strings from audit details", async () => {
    inRequest(`${tag}-detail`, "/api/candidates/export");
    await auditAccess(userId, "CandidateExport", "export", {
      rows: 1,
      api_key: "k-123",
      note: "postgresql://vertex_web:<DB_PASSWORD>@db:5432/vertex",
      link: `/api/documents/file?token=${["eyJhbGciOiJIUzI1NiJ9", "eyJhIjoiYiJ9", "c2lnbmF0dXJl"].join(".")}`,
    });
    const row = await prisma.auditLog.findFirst({ where: { request_id: `${tag}-detail` } });
    const text = JSON.stringify(row?.after);
    for (const secret of ["k-123", "<DB_PASSWORD>", "eyJhbGciOiJIUzI1NiJ9"]) expect(text).not.toContain(secret);
  });
});

describe("alerts (item 6)", () => {
  it("brute force on one account: one alert and one email, however many failures", async () => {
    for (let i = 0; i < 12; i++) {
      inRequest(`${tag}-bf-${i}`, "/api/auth/login", `198.51.100.${i}`);
      await login(loginRequest(`wrong-${i}`));
    }
    const fp = emailFingerprint(email);
    const alerts = await prisma.auditLog.findMany({ where: { action: "alert_raised", entity_id: `brute_force_account:account:${fp}` } });
    expect(alerts).toHaveLength(1);
    expect(state.sent.filter((m) => m.subject.includes("failed sign-ins for one account"))).toHaveLength(1);
    expect(state.sent[0].to).toEqual(["security@test.invalid"]);
    expect(lines.some((l) => l.level === "alert" && l.event === "alert.raised" && l.rule === "brute_force_account")).toBe(true);
  }, 30_000);

  it("authorization probing by one user", async () => {
    const prober = `${tag}-prober`;
    for (let i = 0; i < 20; i++) {
      inRequest(`${tag}-probe-${i}`, `/api/admin/thing-${i}`);
      await recordSecurityEvent("access_denied", { actorId: prober, entityType: "Route", entityId: "", detail: { reason: "role" } });
    }
    expect(await prisma.auditLog.count({ where: { action: "alert_raised", entity_id: `authorization_probing:user:${prober}` } })).toBe(1);
  });

  it("a user made admin", async () => {
    inRequest(`${tag}-promote`, "/api/admin/users/x");
    const promoted = await prisma.user.create({ data: { full_name: "To promote", email: `${tag}-promote@test.invalid`, role: "candidate" } });
    await auditedPrisma("admin-actor").user.update({ where: { id: promoted.id }, data: { role: "admin" } });
    await settle();
    const alert = await prisma.auditLog.findFirst({ where: { action: "alert_raised", entity_id: `privilege_granted:user:${promoted.id}` } });
    expect(alert?.after).toMatchObject({ from: "candidate", to: "admin", actor_id: "admin-actor", severity: "critical" });
  });

  it("malware is alerted immediately", async () => {
    inRequest(`${tag}-mw`, "/api/upload");
    await recordSecurityEvent("malware_rejected", { actorId: userId, entityType: "Candidate", entityId: `${tag}-cand`, detail: { signature: "Eicar-Test-Signature" } });
    expect(await prisma.auditLog.count({ where: { action: "alert_raised", entity_id: `malware_detected:malware_rejected:${tag}-cand` } })).toBe(1);
    expect(state.sent).toHaveLength(1);
  });
});

describe("logging failures cannot grant access (item 7)", () => {
  function breakAuditTrail() {
    vi.spyOn(prisma.auditLog, "create").mockRejectedValue(new Error("audit store unavailable"));
  }

  it("a role denial stays a denial", async () => {
    breakAuditTrail();
    inRequest(`${tag}-f1`, "/api/admin/users");
    expect(requireRole({ userId, email, role: "candidate", sid: "test", ver: 0 }, ["admin"])?.status).toBe(403);
    await settle();
    expect(lines.some((l) => l.event === "audit.write_failed")).toBe(true);
    expect(lines.some((l) => l.event === "alert.raised" && l.rule === "audit_write_failed")).toBe(true);
  });

  it("a record denial stays a denial", async () => {
    breakAuditTrail();
    state.token = await sessionToken({ userId, email, role: "candidate" });
    inRequest(`${tag}-f2`, "/api/cases/x");
    expect(forbidden().status).toBe(403);
    await settle();
  });

  it("an invalid session stays invalid when logging itself throws", async () => {
    setLogSink(() => {
      throw new Error("log sink down");
    });
    state.token = "not-a-token";
    expect(await getAuthUser({} as NextRequest)).toBeNull();
    await expect(recordSecurityEvent("access_denied", { actorId: null, entityType: "Route", entityId: "x" })).resolves.toBeUndefined();
  });

  it("an export still fails closed when its audit can't be written", async () => {
    breakAuditTrail();
    await expect(auditAccess(userId, "CandidateExport", "export", { rows: 1 })).rejects.toThrow();
  });
});
