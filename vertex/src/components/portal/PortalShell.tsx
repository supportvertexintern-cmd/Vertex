"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { Icon } from "@phosphor-icons/react";
import { List, X, SignOut, Devices } from "@phosphor-icons/react";
import SessionsPanel from "./SessionsPanel";

export interface PortalNavItem {
  href: string;
  label: string;
  icon: Icon;
  /** A heading drawn above the first item of each section after the first. */
  section?: string;
  /** A count for a badge: an API route answering { data: { open: number } }. */
  badgeFrom?: string;
}

interface PortalShellProps {
  /** e.g. "Country Supervisor", "System Administrator" */
  roleLabel: string;
  navItems: PortalNavItem[];
  children: React.ReactNode;
  wideContent?: boolean;
}

/**
 * Shared shell for every internal, role-based portal (SRS FR-5.1 "role-based
 * sections/portals"). Reuses the same design tokens and utility classes as
 * the public site (midnight/gold/ivory, Outfit, Phosphor) rather than
 * inventing a separate visual language for internal pages.
 */
export default function PortalShell({ roleLabel, navItems, children, wideContent = true }: PortalShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [badges, setBadges] = useState<Record<string, number>>({});

  // Each badge's count, once per page: a failure just shows no badge.
  const badgeUrls = navItems.map((item) => item.badgeFrom).filter((url): url is string => Boolean(url)).join("|");
  useEffect(() => {
    if (!badgeUrls) return;
    let live = true;
    for (const url of badgeUrls.split("|")) {
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((body) => {
          const open = Number(body?.data?.open);
          if (live && Number.isFinite(open)) setBadges((prev) => ({ ...prev, [url]: open }));
        })
        .catch(() => {});
    }
    return () => {
      live = false;
    };
  }, [badgeUrls, pathname]);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/auth/login");
  };

  // The single longest-matching href "wins" — otherwise a parent path like
  // /admin matches every nested route too and multiple nav items light up
  // at once.
  const activeHref = navItems
    .map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(href + "/"))
    .sort((a, b) => b.length - a.length)[0];

  const NavList = () => (
    <nav className="flex flex-col gap-1 px-3">
      {navItems.map((item, i) => {
        const Icon = item.icon;
        const active = item.href === activeHref;
        const heading = item.section && item.section !== navItems[i - 1]?.section ? item.section : null;
        return (
          <div key={item.href} className="contents">
          {heading && (
            <p className="px-4 pt-5 pb-1 text-[10px] font-semibold uppercase tracking-[0.2em] text-ivory-50/35">{heading}</p>
          )}
          <Link
            href={item.href}
            onClick={() => setMobileOpen(false)}
            className={`group flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium tracking-tight transition-colors ${
              active
                ? "bg-gold-400 text-midnight-950"
                : "text-ivory-50/60 hover:text-ivory-50 hover:bg-white/5"
            }`}
          >
            <Icon size={18} weight={active ? "fill" : "regular"} />
            {item.label}
            {item.badgeFrom && badges[item.badgeFrom] > 0 && (
              <span
                className={`ml-auto min-w-[1.5rem] rounded-full px-1.5 py-0.5 text-center text-[11px] font-semibold ${active ? "bg-midnight-950 text-gold-300" : "bg-red-500 text-white"}`}
                aria-label={`${badges[item.badgeFrom]} open`}
              >
                {badges[item.badgeFrom]}
              </span>
            )}
          </Link>
          </div>
        );
      })}
    </nav>
  );

  return (
    <div className="min-h-screen flex bg-ivory-50">
      {/* Desktop sidebar — pinned to the viewport height (not the page's,
          which can grow taller than the screen), so the logout button at
          the bottom never needs a page scroll to reach. Only the nav list
          itself scrolls internally if it's ever too long to fit. */}
      <aside className="hidden lg:flex flex-col w-64 shrink-0 bg-midnight-950 py-6 h-screen sticky top-0">
        <div className="px-6 mb-8 flex items-center gap-3 shrink-0">
          <img src="/logo.svg" alt="Vertex" className="h-8 w-auto brightness-0 invert opacity-95" />
          <div className="flex flex-col justify-center">
            <span className="text-ivory-50 font-semibold text-sm leading-none tracking-[0.15em]">VERTEX</span>
            <span className="text-gold-400 font-medium text-[9px] tracking-[0.25em] uppercase mt-1 leading-none">
              {roleLabel}
            </span>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <NavList />
        </div>

        <div className="shrink-0 px-3 pt-6">
          <button
            onClick={() => setSessionsOpen(true)}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-ivory-50/50 hover:text-ivory-50 hover:bg-white/5 transition-colors"
          >
            <Devices size={18} weight="regular" />
            Active sessions
          </button>
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-ivory-50/50 hover:text-ivory-50 hover:bg-white/5 transition-colors"
          >
            <SignOut size={18} weight="regular" />
            Log out
          </button>
        </div>
      </aside>

      {/* Mobile top bar + drawer */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-40 bg-midnight-950 flex items-center justify-between px-4 h-16">
        <div className="flex items-center gap-2">
          <img src="/logo.svg" alt="Vertex" className="h-6 w-auto brightness-0 invert opacity-95" />
          <span className="text-ivory-50 font-semibold text-xs tracking-[0.15em]">VERTEX</span>
        </div>
        <button onClick={() => setMobileOpen(true)} className="text-ivory-50 p-2" aria-label="Open menu">
          <List size={22} weight="bold" />
        </button>
      </div>

      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 bg-midnight-950 flex flex-col py-6">
          <div className="px-6 mb-8 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <img src="/logo.svg" alt="Vertex" className="h-8 w-auto brightness-0 invert opacity-95" />
              <span className="text-gold-400 font-medium text-[9px] tracking-[0.25em] uppercase">{roleLabel}</span>
            </div>
            <button onClick={() => setMobileOpen(false)} className="text-ivory-50 p-2" aria-label="Close menu">
              <X size={22} weight="bold" />
            </button>
          </div>
          <NavList />
          <div className="mt-auto px-3 pt-6">
            <button
              onClick={() => {
                setMobileOpen(false);
                setSessionsOpen(true);
              }}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-ivory-50/50 hover:text-ivory-50 hover:bg-white/5 transition-colors"
            >
              <Devices size={18} weight="regular" />
              Active sessions
            </button>
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-medium text-ivory-50/50 hover:text-ivory-50 hover:bg-white/5 transition-colors"
            >
              <SignOut size={18} weight="regular" />
              Log out
            </button>
          </div>
        </div>
      )}

      {sessionsOpen && <SessionsPanel onClose={() => setSessionsOpen(false)} />}

      {/* Content */}
      <main className="flex-1 min-w-0 pt-16 lg:pt-0">
        <div className={`${wideContent ? "max-w-[1600px]" : "max-w-6xl"} mx-auto px-4 sm:px-6 lg:px-10 py-8 lg:py-10`}>{children}</div>
      </main>
    </div>
  );
}
