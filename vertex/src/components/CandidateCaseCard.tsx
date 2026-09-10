"use client";

import { useEffect, useState } from "react";
import CaseStageProgress from "@/components/portal/CaseStageProgress";
import type { CaseStageKey } from "@/components/portal/caseStages";

interface CandidateCase {
  id: string;
  current_stage: CaseStageKey;
  contract: { status: string; content: string; signed_by_name: string | null; signed_at: string | null } | null;
  application: {
    job: { title: string; country: string; city: string } | null;
    preferred_country_1: { name: string } | null;
    preferred_sector: { name: string } | null;
  };
}

interface Props {
  /** Show an explicit "no cases" message instead of rendering nothing —
   * for a dedicated Cases tab where this is the whole page's content, as
   * opposed to an addendum on a longer dashboard where silently
   * disappearing is the right call. */
  showEmptyState?: boolean;
}

/**
 * The candidate's own view of their mobility case (SRS FR-4.1/4.3) — read
 * progress, sign the contract. No stage-advance or document-verification
 * controls here; those stay with staff.
 */
export default function CandidateCaseCard({ showEmptyState = false }: Props = {}) {
  const [cases, setCases] = useState<CandidateCase[]>([]);
  const [loading, setLoading] = useState(true);
  const [signName, setSignName] = useState("");

  // /api/cases (list) only returns a slim contract summary (status) for
  // the staff case table — a candidate needs the full contract content to
  // read and sign, so fetch full detail per case (a candidate has at most
  // a small handful of cases, so this N+1 is cheap at this scale).
  const load = async () => {
    const listRes = await fetch("/api/cases");
    const listJson = await listRes.json();
    const ids: string[] = (listJson.data ?? []).map((c: { id: string }) => c.id);
    const details = await Promise.all(
      ids.map((id) => fetch(`/api/cases/${id}`).then((r) => r.json()).then((r) => r.data))
    );
    setCases(details.filter(Boolean));
    setLoading(false);
  };

  useEffect(() => { load(); }, []);

  const sign = async (caseId: string) => {
    if (!signName.trim()) return;
    const res = await fetch(`/api/cases/${caseId}/contract/sign`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signed_by_name: signName }),
    });
    const json = await res.json();
    if (!res.ok) { alert(json.error ?? "Failed to sign."); return; }
    setSignName("");
    load();
  };

  if (loading) return showEmptyState ? <p className="text-midnight-900/50">Loading…</p> : null;

  if (cases.length === 0) {
    if (!showEmptyState) return null;
    return (
      <div className="card p-10 text-center text-midnight-900/40">
        No case yet — one opens automatically once your application is approved.
      </div>
    );
  }

  return (
    <div className="card p-6">
      <h2 className="text-lg font-semibold text-midnight-900 mb-5">My Placement Case</h2>
      <div className="space-y-6">
        {cases.map((c) => (
          <div key={c.id}>
            <p className="text-sm text-midnight-900/50 mb-3">
              {c.application.job
                ? <>{c.application.job.title} · {c.application.job.city}, {c.application.job.country}</>
                : <>{c.application.preferred_sector?.name ?? "General Programme"}{c.application.preferred_country_1 && <> · {c.application.preferred_country_1.name}</>}</>}
            </p>
            <CaseStageProgress stage={c.current_stage} />

            {c.contract && (
              <div className="mt-5 pt-5 border-t border-midnight-900/10">
                <h3 className="text-sm font-semibold text-midnight-900 mb-2">Contract</h3>
                <pre className="text-xs bg-ivory-100 rounded-lg p-4 whitespace-pre-wrap max-h-60 overflow-y-auto mb-3">{c.contract.content}</pre>
                {c.contract.status === "signed" ? (
                  <p className="text-xs text-midnight-900/50">Signed by {c.contract.signed_by_name} on {new Date(c.contract.signed_at!).toLocaleString()}</p>
                ) : (
                  <div className="flex items-center gap-2">
                    <input
                      value={signName}
                      onChange={(e) => setSignName(e.target.value)}
                      className="input-field text-sm"
                      placeholder="Type your full legal name to sign"
                    />
                    <button onClick={() => sign(c.id)} disabled={!signName.trim()} className="btn-primary text-xs whitespace-nowrap disabled:opacity-40">
                      Sign Contract
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
