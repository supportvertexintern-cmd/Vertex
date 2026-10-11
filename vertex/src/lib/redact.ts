// Strips credentials from anything that is about to be logged or written to
// the audit trail (Phase 10). Two layers: values under a sensitive-looking
// key are replaced outright, and every string is scanned for credential
// shapes (JWTs, bearer tokens, connection strings with a password), so a
// secret embedded in an error message is caught too.

// (Not plain "pass": that would also hide passport fields.)
const SENSITIVE_KEY = /password|passwd|passphrase|(^|_)pass($|_)|secret|token|authorization|cookie|api[_-]?key|private[_-]?key|credential|database_url|dsn|session/i;

// Keys that match the pattern above but hold no secret.
const SAFE_KEYS = new Set(["permit_authorization_approved", "stripe_checkout_session_id"]);

const STRING_PATTERNS: [RegExp, string][] = [
  // Connection strings: keep the scheme and host, drop the user and password.
  [/\b([a-z][a-z0-9+.-]*:\/\/)[^\s:/@]+:[^\s@/]+@/gi, "$1[redacted]@"],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]"],
  [/\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]+/g, "[redacted-jwt]"],
  [/((?:auth_token|token|access_token|refresh_token|api_key|password)=)[^\s&;"]+/gi, "$1[redacted]"],
];

export const REDACTED = "[redacted]";

export function redactString(value: string): string {
  let out = value;
  for (const [pattern, replacement] of STRING_PATTERNS) out = out.replace(pattern, replacement);
  return out;
}

export function isSensitiveKey(key: string): boolean {
  return !SAFE_KEYS.has(key) && SENSITIVE_KEY.test(key);
}

/** A redacted, JSON-safe copy. Never throws: cycles, BigInts and getters that throw all become placeholders. */
export function redact(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  try {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") return redactString(value);
    if (typeof value === "number" || typeof value === "boolean") return value;
    if (typeof value === "bigint") return value.toString();
    if (typeof value === "function" || typeof value === "symbol") return undefined;
    if (value instanceof Date) return value.toISOString();
    if (value instanceof Error) {
      return { name: value.name, message: redactString(value.message), code: (value as { code?: unknown }).code };
    }
    if (depth > 8) return "[truncated]";
    if (typeof value === "object") {
      if (seen.has(value)) return "[circular]";
      seen.add(value);
      if (Array.isArray(value)) return value.slice(0, 100).map((v) => redact(v, depth + 1, seen));
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = isSensitiveKey(k) && v !== null && v !== undefined && v !== "" ? REDACTED : redact(v, depth + 1, seen);
      }
      return out;
    }
    return String(value);
  } catch {
    return "[unserializable]";
  }
}
