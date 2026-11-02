import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";

// Read from FastAPI since reads handover R2: the agent's profile, referral
// count, milestones and commission totals. FastAPI doesn't know this site's
// address, so the referral link and its QR code are made here.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["referral_agent"]);
  if (guardRes) return guardRes;

  const result = await callBackend<{ referral_code: string } & Record<string, unknown>>("/api/v1/referral-agent/me");
  if (!result.ok) return backendResponse(result);

  const referralLink = `${APP_URL}/apply?ref=${result.body.data.referral_code}`;
  const qrDataUri = await QRCode.toDataURL(referralLink);
  return NextResponse.json({ data: { ...result.body.data, referral_link: referralLink, qr_data_uri: qrDataUri } });
}
