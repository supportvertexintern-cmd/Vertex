"use client";

import { useEffect, useState } from "react";
import PortalShell from "@/components/portal/PortalShell";
import { CANDIDATE_NAV_ITEMS } from "@/components/portal/candidateNav";
import SupportingDocumentUpload from "@/components/portal/SupportingDocumentUpload";
import { documentTypeLabel } from "@/lib/documentTypes";
import { CheckCircle, FileText, UploadSimple } from "@phosphor-icons/react";

interface Application {
  id: string;
  job: { title: string } | null;
  preferred_sector: { name: string } | null;
  required_document_types: string[];
}

interface Profile {
  documents: { id: string; type: string; verification_status: string; uploaded_at: string; label: string | null }[];
}

function UploadTile({ type, label, uploaded, onUploaded }: { type: string; label: string; uploaded: boolean; onUploaded: () => void }) {
  const [uploading, setUploading] = useState(false);

  return (
    <label
      className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors group ${
        uploaded ? "border-emerald-300 bg-emerald-50/40" : "border-midnight-900/15 hover:border-gold-400 hover:bg-gold-50/40"
      }`}
    >
      {uploaded ? (
        <CheckCircle size={30} weight="fill" className="mx-auto mb-2 text-emerald-600" />
      ) : (
        <FileText size={30} weight="regular" className="mx-auto mb-2 text-midnight-900/40 group-hover:text-gold-600" />
      )}
      <div className="font-semibold text-midnight-800 group-hover:text-midnight-950">
        {uploading ? "Uploading…" : uploaded ? "Uploaded" : "Upload"} {label}
      </div>
      <div className="text-xs text-midnight-900/40 mt-1">PDF, JPG, PNG · Max 5MB{uploaded && " · Click to replace"}</div>
      <input
        type="file"
        data-testid={`upload-${type}-input`}
        accept=".pdf,.jpg,.jpeg,.png"
        className="hidden"
        disabled={uploading}
        onChange={async (e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setUploading(true);
          const fd = new FormData();
          fd.append("file", file);
          await fetch(`/api/upload?type=${type}`, { method: "POST", body: fd });
          setUploading(false);
          onUploaded();
        }}
      />
    </label>
  );
}

export default function CandidateDocumentsPage() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [applications, setApplications] = useState<Application[]>([]);
  const [docTypeLabels, setDocTypeLabels] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = () => {
    Promise.all([
      fetch("/api/candidates/profile").then((r) => r.json()),
      fetch("/api/applications").then((r) => r.json()),
      fetch("/api/apply/options").then((r) => r.json()).catch(() => null),
    ]).then(([p, a, options]) => {
      setProfile(p.error ? null : p);
      setApplications(Array.isArray(a) ? a : []);
      const types: { key: string; label: string }[] = options?.documentTypes ?? [];
      setDocTypeLabels(Object.fromEntries(types.map((t) => [t.key, t.label])));
      setLoading(false);
    }).catch(() => setLoading(false));
  };

  useEffect(load, []);

  const uploadedTypes = new Set(profile?.documents.map((d) => d.type) ?? []);
  const requiredTypes = [...new Set(applications.flatMap((a) => a.required_document_types))];

  return (
    <PortalShell roleLabel="Candidate" navItems={CANDIDATE_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        My Account
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-2">Documents.</h1>
      <p className="text-midnight-900/55 font-light mb-8 max-w-2xl">
        Everything required across your application{applications.length === 1 ? "" : "s"} — upload whatever&rsquo;s still missing.
      </p>

      {loading ? (
        <p className="text-midnight-900/50">Loading…</p>
      ) : applications.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">
          Submit an application first — document requirements depend on your destination programme.
        </div>
      ) : requiredTypes.length === 0 ? (
        <div className="card p-10 text-center text-midnight-900/50">No document requirements found for your application yet.</div>
      ) : (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-midnight-900 mb-4 flex items-center gap-2">
            <UploadSimple size={18} weight="regular" /> Required Documents
          </h2>
          <div className="grid sm:grid-cols-2 gap-4">
            {requiredTypes.map((type) => (
              <UploadTile
                key={type}
                type={type}
                label={docTypeLabels[type] ?? documentTypeLabel(type)}
                uploaded={uploadedTypes.has(type)}
                onUploaded={load}
              />
            ))}
          </div>
        </div>
      )}

      {!loading && profile && (
        <div className="card p-6 mt-6">
          <SupportingDocumentUpload
            documents={profile.documents.filter((d) => d.type === "other")}
            onUploaded={load}
          />
        </div>
      )}
    </PortalShell>
  );
}
