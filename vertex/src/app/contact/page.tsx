"use client";

import { useState } from "react";
import { ChatCircleText, Phone, EnvelopeSimple, MapPin, CheckCircle } from "@phosphor-icons/react";

export default function ContactPage() {
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "", registration_number: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [error, setError] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setError("");
    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        setStatus("error");
        setError(data.error || "Failed to send message. Please try again.");
        return;
      }
      setStatus("success");
    } catch {
      setStatus("error");
      setError("Failed to send message. Please try again.");
    }
  };

  return (
    <div>
      {/* Hero */}
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-6">
            <span className="eyebrow-rule" />
            Contact
          </p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.02] mb-4">
            We&apos;d love to hear from you.
          </h1>
          <p className="text-ivory-50/50 text-lg font-light">
            Employers, agencies, partners, or candidates — reach the Vertex team directly.
          </p>
        </div>
      </section>

      {/* Content */}
      <section className="bg-ivory-50 py-20 md:py-24">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-24">
            {/* Info */}
            <div>
              <p className="eyebrow mb-5">
                <span className="eyebrow-rule" />
                Get in touch
              </p>
              <h2 className="section-title text-3xl md:text-4xl mb-10">Direct lines, real people.</h2>
              <div className="space-y-8">
                {/* WhatsApp */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                    <ChatCircleText size={22} weight="regular" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-midnight-900 tracking-tight">WhatsApp</h3>
                    <a href="https://wa.me/447438613251" target="_blank" rel="noopener noreferrer"
                      className="block text-midnight-700 hover:text-gold-600 text-sm font-mono mt-2 transition-colors">+44 7438 613251</a>
                  </div>
                </div>

                {/* Office */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                    <Phone size={22} weight="regular" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-midnight-900 tracking-tight">Office</h3>
                    <a href="tel:+442030263403"
                      className="text-midnight-700 hover:text-gold-600 text-sm font-mono mt-2 block transition-colors">+44 2030 263403</a>
                  </div>
                </div>

                {/* Email */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                    <EnvelopeSimple size={22} weight="regular" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-midnight-900 tracking-tight">Email</h3>
                    <div className="space-y-1 mt-2">
                      <a href="mailto:vertex@vertexintern.com" className="block text-midnight-700 hover:text-gold-600 text-sm font-mono transition-colors">vertex@vertexintern.com</a>
                      <a href="mailto:inquiries@vertexintern.com" className="block text-midnight-700 hover:text-gold-600 text-sm font-mono transition-colors">inquiries@vertexintern.com</a>
                      <a href="mailto:support@vertexintern.com" className="block text-midnight-700 hover:text-gold-600 text-sm font-mono transition-colors">support@vertexintern.com</a>
                    </div>
                  </div>
                </div>

                {/* Address */}
                <div className="flex gap-5">
                  <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                    <MapPin size={22} weight="regular" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-midnight-900 tracking-tight">Registered Offices</h3>
                    <p className="text-midnight-900/60 text-sm mt-2 leading-relaxed max-w-sm">
                      5 Brayford Square, London, E1 0SG, United Kingdom
                      <br />
                      International House, Kingsfield Court, Chester, United Kingdom
                    </p>
                    <p className="text-midnight-900/40 text-xs mt-2 uppercase tracking-[0.1em]">
                      Company No. 16943308
                    </p>
                  </div>
                </div>
              </div>
            </div>

            {/* Form */}
            <div className="card p-8 md:p-10 h-fit">
              {status === "success" ? (
                <div className="text-center py-10">
                  <CheckCircle size={56} weight="fill" className="text-midnight-600 mx-auto mb-5" />
                  <h3 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Message Sent!</h3>
                  <p className="text-midnight-900/55 font-light mb-8">Thank you for reaching out. We&apos;ll respond within 1–2 business days.</p>
                  <button onClick={() => { setStatus("idle"); setForm({ name: "", email: "", subject: "", message: "", registration_number: "" }); }} className="btn-primary text-xs">
                    Send Another Message
                  </button>
                </div>
              ) : (
                <form method="post" onSubmit={handleSubmit} className="space-y-5">
                  <h2 className="text-2xl font-semibold text-midnight-900 tracking-tight mb-6">Send a message</h2>
                  <div className="grid sm:grid-cols-2 gap-5">
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Full Name *</label>
                      <input id="contact-name" name="name" value={form.name} onChange={handleChange} required className="input-field" placeholder="Your full name" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Email *</label>
                      <input id="contact-email" name="email" type="email" value={form.email} onChange={handleChange} required className="input-field" placeholder="your@email.com" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Subject *</label>
                    <input id="contact-subject" name="subject" value={form.subject} onChange={handleChange} required className="input-field" placeholder="How can we help?" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Registration/Licence Number</label>
                    <input
                      id="contact-registration-number"
                      name="registration_number"
                      value={form.registration_number}
                      onChange={handleChange}
                      className="input-field"
                      placeholder="If you're a partner agency (optional)"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Message *</label>
                    <textarea id="contact-message" name="message" value={form.message} onChange={handleChange} required rows={5} className="input-field resize-none" placeholder="Your message..." />
                  </div>
                  {error && <div className="text-red-600 text-sm">{error}</div>}
                  <button type="submit" id="contact-submit-btn" disabled={status === "loading"} className="btn-primary w-full py-4 disabled:opacity-60">
                    {status === "loading" ? "Sending..." : "Send Message"}
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
