"use client";

import { useState } from "react";
import { Compass, ClipboardText, ShieldCheck, ArrowRight } from "@phosphor-icons/react";

// Placeholder copy (2026-08-06) — first draft for the business to refine,
// not final marketing copy. Modeled on https://andagain.ae/pathway's
// direct CTA-to-payment-processor flow: no pre-payment form here, the
// "Book Now" button goes straight to Stripe Checkout, which collects the
// customer's own contact details.
const INCLUDES = [
  {
    icon: Compass,
    title: "Programme fit assessment",
    description: "A candid read on which of Vertex's work-permit programmes actually match your background and goals.",
  },
  {
    icon: ClipboardText,
    title: "Visa & documentation guidance",
    description: "What you'll need to have ready, and where your application is likely to run into friction.",
  },
  {
    icon: ShieldCheck,
    title: "A clear next step",
    description: "You'll leave the call knowing exactly what to do next — apply, prepare further, or look elsewhere.",
  },
];

export default function ConsultationPage() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleBookNow = async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/consultations/checkout", { method: "POST" });
      const data = await res.json();
      if (!res.ok || !data.url) {
        setError(data.error || "Couldn't start checkout. Please try again.");
        setLoading(false);
        return;
      }
      window.location.href = data.url;
    } catch {
      setError("Couldn't start checkout. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-6">
            <span className="eyebrow-rule" />
            Consultation
          </p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02] mb-4 max-w-3xl">
            The Pathway Consultation.
          </h1>
          <p className="text-ivory-50/50 text-lg font-light max-w-xl">
            A paid 1:1 advisory session before you apply — an honest look at your programme fit and visa
            eligibility, from someone who does this every day.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="bg-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-24">
            {/* What's included */}
            <div>
              <p className="eyebrow mb-5">
                <span className="eyebrow-rule" />
                What&apos;s included
              </p>
              <h2 className="section-title text-3xl md:text-4xl mb-10">Worth knowing before you apply.</h2>
              <div className="space-y-8">
                {INCLUDES.map(({ icon: Icon, title, description }) => (
                  <div key={title} className="flex gap-5">
                    <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                      <Icon size={22} weight="regular" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-midnight-900 tracking-tight">{title}</h3>
                      <p className="text-midnight-900/60 text-sm mt-2 leading-relaxed max-w-sm">{description}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Booking card */}
            <div className="card p-8 md:p-10 h-fit">
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                Book your session
              </p>
              <div className="flex items-baseline gap-2 mb-6">
                <span className="text-5xl font-semibold text-midnight-900 tracking-tight">$50</span>
                <span className="text-midnight-900/50 text-sm">USD, one-time</span>
              </div>
              <p className="text-midnight-900/60 text-sm leading-relaxed mb-4">
                After payment, you&apos;ll pick an available time slot right away — no back-and-forth over email.
              </p>
              <p className="text-midnight-900/45 text-xs leading-relaxed mb-8">
                For prospective candidates only — if you&apos;re a recruitment partner or agency, please{" "}
                <a href="/contact" className="text-gold-600 hover:underline">contact us</a> directly instead.
              </p>
              {error && <div className="text-red-600 text-sm mb-4">{error}</div>}
              <button
                onClick={handleBookNow}
                disabled={loading}
                className="btn-primary w-full py-4 disabled:opacity-60 inline-flex items-center justify-center gap-2"
              >
                {loading ? "Redirecting…" : "Book Now — $50"}
                {!loading && <ArrowRight size={16} weight="bold" />}
              </button>
              <p className="text-midnight-900/35 text-xs mt-4 text-center">
                Secure payment via Stripe. You&apos;ll be redirected to complete checkout.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
