"use client";

import { useState } from "react";
import { Envelope } from "@phosphor-icons/react";

const emptyForm = {
  full_name: "",
  email: "",
  phone: "",
  whatsapp_number: "",
  country: "",
  city: "",
  date_of_birth: "",
  nationality: "",
  preferred_contact_channel: "" as "" | "email" | "whatsapp" | "phone",
  previous_experience: "",
  current_occupation: "",
  network_size: "",
  social_media_profiles: "",
  promotion_plan: "",
  payment_details: "",
};

export default function BecomeAReferralAgentPage() {
  const [form, setForm] = useState(emptyForm);
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setError("");
    setFieldErrors({});
    try {
      const res = await fetch("/api/referral-agents/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          whatsapp_number: form.whatsapp_number || undefined,
          city: form.city || undefined,
          date_of_birth: form.date_of_birth || undefined,
          nationality: form.nationality || undefined,
          preferred_contact_channel: form.preferred_contact_channel || undefined,
          previous_experience: form.previous_experience || undefined,
          current_occupation: form.current_occupation || undefined,
          network_size: form.network_size || undefined,
          social_media_profiles: form.social_media_profiles || undefined,
          promotion_plan: form.promotion_plan || undefined,
          payment_details: form.payment_details || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Failed to submit application. Please try again.");
        setFieldErrors(data.details || {});
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Failed to submit application. Please try again.");
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-6">
            <span className="eyebrow-rule" />
            Referral Agents
          </p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02] mb-4">
            Earn by referring candidates to Vertex.
          </h1>
          <p className="text-ivory-50/50 text-lg font-light max-w-2xl">
            Register as a Vertex Referral Agent, get your own referral link and QR code, and earn a commission
            as the people you refer progress through our work permit and visa programmes.
          </p>
        </div>
      </section>

      {/* Form */}
      <section className="bg-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="max-w-2xl mx-auto">
            <div className="card p-8">
              {status === "success" ? (
                <div className="text-center py-10">
                  <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                    <Envelope size={32} weight="fill" className="text-emerald-600" />
                  </div>
                  <h3 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Check your email</h3>
                  <p className="text-midnight-900/55 font-light">
                    We&apos;ve sent a verification link to your inbox. Verify your email to complete your application —
                    our team will then review it and let you know the outcome.
                  </p>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-5">
                  <h2 className="text-2xl font-semibold text-midnight-900 tracking-tight mb-2">Apply to become a Referral Agent</h2>
                  <p className="text-midnight-900/55 text-sm font-light mb-6">Fields marked * are required.</p>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Full Name *</label>
                      <input name="full_name" value={form.full_name} onChange={handleChange} required className="input-field" placeholder="Your full name" />
                      {fieldErrors.full_name && <p className="text-red-600 text-xs mt-1">{fieldErrors.full_name[0]}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Email *</label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} required className="input-field" placeholder="your@email.com" />
                      {fieldErrors.email && <p className="text-red-600 text-xs mt-1">{fieldErrors.email[0]}</p>}
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Phone *</label>
                      <input name="phone" value={form.phone} onChange={handleChange} required className="input-field" placeholder="+254..." />
                      {fieldErrors.phone && <p className="text-red-600 text-xs mt-1">{fieldErrors.phone[0]}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">WhatsApp Number</label>
                      <input name="whatsapp_number" value={form.whatsapp_number} onChange={handleChange} className="input-field" placeholder="If different from phone" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Country *</label>
                      <input name="country" value={form.country} onChange={handleChange} required className="input-field" placeholder="Country you're based in" />
                      {fieldErrors.country && <p className="text-red-600 text-xs mt-1">{fieldErrors.country[0]}</p>}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">City</label>
                      <input name="city" value={form.city} onChange={handleChange} className="input-field" />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Date of Birth</label>
                      <input name="date_of_birth" type="date" value={form.date_of_birth} onChange={handleChange} className="input-field" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Nationality</label>
                      <input name="nationality" value={form.nationality} onChange={handleChange} className="input-field" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Preferred Contact Channel</label>
                    <select name="preferred_contact_channel" value={form.preferred_contact_channel} onChange={handleChange} className="input-field">
                      <option value="">Select…</option>
                      <option value="email">Email</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="phone">Phone</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Current Occupation</label>
                    <input name="current_occupation" value={form.current_occupation} onChange={handleChange} className="input-field" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Previous Referral/Recruitment Experience</label>
                    <textarea name="previous_experience" value={form.previous_experience} onChange={handleChange} rows={3} className="input-field resize-none" />
                  </div>

                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Estimated Network Size</label>
                      <input name="network_size" type="number" min={0} value={form.network_size} onChange={handleChange} className="input-field" placeholder="e.g. 200" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Social Media Profiles</label>
                      <input name="social_media_profiles" value={form.social_media_profiles} onChange={handleChange} className="input-field" placeholder="Links, handles" />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">How Will You Promote Vertex?</label>
                    <textarea name="promotion_plan" value={form.promotion_plan} onChange={handleChange} rows={3} className="input-field resize-none" />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Payment Details</label>
                    <textarea
                      name="payment_details"
                      value={form.payment_details}
                      onChange={handleChange}
                      rows={2}
                      className="input-field resize-none"
                      placeholder="Bank or mobile money details for commission payouts"
                    />
                  </div>

                  {error && <div className="text-red-600 text-sm">{error}</div>}
                  <button type="submit" disabled={status === "loading"} className="btn-primary w-full py-4 disabled:opacity-60">
                    {status === "loading" ? "Submitting..." : "Submit Application"}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
