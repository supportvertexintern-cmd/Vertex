import { NextRequest, NextResponse } from "next/server";
import { contactMessageSchema } from "@/lib/validations";
import { rateLimit, retryAfter } from "@/lib/rate-limit";
import { clientKey } from "@/lib/client-ip";
import { callBackend } from "@/lib/backend";

const FAILED = "We couldn't send your message right now. Please try again shortly or email us directly.";

// POST /api/contact — always emails PUBLIC_FORMS_NOTIFY_EMAIL; unlike the
// CIF, there's no CRM record this could otherwise create, so nothing here
// is gated by the intake_mode admin setting. FastAPI sends it since reads
// handover R7b (vertex_be/app/api/v1/public_forms.py); this route keeps the
// rate limit and the form's messages.
export async function POST(req: NextRequest) {
  const ip = clientKey(req.headers);
  const rl = await rateLimit(`contact:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429, headers: { "Retry-After": retryAfter(rl) } });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = contactMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const sent = await callBackend("/api/v1/public-forms/contact", { method: "POST", body: parsed.data, asUser: false });
  if (!sent.ok) return NextResponse.json({ error: FAILED }, { status: 502 });

  return NextResponse.json({ success: true }, { status: 201 });
}
