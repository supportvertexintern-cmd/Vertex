"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { CANDIDATE_NAV_ITEMS } from "@/components/portal/candidateNav";
import CandidateMessages from "@/components/CandidateMessages";

export default function CandidateMessagesPage() {
  const [candidateId, setCandidateId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/candidates/profile")
      .then((r) => r.json())
      .then((p) => setCandidateId(p.error ? null : p.id))
      .finally(() => setLoading(false));
  }, []);

  return (
    <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Account
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Messages.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">Your conversation with your assigned recruiter.</p>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : !candidateId ? (
        <div className="card p-10 text-center text-midnight-900/50">Failed to load your profile.</div>
      ) : (
        <CandidateMessages candidateId={candidateId} />
      )}
    </PortalShell>
  );
}
