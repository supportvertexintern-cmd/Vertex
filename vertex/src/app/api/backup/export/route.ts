import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import { BACKUP_ROLES } from "@/server/backup/catalog";
import { buildExport, exportRequestSchema, ExportValidationError } from "@/server/backup/exporter";

// A large full backup can take a while to page through every table.
export const maxDuration = 60;

// POST /api/backup/export — { mode: "full" } or { mode: "custom",
// sections: [...] } (see exporter.ts). Returns a ZIP of per-table CSVs.
// Every export is written to AuditLog (an export of candidate PII is a
// compliance-relevant event, SRS FR-3.6) with what was exported and how
// many rows.
export async function POST(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;

  const parsed = exportRequestSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid export request.", issues: parsed.error.issues }, { status: 400 });
  }

  const actor = await prisma.user.findUnique({
    where: { id: user!.userId },
    select: { full_name: true, email: true },
  });

  try {
    const result = await buildExport(
      { userId: user!.userId, role: user!.role, name: actor?.full_name, email: actor?.email ?? user!.email },
      parsed.data
    );

    await prisma.auditLog.create({
      data: {
        entity_type: "DataExport",
        entity_id: result.filename,
        action: "export",
        actor_id: user!.userId,
        after: {
          export_type: result.manifest.export_type,
          role: user!.role,
          request: parsed.data,
          sections: result.summary,
        },
      },
    });

    return new NextResponse(new Uint8Array(result.zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        // inline, not attachment: the builder fetch()es this and saves it
        // via a blob link (which names the file itself). An attachment
        // response to fetch() can be diverted into a browser-level download
        // and handed to the page as an empty 204 instead (seen in Edge).
        "Content-Disposition": `inline; filename="${result.filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    if (err instanceof ExportValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("Backup export failed:", err);
    return NextResponse.json({ error: "Export failed. Please try again." }, { status: 500 });
  }
}
