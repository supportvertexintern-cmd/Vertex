import type { Metadata } from "next";
import { Outfit } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import AIChatWidget from "@/components/AIChatWidget";
import WhatsAppButton from "@/components/WhatsAppButton";
import WelcomePopup from "@/components/WelcomePopup";

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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={font.variable}>
      <body className="min-h-screen flex flex-col bg-ivory-50">
        <Navbar />
        <main className="flex-1">{children}</main>
        <Footer />
        <AIChatWidget />
        <WhatsAppButton />
        <WelcomePopup />

        <div id="google_translate_element" style={{ display: 'none' }}></div>
        <Script id="google-translate-config" strategy="afterInteractive">
          {`
            function googleTranslateElementInit() {
              new window.google.translate.TranslateElement({
                pageLanguage: 'en',
                autoDisplay: false
              }, 'google_translate_element');
            }
          `}
        </Script>
        <Script src="//translate.google.com/translate_a/element.js?cb=googleTranslateElementInit" strategy="afterInteractive" />
      </body>
    </html>
  );
}
