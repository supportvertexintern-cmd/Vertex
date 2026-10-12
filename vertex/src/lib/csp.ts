// Content Security Policy with per-request nonces (exception E3,
// docs/security/csp.md). Dependency-free: used by src/proxy.ts on every
// page and API response, and by the regression test.
//
// Scripts run only if they carry this response's nonce, or were added by a
// script that did ('strict-dynamic': Next.js's chunks, the Google Translate
// and Calendly loaders). No 'unsafe-inline' and no 'unsafe-eval' for
// scripts. Styles keep 'unsafe-inline' for now (React style attributes);
// far lower risk, tracked as a follow-up.
//
// CSP_MODE (runtime env):
//   report-only (default)  the nonce policy is sent as
//                          Content-Security-Policy-Report-Only, next to the
//                          previous policy, still enforced from next.config.ts
//                          (it allows inline scripts). Violations go to
//                          /api/csp-report.
//   enforce                the proxy replaces it with the nonce policy on
//                          every page.

export const NONCE_HEADER = "x-nonce";
export const CSP_REPORT_PATH = "/api/csp-report";
export const CSP_REPORT_GROUP = "csp-endpoint";

export type CspMode = "report-only" | "enforce";

export function cspMode(): CspMode {
  return process.env.CSP_MODE === "enforce" ? "enforce" : "report-only";
}

/** 128 bits from the platform CSPRNG, base64. New for every response. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}

const isDev = () => process.env.NODE_ENV === "development";

// Hosts the pages load from (layout.tsx: Google Translate; CalendlyEmbed).
const STYLE_HOSTS = "https://www.gstatic.com https://translate.googleapis.com https://assets.calendly.com";
const CONNECT_HOSTS = "https://translate.googleapis.com https://translate-pa.googleapis.com";
const FRAME_HOSTS = "https://calendly.com https://*.calendly.com https://translate.google.com";

/** The target policy: nonce-based, no inline or eval for scripts. */
export function noncePolicy(nonce: string, { https }: { https: boolean }): string {
  return [
    "default-src 'self'",
    // 'self' and https: only matter to browsers without 'strict-dynamic'
    // support (they ignore them otherwise). Next.js dev mode needs eval.
    `script-src 'nonce-${nonce}' 'strict-dynamic' 'self' https:${isDev() ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline' ${STYLE_HOSTS}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_HOSTS}`,
    `frame-src ${FRAME_HOSTS}`,
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only behind HTTPS: on the local http stacks it would break every
    // subresource.
    ...(https ? ["upgrade-insecure-requests"] : []),
    `report-uri ${CSP_REPORT_PATH}`,
    // report-to too only behind HTTPS: where it is present Chromium ignores
    // report-uri, and over plain http it delivered nothing (tested
    // 2026-10-12), so the local stacks would get no reports at all.
    ...(https ? [`report-to ${CSP_REPORT_GROUP}`] : []),
  ].join("; ");
}

/** The policy enforced before E3: next.config.ts's static baseline for every
 * response (API and static files too), replaced on pages in enforce mode. */
export function legacyPolicy(): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev() ? " 'unsafe-eval'" : ""} https://translate.google.com https://translate.googleapis.com https://www.gstatic.com https://assets.calendly.com`,
    `style-src 'self' 'unsafe-inline' ${STYLE_HOSTS}`,
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${CONNECT_HOSTS}`,
    `frame-src ${FRAME_HOSTS}`,
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

export interface CspHeaders {
  /** Response headers to set. */
  response: Record<string, string>;
  /** Request headers for Next.js: it reads the nonce from the CSP header. */
  request: Record<string, string>;
}

export function pageCsp(nonce: string, opts: { https: boolean; mode?: CspMode }): CspHeaders {
  const policy = noncePolicy(nonce, opts);
  const reporting: Record<string, string> = opts.https ? { "Reporting-Endpoints": `${CSP_REPORT_GROUP}="${CSP_REPORT_PATH}"` } : {};
  if ((opts.mode ?? cspMode()) === "enforce") {
    return {
      response: { "Content-Security-Policy": policy, ...reporting },
      request: { "content-security-policy": policy, [NONCE_HEADER]: nonce },
    };
  }
  // Report-only: the enforced policy stays next.config.ts's static
  // legacyPolicy(). The proxy must NOT set Content-Security-Policy on the
  // response here: Next.js copies a proxy's response headers into the
  // request (resolve-routes.js), which would replace the nonce'd request
  // header below and leave every script without a nonce (found by the
  // browser smoke test, 2026-10-12). The request header is internal;
  // Next.js only extracts the nonce from it.
  return {
    response: { "Content-Security-Policy-Report-Only": policy, ...reporting },
    request: { "content-security-policy": policy, [NONCE_HEADER]: nonce },
  };
}

/** The script-src directive of a policy, for checks. */
export function scriptSrc(policy: string): string {
  return policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src ")) ?? "";
}
