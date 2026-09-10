"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle } from "@phosphor-icons/react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    const res = await fetch("/api/auth/forgot-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    });

    const data = await res.json();
    if (res.ok) {
      setStatus("sent");
      setMessage(data.message);
    } else {
      setStatus("error");
      setMessage(data.error || "Something went wrong. Please try again.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img src="/logo.svg" alt="Vertex" className="h-10 w-auto brightness-0 invert mx-auto" />
            <span className="block text-ivory-50 font-semibold text-lg tracking-[0.2em] mt-3">VERTEX</span>
            <span className="block text-gold-400 text-xs font-semibold tracking-widest uppercase mt-1">International</span>
          </Link>
          <h1 className="section-title-dark text-3xl">Forgot Password</h1>
          <p className="text-ivory-50/60 font-light mt-2">We&apos;ll email you a link to reset it</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-midnight-900/10 p-8">
          {status === "sent" ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                <CheckCircle size={32} weight="fill" className="text-emerald-600" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Check your email</h2>
              <p className="text-midnight-900/55 font-light mb-6">{message}</p>
              <Link href="/auth/login" className="btn-secondary">Back to Login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Email Address *</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  className="input-field"
                  placeholder="john@example.com"
                />
              </div>

              {status === "error" && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
              )}

              <button type="submit" disabled={status === "loading"} className="btn-primary w-full py-3.5 text-base disabled:opacity-60">
                {status === "loading" ? "Sending…" : "Send Reset Link"}
              </button>

              <p className="text-center text-sm text-midnight-900/50">
                <Link href="/auth/login" className="text-gold-600 font-semibold hover:underline">Back to Login</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
