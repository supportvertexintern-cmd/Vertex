"use client";

import { usePathname } from "next/navigation";
import { Warning } from "@phosphor-icons/react";

// Fraud-warning banner (2026-09-04) — vertex-recruite.co.uk is
// impersonating Vertex and is not affiliated with us in any way.
// Deliberately non-dismissible (no close button) and scoped to the
// public landing page only ("/"), not every route in the app — a portal
// user already knows they're on the real site once logged in.
export default function ImpersonationWarningBanner() {
  const pathname = usePathname();
  if (pathname !== "/") return null;

  return (
    <div className="bg-red-700 text-white text-sm">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 py-2.5 flex items-center justify-center gap-2 text-center">
        <Warning size={18} weight="fill" className="shrink-0" />
        <p>
          <strong className="font-semibold">Fraud warning:</strong> the website{" "}
          <strong className="font-semibold">vertex-recruite.co.uk</strong> is impersonating Vertex International
          Recruitment Ltd. and is <strong className="font-semibold">not affiliated with us in any way</strong>. If
          you were contacted through that site, do not share personal information or make any payment — contact us
          directly to verify.
        </p>
      </div>
    </div>
  );
}
