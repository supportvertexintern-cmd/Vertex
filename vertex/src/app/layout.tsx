import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AIChatWidget from "@/components/AIChatWidget";
import WhatsAppButton from "@/components/WhatsAppButton";
import WelcomePopup from "@/components/WelcomePopup";
import SessionRefresh from "@/components/SessionRefresh";

const font = Outfit({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});
const siteUrl = process.env.NEXT_PUBLIC_APP_URL || "https://vertex-omega-kohl.vercel.app";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    template: "%s | Vertex International Recruitment",
    default: "Vertex International Recruitment Ltd.",
  },
  description:
    "Vertex International Recruitment Ltd. — a UK-incorporated human capital and mobility enterprise connecting talent, employers, agencies and institutional partners worldwide.",
  keywords: ["recruitment", "jobs", "international", "careers", "employment", "work visa", "mobility"],
  openGraph: {
    siteName: "Vertex International Recruitment Ltd.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
  },
};

import Script from "next/script";
import { headers } from "next/headers";
import { NONCE_HEADER } from "@/lib/csp";

// Reading the request's CSP nonce (set by src/proxy.ts) also makes every
// page render per request, which nonces require: a page prerendered at
// build time would carry no nonce (E3).
export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = (await headers()).get(NONCE_HEADER) ?? undefined;
  return (
    <html lang="en" className={font.variable}>
      <body className="min-h-screen flex flex-col bg-ivory-50">
        <SessionRefresh />
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
        <AIChatWidget />
        <WhatsAppButton />
        <WelcomePopup />

        <div id="google_translate_element" style={{ display: 'none' }}></div>
        <Script src="/js/google-translate.js" strategy="afterInteractive" nonce={nonce} />
      </body>
    </html>
  );
}
