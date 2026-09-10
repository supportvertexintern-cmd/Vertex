"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CaretDown, Check } from "@phosphor-icons/react";
import { isInternalPortalPath, homeFor } from "@/lib/rbac";
import type { Role } from "@prisma/client";

const BASE_NAV_LINKS = [
  { href: "/", label: "Home" },
  { href: "/about", label: "About" },
  { href: "/apply", label: "Apply" },
  { href: "/consultation", label: "Book a Consultation" },
  { href: "/contact", label: "Contact" },
];
const JOBS_LINK = { href: "/jobs", label: "Jobs" };

const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
  { code: "de", label: "Deutsch" },
  { code: "ru", label: "Русский" },
  { code: "zh-CN", label: "中文（简体）" },
  { code: "hi", label: "हिन्दी" },
  { code: "tr", label: "Türkçe" },
];

function getActiveLanguage(): string {
  const match = document.cookie.match(/(?:^|; )googtrans=([^;]*)/);
  if (!match) return "en";
  const value = decodeURIComponent(match[1]);
  const parts = value.split("/").filter(Boolean); // "/en/it" -> ["en", "it"]
  return parts[1] || "en";
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [currentLang, setCurrentLang] = useState("en");
  const [hasJobs, setHasJobs] = useState(false);
  const [authedRole, setAuthedRole] = useState<Role | null>(null);
  const pathname = usePathname();

  // The Jobs nav link only appears once there's something to browse —
  // no point sending visitors to an empty listings page.
  useEffect(() => {
    fetch("/api/jobs?limit=1")
      .then((r) => r.json())
      .then((res) => setHasJobs((res.total ?? 0) > 0))
      .catch(() => {});
  }, []);

  // Swaps Login/Get Started for Dashboard/Log Out when a session cookie
  // is present — this public marketing nav previously never checked auth
  // state at all, so a logged-in candidate browsing /jobs or /about kept
  // seeing "Log In" as if they weren't. Re-checked on every route change
  // since login/logout happen via full navigations, not client state this
  // component would otherwise observe.
  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : { data: null }))
      .then((res) => setAuthedRole(res.data?.role ?? null))
      .catch(() => setAuthedRole(null));
  }, [pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    setAuthedRole(null);
    window.location.href = "/";
  };

  const navLinks = hasJobs
    ? [...BASE_NAV_LINKS.slice(0, 2), JOBS_LINK, ...BASE_NAV_LINKS.slice(2)]
    : BASE_NAV_LINKS;

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 20);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    setCurrentLang(getActiveLanguage());
  }, []);

  const handleTranslate = (lang: string) => {
    if (lang === "en") {
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/;";
      document.cookie = "googtrans=; expires=Thu, 01 Jan 1970 00:00:00 UTC; path=/; domain=" + window.location.hostname;
    } else {
      document.cookie = `googtrans=/en/${lang}; path=/;`;
      document.cookie = `googtrans=/en/${lang}; path=/; domain=${window.location.hostname}`;
    }
    setCurrentLang(lang);
    window.location.reload();
  };

  if (isInternalPortalPath(pathname)) return null;

  return (
    <header
      className={`sticky top-0 z-50 w-full transition-all duration-300 border-b ${
        scrolled
          ? "bg-midnight-950/95 backdrop-blur-md border-white/10"
          : "bg-midnight-950 border-white/5"
      }`}
    >
      <nav className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-20">
          {/* Logo */}
          <Link href="/" className="flex items-center gap-3 group">
            <img
              src="/logo.svg"
              alt="Vertex"
              className="h-9 w-auto brightness-0 invert opacity-95 transition-opacity group-hover:opacity-100"
            />
            <div className="hidden sm:flex flex-col justify-center">
              <span className="text-ivory-50 font-semibold text-lg leading-none tracking-[0.2em]">
                VERTEX
              </span>
              <span className="text-gold-400 font-medium text-[9px] leading-none tracking-[0.35em] uppercase mt-1.5">
                International
              </span>
            </div>
          </Link>

          {/* Desktop nav */}
          <div className="hidden lg:flex items-center gap-9">
            {navLinks.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className={`text-[12px] font-semibold tracking-[0.2em] uppercase transition-colors duration-300 relative group ${
                  pathname === link.href ? "text-ivory-50" : "text-ivory-50/50 hover:text-ivory-50"
                }`}
              >
                {link.label}
                <span
                  className={`absolute -bottom-2 left-0 w-full h-px bg-gold-400 origin-left transition-transform duration-300 ${
                    pathname === link.href ? "scale-x-100" : "scale-x-0 group-hover:scale-x-100"
                  }`}
                />
              </Link>
            ))}
          </div>

          {/* Language + auth */}
          <div className="hidden md:flex items-center gap-6">
            {/* Language dropdown */}
            <div className="relative group py-2">
              <div translate="no" className="notranslate flex items-center gap-1.5 text-[12px] font-semibold text-ivory-50/50 hover:text-ivory-50 cursor-pointer uppercase tracking-[0.2em] transition-colors">
                <span>{currentLang}</span>
                <CaretDown size={12} weight="bold" className="transition-transform group-hover:rotate-180" />
              </div>
              <div
                translate="no"
                className="notranslate absolute top-full right-0 bg-midnight-900 border border-white/10 shadow-2xl rounded-xl py-2 w-48 max-h-96 overflow-y-auto opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right group-hover:translate-y-0 translate-y-2 flex flex-col z-50"
              >
                {LANGUAGES.map((lang) => {
                  const active = lang.code === currentLang;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleTranslate(lang.code)}
                      className={`text-left px-4 py-2 hover:bg-white/5 text-sm transition-colors cursor-pointer flex items-center justify-between ${
                        active ? "font-semibold text-gold-300" : "text-ivory-50/70 hover:text-ivory-50"
                      }`}
                    >
                      {lang.label}
                      {active && <Check size={14} weight="bold" />}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="h-5 w-px bg-white/15 hidden lg:block" />

            {authedRole ? (
              <>
                <Link
                  href={homeFor(authedRole)}
                  className="text-[12px] font-semibold tracking-[0.2em] uppercase text-ivory-50/50 hover:text-ivory-50 transition-colors"
                >
                  Dashboard
                </Link>
                <button
                  onClick={handleLogout}
                  className="bg-gold-400 hover:bg-gold-300 text-midnight-950 font-semibold text-[12px] py-3 px-6 rounded-full transition-all uppercase tracking-[0.15em]"
                >
                  Log Out
                </button>
              </>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className="text-[12px] font-semibold tracking-[0.2em] uppercase text-ivory-50/50 hover:text-ivory-50 transition-colors"
                >
                  Log In
                </Link>
                <Link
                  href="/apply"
                  className="bg-gold-400 hover:bg-gold-300 text-midnight-950 font-semibold text-[12px] py-3 px-6 rounded-full transition-all uppercase tracking-[0.15em]"
                >
                  Get Started
                </Link>
              </>
            )}
          </div>

          {/* Mobile hamburger */}
          <button
            id="mobile-menu-button"
            onClick={() => setOpen(!open)}
            className="md:hidden p-2 rounded-lg text-ivory-50 hover:bg-white/10"
            aria-label="Toggle menu"
          >
            <div className="w-5 flex flex-col gap-1">
              <span className={`block h-0.5 bg-current transition-all ${open ? "rotate-45 translate-y-1.5" : ""}`} />
              <span className={`block h-0.5 bg-current transition-all ${open ? "opacity-0" : ""}`} />
              <span className={`block h-0.5 bg-current transition-all ${open ? "-rotate-45 -translate-y-1.5" : ""}`} />
            </div>
          </button>
        </div>

        {/* Mobile menu */}
        {open && (
          <div className="md:hidden pb-5 border-t border-white/10 mt-1">
            <div className="flex flex-col gap-1 pt-3">
              {navLinks.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className={`px-4 py-2.5 rounded-lg text-sm font-medium uppercase tracking-[0.15em] transition-colors ${
                    pathname === link.href
                      ? "bg-white/10 text-ivory-50"
                      : "text-ivory-50/60 hover:bg-white/5 hover:text-ivory-50"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
              <hr className="my-2 border-white/10" />

              <div translate="no" className="notranslate px-4 py-1 pb-3 flex flex-wrap items-center gap-2">
                {LANGUAGES.map((lang) => {
                  const active = lang.code === currentLang;
                  return (
                    <button
                      key={lang.code}
                      onClick={() => handleTranslate(lang.code)}
                      className={`px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${
                        active ? "bg-gold-400 text-midnight-950" : "bg-white/10 hover:bg-white/20 text-ivory-50/70"
                      }`}
                    >
                      {lang.code.toUpperCase()}
                    </button>
                  );
                })}
              </div>

              <hr className="my-1 border-white/10" />
              {authedRole ? (
                <>
                  <Link href={homeFor(authedRole)} className="px-4 py-2.5 text-sm font-medium uppercase tracking-[0.15em] text-ivory-50/60">
                    Dashboard
                  </Link>
                  <button onClick={handleLogout} className="btn-gold text-sm mx-2 mt-1 text-center">
                    Log Out
                  </button>
                </>
              ) : (
                <>
                  <Link href="/auth/login" className="px-4 py-2.5 text-sm font-medium uppercase tracking-[0.15em] text-ivory-50/60">
                    Log In
                  </Link>
                  <Link href="/apply" className="btn-gold text-sm mx-2 mt-1">
                    Get Started
                  </Link>
                </>
              )}
            </div>
          </div>
        )}
      </nav>
    </header>
  );
}
