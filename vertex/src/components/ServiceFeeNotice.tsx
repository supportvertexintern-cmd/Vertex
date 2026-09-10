// Shared source of truth (2026-07-31, Stripe restricted to self-applicants
// + 2026 pricing revision) for the legal notice that must accompany any
// service-fee display — one copy of the exact wording, reused by /jobs,
// /jobs/[id], and ApplicationForm.tsx's Payment Plan Acknowledgement
// section, rather than the same paragraph drifting across three places.
const NOTICE_TEXT =
  "Important Notice: The fees listed below are for recruitment support, document processing, immigration assistance, work permit facilitation, and related administrative services. They are not fees for employment itself. Employment remains subject to employer selection, work permit approval, and visa issuance by the relevant authorities.";

const SELF_APPLICANT_TEXT =
  "These prices apply to candidates applying directly (self-applicants). If you were referred by a partner agency or a Vertex recruiter, your fee arrangement is handled by them separately, not through this pricing.";

export default function ServiceFeeNotice({ variant }: { variant: "dark" | "light" | "plain" }) {
  if (variant === "dark") {
    return (
      <div className="mb-4">
        <h3 className="text-xs font-semibold uppercase tracking-[0.1em] text-gold-300 mb-2">
          Recruitment &amp; Immigration Support Service Fees
        </h3>
        <p className="text-ivory-50/60 text-[11px] leading-relaxed mb-2">{NOTICE_TEXT}</p>
        <p className="text-ivory-50/45 text-[11px] leading-relaxed">{SELF_APPLICANT_TEXT}</p>
      </div>
    );
  }

  if (variant === "light") {
    return (
      <div className="bg-gold-500/5 border border-gold-500/20 rounded-2xl p-5 md:p-6 mb-6">
        <h2 className="text-sm font-semibold uppercase tracking-[0.1em] text-gold-700 mb-2">
          Recruitment &amp; Immigration Support Service Fees
        </h2>
        <p className="text-midnight-900/60 text-xs leading-relaxed mb-2">{NOTICE_TEXT}</p>
        <p className="text-midnight-900/50 text-xs leading-relaxed">{SELF_APPLICANT_TEXT}</p>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
      <h3 className="text-xs font-bold text-amber-900 uppercase tracking-wide mb-1.5">
        Recruitment &amp; Immigration Support Service Fees
      </h3>
      <p className="text-[11px] text-amber-800 leading-relaxed mb-1.5">{NOTICE_TEXT}</p>
      <p className="text-[11px] text-amber-700 leading-relaxed">{SELF_APPLICANT_TEXT}</p>
    </div>
  );
}
