"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import PortalShell from "@/components/portal/PortalShell";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";
import SearchableSelect from "@/components/SearchableSelect";
import PartnerCandidateForm from "@/components/portal/PartnerCandidateForm";

interface Partner {
  id: string;
  name: string;
}

// Staff-entered, on-behalf-of-a-partner submission (CRM Comments item 10,
// 2026-08-10) — see src/app/hr/partner-candidates/new/page.tsx for full
// context; this is Operations' equivalent entry point.
export default function OperationsNewPartnerCandidatePage() {
  const router = useRouter();
  const [partners, setPartners] = useState<Partner[]>([]);
  const [partnerId, setPartnerId] = useState("");

  useEffect(() => {
    fetch("/api/admin/partners")
      .then((r) => r.json())
      .then((res) => setPartners(res.data ?? []))
      .catch(() => {});
  }, []);

  return (
    <PortalShell roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Partner Network
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Add Candidate on Behalf of Partner.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        For candidates a partner already vetted before they had submission access — enter their details from the
        paper/scanned form and attach whatever documents you have on hand.
      </p>

      <div className="card p-6 mb-6 max-w-md">
        <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Partner Agency *</label>
        <SearchableSelect
          value={partnerId}
          onChange={setPartnerId}
          placeholder="Select the partner…"
          options={partners.map((p) => ({ value: p.id, label: p.name }))}
        />
      </div>

      {partnerId ? (
        <div className="card p-6">
          <PartnerCandidateForm partnerId={partnerId} onSubmitted={() => router.push("/operations/partner-candidates")} />
        </div>
      ) : (
        <div className="card p-10 text-center text-midnight-900/50">Select a partner above to continue.</div>
      )}
    </PortalShell>
  );
}
