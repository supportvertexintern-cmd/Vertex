/**
 * Only same-site relative paths are allowed as post-login destinations.
 * Anything else ("//evil.com", "@evil.com", ".evil.com", "https://…",
 * backslash tricks) would let a crafted link send a freshly signed-in user
 * to another site, so it falls back to the default.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value) return fallback;
  let path = value;
  try {
    path = decodeURIComponent(value);
  } catch {
    return fallback;
  }
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) return fallback;
  // Reject control characters, which some browsers strip before resolving.
  if (/[\u0000-\u001f\u007f]/.test(path)) return fallback;
  return path;
}
