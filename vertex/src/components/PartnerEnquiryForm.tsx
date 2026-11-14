"use client";

import { useState } from "react";
import { CheckCircle, EnvelopeSimple } from "@phosphor-icons/react";

interface PartnerEnquiryFormProps {
  variant?: "dark" | "light";
}

export default function PartnerEnquiryForm({ variant = "dark" }: PartnerEnquiryFormProps) {
  const [form, setForm] = useState({
    organisation: "",
    organisation_type: "",
    country: "",
    website: "",
    name: "",
    job_title: "",
    email: "",
    phone: "",
    cooperation_requirements: "",
    registration_number: "",
    meeting_preference: "",
    estimated_volume: "",
    preferred_language: "",
    profile_link: "",
    acknowledgement: false,
  });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    setForm((prev) => ({ ...prev, [name]: type === "checkbox" ? (e.target as HTMLInputElement).checked : value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setError("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          enquiry_type: "partner",
          organisation: form.organisation,
          organisation_type: form.organisation_type || undefined,
          country: form.country,
          name: form.name,
          job_title: form.job_title,
          email: form.email,
          phone: form.phone || undefined,
          subject: `Partnership enquiry: ${form.organisation}`,
          message: form.cooperation_requirements,
          cooperation_requirements: form.cooperation_requirements,
          registration_number: form.registration_number || undefined,
          meeting_preference: form.meeting_preference || undefined,
          estimated_volume: form.estimated_volume ? parseInt(form.estimated_volume) : undefined,
          preferred_language: form.preferred_language || undefined,
          profile_link: form.profile_link || undefined,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Failed to send enquiry. Please try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Failed to send enquiry. Please try again.");
    }
  };

  const isDark = variant === "dark";

  if (status === "success") {
    return (
      <div className={`rounded-2xl p-8 md:p-10 ${isDark ? "bg-white/5 border border-white/10" : "bg-midnight-900/5 border border-midnight-900/10"}`}>
        <div className="text-center">
          <CheckCircle size={48} weight="fill" className={isDark ? "text-gold-400 mx-auto mb-4" : "text-midnight-600 mx-auto mb-4"} />
          <h3 className={`text-2xl font-semibold mb-3 ${isDark ? "text-ivory-50" : "text-midnight-900"}`}>
            Thank you for your enquiry
          </h3>
          <p className={`text-sm mb-6 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
            We&apos;ve received your partnership enquiry. Our team will review your information and contact you regarding the next steps.
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className={`rounded-2xl p-6 md:p-8 ${isDark ? "bg-white/5 border border-white/10" : "bg-white border border-midnight-900/10"}`}>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-2">
          <EnvelopeSimple size={18} weight="regular" className={isDark ? "text-gold-400" : "text-midnight-600"} />
          <span className={`text-[10px] font-semibold uppercase tracking-[0.25em] ${isDark ? "text-ivory-50/50" : "text-midnight-900/50"}`}>
            Partner Enquiry
          </span>
        </div>
        <h3 className={`text-xl md:text-2xl font-semibold mb-2 ${isDark ? "text-ivory-50" : "text-midnight-900"}`}>
          Introduce your organisation
        </h3>
        <p className={`text-xs ${isDark ? "text-ivory-50/40" : "text-midnight-900/40"}`}>
          * Required fields
        </p>
      </div>

      <div className="space-y-4">
        {/* Organisation details */}
        <div>
          <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
            Company / organisation name *
          </label>
          <input
            required
            name="organisation"
            value={form.organisation}
            onChange={handleChange}
            maxLength={150}
            className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
              isDark
                ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
            }`}
            placeholder="Your organisation name"
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Organisation type *
            </label>
            <select
              required
              name="organisation_type"
              value={form.organisation_type}
              onChange={handleChange}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 focus:border-midnight-600"
              }`}
            >
              <option value="">Select type</option>
              <option value="agency">Recruitment agency / manpower supplier</option>
              <option value="employer">Employer / corporate client</option>
              <option value="travel">Travel agency / visa consultancy</option>
              <option value="institution">Institution / association</option>
              <option value="other">Other business collaborator</option>
            </select>
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Country of operation *
            </label>
            <input
              required
              name="country"
              value={form.country}
              onChange={handleChange}
              maxLength={80}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
              }`}
              placeholder="e.g. United Kingdom"
            />
          </div>
        </div>

        <div>
          <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
            Website (optional)
          </label>
          <input
            type="url"
            name="website"
            value={form.website}
            onChange={handleChange}
            maxLength={200}
            className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
              isDark
                ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
            }`}
            placeholder="https://"
          />
        </div>

        {/* Contact details */}
        <div className={`pt-4 border-t ${isDark ? "border-white/10" : "border-midnight-900/10"}`}>
          <p className={`text-xs font-semibold uppercase tracking-wider mb-4 ${isDark ? "text-ivory-50/50" : "text-midnight-900/50"}`}>
            Contact Details
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Contact name *
            </label>
            <input
              required
              name="name"
              value={form.name}
              onChange={handleChange}
              maxLength={100}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
              }`}
              placeholder="Your full name"
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Job title *
            </label>
            <input
              required
              name="job_title"
              value={form.job_title}
              onChange={handleChange}
              maxLength={100}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
              }`}
              placeholder="Your role"
            />
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Business email *
            </label>
            <input
              required
              type="email"
              name="email"
              value={form.email}
              onChange={handleChange}
              maxLength={150}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
              }`}
              placeholder="you@company.com"
            />
          </div>

          <div>
            <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
              Phone / WhatsApp (optional)
            </label>
            <input
              type="tel"
              name="phone"
              value={form.phone}
              onChange={handleChange}
              maxLength={40}
              className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                isDark
                  ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                  : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
              }`}
              placeholder="Include country code"
            />
          </div>
        </div>

        {/* Cooperation requirements */}
        <div className={`pt-4 border-t ${isDark ? "border-white/10" : "border-midnight-900/10"}`}>
          <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
            How would you like to cooperate? *
          </label>
          <textarea
            required
            name="cooperation_requirements"
            value={form.cooperation_requirements}
            onChange={handleChange}
            rows={3}
            maxLength={2500}
            className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors resize-none ${
              isDark
                ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
            }`}
            placeholder="Sectors, source countries, destinations or workforce needs"
          />
        </div>

        {/* Optional business details */}
        <details className={`group ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
          <summary className="cursor-pointer list-none flex items-center gap-2 text-xs font-semibold uppercase tracking-wider hover:text-gold-400 transition-colors">
            <span className="transition-transform group-open:rotate-90">›</span>
            Add business details (optional)
          </summary>
          <div className="mt-4 space-y-4 pl-5">
            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
                Registration / licence number
              </label>
              <input
                name="registration_number"
                value={form.registration_number}
                onChange={handleChange}
                maxLength={120}
                className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                  isDark
                    ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                    : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
                }`}
              />
            </div>

            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
                Preferred meeting time & time zone
              </label>
              <input
                name="meeting_preference"
                value={form.meeting_preference}
                onChange={handleChange}
                maxLength={150}
                className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                  isDark
                    ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                    : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
                }`}
                placeholder="e.g. weekdays, 14:00, Africa/Nairobi"
              />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
                  Estimated candidates / workforce needed
                </label>
                <input
                  type="number"
                  name="estimated_volume"
                  value={form.estimated_volume}
                  onChange={handleChange}
                  min={1}
                  max={100000}
                  className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                    isDark
                      ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                      : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
                  }`}
                />
              </div>

              <div>
                <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
                  Preferred language
                </label>
                <input
                  name="preferred_language"
                  value={form.preferred_language}
                  onChange={handleChange}
                  maxLength={80}
                  className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                    isDark
                      ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                      : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
                  }`}
                />
              </div>
            </div>

            <div>
              <label className={`block text-xs font-semibold uppercase tracking-wider mb-2 ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
                Company profile link
              </label>
              <input
                type="url"
                name="profile_link"
                value={form.profile_link}
                onChange={handleChange}
                maxLength={300}
                className={`w-full px-4 py-3 rounded-lg border text-sm transition-colors ${
                  isDark
                    ? "bg-white/5 border-white/15 text-ivory-50 placeholder:text-ivory-50/30 focus:border-gold-400"
                    : "bg-white border-midnight-900/15 text-midnight-900 placeholder:text-midnight-900/30 focus:border-midnight-600"
                }`}
                placeholder="https://"
              />
            </div>
          </div>
        </details>

        {/* Acknowledgement */}
        <label className="flex items-start gap-3 cursor-pointer">
          <input
            type="checkbox"
            required
            name="acknowledgement"
            checked={form.acknowledgement}
            onChange={handleChange}
            className="mt-1 w-4 h-4 rounded border-white/20 bg-white/5 text-gold-400 focus:ring-gold-400 focus:ring-offset-0"
          />
          <span className={`text-xs leading-relaxed ${isDark ? "text-ivory-50/60" : "text-midnight-900/60"}`}>
            I confirm that I am authorised to contact Vertex for this organisation and have read the{" "}
            <a href="/privacy" target="_blank" rel="noopener" className="text-gold-400 hover:underline">
              Privacy Policy
            </a>
            . *
          </span>
        </label>

        <p className={`text-xs ${isDark ? "text-ivory-50/40" : "text-midnight-900/40"}`}>
          Please do not include passport copies, financial details or candidate records in this enquiry.
        </p>

        {/* Submit button */}
        <button
          type="submit"
          disabled={status === "loading" || !form.acknowledgement}
          className={`w-full py-3.5 rounded-lg font-semibold text-sm transition-all ${
            status === "loading" || !form.acknowledgement
              ? "bg-midnight-900/30 text-ivory-50/30 cursor-not-allowed"
              : isDark
              ? "bg-gold-400 text-midnight-950 hover:bg-gold-300"
              : "bg-midnight-900 text-ivory-50 hover:bg-midnight-800"
          }`}
        >
          {status === "loading" ? "Sending..." : "Submit partnership enquiry"}
        </button>

        {error && (
          <p className="text-sm text-red-400 text-center">{error}</p>
        )}

        <p className={`text-xs text-center ${isDark ? "text-ivory-50/40" : "text-midnight-900/40"}`}>
          Prefer email?{" "}
          <a href="mailto:vertex@vertexintern.com" className={isDark ? "text-gold-400 hover:underline" : "text-midnight-600 hover:underline"}>
            vertex@vertexintern.com
          </a>
        </p>
      </div>
    </form>
  );
}
