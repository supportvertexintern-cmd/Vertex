import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { passOn, readJson, seg } from "@/lib/pipeline";
import { getAuthUser, requireRole, forbidden } from "@/lib/api-auth";

// "Approved by In-House" is the framework's controlling position for this
// decision (Regional Supervisory Operational Workflow p.5) — admin
// retains override access, not primary ownership.
const APPLICATION_REVIEWER_ROLES = ["inhouse_supervisor", "director", "admin"] as const;


// GET /api/applications/[id] — In-House/Director/admin, or the owning candidate
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const application = await prisma.application.findUnique({
    where: { id },
    include: {
      candidate: { include: { user: { select: { full_name: true, email: true } } } },
      job: true,
    },
  });

  if (!application) return NextResponse.json({ error: "Application not found." }, { status: 404 });

  const isReviewer = (APPLICATION_REVIEWER_ROLES as readonly string[]).includes(user.role);
  if (!isReviewer && application.candidate.user_id !== user.userId) {
    return forbidden({ error: "Forbidden." });
  }

  return NextResponse.json(application);
}

// PUT /api/applications/[id] — In-House, the director or admin changing the
// legacy hiring status or the internal notes (edited from a case). Written
// by FastAPI since the pipeline switch (step 6.7;
// vertex_be/app/api/v1/applications.py, review), which lists the
// candidate's email for a status change; answered in this route's older
// shape.
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, [...APPLICATION_REVIEWER_ROLES]);
  if (guardRes) return guardRes;
  const read = await readJson(req, true);
  if (read.invalid) return read.invalid;
  return passOn(`/api/v1/applications/${seg(id)}`, { method: "PUT", body: read.body }, { unwrap: true, legacyErrors: true });
}
