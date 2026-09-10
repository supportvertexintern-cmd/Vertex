"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { CANDIDATE_NAV_ITEMS } from "@/components/portal/candidateNav";
import CandidateProfileForm from "@/components/CandidateProfileForm";
import { IdentificationCard } from "@phosphor-icons/react";

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
  user: { full_name: string; email: string; phone?: string; country?: string };
}

export default function CandidateProfilePage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const load = () => {
    fetch("/api/candidates/profile")
      .then((r) => r.json())
      .then((p) => setProfile(p.error ? null : p))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Account
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Profile.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Keep your personal details up to date — this is checked against your passport and supporting documents.
      </p>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : !profile ? (
        <div className="card p-10 text-center text-midnight-900/50">Failed to load your profile.</div>
      ) : (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-midnight-900 mb-4 flex items-center gap-2">
            <IdentificationCard size={18} weight="regular" /> Personal Information
          </h2>
          <div className="grid sm:grid-cols-3 gap-4 mb-6 text-sm">
            <div>
              <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Name</div>
              <div className="text-midnight-900">{profile.user.full_name}</div>
            </div>
            <div>
              <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Email</div>
              <div className="text-midnight-900">{profile.user.email}</div>
            </div>
            <div>
              <div className="text-[11px] text-midnight-900/40 uppercase tracking-wider mb-0.5">Phone</div>
              <div className="text-midnight-900">{profile.user.phone || "—"}</div>
            </div>
          </div>
          <CandidateProfileForm initial={profile} onSaved={load} />
        </div>
      )}
    </PortalShell>
  );
}
