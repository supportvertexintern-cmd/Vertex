import { NextResponse, type NextRequest } from "next/server";
import { callBackend, type BackendResult, type CallBackendOptions } from "@/lib/backend";
import { log } from "@/lib/log";

/**
 * The candidate pipeline is written by FastAPI since the switch
 * (docs/architecture/pipeline-handover.md, step 6.7): every pipeline route
 * here checks what it can early (role, JSON) and passes the request on.
 *
 * FastAPI sends every email a write leaves due itself since reads handover
 * R7b (vertex_be/app/services/emails.py). A response still carries
 * `notify`, always empty (vertex_be/tests/test_notices.py); it's never
 * passed on, and one that isn't empty is logged by kind, as an email lost.
 */

export interface PassOnOptions {
  /** Answer with `data` itself, as an older route did (default: {data}). */
  unwrap?: boolean;
  /** Errors as { error: message, details? }, for pages written against that shape. */
  legacyErrors?: boolean;
  /** Reshape a success before it's sent (e.g. add the form's upload token). */
  reshape?: (data: unknown, body: Record<string, unknown>) => unknown;
}

/** The route's answer from FastAPI's. */
export function pipelineResponse(result: BackendResult<unknown>, options: PassOnOptions = {}): NextResponse {
  if (!result.ok) {
    const { message, details } = result.error;
    const error = options.legacyErrors ? (details !== undefined ? { error: message, details } : { error: message }) : { error: result.error };
    return NextResponse.json(error, { status: result.status });
  }
  const { data, notify } = result.body as { data: unknown; notify?: unknown };
  if (Array.isArray(notify) && notify.length > 0) log.error("email.unsent_notice", { kinds: notify.map((n) => (n as { kind?: unknown })?.kind) });
  const shaped = options.reshape ? options.reshape(data, result.body) : data;
  return NextResponse.json(options.unwrap ? shaped : { data: shaped }, { status: result.status });
}

/** Calls FastAPI and answers with pipelineResponse(). */
export async function passOn(path: string, call: CallBackendOptions, options: PassOnOptions = {}): Promise<NextResponse> {
  return pipelineResponse(await callBackend(path, call), options);
}

/** A path segment from a route parameter, encoded. */
export const seg = (value: string) => encodeURIComponent(value);

/** The request's query parameters named, to pass on (an empty one is left out). */
export const queryOf = (req: NextRequest, keys: readonly string[]) =>
  Object.fromEntries(keys.map((key) => [key, req.nextUrl.searchParams.get(key) || undefined]));

/** The request's JSON body, or the 400 an unreadable one gets. */
export async function readJson(req: NextRequest, legacyErrors = false): Promise<{ body: unknown; invalid?: undefined } | { invalid: NextResponse }> {
  try {
    return { body: await req.json() };
  } catch {
    const error = legacyErrors ? { error: "Invalid JSON" } : { error: { code: "invalid_json", message: "Invalid JSON" } };
    return { invalid: NextResponse.json(error, { status: 400 }) };
  }
}
