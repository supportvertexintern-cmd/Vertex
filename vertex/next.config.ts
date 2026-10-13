import type { NextConfig } from "next";
import { legacyPolicy } from "./src/lib/csp";

// Content Security Policy (E3, docs/security/csp.md). This static policy is
// the baseline on every response. Pages also get a per-request nonce policy
// from src/proxy.ts: report-only by default, and with CSP_MODE=enforce it
// replaces this one on pages.

const nextConfig: NextConfig = {
  // output: 'standalone' is for self-hosted Node/cPanel only.
  // Remove it for Vercel — Vercel manages its own output format.

  // Don't advertise the framework (ZAP 10037).
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: legacyPolicy() },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
    ];
  },
};

export default nextConfig;
