import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { auditedPrisma } from "@/lib/audit";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { createDocumentRequirementTypeSchema } from "@/lib/validations";

function slugify(label: string): string {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

// GET /api/admin/document-types — every admin-managed document requirement
// type (replaces the old fixed DocumentType enum), read-only reference
// data for every staff role that needs to render or configure a document
// checklist; only admin can write.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, ["regional_recruiter", "country_supervisor", "inhouse_supervisor", "director", "marketing", "hr", "operations_team", "operations_director", "admin"]);
  if (guardRes) return guardRes;

  const types = await prisma.documentRequirementType.findMany({ orderBy: [{ sort_order: "asc" }, { created_at: "asc" }] });
  return NextResponse.json({ data: types });
}

// POST /api/admin/document-types — admin adds a brand-new requirement
// type from just a label; the key (stored on Document.type,
// CountryDocumentRequirement.document_type, and documents_available
// arrays) is derived by slugifying it. Immediately usable everywhere else
// reads this table — no code change needed.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 });
  }

  const parsed = createDocumentRequirementTypeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation_error", message: "Validation failed", details: parsed.error.flatten().fieldErrors } },
      { status: 422 }
    );
  }

  const key = slugify(parsed.data.label);
  if (!key) {
    return NextResponse.json({ error: { code: "validation_error", message: "Label must contain at least one letter or number." } }, { status: 422 });
  }

  const existing = await prisma.documentRequirementType.findUnique({ where: { key } });
  if (existing) {
    return NextResponse.json(
      { error: { code: "duplicate", message: "A document type with this name already exists." } },
      { status: 409 }
    );
  }

  const maxSortOrder = await prisma.documentRequirementType.aggregate({ _max: { sort_order: true } });
  const db = auditedPrisma(user!.userId);
  const type = await db.documentRequirementType.create({
    data: { key, label: parsed.data.label, sort_order: (maxSortOrder._max.sort_order ?? 0) + 1 },
  });
  return NextResponse.json({ data: type }, { status: 201 });
}
