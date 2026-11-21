import { NextRequest, NextResponse } from "next/server";
import { backendResponse, callBackend, type CallBackendOptions } from "@/lib/backend";

/**
 * The landing editor's routes (/api/content/blocks/...; the landing CMS,
 * part 3): each lets in a signed-in internal role (requireRole with
 * INTERNAL_ROLES, in the handler, where lib/route-guards.test.ts sees it)
 * and passes the request on to FastAPI (vertex_be/app/api/v1/landing.py),
 * which decides by the permissions the admin gave the role (landing.edit,
 * landing.publish) and checks the block and its body itself.
 */
export async function passToLanding(path: string, options: CallBackendOptions = {}): Promise<NextResponse> {
  return backendResponse(await callBackend(`/api/v1/content/blocks${path}`, options));
}

/** A block key or a revision number, as one path segment. */
export const segment = (value: string) => `/${encodeURIComponent(value)}`;

/** The JSON body, or the 400 to answer. */
export async function jsonBody(req: NextRequest): Promise<{ body: unknown } | { error: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    return { error: NextResponse.json({ error: { code: "invalid_json", message: "Invalid JSON" } }, { status: 400 }) };
  }
}
