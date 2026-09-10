"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Link from "next/link";
import { ShieldCheck } from "@phosphor-icons/react";
import { isInternalPortalPath } from "@/lib/rbac";

export default function WelcomePopup() {
  const pathname = usePathname();
  const [isOpen, setIsOpen] = useState(false);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    setIsMounted(true);
    // Check if the user has already accepted the terms in this browser
    const hasAccepted = localStorage.getItem("vertex_welcome_accepted");
    if (!hasAccepted) {
      // Small delay so it feels like a deliberate popup after initial page load
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem("vertex_welcome_accepted", "true");
    setIsOpen(false);
  };

  // Don't render anything during SSR to prevent hydration mismatch
  if (!isMounted || isInternalPortalPath(pathname)) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-midnight-950/70 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
            className="bg-white rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col border border-midnight-900/10"
          >
            <div className="p-8 sm:p-10 text-center flex flex-col items-center">
              <div className="w-16 h-16 bg-midnight-950/5 rounded-full flex items-center justify-center mb-6">
                <ShieldCheck size={32} weight="duotone" className="text-midnight-700" />
              </div>

              <p className="eyebrow mb-3">
                <span className="eyebrow-rule" />
                Agent Network
              </p>

              <h2 className="text-2xl font-semibold text-midnight-900 tracking-tight mb-3">
                Welcome to Vertex International
              </h2>

              <p className="text-midnight-900/55 font-light mb-8 leading-relaxed text-sm sm:text-base">
                You are entering the official online portal for Vertex International Recruitment.
                By continuing to use this website, you acknowledge that you have read and agree to our{" "}
                <Link href="/privacy" className="text-gold-600 hover:text-gold-700 hover:underline font-semibold outline-none focus:ring-2 focus:ring-gold-400 rounded" onClick={() => setIsOpen(false)}>
                  Privacy Policy
                </Link>
                {" "}and{" "}
                <Link href="/terms" className="text-gold-600 hover:text-gold-700 hover:underline font-semibold outline-none focus:ring-2 focus:ring-gold-400 rounded" onClick={() => setIsOpen(false)}>
                  Terms of Service
                </Link>.
              </p>

              <button
                onClick={handleAccept}
                className="btn-primary w-full py-3.5"
              >
                Accept & Enter Portal
              </button>
            </div>

            <div className="bg-ivory-100 py-3 text-center border-t border-midnight-900/10">
              <span className="text-[10px] text-midnight-900/40 font-semibold uppercase tracking-widest">
                We are committed to your privacy
              </span>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
