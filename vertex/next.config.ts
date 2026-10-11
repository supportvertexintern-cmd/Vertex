import type { NextConfig } from "next";

// Content Security Policy (Phase 8, from the ZAP scan). External origins
// are only those the pages actually load: Google Translate (layout.tsx) and
// the Calendly widget (CalendlyEmbed.tsx). Stripe Checkout and PayPal are
// top-level redirects or server-side calls; fonts are self-hosted by
// next/font. Scripts still need 'unsafe-inline' for Next.js's own inline
// bootstrap; moving to per-request nonces is the next step (it makes every
// page dynamic, so it's a separate change).
const isDev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""} https://translate.google.com https://translate.googleapis.com https://www.gstatic.com https://assets.calendly.com`,
  "style-src 'self' 'unsafe-inline' https://www.gstatic.com https://translate.googleapis.com https://assets.calendly.com",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://translate.googleapis.com https://translate-pa.googleapis.com",
  "frame-src https://calendly.com https://*.calendly.com https://translate.google.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

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
          { key: "Content-Security-Policy", value: csp },
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
