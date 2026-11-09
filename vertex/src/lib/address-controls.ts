import { BlockList, isIP } from "node:net";
import { callBackend } from "./backend";
import { clientKey } from "./client-ip";
import { log } from "./log";

// Address controls (login protection PR 5, 2026-11-09): an admin's blocks and
// allows on network addresses and ranges, kept by FastAPI
// (vertex_be/app/services/address_controls.py) and read here at most once a
// minute.
//   - A blocked address gets 403 on sign-in, registration and password reset
//     (refuseBlocked, at the top of those routes).
//   - An allowed one skips this site's per-address limits (lib/rate-limit.ts).
//     FastAPI's per-account lockout always applies.
// Where both match, the block wins. If FastAPI can't be asked, the last list
// stands; if there never was one, nothing is blocked or allowed (the limits
// and the lockout still apply), and the failure is logged.

const REFRESH_MS = 60_000;
const RETRY_MS = 10_000;

interface Rules {
  blocked: BlockList;
  allowed: BlockList;
}

let rules: Rules | null = null;
let fetchedAt = 0;
let pending: Promise<void> | null = null;

function listOf(networks: string[]): BlockList {
  const list = new BlockList();
  for (const network of networks) {
    const [address, bits] = network.split("/");
    const type = isIP(address) === 6 ? "ipv6" : "ipv4";
    if (!isIP(address)) continue;
    list.addSubnet(address, Number(bits ?? (type === "ipv6" ? 128 : 32)), type);
  }
  return list;
}

async function refresh(): Promise<void> {
  const res = await callBackend<{ network: string; kind: "block" | "allow" }[]>("/api/v1/address-controls", { asUser: false, timeoutMs: 1500 });
  if (!res.ok) {
    log.error("address_controls.unavailable", { status: res.status, code: res.error.code });
    fetchedAt = Date.now() - REFRESH_MS + RETRY_MS; // try again in a few seconds
    return;
  }
  rules = {
    blocked: listOf(res.body.data.filter((r) => r.kind === "block").map((r) => r.network)),
    allowed: listOf(res.body.data.filter((r) => r.kind === "allow").map((r) => r.network)),
  };
  fetchedAt = Date.now();
}

async function current(): Promise<Rules | null> {
  if (!process.env.BACKEND_URL) return null; // no FastAPI (unit tests): no controls
  if (Date.now() - fetchedAt >= REFRESH_MS) {
    pending ??= refresh().finally(() => {
      pending = null;
    });
    await pending;
  }
  return rules;
}

function family(ip: string): "ipv4" | "ipv6" | null {
  const v = isIP(ip);
  return v === 4 ? "ipv4" : v === 6 ? "ipv6" : null;
}

/** Whether an admin has blocked this address. */
export async function isBlocked(ip: string): Promise<boolean> {
  const type = family(ip);
  const now = type && (await current());
  return Boolean(now && type && now.blocked.check(ip, type));
}

/** Whether an admin has exempted this address from per-address limits (and not blocked it). */
export async function isAllowed(ip: string): Promise<boolean> {
  const type = family(ip);
  const now = type && (await current());
  return Boolean(now && type && now.allowed.check(ip, type) && !now.blocked.check(ip, type));
}

export const BLOCKED_MESSAGE = "Requests from this network have been blocked. Contact support if you think this is a mistake.";

/**
 * For the website's sign-in, registration and password-reset routes: a 403
 * ({ error: message }, as those pages read it) for a blocked address, or
 * null to continue. The app's routes answer in their own shape.
 */
export async function refuseBlocked(req: Request): Promise<Response | null> {
  if (!(await isBlocked(clientKey(req.headers)))) return null;
  log.warn("address_controls.blocked", { path: new URL(req.url).pathname });
  return Response.json({ error: BLOCKED_MESSAGE }, { status: 403 });
}

/** Tests only: forget the cached list. */
export function resetAddressControls(): void {
  rules = null;
  fetchedAt = 0;
  pending = null;
}
