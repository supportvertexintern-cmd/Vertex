import { NextRequest, NextResponse } from "next/server";
import { isNotFound, prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { candidateProfileSchema } from "@/lib/validations";
import { getAuthUser, requireAuth } from "@/lib/api-auth";

// GET /api/candidates/profile
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  const profile = await prisma.candidate.findUnique({
    where: { user_id: user!.userId },
    include: {
      user: { select: { full_name: true, email: true, phone: true, country: true } },
      documents: { select: { id: true, type: true, verification_status: true, uploaded_at: true, label: true } },
      _count: { select: { applications: true } },
    },
  });

  if (!profile) return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  return NextResponse.json(profile);
}

// PUT /api/candidates/profile
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON" }, { status: 400 }); }

  const parsed = candidateProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Validation failed", details: parsed.error.flatten().fieldErrors }, { status: 422 });
  }

  const data: Record<string, unknown> = { ...parsed.data };
  if (parsed.data.date_of_birth) {
    data.date_of_birth = new Date(parsed.data.date_of_birth);
  }
  if (parsed.data.passport_expiry) {
    data.passport_expiry = new Date(parsed.data.passport_expiry);
  }

  let profile;
  try {
    profile = await auditedPrisma(user!.userId).candidate.update({
      where: { user_id: user!.userId },
      data,
    });
  } catch (err) {
    // Signed in, but no candidate profile linked to this account.
    if (isNotFound(err)) return NextResponse.json({ error: "No candidate profile for this account." }, { status: 404 });
    throw err;
  }

  return NextResponse.json(profile);
}
