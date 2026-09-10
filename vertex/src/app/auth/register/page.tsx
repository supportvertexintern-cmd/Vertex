"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { EnvelopeSimple } from "@phosphor-icons/react";
import PasswordInput from "@/components/PasswordInput";

// There's no general-purpose sign-up anymore — a candidate account only
// ever comes into being via a screening invite (Candidate Information
// Form -> screened -> invite -> set password here). Without a valid
// invite this page has nothing to do, so it sends the visitor to the
// actual starting point instead of showing a blank registration form.
function RegisterForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const invite = searchParams.get("invite");
  const setup = searchParams.get("setup");
  const isSetup = !invite && !!setup;

  const [form, setForm] = useState({ full_name: "", email: "", phone: "", country: "", password: "", confirmPassword: "" });
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState("");
  const [inviteState, setInviteState] = useState<"checking" | "prefilled" | "unavailable">("checking");

  useEffect(() => {
    if (!invite && !setup) {
      router.replace("/apply");
      return;
    }
    const param = invite ? `invite=${encodeURIComponent(invite)}` : `setup=${encodeURIComponent(setup!)}`;
    fetch(`/api/auth/register?${param}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = await res.json();
        setForm((prev) => ({
          ...prev,
          full_name: body.data.full_name,
          email: body.data.email,
          phone: body.data.phone,
          country: body.data.country,
        }));
        setInviteState("prefilled");
      })
      .catch(() => setInviteState("unavailable"));
  }, [invite, setup, router]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setErrors((prev) => ({ ...prev, [e.target.name]: [] }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      setErrors({ confirmPassword: ["Passwords do not match"] });
      return;
    }
    setStatus("loading");
    setErrors({});

    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(isSetup ? { password: form.password, setup } : { password: form.password, invite }),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        data = { error: `Server error (${res.status}). Please try again later.` };
      }

      if (res.ok) {
        setStatus("success");
        setMessage(data.message);
      } else {
        setStatus("error");
        setMessage(data.error || "Registration failed.");
        if (data.details) setErrors(data.details);
      }
    } catch (err) {
      setStatus("error");
      setMessage("Network error. Please check your connection.");
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-lg">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img src="/logo.svg" alt="Vertex" className="h-10 w-auto brightness-0 invert mx-auto" />
            <span className="block text-ivory-50 font-semibold text-lg tracking-[0.2em] mt-3">VERTEX</span>
            <span className="block text-gold-400 text-xs font-semibold tracking-widest uppercase mt-1">International</span>
          </Link>
          <h1 className="section-title-dark text-3xl">{isSetup ? "Set Up Your Account" : "Create Your Account"}</h1>
          <p className="text-ivory-50/60 font-light mt-2">
            {isSetup
              ? "An account has been created for you — set a password to get started."
              : "Your recruiter says you’re ready — finish setting up your account."}
          </p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-midnight-900/10 p-8">
          {status === "success" ? (
            <div className="text-center py-6">
              <div className="w-16 h-16 bg-midnight-950/5 rounded-full flex items-center justify-center mb-5 mx-auto">
                <EnvelopeSimple size={32} weight="duotone" className="text-midnight-700" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">
                {isSetup ? "You're All Set" : "Check Your Email"}
              </h2>
              <p className="text-midnight-900/55 font-light mb-6">{message}</p>
              <Link href="/auth/login" className="btn-primary">Go to Login</Link>
            </div>
          ) : inviteState === "checking" ? (
            <div className="py-10 text-center text-midnight-900/40 text-sm">Loading your details…</div>
          ) : inviteState === "unavailable" ? (
            <div className="text-center py-6">
              <h2 className="font-semibold text-midnight-900 text-xl tracking-tight mb-2">This invite link isn&rsquo;t valid</h2>
              <p className="text-midnight-900/55 font-light mb-6">
                It may have expired or already been used to set up an account. If you already have one, sign in below —
                otherwise ask your recruiter to resend your invite.
              </p>
              <Link href="/auth/login" className="btn-primary">Go to Login</Link>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="bg-ivory-100 rounded-lg p-4 space-y-1">
                <p className="text-xs font-semibold text-midnight-900/45 uppercase tracking-wider mb-2">Your details on file</p>
                <p className="text-sm text-midnight-900"><span className="text-midnight-900/50">Name:</span> {form.full_name}</p>
                <p className="text-sm text-midnight-900"><span className="text-midnight-900/50">Email:</span> {form.email}</p>
                {form.phone && <p className="text-sm text-midnight-900"><span className="text-midnight-900/50">Phone:</span> {form.phone}</p>}
                {form.country && <p className="text-sm text-midnight-900"><span className="text-midnight-900/50">Country:</span> {form.country}</p>}
              </div>

              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Password *</label>
                <PasswordInput id="reg-password" name="password" value={form.password} onChange={handleChange} required placeholder="Min 8 chars, 1 uppercase, 1 number" />
                {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password[0]}</p>}
              </div>
              <div>
                <label className="block text-sm font-medium text-midnight-900/70 mb-1.5">Confirm Password *</label>
                <PasswordInput id="reg-confirm-password" name="confirmPassword" value={form.confirmPassword} onChange={handleChange} required placeholder="Repeat password" />
                {errors.confirmPassword && <p className="text-red-500 text-xs mt-1">{errors.confirmPassword[0]}</p>}
              </div>

              {message && status === "error" && (
                <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm">{message}</div>
              )}

              <button type="submit" id="register-submit-btn" disabled={status === "loading"} className="btn-primary w-full py-3.5 text-base mt-2 disabled:opacity-60">
                {status === "loading" ? "Saving..." : isSetup ? "Set Password" : "Set Password & Create Account"}
              </button>

              <p className="text-center text-sm text-midnight-900/50 mt-4">
                Already have an account?{" "}
                <Link href="/auth/login" className="text-gold-600 font-semibold hover:underline">Sign In</Link>
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
