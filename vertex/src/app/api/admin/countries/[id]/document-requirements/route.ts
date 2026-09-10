import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { updateCountryDocumentRequirementsSchema } from "@/lib/validations";

// GET /api/admin/countries/:id/document-requirements — the extra documents
// (beyond the universal passport/photo/CV set) a specific programme
// destination requires (Candidate Information Form §3's "Required for: X").
// Readable by the candidate too — they need to know what their own
// dashboard's document checklist expects of them.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["candidate", "regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "marketing", "admin"]);
  if (guardRes) return guardRes;

  const { id } = await params;
  const requirements = await prisma.countryDocumentRequirement.findMany({ where: { country_id: id } });
  return NextResponse.json({ data: requirements });
}

// PUT /api/admin/countries/:id/document-requirements — replaces the full
// set for this country with the given list (admin picks from a checklist,
// not an incremental add/remove).
export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  const { id } = await params;
  const country = await prisma.country.findUnique({ where: { id } });
  if (!country) {
    return NextResponse.json({ error: { code: "not_found", message: "Country not found." } }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = updateCountryDocumentRequirementsSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  try {
    await prisma.$transaction([
      prisma.countryDocumentRequirement.deleteMany({ where: { country_id: id } }),
      prisma.countryDocumentRequirement.createMany({
        data: parsed.data.document_types.map((document_type) => ({ country_id: id, document_type })),
      }),
    ]);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      return NextResponse.json(
        { error: { code: "unknown_type", message: "One or more document types don't exist." } },
        { status: 422 }
      );
    }
    throw err;
  }

  const requirements = await prisma.countryDocumentRequirement.findMany({ where: { country_id: id } });
  return NextResponse.json({ data: requirements });
}
