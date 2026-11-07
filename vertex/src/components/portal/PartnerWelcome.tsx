"use client";

// The partner portal's first-time welcome (owner's requirement 2026-11-07):
// shown once, after the first sign-in activated the partner's login. FastAPI
// decides "once" (POST /api/partner/welcome answers show: true a single time),
// so it doesn't come back on a later sign-in, another browser or a password
// reset. Asked once per page load: a second request would already say no.

import { useEffect, useRef, useState } from "react";
import { HandWaving } from "@phosphor-icons/react";

interface Welcome {
  show: boolean;
  agency_name: string | null;
}

export default function PartnerWelcome() {
  const [welcome, setWelcome] = useState<Welcome | null>(null);
  const asked = useRef(false);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    fetch("/api/partner/welcome", { method: "POST" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => {
        if (body?.data?.show) setWelcome(body.data);
      })
      .catch(() => {}); // no welcome is better than an error on the dashboard
  }, []);

  useEffect(() => {
    if (welcome) button.current?.focus();
  }, [welcome]);

  if (!welcome) return null;
  const close = () => setWelcome(null);

  return (
    <div
      className="fixed inset-0 z-[70] bg-midnight-950/60 flex items-center justify-center p-4"
      onKeyDown={(e) => e.key === "Escape" && close()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="partner-welcome-title"
        className="bg-white rounded-2xl shadow-xl w-full max-w-lg p-8 text-center"
      >
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-gold-300/30 text-gold-600">
          <HandWaving size={30} weight="duotone" />
        </div>
        <h2 id="partner-welcome-title" className="text-2xl font-semibold text-midnight-950 mb-3">
          Welcome to Vertex!
        </h2>
        <p className="text-midnight-950 font-medium mb-2">Hello, {welcome.agency_name ?? "partner"}!</p>
        <p className="text-sm text-midnight-950/70 mb-2">
          Your partner account has been successfully activated. Welcome to the Vertex Partner Portal.
        </p>
        <p className="text-sm text-midnight-950/70 mb-6">
          You can now start managing your candidate applications, submit candidates and track their application progress.
        </p>
        <button ref={button} type="button" onClick={close} className="btn-primary">
          Go to Partner Dashboard
        </button>
      </div>
    </div>
  );
}
