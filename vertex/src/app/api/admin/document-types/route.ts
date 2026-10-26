import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireAdmin, requireRole } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";

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
// arrays) is the label slugified. FastAPI owns document types since backend
// plan step 3.2 (vertex_be/app/api/v1/reference.py, which also creates each
// job payment stage's receipt type): this handler checks the role early and
// passes the request on.
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
  return backendResponse(await callBackend("/api/v1/document-types", { method: "POST", body }));
}
