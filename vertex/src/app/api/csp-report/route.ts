import { NextRequest, NextResponse } from "next/server";
import { limitByIp } from "@/lib/rate-limit";
import { log } from "@/lib/log";

// POST /api/csp-report: browsers send CSP violation reports here (E3,
// docs/security/csp.md). Accepts both formats: the older report-uri one
// (application/csp-report, {"csp-report": {...}}) and the Reporting API's
// (application/reports+json, [{type: "csp-violation", body: {...}}]).
//
// Reports are untrusted input from any page visitor: only a few fields are
// kept, each cut short; URLs lose their query string (it can hold tokens).
// They go to the log as `csp.violation`, never the audit trail.

const MAX_BYTES = 16 * 1024;
const MAX_REPORTS = 10;

function clip(v: unknown, n = 300): string | null {
  return typeof v === "string" && v ? v.slice(0, n) : null;
}

// Keeps origin and path only; "inline", "eval" and the like pass through.
function urlish(v: unknown): string | null {
  const s = clip(v);
  if (!s) return null;
  try {
    const u = new URL(s);
    return `${u.origin}${u.pathname}`.slice(0, 300);
  } catch {
    return s.split(/[?#]/)[0];
  }
}

function fields(r: Record<string, unknown>) {
  return {
    directive: clip(r["effective-directive"] ?? r.effectiveDirective ?? r["violated-directive"] ?? r.violatedDirective, 80),
    blocked: urlish(r["blocked-uri"] ?? r.blockedURL),
    page: urlish(r["document-uri"] ?? r.documentURL),
    source: urlish(r["source-file"] ?? r.sourceFile),
    line: Number(r["line-number"] ?? r.lineNumber) || null,
    disposition: clip(r.disposition, 20),
    sample: clip(r["script-sample"] ?? r.sample, 40),
  };
}

export async function POST(req: NextRequest) {
  const limited = limitByIp(req, "csp-report", { windowMs: 60_000, max: 30 });
  if (limited) return limited;

  const text = await req.text().catch(() => "");
  if (!text || text.length > MAX_BYTES) return new NextResponse(null, { status: 204 });

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse(null, { status: 204 });
  }

  const reports: Record<string, unknown>[] = [];
  if (Array.isArray(body)) {
    for (const item of body.slice(0, MAX_REPORTS)) {
      const b = (item as { type?: unknown; body?: unknown })?.body;
      if ((item as { type?: unknown }).type === "csp-violation" && b && typeof b === "object") reports.push(b as Record<string, unknown>);
    }
  } else if (body && typeof body === "object" && "csp-report" in body) {
    const r = (body as { "csp-report": unknown })["csp-report"];
    if (r && typeof r === "object") reports.push(r as Record<string, unknown>);
  }

  for (const r of reports) log.warn("csp.violation", fields(r));
  return new NextResponse(null, { status: 204 });
}
