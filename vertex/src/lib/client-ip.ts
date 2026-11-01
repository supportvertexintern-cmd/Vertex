// The browser's address, for rate limits and the audit trail (security
// review #5, auth hardening plan B.1). Taken only from X-Real-IP, which the
// stack's edge proxy (vertex_be/deploy/edge/Caddyfile) overwrites with the
// connecting address, and only when TRUST_PROXY_HEADERS is "true": set it
// where that proxy is the only way in. X-Forwarded-For is never read: a
// client can put anything in it.
//
// Without a trusted proxy (npm run dev, the end-to-end suite) there is no
// address: every caller shares the "direct" bucket.
export function clientIp(h: Headers): string | null {
  if (process.env.TRUST_PROXY_HEADERS?.trim().toLowerCase() !== "true") return null;
  const ip = h.get("x-real-ip")?.trim();
  return ip ? ip.slice(0, 64) : null;
}

/** The rate-limit key for a request's sender. */
export function clientKey(h: Headers): string {
  return clientIp(h) ?? "direct";
}
