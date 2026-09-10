"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = searchParams.get("redirect") || "/dashboard";

  const [form, setForm] = useState({ email: "", password: "" });
  const [status, setStatus] = useState<"idle" | "loading" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setStatus("loading");
    setMessage("");

    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const data = await res.json();
    if (res.ok) {
      router.push(redirect);
      router.refresh();
    } else {
      setStatus("error");
      setMessage(data.error || "Login failed.");
    }
  };

  return (
    <div className="space-y-5">
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Email Address *</label>
          <input id="login-email" name="email" type="email" value={form.email} onChange={handleChange} required className="input-field" placeholder="john@example.com" />
        </div>
        <div>
          <div className="flex items-center justify-between mb-1.5">
            <label className="block text-sm font-medium text-midnight-900/70">Password *</label>
            <Link href="/auth/forgot-password" className="text-xs text-gold-600 font-semibold hover:underline">
              Forgot password?
            </Link>
          </div>
          <PasswordInput id="login-password" name="password" value={form.password} onChange={handleChange} required placeholder="••••••••" />
        </div>

        {message && (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
        )}

        <button type="submit" id="login-submit-btn" disabled={status === "loading"} className="btn-primary w-full py-3.5 text-base mt-2 disabled:opacity-60">
          {status === "loading" ? "Signing In..." : "Sign In"}
        </button>

        <p className="text-center text-sm text-midnight-900/50 mt-4">
          Don&apos;t have an account yet?{" "}
          <Link href="/apply" className="text-gold-600 font-semibold hover:underline">Submit an Application</Link>
        </p>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img src="/logo.svg" alt="Vertex" className="h-10 w-auto brightness-0 invert mx-auto" />
            <span className="block text-ivory-50 font-semibold text-lg tracking-[0.2em] mt-3">VERTEX</span>
            <span className="block text-gold-400 text-xs font-semibold tracking-widest uppercase mt-1">International</span>
          </Link>
          <h1 className="section-title-dark text-3xl">Welcome Back</h1>
          <p className="text-ivory-50/60 font-light mt-2">Sign in to your account</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-midnight-900/10 p-8">
          <Suspense fallback={<div className="text-midnight-900/40 text-center py-4">Loading...</div>}>
            <LoginForm />
          </Suspense>
        </div>
      </div>
    </div>
  );
}
