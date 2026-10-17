"use client";

import { useEffect, useState, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle, XCircle, CircleNotch } from "@phosphor-icons/react";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");
  const [status, setStatus] = useState<"loading" | "success" | "error">("loading");
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!token) {
      setStatus("error");
      setMessage("No verification token provided.");
      return;
    }

    fetch(`/api/referral-agents/verify-email?token=${token}`)
      .then((r) => r.json())
      .then((data) => {
        if (data.message) {
          setStatus("success");
          setMessage(data.message);
        } else {
          setStatus("error");
          setMessage(data.error || "Verification failed.");
        }
      })
      .catch(() => {
        setStatus("error");
        setMessage("An error occurred. Please try again.");
      });
  }, [token]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center py-12 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <Link href="/" className="inline-block mb-6">
            <img src="/logo.svg" alt="Vertex" className="h-10 w-auto brightness-0 invert mx-auto" />
            <span className="block text-ivory-50 font-semibold text-lg tracking-[0.2em] mt-3">VERTEX</span>
            <span className="block text-gold-400 text-xs font-semibold tracking-widest uppercase mt-1">International</span>
          </Link>
          <h1 className="section-title-dark text-3xl">Referral Agent Email Verification</h1>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl border border-midnight-900/10 p-8 text-center">
          {status === "loading" && (
            <>
              <CircleNotch size={48} weight="bold" className="text-gold-500 mx-auto mb-5 animate-spin" />
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Verifying your email…</h2>
              <p className="text-midnight-900/55 font-light">Please wait a moment.</p>
            </>
          )}
          {status === "success" && (
            <>
              <div className="w-16 h-16 bg-emerald-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                <CheckCircle size={32} weight="fill" className="text-emerald-600" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Email Verified</h2>
              <p className="text-midnight-900/55 font-light mb-6">{message}</p>
              <Link href="/" className="btn-primary">Back to Home</Link>
            </>
          )}
          {status === "error" && (
            <>
              <div className="w-16 h-16 bg-red-50 rounded-full flex items-center justify-center mb-5 mx-auto">
                <XCircle size={32} weight="fill" className="text-red-500" />
              </div>
              <h2 className="font-semibold text-midnight-900 text-2xl tracking-tight mb-2">Verification Failed</h2>
              <p className="text-midnight-900/55 font-light mb-6">{message}</p>
              <Link href="/become-a-referral-agent" className="btn-secondary">Back to Application</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function ReferralAgentVerifyEmailPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-gradient-to-br from-midnight-950 via-midnight-900 to-midnight-800 flex items-center justify-center text-ivory-50/60">
          Loading…
        </div>
      }
    >
      <VerifyContent />
    </Suspense>
  );
}
