import { NextRequest, NextResponse } from "next/server";
import { contactMessageSchema } from "@/lib/validations";
import { rateLimit } from "@/lib/rate-limit";
import { sendContactMessageEmail } from "@/lib/email";

// POST /api/contact — the public /contact page had no backend at all
// (client-side simulated success). Always emails PUBLIC_FORMS_NOTIFY_EMAIL
// — unlike the CIF, there's no CRM record this could otherwise create, so
// nothing here is gated by the intake_mode admin setting.
export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const rl = rateLimit(`contact:${ip}`, { max: 5, windowMs: 60_000 });
  if (!rl.success) {
    return NextResponse.json({ error: "Too many messages. Please try again later." }, { status: 429 });
  }

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = contactMessageSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  try {
    await sendContactMessageEmail(parsed.data);
  } catch (error) {
    console.error("Failed to send contact-form notification email:", error);
    return NextResponse.json({ error: "We couldn't send your message right now. Please try again shortly or email us directly." }, { status: 502 });
  }

  return NextResponse.json({ success: true }, { status: 201 });
}
