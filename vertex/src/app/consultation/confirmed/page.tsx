import Link from "next/link";
import { WarningCircle } from "@phosphor-icons/react/dist/ssr";
import { stripe } from "@/lib/stripe";
import CalendlyEmbed from "@/components/CalendlyEmbed";

// Verifies payment server-side against Stripe directly — independent of
// the webhook (src/app/api/webhooks/stripe/route.ts), which is the source
// of truth for the durable ConsultationBooking record but may lag a few
// seconds behind this redirect. This page's own check exists purely to
// decide what to render, so it can't depend on that timing.
async function verifySession(sessionId: string | undefined) {
  if (!sessionId) return false;
  try {
    const session = await stripe.checkout.sessions.retrieve(sessionId);
    return session.payment_status === "paid" && session.metadata?.type === "consultation";
  } catch {
    return false;
  }
}

export default async function ConsultationConfirmedPage({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const { session_id } = await searchParams;
  const confirmed = await verifySession(session_id);
  const calendlyUrl = process.env.NEXT_PUBLIC_CALENDLY_URL;

  if (!confirmed) {
    return (
      <section className="bg-ivory-50 py-20 md:py-24 min-h-[60vh] flex items-center">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <WarningCircle size={56} weight="fill" className="text-red-500 mx-auto mb-5" />
          <h1 className="section-title text-3xl md:text-4xl mb-3">We couldn&apos;t confirm your payment.</h1>
          <p className="text-midnight-900/55 font-light mb-8 max-w-md mx-auto">
            If you completed checkout, this may just be a broken link — please try booking again, or contact us if
            you were charged.
          </p>
          <Link href="/consultation" className="btn-primary inline-block">Back to Consultation</Link>
        </div>
      </section>
    );
  }

  return (
    <section className="bg-ivory-50 py-20 md:py-24">
      <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center mb-10">
          <p className="eyebrow justify-center mb-5">
            <span className="eyebrow-rule" />
            Payment confirmed
          </p>
          <h1 className="section-title text-3xl md:text-4xl mb-3">Pick a time that works for you.</h1>
          <p className="text-midnight-900/55 font-light max-w-md mx-auto">
            Choose an available slot below and you&apos;re all set — a confirmation will follow by email.
          </p>
        </div>

        {calendlyUrl ? (
          <div className="card p-2 md:p-4">
            <CalendlyEmbed url={calendlyUrl} />
          </div>
        ) : (
          <div className="card p-10 text-center text-midnight-900/50 max-w-md mx-auto">
            Scheduling isn&apos;t available yet — we&apos;ll be in touch by email to arrange your session.
          </div>
        )}
      </div>
    </section>
  );
}
