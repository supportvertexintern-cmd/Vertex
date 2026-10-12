/**
 * The public endpoint register (docs/security/zero-trust.md §3).
 *
 * Every API handler must either check the caller (requireRole / requireAdmin
 * / requireAuth / an explicit `if (!user)` 401) or be listed here. Being
 * listed is a reviewed decision: say why it is public and what protects it.
 * src/lib/route-guards.test.ts fails CI on any handler that does neither, on
 * stale entries, and on public endpoints that should be rate-limited but
 * aren't.
 *
 * `protection`:
 *  - "rate-limit"       must call limitByIp/rateLimit
 *  - "signed-token"     needs a signed, expiring single-purpose token
 *  - "signature"        needs the sender's cryptographic signature
 *  - "refresh-token"    needs a live server-side refresh token (lib/session.ts)
 *  - "none-needed"      has no effect without a session (e.g. logout)
 */
export type PublicProtection = "rate-limit" | "signed-token" | "signature" | "refresh-token" | "none-needed";

export const PUBLIC_ENDPOINTS: Record<string, { purpose: string; protection: PublicProtection[] }> = {
  "POST /api/auth/login": { purpose: "sign in", protection: ["rate-limit"] },
  "POST /api/auth/logout": { purpose: "sign out: revokes this browser's session, clears the cookies", protection: ["none-needed"] },
  "POST /api/auth/refresh": { purpose: "renew an expired 15-minute access token (G19)", protection: ["rate-limit", "refresh-token"] },
  "GET /api/auth/refresh": { purpose: "renew the access token on a page navigation, then redirect back", protection: ["rate-limit", "refresh-token"] },
  "GET /api/auth/register": { purpose: "look up an account-setup invite link", protection: ["rate-limit"] },
  "POST /api/auth/register": { purpose: "create a candidate account", protection: ["rate-limit"] },
  "POST /api/auth/forgot-password": { purpose: "request a reset email; same reply for unknown accounts", protection: ["rate-limit"] },
  "POST /api/auth/reset-password": { purpose: "set a new password", protection: ["rate-limit", "signed-token"] },
  "GET /api/auth/verify-email": { purpose: "confirm an email address", protection: ["rate-limit", "signed-token"] },
  "GET /api/auth/google": { purpose: "start Google sign-in", protection: ["rate-limit"] },
  "GET /api/auth/google/callback": { purpose: "finish Google sign-in", protection: ["rate-limit"] },
  "GET /api/apply/options": { purpose: "application form choices (country/document names)", protection: ["rate-limit"] },
  "GET /api/jobs/[id]": { purpose: "public job page: active/closed jobs, public fields only", protection: ["rate-limit"] },
  "POST /api/applications": { purpose: "public apply form (anonymous applicants; staff/candidates are checked inside)", protection: ["rate-limit"] },
  "POST /api/contact": { purpose: "contact form", protection: ["rate-limit"] },
  "POST /api/public-intake/application": { purpose: "public application form", protection: ["rate-limit"] },
  "POST /api/consultations/checkout": { purpose: "pay for a consultation", protection: ["rate-limit"] },
  "POST /api/chat": { purpose: "website AI assistant over public knowledge", protection: ["rate-limit"] },
  "GET /api/documents/file": { purpose: "download one file named in a short-lived signed URL", protection: ["signed-token"] },
  "POST /api/webhooks/stripe": { purpose: "payment events from Stripe", protection: ["signature"] },
};
