"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import PortalShell from "@/components/portal/PortalShell";
import { MARKETING_NAV_ITEMS } from "@/components/portal/marketingNav";
import SearchableSelect from "@/components/SearchableSelect";

interface EmployerClient {
  id: string;
  name: string;
}

export default function CreateJobPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [employerClients, setEmployerClients] = useState<EmployerClient[]>([]);
  const [formData, setFormData] = useState({
    title: "",
    country: "",
    city: "",
    category: "",
    salary_range: "",
    job_description: "",
    requirements: "",
    status: "active",
    employer_client_id: "",
    visa_type: "",
    duration_permit: "",
    processing_time: "",
    service_fee_gbp: "",
    visa_success_rates: "",
  });

  useEffect(() => {
    fetch("/api/admin/employer-clients")
      .then((r) => r.json())
      .then((res) => setEmployerClients(res.data ?? []))
      .catch(() => {});
  }, []);

  const categories = [
    "Technology", "Healthcare", "Engineering", "Operations",
    "Sales & Marketing", "Finance", "Education", "Other"
  ];

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...formData,
          employer_client_id: formData.employer_client_id || undefined,
          visa_type: formData.visa_type || undefined,
          duration_permit: formData.duration_permit || undefined,
          processing_time: formData.processing_time || undefined,
          visa_success_rates: formData.visa_success_rates || undefined,
          service_fee_gbp: formData.service_fee_gbp ? Number(formData.service_fee_gbp) : undefined,
        }),
      });

      if (res.ok) {
        router.push("/marketing/jobs");
      } else {
        const data = await res.json();
        setError(data.error || "Failed to create job.");
      }
    } catch {
      setError("An unexpected error occurred.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  return (
    <PortalShell roleLabel="Marketing" navItems={MARKETING_NAV_ITEMS}>
      <div className="flex items-center justify-between mb-8">
        <div>
          <p className="eyebrow mb-3">
            <span className="eyebrow-rule" />
            Recruitment
          </p>
          <h1 className="section-title text-3xl md:text-4xl">Post New Job.</h1>
        </div>
        <Link href="/marketing/jobs" className="text-sm font-medium text-midnight-900/50 hover:text-gold-600">
          ← Back to Jobs
        </Link>
      </div>

      <div className="card p-6 md:p-8 max-w-3xl">
        {error && <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Job Title</label>
              <input required type="text" name="title" value={formData.title} onChange={handleChange} className="input-field w-full" placeholder="e.g. Senior Software Engineer" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Country</label>
              <input required type="text" name="country" value={formData.country} onChange={handleChange} className="input-field w-full" placeholder="e.g. United Arab Emirates" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">City</label>
              <input required type="text" name="city" value={formData.city} onChange={handleChange} className="input-field w-full" placeholder="e.g. Dubai" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Category</label>
              <SearchableSelect
                value={formData.category}
                onChange={(value) => setFormData({ ...formData, category: value })}
                placeholder="Select a Category"
                options={categories.map((cat) => ({ value: cat, label: cat }))}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Salary Range <span className="text-midnight-900/35 font-normal">(Optional)</span></label>
              <input type="text" name="salary_range" value={formData.salary_range} onChange={handleChange} className="input-field w-full" placeholder="e.g. $4000 - $6000 / month" />
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Employer / Client <span className="text-midnight-900/35 font-normal">(Optional)</span></label>
              <SearchableSelect
                value={formData.employer_client_id}
                onChange={(value) => setFormData({ ...formData, employer_client_id: value })}
                placeholder="No linked client"
                options={employerClients.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>

            <div className="col-span-1 md:col-span-2 border-t border-midnight-900/10 pt-6 mt-2">
              <p className="text-xs font-semibold uppercase tracking-[0.1em] text-midnight-900/40 mb-4">
                Work-Permit Programme Details <span className="font-normal normal-case">(Optional — shown on the public Opportunities page when filled in)</span>
              </p>
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Visa Type</label>
              <input type="text" name="visa_type" value={formData.visa_type} onChange={handleChange} className="input-field w-full" placeholder="e.g. Visa D" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Duration / Permit</label>
              <input type="text" name="duration_permit" value={formData.duration_permit} onChange={handleChange} className="input-field w-full" placeholder="e.g. 2-year resident card" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Processing Time</label>
              <input type="text" name="processing_time" value={formData.processing_time} onChange={handleChange} className="input-field w-full" placeholder="e.g. 3 months" />
            </div>

            <div>
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Service Fee (GBP)</label>
              <input type="number" min="0" step="1" name="service_fee_gbp" value={formData.service_fee_gbp} onChange={handleChange} className="input-field w-full" placeholder="e.g. 1400" />
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Visa Success Rates</label>
              <input type="text" name="visa_success_rates" value={formData.visa_success_rates} onChange={handleChange} className="input-field w-full" placeholder="e.g. Asia: 70–80% · Africa: 85–95% · South America: above 95%" />
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Job Description</label>
              <textarea required name="job_description" value={formData.job_description} onChange={handleChange} rows={5} className="input-field w-full resize-y" placeholder="Detailed description of the role..." />
            </div>

            <div className="col-span-1 md:col-span-2">
              <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Requirements</label>
              <textarea required name="requirements" value={formData.requirements} onChange={handleChange} rows={5} className="input-field w-full resize-y" placeholder="List of requirements, experience, skills..." />
            </div>

            <div className="col-span-1 md:col-span-2 border-t border-midnight-900/10 pt-6 mt-2 flex justify-end gap-4">
              <Link href="/marketing/jobs" className="btn-secondary py-2.5 px-6">Cancel</Link>
              <button type="submit" disabled={loading} className="btn-primary py-2.5 px-8 disabled:opacity-70">
                {loading ? "Posting..." : "Post Job"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </PortalShell>
  );
}
