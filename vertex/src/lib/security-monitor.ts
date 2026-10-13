import { prisma } from "./prisma";
import { log } from "./log";
import { redact } from "./redact";
import { currentRequest } from "./request-context";

// Security monitoring and alerts (Phase 10). Rules agreed with the owner
// (2026-10-11): brute-force sign-ins, malware, authorization probing and
// privilege grants, plus two operational ones: audit-trail write failures
// and the malware scanner being unreachable (uploads accepted unscanned).
// E6 (2026-10-12) adds refresh-token reuse, a sign of a stolen session.
//
// An alert is a log line at level "alert" (event alert.raised), an
// `alert_raised` row in the audit trail, and an email to
// SECURITY_ALERT_EMAILS (comma-separated; default: every admin user).
// Each alert key fires at most once per window. Nothing here throws: a
// monitoring failure is logged and never changes a request's outcome.

export interface AlertRule {
  id: string;
  severity: "high" | "critical";
  windowMinutes: number;
  threshold: number;
}

export const RULES = {
  bruteForceAccount: { id: "brute_force_account", severity: "high", windowMinutes: 15, threshold: 10 },
  bruteForceIp: { id: "brute_force_ip", severity: "high", windowMinutes: 15, threshold: 20 },
  authorizationProbing: { id: "authorization_probing", severity: "high", windowMinutes: 10, threshold: 20 },
  malware: { id: "malware_detected", severity: "critical", windowMinutes: 60, threshold: 1 },
  privilegeGranted: { id: "privilege_granted", severity: "critical", windowMinutes: 1, threshold: 1 },
  auditWriteFailed: { id: "audit_write_failed", severity: "critical", windowMinutes: 15, threshold: 1 },
  scannerUnavailable: { id: "malware_scanner_unavailable", severity: "high", windowMinutes: 60, threshold: 1 },
  refreshTokenReused: { id: "refresh_token_reused", severity: "high", windowMinutes: 15, threshold: 1 },
} as const satisfies Record<string, AlertRule>;

// Per-process dedupe, so a burst doesn't query the database per event and
// alerts still dedupe when the database is the thing that's failing.
const lastRaised = new Map<string, number>();

function since(minutes: number): Date {
  return new Date(Date.now() - minutes * 60_000);
}

export async function onSecurityEvent(
  action: string,
  actorId: string | null,
  entityId: string,
  detail: Record<string, unknown>,
): Promise<void> {
  try {
    if (action === "login_failed") {
      const fp = typeof detail.email_fp === "string" ? detail.email_fp : null;
      const ip = typeof detail.ip === "string" ? detail.ip : null;
      if (fp) {
        const r = RULES.bruteForceAccount;
        const n = await prisma.auditLog.count({
          where: { action, created_at: { gte: since(r.windowMinutes) }, after: { path: ["email_fp"], equals: fp } },
        });
        if (n >= r.threshold) await raiseAlert(r, `account:${fp}`, `${n} failed sign-ins for one account in ${r.windowMinutes} minutes`, { email_fp: fp, failures: n, last_ip: ip });
      }
      if (ip) {
        const r = RULES.bruteForceIp;
        const n = await prisma.auditLog.count({
          where: { action, created_at: { gte: since(r.windowMinutes) }, after: { path: ["ip"], equals: ip } },
        });
        if (n >= r.threshold) await raiseAlert(r, `ip:${ip}`, `${n} failed sign-ins from one address in ${r.windowMinutes} minutes`, { ip, failures: n });
      }
    } else if (action === "access_denied" && actorId) {
      const r = RULES.authorizationProbing;
      const n = await prisma.auditLog.count({ where: { action, actor_id: actorId, created_at: { gte: since(r.windowMinutes) } } });
      if (n >= r.threshold) await raiseAlert(r, `user:${actorId}`, `${n} denied requests by one user in ${r.windowMinutes} minutes`, { actor_id: actorId, denials: n, last_path: detail.path });
    } else if (action === "refresh_token_reused") {
      await raiseAlert(RULES.refreshTokenReused, `session:${entityId}`, "A spent refresh token was used again; the session was revoked", {
        actor_id: actorId, session: entityId, used_at: detail.used_at,
      });
    } else if (action === "malware_rejected" || action === "malware_blocked_download") {
      await raiseAlert(RULES.malware, `${action}:${entityId}`, action === "malware_rejected" ? "An uploaded file was infected and rejected" : "A stored document was found infected and blocked", {
        actor_id: actorId, entity_id: entityId, signature: detail.signature,
      });
    }
  } catch (err) {
    log.error("monitor.evaluate_failed", { action, err });
  }
}

export function onPrivilegeGranted(actorId: string | null, userId: string, from: string | null, to: string): void {
  void raiseAlert(RULES.privilegeGranted, `user:${userId}`, from ? `A user was promoted from ${from} to ${to}` : `An ${to} account was created`, {
    actor_id: actorId, user_id: userId, from, to,
  });
}

// The audit trail itself is failing: no database dedupe or row (that's
// what's broken), just the log line and the email.
export function onAuditWriteFailed(what: string, err: unknown): void {
  void raiseAlert(RULES.auditWriteFailed, "audit", "Writing to the audit trail failed", { operation: what, error: err }, { persist: false });
}

export function onScannerUnavailable(reason: string): void {
  void raiseAlert(RULES.scannerUnavailable, "clamd", "The malware scanner is unreachable; uploads are being accepted unscanned", { reason });
}

export async function raiseAlert(
  rule: AlertRule,
  key: string,
  summary: string,
  detail: Record<string, unknown>,
  { persist = true }: { persist?: boolean } = {},
): Promise<boolean> {
  try {
    const alertKey = `${rule.id}:${key}`.slice(0, 200);
    const now = Date.now();
    const windowMs = rule.windowMinutes * 60_000;
    if ((lastRaised.get(alertKey) ?? 0) > now - windowMs) return false;
    lastRaised.set(alertKey, now);

    const ctx = await currentRequest();
    const clean = redact({ ...detail, severity: rule.severity, rule: rule.id, summary }) as Record<string, unknown>;

    if (persist) {
      try {
        const recent = await prisma.auditLog.findFirst({
          where: { action: "alert_raised", entity_id: alertKey, created_at: { gte: new Date(now - windowMs) } },
          select: { id: true },
        });
        if (recent) return false; // another process raised it
        await prisma.auditLog.create({
          data: { entity_type: "SecurityAlert", entity_id: alertKey, action: "alert_raised", request_id: ctx.requestId, after: clean as object },
        });
      } catch (err) {
        log.error("alert.persist_failed", { rule: rule.id, err });
      }
    }

    log.alert("alert.raised", { ...clean, alert_key: alertKey, request_id: ctx.requestId });
    await notify(rule, alertKey, summary, clean, ctx.requestId);
    return true;
  } catch (err) {
    log.error("alert.failed", { rule: rule.id, err });
    return false;
  }
}

async function recipients(): Promise<string[]> {
  const configured = (process.env.SECURITY_ALERT_EMAILS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (configured.length) return configured;
  const admins = await prisma.user.findMany({ where: { role: "admin" }, select: { email: true } });
  return admins.map((a: { email: string }) => a.email);
}

async function notify(rule: AlertRule, alertKey: string, summary: string, detail: Record<string, unknown>, requestId: string | null): Promise<void> {
  try {
    if (!process.env.SMTP_HOST) {
      log.warn("alert.email_skipped", { rule: rule.id, reason: "SMTP_HOST not set" });
      return;
    }
    const to = await recipients();
    if (!to.length) {
      log.warn("alert.email_skipped", { rule: rule.id, reason: "no recipients" });
      return;
    }
    const env = process.env.APP_ENV || process.env.NODE_ENV || "unknown";
    const lines = [
      `${summary}.`,
      "",
      `Rule:        ${rule.id} (${rule.severity})`,
      `Environment: ${env}`,
      `Time:        ${new Date().toISOString()}`,
      `Alert key:   ${alertKey}`,
      `Request ID:  ${requestId ?? "-"}`,
      "",
      "Details:",
      ...Object.entries(detail)
        .filter(([k]) => !["summary", "severity", "rule"].includes(k))
        .map(([k, v]) => `  ${k}: ${typeof v === "string" ? v : JSON.stringify(v)}`),
      "",
      `Investigate: AuditLog rows with action "alert_raised" and entity_id "${alertKey}",`,
      "and the application logs for the request ID above.",
      `This alert won't repeat for ${rule.windowMinutes} minutes.`,
    ];
    const { sendSecurityAlertEmail } = await import("./email");
    await sendSecurityAlertEmail(to, `[Vertex ${env}] Security alert: ${summary}`, lines.join("\n"));
    log.info("alert.email_sent", { rule: rule.id, recipients: to.length, request_id: requestId });
  } catch (err) {
    log.error("alert.email_failed", { rule: rule.id, err });
  }
}

// Test hook.
export function resetAlertDedupe(): void {
  lastRaised.clear();
}
