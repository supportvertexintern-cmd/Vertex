"use client";
export const dynamic = "force-dynamic";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import ApplicationForm from "@/components/ApplicationForm";

interface Profile {
  nationality?: string | null;
  second_nationality?: string | null;
  date_of_birth?: string | null;
  passport_number?: string | null;
  passport_expiry?: string | null;
  current_occupation?: string | null;
  highest_education?: string | null;
  home_address?: string | null;
  whatsapp_number?: string | null;
  marital_status?: string | null;
  // Authoritative full_name/email/phone live on the linked User once an
  // account exists — prefilled into the CIF's Section 2 alongside the
  // Candidate-only fields above, same fallback used elsewhere in the app.
  user?: { full_name?: string | null; email?: string | null; phone?: string | null } | null;
}

interface OpportunityJob {
  id: string;
  title: string;
}

export default function ApplyPage() {
  return (
    <Suspense fallback={<div className="bg-slate-50 min-h-screen" />}>
      <ApplyPageInner />
    </Suspense>
  );
}

function ApplyPageInner() {
  const searchParams = useSearchParams();
  const jobId = searchParams.get("job") || undefined;

  const [authState, setAuthState] = useState<"loading" | "signed_out" | "signed_in">("loading");
  const [profile, setProfile] = useState<Profile | null>(null);
  // Mirrors the server's own duplicate-application check (POST
  // /api/applications rejects a second non-rejected one) so the form isn't
  // shown only to fail on submit — but a candidate whose only prior
  // application was rejected can still see and resubmit it.
  const [hasActiveApplication, setHasActiveApplication] = useState(false);
  // Set when arriving via /apply?job=... from a specific /jobs opportunity
  // — jobId itself preselects ApplicationForm's Section 1 job picker; this
  // is only for the confirmation banner's title text.
  const [opportunity, setOpportunity] = useState<OpportunityJob | null>(null);
  // Referral Agent attribution (2026-08-29) — persisted to localStorage so
  // a candidate who followed a referral link earlier still carries
  // attribution on a later visit, same precedent as WelcomePopup's
  // vertex_welcome_accepted key.
  const [referralCode, setReferralCode] = useState<string | undefined>(undefined);

  useEffect(() => {
    const refParam = searchParams.get("ref");
    if (refParam) {
      localStorage.setItem("vertex_referral_code", refParam);
      setReferralCode(refParam);
    } else {
      setReferralCode(localStorage.getItem("vertex_referral_code") || undefined);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!jobId) return;
    fetch(`/api/jobs/${jobId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => setOpportunity(data?.id ? data : null))
      .catch(() => {});
  }, [jobId]);

  useEffect(() => {
    fetch("/api/candidates/profile")
      .then((r) => {
        if (r.status === 401) {
          setAuthState("signed_out");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) {
          setProfile(data);
          setAuthState("signed_in");
        }
      })
      .catch(() => setAuthState("signed_out"));

    fetch("/api/applications")
      .then((r) => r.json())
      .then((apps) => {
        if (Array.isArray(apps)) {
          setHasActiveApplication(apps.some((a) => a.application_status !== "rejected"));
        }
      })
      .catch(() => {});
  }, []);

  return (
    <div className="bg-slate-50 min-h-screen">
      <section className="bg-gradient-to-br from-emerald-950 to-emerald-800 text-white py-12">
        <div className="max-w-4xl mx-auto px-4 text-center">
          <h1 className="text-3xl font-black mb-2">Candidate Information Form</h1>
          <p className="text-emerald-200">European Work Permit & Visa Application</p>
        </div>
      </section>

      <div className="max-w-2xl mx-auto px-4 py-16">
        <div className="card p-8 mb-6">
          <p className="text-slate-600 text-sm leading-relaxed">
            This form collects the information we need to begin your work permit and visa application.
            Please complete all sections as accurately as possible — every detail is checked against your
            passport and supporting documents. We ask for multiple programme options because vacancy
            availability and embassy capacity vary by country; having alternatives prevents delays.
          </p>
        </div>

        {opportunity && (
          <div className="bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3 mb-6 text-sm text-emerald-800">
            Applying for <span className="font-semibold">{opportunity.title}</span> — we've preselected this
            programme below.
          </div>
        )}

        {authState === "loading" && <p className="text-center text-slate-400 py-10">Loading…</p>}

        {authState === "signed_out" && (
          <div className="card p-8">
            <ApplicationForm
              includePersonalInfo
              onSubmitted={() => {}}
              jobId={jobId}
              useEmailIntakeIfConfigured
              referralCode={referralCode}
            />
            <p className="text-center text-xs text-slate-400 mt-4">
              Already submitted and have an account? <Link href="/auth/login?redirect=/apply" className="underline">Log in</Link> to check your status.
            </p>
          </div>
        )}

        {authState === "signed_in" && profile && (
          <>
            {hasActiveApplication ? (
              <div className="card p-8 text-center">
                <h2 className="font-bold text-slate-800 text-lg mb-2">You already have an application on file</h2>
                <p className="text-slate-500 text-sm mb-6">Track its progress from your dashboard.</p>
                <Link href="/dashboard" className="btn-primary text-sm py-2.5 px-6">View Dashboard</Link>
              </div>
            ) : (
              <div className="card p-8">
                <ApplicationForm
                  includePersonalInfo
                  onSubmitted={() => fetch("/api/candidates/profile").then((r) => r.json()).then(setProfile)}
                  jobId={jobId}
                  useEmailIntakeIfConfigured
                  referralCode={referralCode}
                  signedInCandidate
                  initialProfile={{
                    full_name: profile.user?.full_name ?? undefined,
                    email: profile.user?.email ?? undefined,
                    phone: profile.user?.phone ?? undefined,
                    nationality: profile.nationality ?? undefined,
                    second_nationality: profile.second_nationality ?? undefined,
                    date_of_birth: profile.date_of_birth?.slice(0, 10),
                    passport_number: profile.passport_number ?? undefined,
                    passport_expiry: profile.passport_expiry?.slice(0, 10),
                    current_occupation: profile.current_occupation ?? undefined,
                    highest_education: profile.highest_education ?? undefined,
                    home_address: profile.home_address ?? undefined,
                    whatsapp_number: profile.whatsapp_number ?? undefined,
                    marital_status: profile.marital_status ?? undefined,
                  }}
                />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
