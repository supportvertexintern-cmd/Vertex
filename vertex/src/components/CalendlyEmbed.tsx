"use client";

import Script from "next/script";

// Isolated as its own client component (2026-08-06) — next/script's widget
// loader broke Next.js's page-data collection when rendered directly from
// a pure async Server Component page (src/app/consultation/confirmed/page.tsx).
export default function CalendlyEmbed({ url }: { url: string }) {
  return (
    <>
      <div className="calendly-inline-widget" data-url={url} style={{ minWidth: "320px", height: "700px" }} />
      <Script src="https://assets.calendly.com/assets/external/widget.js" strategy="lazyOnload" />
    </>
  );
}
