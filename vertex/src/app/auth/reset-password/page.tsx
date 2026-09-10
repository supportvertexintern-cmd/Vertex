"use client";

import { useState, Suspense } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import PasswordInput from "@/components/PasswordInput";
import { CheckCircle, XCircle } from "@phosphor-icons/react";

function ResetPasswordForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token) {
      setStatus("error");
      setMessage("No reset token provided. Request a new link.");
      return;
    }
    if (password !== confirmPassword) {
      setStatus("error");
      setMessage("Passwords do not match.");
      return;
    }

    setStatus("loading");
    setMessage("");

    const res = await fetch("/api/auth/reset-password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, password }),
    });

    const data = await res.json();
    if (res.ok) {
      setStatus("success");
      setMessage(data.message);
    } else {
      setStatus("error");
      setMessage(data.error || "Failed to reset password.");
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
          <h1 className="section-title-dark text-3xl">Reset Password</h1>
          <p className="text-ivory-50/60 font-light mt-2">Choose a new password</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-midnight-900/10 p-8">
          {status === "success" ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                <CheckCircle size={32} weight="fill" className="text-emerald-600" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Password Reset</h2>
              <p className="text-midnight-900/55 font-light mb-6">{message}</p>
              <button onClick={() => router.push("/auth/login")} className="btn-primary">Sign In Now</button>
            </div>
          ) : !token ? (
            <div className="text-center">
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                <XCircle size={32} weight="fill" className="text-red-500" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Invalid Link</h2>
              <p className="text-midnight-900/55 font-light mb-6">No reset token provided.</p>
              <Link href="/auth/forgot-password" className="btn-secondary">Request a New Link</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">New Password *</label>
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} required placeholder="••••••••" />
                <p className="text-xs text-midnight-900/40 mt-1.5">At least 8 characters, one uppercase letter, one number.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Confirm New Password *</label>
                <PasswordInput value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required placeholder="••••••••" />
              </div>

              {status === "error" && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
              )}

              <button type="submit" disabled={status === "loading"} className="btn-primary w-full py-3.5 text-base mt-2 disabled:opacity-60">
                {status === "loading" ? "Resetting…" : "Reset Password"}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center text-ivory-50/60">
          Loading…
        </div>
      }
    >
      <ResetPasswordForm />
    </Suspense>
  );
}
