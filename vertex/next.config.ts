import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  output: 'standalone',
  // Baseline security headers (PII platform — SRS NFR-6). Deliberately
  // not including Content-Security-Policy here: the site already loads
  // Google Translate's external script + an inline config script, and a
  // CSP added without carefully accounting for every existing embed
  // (translate, chat/WhatsApp widgets) fails closed and silently breaks
  // the page rather than degrading gracefully — needs its own dedicated
  // pass with real testing, not a drive-by addition alongside these.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
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
