import { NextRequest } from "next/server";
import { getAuthUser, requireAdmin } from "@/lib/api-auth";
import { backendResponse, callBackend } from "@/lib/backend";
import { clientHeaders } from "@/lib/auth-backend";
import { queryOf } from "@/lib/pipeline";

// GET /api/admin/monitoring/audit?actor_id=&action=&entity_type=&entity_id=&date_from=&date_to=&page=&pageSize=
// Admin → Monitoring → Audit Trail (phase 4, 2026-11-07), read-only. FastAPI
// reads it through vertex_audit_trail and records each read, with the
// browser's address (vertex_be/app/api/v1/monitoring.py).
const KEYS = ["actor_id", "action", "entity_type", "entity_id", "date_from", "date_to", "page", "pageSize"] as const;

export async function GET(req: NextRequest) {
  const user = await getAuthUser(req);
  const guardRes = requireAdmin(user);
  if (guardRes) return guardRes;
  return backendResponse(await callBackend("/api/v1/monitoring/audit", { query: queryOf(req, KEYS), forward: await clientHeaders(req) }));
}
