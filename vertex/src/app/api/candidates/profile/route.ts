import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson } from "@/lib/pipeline";
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

// PUT /api/candidates/profile — the candidate's own Section 2. Written by
// FastAPI since the pipeline switch (step 6.7; vertex_be/app/api/v1/
// candidates.py, update_own_profile); answered in this route's older shape.
export async function PUT(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAuth(user);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn("/api/v1/candidates/profile", { method: "PUT", body: read.body }, { unwrap: true, legacyErrors: true });
}
