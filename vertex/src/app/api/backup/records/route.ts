import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getAuthUser, requireRole } from "@/lib/api-auth";
import {
  BACKUP_ROLES,
  canExportModel,
  defaultDateField,
  delegateName,
  getModel,
  labelPaths,
  primaryKey,
  roleRowFilter,
} from "@/server/backup/catalog";

function nest(path: string[], leaf: unknown): Record<string, unknown> {
  return path.reduceRight<unknown>((acc, key) => ({ [key]: acc }), leaf) as Record<string, unknown>;
}

function mergeDeep(target: Record<string, unknown>, source: Record<string, unknown>) {
  for (const [key, value] of Object.entries(source)) {
    const existing = target[key];
    if (existing && typeof existing === "object" && value && typeof value === "object") {
      const e = existing as { select?: Record<string, unknown> };
      const v = value as { select?: Record<string, unknown> };
      if (e.select && v.select) mergeDeep(e.select, v.select);
    } else {
      target[key] = value;
    }
  }
}

// Turns ["application","candidate","full_name"] into a Prisma select
// ({ application: { select: { candidate: { select: { full_name: true } } } } }).
function selectFor(path: string[]): Record<string, unknown> {
  return path
    .slice(0, -1)
    .reduceRight<Record<string, unknown>>((acc, key) => ({ [key]: { select: acc } }), { [path[path.length - 1]]: true });
}

function readPath(row: unknown, path: string[]): unknown {
  return path.reduce<unknown>((acc, key) => (acc && typeof acc === "object" ? (acc as Record<string, unknown>)[key] : undefined), row);
}

// GET /api/backup/records?model=Case&q=grace — record picker for the
// export builder's "specific records" filter. Searches the table's
// human-readable label (name/title/reference, or the linked candidate's
// name for tables without one) or an exact id, within the caller's
// role-level row filter.
export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireRole(user, BACKUP_ROLES);
  if (guardRes) return guardRes;

  const modelName = req.nextUrl.searchParams.get("model") ?? "";
  const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
  const model = getModel(modelName);
  if (!model || !canExportModel(user!.role, modelName)) {
    return NextResponse.json({ error: "Table not available for export." }, { status: 403 });
  }

  const pk = primaryKey(model);
  const paths = labelPaths(model) ?? [];
  const dateField = defaultDateField(model);

  const select: Record<string, unknown> = { [pk]: true };
  if (dateField) select[dateField] = true;
  for (const path of paths) mergeDeep(select, selectFor(path));

  const search = q
    ? {
        OR: [
          { [pk]: q },
          ...paths.map((path) => nest(path, { contains: q, mode: "insensitive" })),
        ],
      }
    : undefined;
  const rowFilter = roleRowFilter(user!.role, modelName);
  const where = search && rowFilter ? { AND: [search, rowFilter] } : search ?? rowFilter ?? {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows: Record<string, unknown>[] = await (prisma as any)[delegateName(modelName)].findMany({
    where,
    select,
    orderBy: dateField ? { [dateField]: "desc" } : { [pk]: "asc" },
    take: 25,
  });

  return NextResponse.json({
    records: rows.map((row) => {
      const label = paths.map((p) => readPath(row, p)).find((v) => typeof v === "string" && v.trim() !== "");
      const date = dateField ? (row[dateField] as Date | null) : null;
      return {
        id: String(row[pk]),
        label: (label as string | undefined) ?? String(row[pk]),
        date: date ? new Date(date).toISOString() : null,
      };
    }),
  });
}
