"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { loadStripe } from "@stripe/stripe-js";
import { PayPalScriptProvider, PayPalButtons } from "@paypal/react-paypal-js";

// Initialize Stripe (will handle missing key gracefully in UI if not set)
const stripePromise = process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY 
  ? loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY) 
  : null;

interface Job {
  id: string;
  title: string;
  country: string;
  application_fee: number;
}

export default function PaymentSelectionPage({ params }: { params: Promise<{ id: string }> }) {
  const router = useRouter();
  const { id: jobId } = use(params);
  
  const [job, setJob] = useState<Job | null>(null);
  const [loading, setLoading] = useState(true);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/jobs/${jobId}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) throw new Error(data.error);
        if (!data.application_fee || data.application_fee <= 0) {
          // If no fee, route directly to apply
          router.replace(`/apply?jobId=${jobId}`);
          return;
        }
        setJob(data);
        setLoading(false);
      })
      .catch((err) => {
        setError("Failed to load job details.");
        setLoading(false);
      });
  }, [jobId, router]);

  const handleStripePayment = async () => {
    if (!stripePromise) {
      setError("Stripe is not configured on this environment.");
      return;
    }
    
    setProcessing(true);
    setError("");
    
    try {
      const res = await fetch("/api/payments/stripe/create-checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jobId }),
      });
      
      const data = await res.json();
      
      if (res.ok && data.sessionId) {
        const stripe = await stripePromise;
        if (!stripe) throw new Error("Stripe failed to initialize.");
        const { error } = await (stripe as any).redirectToCheckout({ sessionId: data.sessionId });
        if (error) throw error;
      } else {
        throw new Error(data.error || "Failed to initialize Stripe checkout");
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred during payment.");
      setProcessing(false);
    }
  };

  if (loading) return <div className="p-20 text-center text-slate-500">Loading payment details...</div>;
  if (!job) return <div className="p-20 text-center text-red-500">{error}</div>;

  return (
    <div className="bg-slate-50 min-h-screen py-12">
      <div className="max-w-xl mx-auto px-4 sm:px-6">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-black text-slate-800">Application Fee</h1>
          <Link href={`/jobs/${jobId}`} className="text-sm font-medium text-slate-500 hover:text-emerald-600">
            ← Back to Job
          </Link>
        </div>

        <div className="card shadow-md p-6 sm:p-8 bg-white overflow-hidden relative">
          {/* Decorative background element */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-emerald-50 rounded-bl-full -z-0"></div>
          
          <div className="relative z-10">
            <div className="text-center mb-8">
              <h2 className="text-slate-500 font-medium mb-1">Applying for</h2>
              <div className="text-xl font-bold text-slate-900">{job.title}</div>
              <div className="text-sm text-slate-500 flex items-center justify-center gap-1 mt-1">
                <span>📍</span> {job.country}
              </div>
            </div>

            <div className="bg-slate-50 rounded-xl p-6 border border-slate-100 flex flex-col items-center justify-center mb-8">
              <div className="text-sm font-semibold tracking-wider text-slate-500 uppercase mb-2">Processing Fee</div>
              <div className="text-4xl font-black text-slate-900">${job.application_fee.toFixed(2)}</div>
              <div className="text-xs text-slate-500 mt-3 text-center">
                This fee covers international document verification and application processing.
              </div>
            </div>

            {error && (
              <div className="mb-6 bg-red-50 text-red-700 p-4 rounded-lg border border-red-200 text-sm text-center">
                {error}
              </div>
            )}

            <div className="space-y-4">
              <p className="text-sm font-semibold text-slate-700 mb-2">Select Payment Method</p>
              
              {/* Stripe Button */}
              <button 
                onClick={handleStripePayment}
                disabled={processing}
                className="w-full flex items-center justify-center gap-3 bg-slate-900 hover:bg-slate-800 text-white py-3.5 px-4 rounded-lg font-medium transition-colors disabled:opacity-70 disabled:cursor-not-allowed group relative overflow-hidden"
              >
                <span className="absolute w-0 h-0 transition-all duration-300 ease-out bg-white rounded-full group-hover:w-full group-hover:h-32 opacity-10"></span>
                <span className="relative flex items-center gap-2">
                  <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="1" y="4" width="22" height="16" rx="2" ry="2"></rect><line x1="1" y1="10" x2="23" y2="10"></line></svg>
                  {processing ? "Processing..." : "Pay securely with Credit / Debit Card"}
                </span>
              </button>

              <div className="relative flex items-center py-2">
                <div className="flex-grow border-t border-slate-200"></div>
                <span className="flex-shrink-0 mx-4 text-slate-400 text-xs font-medium uppercase">Or</span>
                <div className="flex-grow border-t border-slate-200"></div>
              </div>

              {/* PayPal Button Container */}
              <div className="w-full relative z-10 min-h-[48px]">
                {process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? (
                  <PayPalScriptProvider options={{ clientId: process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID, currency: "USD" }}>
                    <PayPalButtons 
                      style={{ layout: "horizontal", height: 48, label: "pay" }}
                      disabled={processing}
                      createOrder={async () => {
                        const res = await fetch("/api/payments/paypal/create-order", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({ jobId })
                        });
                        const order = await res.json();
                        if (!res.ok) throw new Error(order.error || "Failed to create order");
                        return order.id;
                      }}
                      onApprove={async (data: any, actions: any) => {
                        setProcessing(true);
                        try {
                          const res = await fetch("/api/payments/paypal/capture-order", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ orderID: data.orderID, jobId })
                          });
                          if (!res.ok) {
                             const errorData = await res.json();
                             throw new Error(errorData.error || "Failed to capture payment");
                          }
                          // Success - route to success page or apply page
                          router.push(`/apply?jobId=${jobId}&payment=success`);
                        } catch (err: any) {
                          setError(err.message || "Payment processing failed. Please try again.");
                          setProcessing(false);
                        }
                      }}
                      onError={(err: any) => {
                        setError("PayPal encountered an error. Please try again or use a card.");
                      }}
                    />
                  </PayPalScriptProvider>
                ) : (
                  <button disabled className="w-full bg-[#ffc439] bg-opacity-50 text-slate-800 py-3.5 px-4 rounded-lg font-bold flex justify-center items-center cursor-not-allowed">
                     <span className="italic font-sans tracking-tight">PayPal</span> <span className="text-xs ml-2 font-normal text-slate-600">(Not configured)</span>
                  </button>
                )}
              </div>
              
              <p className="text-center text-xs text-slate-400 mt-6 mt-4">
                Payments are securely processed. We do not store your full card details.
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
