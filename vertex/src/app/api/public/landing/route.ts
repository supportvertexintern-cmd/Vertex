import { NextRequest, NextResponse } from "next/server";
import { appPreflight, appResponse } from "@/lib/app-auth";
import { limitByIp } from "@/lib/rate-limit";
import { getMobileLanding } from "@/server/services/landingContent";

export const dynamic = "force-dynamic";

// GET /api/public/landing?app=mobile: the mobile app's home screen, which
// it shows before sign-in (the landing CMS, part 4). Public, like the page
// it fills: only what marketing published, never a draft, the same text
// anyone sees on the screen. Rate-limited per address; FastAPI's answer is
// kept 30 seconds (server/services/landingContent.ts). The app shows its
// own built-in text when this fails (vertex_app/lib/core/landing/).
//
// CORS for the Flutter web build's origins (APP_ORIGINS), as the app's
// sign-in routes (lib/app-auth.ts); native apps send no Origin.
export async function GET(req: NextRequest) {
  const limited = await limitByIp(req, "public-landing", { max: 60 });
  if (limited) return cors(req, new NextResponse(limited.body, limited));
  if (req.nextUrl.searchParams.get("app") !== "mobile") {
    return cors(req, NextResponse.json({ error: { code: "validation_error", message: "app must be mobile." } }, { status: 400 }));
  }
  const answer = await getMobileLanding();
  if (!answer) {
    return cors(req, NextResponse.json({ error: { code: "backend_unavailable", message: "The service is unavailable. Please try again." } }, { status: 503 }));
  }
  return cors(req, NextResponse.json({ data: answer }));
}

export function OPTIONS(req: NextRequest) {
  return appPreflight(req, "GET, OPTIONS");
}

const cors = (req: NextRequest, res: NextResponse) => appResponse(req, res, "GET, OPTIONS");
