"use client";

import { usePathname } from "next/navigation";
import { isInternalPortalPath } from "@/lib/rbac";

export default function WhatsAppButton() {
  const pathname = usePathname();
  const phoneNumber = "447438613251"; // +44 7438 613251 formatted for wa.me API
  const defaultMessage = encodeURIComponent("Hi Vertex Recruitment, I need some assistance.");

  if (isInternalPortalPath(pathname)) return null;

  return (
    <div className="fixed bottom-6 left-6 z-40">
      <a
        href={`https://wa.me/${phoneNumber}?text=${defaultMessage}`}
        target="_blank"
        rel="noopener noreferrer"
        className="group relative w-14 h-14 rounded-full bg-midnight-950 border border-white/10 text-gold-400 flex items-center justify-center shadow-lg hover:border-gold-400/50 transition-all hover:scale-105 active:scale-95"
        title="Contact us on WhatsApp"
      >
        <span className="absolute -inset-1 rounded-full bg-gold-400 opacity-0 blur transition duration-500 group-hover:opacity-25" />
        <svg viewBox="0 0 32 32" className="w-7 h-7 relative z-10 pointer-events-none fill-current" xmlns="http://www.w3.org/2000/svg">
          <path d="M16 1.9c-7.8 0-14.1 6.3-14.1 14.1 0 2.5.6 5 1.9 7.1L1.9 30l7-1.8c2.1 1.1 4.4 1.7 6.9 1.7 7.8 0 14.1-6.3 14.1-14.1S23.8 1.9 16 1.9zm0 25.8c-2.1 0-4.1-.6-5.9-1.6l-.4-.2-4.4 1.1 1.2-4.3-.3-.4c-1.2-1.8-1.9-4-1.9-6.3 0-6.4 5.2-11.6 11.6-11.6s11.6 5.2 11.6 11.6S22.4 27.7 16 27.7zm6.3-8.6c-.3-.2-2-.1-2.4 0-.3.1-.6.3-.7.5-.2.3-.8 1-.9 1.1-.2.2-.3.2-.6.1-.3-.1-1.4-.5-2.6-1.6-1-1-1.6-2.1-1.8-2.4-.2-.3 0-.5.2-.6.2-.2.4-.4.5-.6.2-.2.2-.4.4-.6.1-.2.1-.4 0-.6-.1-.2-.7-1.8-1-2.4-.3-.6-.6-.5-.8-.5H11c-.3 0-.7.1-1 .4-.3.3-1.3 1.2-1.3 3s1.3 3.5 1.5 3.7c.2.2 2.5 3.9 6 5.4 3.5 1.5 4.1 1.2 4.9 1.2.7 0 2-.8 2.3-1.6.3-.8.3-1.4.2-1.6-.1-.1-.4-.6-.7-.8z" />
        </svg>
      </a>
    </div>
  );
}
