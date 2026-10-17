"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Buildings,
  Certificate,
  ChatCircleText,
  Check,
  CheckCircle,
  ClipboardText,
  EnvelopeSimple,
  Factory,
  FileText,
  ForkKnife,
  GlobeHemisphereWest,
  GraduationCap,
  HandCoins,
  Handshake,
  HardHat,
  MapPin,
  Package,
  Phone,
  Plus,
  QrCode,
  SealCheck,
  ShareNetwork,
  ShieldCheck,
  Users,
  Wrench,
} from "@phosphor-icons/react";

/* ===== Static content — sourced from Vertex International company documentation ===== */

const STATS = [
  { value: "3", label: "Global Regional Hubs" },
  { value: "UK", label: "Incorporated & Governed" },
  /*{ value: "ISO 9001", label: "Aligned Quality Standard" },*/
  { value: "24/7", label: "Multi-Hub Support" },
];

const SECTORS = [
  { icon: Factory, title: "Manufacturing" },
  { icon: HardHat, title: "Construction" },
  { icon: Wrench, title: "Engineering" },
  { icon: Package, title: "Logistics" },
  { icon: ForkKnife, title: "Hospitality" },
];

const SERVICES = [
  {
    id: "recruitment",
    label: "Recruitment",
    icon: Users,
    tag: "Global Recruitment Services",
    headline: "Talent, sourced and screened.",
    points: [
      "Unskilled to technical & engineering roles",
      "Credential and licence verification",
      "Matched to employer requirements",
    ],
    text: "We source, screen, and coordinate candidates across regions — matching them to international employer requirements across industries.",
    cta: "Apply Now",
    href: "/apply",
  },
  {
    id: "visa",
    label: "Work Visa & Permits",
    icon: ShieldCheck,
    tag: "Work Visa & Employment Support",
    headline: "Compliance, handled end-to-end.",
    points: [
      "Work permit & employment visa processing",
      "Licensed partners & official channels",
      "Destination-side documentation support",
    ],
    text: "Vertex supports work permit, employment visa, and overseas employment processing through structured, compliant coordination.",
    cta: "Discuss Your Case",
    href: "/contact",
  },
  {
    id: "travel",
    label: "Business Travel",
    icon: Buildings,
    tag: "Business Invitation Assistance",
    headline: "Corporate mobility, coordinated.",
    points: [
      "Official business invitation processing",
      "Conference & exhibition visa support",
      "Structured business mobility services",
    ],
    text: "We coordinate business invitation processes and corporate travel, working with partners to deliver structured mobility services.",
    cta: "Start a Discussion",
    href: "/contact",
  },
  {
    id: "agency",
    label: "Agency Partnerships",
    icon: Handshake,
    tag: "Agency Support & Expansion",
    headline: "Expand, with institutional backing.",
    points: [
      "Sourcing & screening collaboration",
      "Shared deployment workflows",
      "Access to global opportunities",
    ],
    text: "We help recruitment agencies, travel agencies, and manpower suppliers expand into international recruitment and mobility services.",
    cta: "Partner With Vertex",
    href: "/contact",
  },
];

const PROCESS_STEPS = [
  {
    icon: ClipboardText,
    title: "Sourcing & Screening",
    text: "Candidates are sourced through secure channels and screened for baseline alignment with employer requirements and institutional standards.",
  },
  {
    icon: FileText,
    title: "Documentation & Verification",
    text: "Dossiers are prepared and reviewed through authentication protocols, licence validation, and reference verification.",
  },
  {
    icon: HandCoins,
    title: "Offer & Permit Processing",
    text: "Formal job offers and contracts are coordinated alongside work permit, visa, and immigration authority processes.",
  },
  {
    icon: GlobeHemisphereWest,
    title: "Travel & Settlement",
    text: "Flight booking, airport reception, and accommodation are arranged, followed by a structured 90-day post-arrival support loop.",
  },
];

const AUDIENCES = [
  {
    icon: Buildings,
    title: "Employers & Corporate Clients",
    text: "Reliable, verified, deployment-ready international talent across workforce categories and project requirements.",
  },
  {
    icon: SealCheck,
    title: "Sovereign & Institutional Stakeholders",
    text: "Structured workforce mobility and overseas employment coordination within compliant, ethical, transparent frameworks.",
  },
  {
    icon: Handshake,
    title: "Recruitment Agencies & Manpower Suppliers",
    text: "Collaboration on sourcing, screening, shortlisting, credential verification, and shared deployment workflows.",
  },
  {
    icon: GlobeHemisphereWest,
    title: "Travel & Visa Partners",
    text: "Cooperation on flight booking, group travel, route optimization, documentation checklists, and compliance updates.",
  },
  {
    icon: Users,
    title: "Candidates & Professionals",
    text: "Support through registration, screening, documentation, offer coordination, visa guidance, and settlement.",
  },
];

const WHY_VERTEX = [
  {
    icon: Handshake,
    title: "Strategic Institutional Partnership",
    text: "Not a transactional staffing vendor — a long-term partner coordinating recruitment, mobility, compliance, travel and settlement through one accountable structure.",
  },
  {
    icon: ShieldCheck,
    title: "Compliance by Design",
    text: "Governed by UK corporate governance, anti-trafficking protocols, modern slavery safeguards, and ethical recruitment principles.",
  },
  {
    icon: CheckCircle,
    title: "Transparent Processes",
    text: "No hidden fees, no opaque processes — structured communication, verified documentation, and auditable compliance support.",
  },
  {
    icon: Phone,
    title: "24/7 Multi-Hub Support",
    text: "A multi-hub operational model across Europe, the Middle East and Africa supports service continuity across time zones.",
  },
];

const WORKFORCE_CATEGORIES = [
  { icon: GraduationCap, title: "Unskilled & General Workforce", text: "Agriculture, logistics, facilities management, manufacturing, food processing, construction support." },
  { icon: Certificate, title: "Semi-Skilled & Vocational Trades", text: "Plumbers, electricians, welders, machinery operators, hospitality professionals." },
  { icon: Buildings, title: "Technical & Engineering", text: "Civil, mechanical, electrical, petroleum, project supervision, EPC-related talent." },
];

const REQUIREMENTS = [
  "Valid passport",
  "CV & educational records",
  "Professional credentials & experience certificates",
  "Police clearance & medical checks",
];

const FAQS = [
  {
    q: "Who can Vertex place internationally?",
    a: "We support candidates across unskilled, semi-skilled, and technical/engineering workforce categories — matched to employer requirements and institutional standards.",
  },
  {
    q: "What documents do I need?",
    a: "A valid passport, CV, educational records, professional credentials, police clearance, and medical checks. Our team reviews your dossier and guides you through any gaps.",
  },
  {
    q: "Where does Vertex operate?",
    a: "We are headquartered in London, United Kingdom, with regional hubs in the UAE and across Africa, and a global network reaching Europe, Canada, Australia, South Korea, New Zealand, the USA and beyond.",
  },
  {
    q: "How does Vertex work with agencies and employers?",
    a: "We collaborate with recruitment agencies, manpower suppliers, travel agencies, and visa consultancies on sourcing, screening, documentation, and shared deployment workflows — reducing time-to-fill and administrative friction.",
  },
  {
    q: "What compliance standards does Vertex follow?",
    a: "Our Quality Management approach is aligned with ISO 9001:2015. We operate under UK corporate governance, with anti-bribery, anti-corruption, modern slavery and anti-human trafficking safeguards built into every placement.",
  },
];

/* ===== Motion helper ===== */

function FadeIn({
  children,
  delay = 0,
  className,
}: {
  children: React.ReactNode;
  delay?: number;
  className?: string;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ duration: 0.6, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

/* ===== Page ===== */

export default function HomeClient({ jobs }: { jobs: any[] }) {
  return (
    <div className="overflow-x-hidden">
      {/* ===== Hero ===== */}
      <section className="relative bg-midnight-950 text-ivory-50">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-1/4 right-0 w-[600px] h-[600px] rounded-full bg-midnight-600/15 blur-[130px]" />
        </div>

        <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center pt-24 pb-20">
          <div className="max-w-2xl">
            <p className="eyebrow-dark mb-6">
              <span className="eyebrow-rule" />
              Global Talent · Trusted Partnerships · Reliable Results
            </p>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight mb-8">
              Your gateway to <span className="text-gold-300">global careers.</span>
            </h1>

            <p className="text-lg text-ivory-50/65 leading-relaxed mb-10 max-w-xl font-light">
              Vertex International Recruitment Ltd. connects talented professionals, employers, agencies and
              institutional partners through ethical recruitment, compliant mobility solutions, and dedicated
              end-to-end support.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 mb-10">
              <Link href="/jobs" className="btn-gold px-8 py-3.5">
                Explore Opportunities <ArrowRight size={16} weight="bold" />
              </Link>
              <Link href="/contact" className="btn-ghost-dark px-8 py-3.5">
                Start a Partnership Discussion
              </Link>
            </div>

            <div className="flex items-center gap-3 text-ivory-50/50">
              <SealCheck size={18} weight="fill" className="text-gold-400" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">
                UK-Incorporated Human Capital & Mobility Enterprise
              </span>
            </div>
          </div>

          {/* Service finder widget */}
          <ServiceWidget />
        </div>

        <div className="relative border-t border-white/10">
          <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-2 md:grid-cols-4">
            {STATS.map((stat, idx) => (
              <div
                key={stat.label}
                className={`py-7 md:py-9 pr-6 ${idx > 0 ? "md:border-l md:border-white/10 md:pl-8" : ""}`}
              >
                <div className="text-2xl md:text-3xl font-semibold tracking-tight text-ivory-50">{stat.value}</div>
                <div className="text-ivory-50/40 text-[11px] uppercase tracking-[0.2em] mt-2">{stat.label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ===== Sector marquee ===== */}
      <section className="bg-midnight-900 border-b border-white/5 py-4 overflow-hidden marquee-mask">
        <div className="flex w-max animate-marquee">
          {[...Array(2)].map((_, dup) => (
            <div key={dup} className="flex items-center shrink-0">
              {[...SECTORS, ...SECTORS].map((s, idx) => (
                <span
                  key={`${dup}-${idx}`}
                  className="flex items-center text-[12px] font-semibold uppercase tracking-[0.3em] text-ivory-50/40"
                >
                  <span className="px-8">{s.title}</span>
                  <span className="text-gold-500/50 text-[8px]">◆</span>
                </span>
              ))}
            </div>
          ))}
        </div>
      </section>

      {/* ===== How it works ===== */}
      <section id="process" className="bg-ivory-50 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-14 max-w-2xl">
            <p className="eyebrow mb-4">
              <span className="eyebrow-rule" />
              The Vertex delivery framework
            </p>
            <h2 className="section-title">From first enquiry to settlement.</h2>
            <p className="section-subtitle">
              An operating model built to institutionalize quality control across the cross-border placement cycle.
            </p>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {PROCESS_STEPS.map((step, idx) => {
              const Icon = step.icon;
              return (
                <FadeIn key={step.title} delay={idx * 0.06} className="h-full">
                  <div className="bg-white border border-midnight-900/10 rounded-2xl p-7 h-full flex flex-col">
                    <div className="flex items-center gap-3 mb-5">
                      <span className="text-xs font-semibold text-gold-600 tracking-[0.15em]">
                        {String(idx + 1).padStart(2, "0")}
                      </span>
                      <div className="w-10 h-10 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800">
                        <Icon size={18} weight="regular" />
                      </div>
                    </div>
                    <h3 className="font-semibold text-midnight-900 mb-2 tracking-tight">{step.title}</h3>
                    <p className="text-sm text-midnight-900/55 font-light leading-relaxed">{step.text}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== Who we serve ===== */}
      <section className="bg-ivory-100 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-14 max-w-2xl">
            <p className="eyebrow mb-4">
              <span className="eyebrow-rule" />
              Who we serve
            </p>
            <h2 className="section-title">One institution, five stakeholders.</h2>
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {AUDIENCES.map((a, idx) => {
              const Icon = a.icon;
              return (
                <FadeIn key={a.title} delay={idx * 0.05} className="h-full">
                  <div className="bg-white border border-midnight-900/10 rounded-2xl p-7 h-full hover:border-gold-500/50 transition-colors">
                    <div className="w-11 h-11 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 mb-5">
                      <Icon size={20} weight="regular" />
                    </div>
                    <h3 className="font-semibold text-midnight-900 mb-2 tracking-tight">{a.title}</h3>
                    <p className="text-sm text-midnight-900/55 font-light leading-relaxed">{a.text}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== Featured jobs ===== */}
      <section className="bg-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                Open positions
              </p>
              <h2 className="section-title">Live opportunities.</h2>
            </div>
            <Link
              href="/jobs"
              className="group inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-midnight-800 hover:text-gold-600 transition-colors shrink-0"
            >
              View all jobs
              <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
            </Link>
          </FadeIn>

          {jobs.length === 0 ? (
            <FadeIn>
              <div className="text-center py-16 border border-midnight-900/10 rounded-2xl bg-white text-midnight-900/50">
                <p className="font-light">No jobs available yet. Check back soon.</p>
              </div>
            </FadeIn>
          ) : (
            <div className="border-t border-midnight-900/10">
              {jobs.map((job: any, idx: number) => (
                <FadeIn key={job.id} delay={idx * 0.03}>
                  <Link
                    href={`/jobs/${job.id}`}
                    className="group grid grid-cols-1 md:grid-cols-[1fr_auto_auto_56px] items-start md:items-center gap-3 md:gap-10 py-6 border-b border-midnight-900/10 transition-colors hover:bg-white px-2 md:px-4 -mx-2 md:-mx-4"
                  >
                    <div>
                      <h3 className="text-lg font-semibold tracking-tight text-midnight-900 group-hover:text-midnight-700 transition-colors">
                        {job.title}
                      </h3>
                      <p className="flex items-center gap-1.5 text-sm text-midnight-900/50 mt-1 font-light">
                        <MapPin size={14} weight="regular" />
                        {job.city}, {job.country}
                      </p>
                    </div>
                    <span className="text-sm font-medium text-midnight-800 md:text-right">
                      {job.salary_range || "Competitive"}
                    </span>
                    <span className="text-xs text-midnight-900/40 uppercase tracking-[0.15em] md:text-right">
                      {new Date(job.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                    <ArrowUpRight
                      size={20}
                      weight="regular"
                      className="hidden md:block text-midnight-900/25 group-hover:text-gold-600 transition-colors justify-self-end"
                    />
                  </Link>
                </FadeIn>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ===== Why Vertex ===== */}
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-12 max-w-2xl">
            <p className="eyebrow-dark mb-4">
              <span className="eyebrow-rule" />
              Why choose Vertex
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-ivory-50">
              End-to-end accountability, by design.
            </h2>
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {WHY_VERTEX.map((item, idx) => {
              const Icon = item.icon;
              return (
                <FadeIn key={item.title} delay={idx * 0.06} className="h-full">
                  <div className="border border-white/10 rounded-2xl p-7 h-full hover:border-gold-400/40 transition-colors">
                    <Icon size={24} weight="light" className="text-gold-300 mb-5" />
                    <h3 className="font-semibold text-ivory-50 mb-2 tracking-tight text-sm">{item.title}</h3>
                    <p className="text-sm text-ivory-50/50 font-light leading-relaxed">{item.text}</p>
                  </div>
                </FadeIn>
              );
            })}
          </div>
        </div>
      </section>

      {/* ===== Workforce categories & eligibility ===== */}
      <section className="bg-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
            <FadeIn>
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                Workforce categories
              </p>
              <h2 className="section-title mb-6">Matched to the right tier.</h2>
              <div className="space-y-4">
                {WORKFORCE_CATEGORIES.map((tier) => {
                  const Icon = tier.icon;
                  return (
                    <div
                      key={tier.title}
                      className="flex items-start gap-4 bg-white border border-midnight-900/10 rounded-2xl p-5 hover:border-gold-500/50 transition-colors"
                    >
                      <div className="w-11 h-11 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 shrink-0">
                        <Icon size={19} weight="regular" />
                      </div>
                      <div>
                        <h3 className="font-semibold text-midnight-900 text-sm">{tier.title}</h3>
                        <p className="text-sm text-midnight-900/55 mt-0.5 font-light">{tier.text}</p>
                      </div>
                    </div>
                  );
                })}
              </div>
            </FadeIn>

            <FadeIn delay={0.1}>
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                Before you apply
              </p>
              <h2 className="section-title mb-6">What you'll need.</h2>
              <ul className="space-y-4 mb-8">
                {REQUIREMENTS.map((req) => (
                  <li key={req} className="flex items-center gap-4 text-midnight-900">
                    <CheckCircle size={20} weight="fill" className="text-midnight-600 shrink-0" />
                    <span className="font-medium text-sm">{req}</span>
                  </li>
                ))}
              </ul>
              <Link
                href="/apply"
                className="group flex items-center justify-between bg-midnight-900 text-ivory-50 rounded-2xl p-6 hover:bg-midnight-800 transition-colors"
              >
                <span className="font-semibold">Ready? Start your application</span>
                <ArrowRight size={20} weight="bold" className="text-gold-300 transition-transform group-hover:translate-x-1" />
              </Link>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===== Referral Agents ===== */}
      <section className="bg-midnight-900 text-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
            <FadeIn>
              <p className="eyebrow-dark mb-4">
                <span className="eyebrow-rule" />
                Referral Agents
              </p>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-6">
                Know someone ready to work abroad?
                <br />
                Earn by referring them to Vertex.
              </h2>
              <p className="text-ivory-50/50 font-light leading-relaxed mb-8 max-w-lg">
                Register as a Vertex Referral Agent, get your own referral link and QR code, and earn a
                commission as the candidates you refer progress through our work permit and visa programmes —
                from registration all the way to deployment.
              </p>
              <Link href="/become-a-referral-agent" className="btn-gold px-8 py-3.5 inline-flex items-center gap-2">
                Become a Referral Agent
                <ArrowRight size={18} weight="bold" />
              </Link>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="grid grid-cols-2 gap-4">
                <div className="border border-white/10 rounded-2xl p-6 hover:border-gold-400/40 transition-colors">
                  <ShareNetwork size={24} weight="light" className="text-gold-300 mb-4" />
                  <h3 className="font-semibold text-ivory-50 mb-2 tracking-tight text-sm">Your own referral link</h3>
                  <p className="text-sm text-ivory-50/50 font-light leading-relaxed">
                    A unique code and link you can share anywhere.
                  </p>
                </div>
                <div className="border border-white/10 rounded-2xl p-6 hover:border-gold-400/40 transition-colors">
                  <QrCode size={24} weight="light" className="text-gold-300 mb-4" />
                  <h3 className="font-semibold text-ivory-50 mb-2 tracking-tight text-sm">A QR code to scan</h3>
                  <p className="text-sm text-ivory-50/50 font-light leading-relaxed">
                    Print it, post it, or send it — instant attribution.
                  </p>
                </div>
                <div className="border border-white/10 rounded-2xl p-6 hover:border-gold-400/40 transition-colors col-span-2">
                  <HandCoins size={24} weight="light" className="text-gold-300 mb-4" />
                  <h3 className="font-semibold text-ivory-50 mb-2 tracking-tight text-sm">Milestone-based commission</h3>
                  <p className="text-sm text-ivory-50/50 font-light leading-relaxed">
                    Earn as each referral progresses — from registration through to deployment — tracked live
                    on your own dashboard.
                  </p>
                </div>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===== FAQ ===== */}
      <section className="bg-ivory-100 py-20 md:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-12 text-center">
            <p className="eyebrow mb-4 justify-center">
              <span className="eyebrow-rule" />
              Common questions
            </p>
            <h2 className="section-title">Answers, upfront.</h2>
          </FadeIn>

          <FadeIn>
            <div className="border-t border-midnight-900/10">
              {FAQS.map((faq) => (
                <details key={faq.q} className="group border-b border-midnight-900/10">
                  <summary className="flex items-center justify-between gap-6 py-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                    <span className="font-semibold text-midnight-900 text-lg tracking-tight">{faq.q}</span>
                    <Plus
                      size={20}
                      weight="bold"
                      className="text-gold-600 shrink-0 transition-transform duration-300 group-open:rotate-45"
                    />
                  </summary>
                  <p className="pb-6 text-midnight-900/60 font-light leading-relaxed max-w-2xl">{faq.a}</p>
                </details>
              ))}
            </div>
            <p className="text-center mt-10 text-sm text-midnight-900/50 font-light">
              More questions?{" "}
              <Link href="/help" className="font-semibold text-midnight-800 hover:text-gold-600 transition-colors">
                Visit the Help Center →
              </Link>
            </p>
          </FadeIn>
        </div>
      </section>

      {/* ===== Contact strip ===== */}
      <section className="bg-midnight-900 text-ivory-50 py-16 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10">
            <p className="eyebrow-dark mb-4">
              <span className="eyebrow-rule" />
              Reach us directly
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight">One message away, always.</h2>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
            <FadeIn className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <ChatCircleText size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">WhatsApp</div>
                <a
                  href="https://wa.me/447438613251"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  +44 7438 613251
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.06} className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <Phone size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">Office</div>
                <a
                  href="tel:+442030263403"
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  +44 20 3026 3403
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.12} className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <EnvelopeSimple size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">Email</div>
                <a
                  href="mailto:vertex@vertexintern.com"
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  vertex@vertexintern.com
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>

      {/* ===== Final CTA ===== */}
      <section className="bg-midnight-950 text-ivory-50 py-24 md:py-28">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeIn>
            <p className="eyebrow-dark mb-6 justify-center">
              <span className="eyebrow-rule" />
              Begin today
            </p>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-6">
              Build across borders.
              <br />
              Move with confidence.
            </h2>
            <p className="text-ivory-50/50 text-lg font-light mb-10 max-w-xl mx-auto">
              Whether you're an employer, a licensed agency, a travel or visa partner, or a candidate ready
              to pursue opportunities abroad — Vertex provides the institutional platform to move forward.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href="/apply" className="btn-gold px-8 py-3.5">
                Apply Now
              </Link>
              <Link href="/contact" className="btn-ghost-dark px-8 py-3.5">
                Partner With Vertex
              </Link>
            </div>
          </FadeIn>
        </div>
      </section>
    </div>
  );
}

/* ===== Hero service widget ===== */

function ServiceWidget() {
  const [active, setActive] = useState(0);
  const service = SERVICES[active];
  const Icon = service.icon;

  return (
    <div className="w-full max-w-[480px] lg:ml-auto rounded-2xl border border-white/15 bg-white/[0.06] backdrop-blur-xl p-6 md:p-7">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-ivory-50/50 mb-5">
        What can we help with?
      </p>

      <div className="flex flex-wrap gap-2 mb-6" role="tablist" aria-label="Our services">
        {SERVICES.map((s, i) => (
          <button
            key={s.id}
            role="tab"
            aria-selected={i === active}
            onClick={() => setActive(i)}
            className={`px-3.5 py-2 rounded-full text-[11px] font-semibold tracking-[0.05em] border transition-all duration-200 ${i === active
                ? "bg-gold-400 text-midnight-950 border-gold-400"
                : "bg-white/5 text-ivory-50/60 border-white/15 hover:border-white/30 hover:text-ivory-50"
              }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      <motion.div key={service.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
        <div className="flex items-center gap-2.5 mb-3">
          <Icon size={16} weight="regular" className="text-gold-300" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-gold-300">{service.tag}</p>
        </div>
        <h3 className="text-xl md:text-2xl font-semibold tracking-tight text-ivory-50 mb-4">{service.headline}</h3>
        <ul className="space-y-2 mb-5">
          {service.points.map((point) => (
            <li key={point} className="flex items-center gap-2.5 text-sm text-ivory-50/70 font-light">
              <Check size={14} weight="bold" className="text-gold-300 shrink-0" />
              {point}
            </li>
          ))}
        </ul>
        <p className="text-sm text-ivory-50/50 font-light leading-relaxed mb-5">{service.text}</p>
        <Link href={service.href} className="btn-primary w-full py-3 text-[12px]">
          {service.cta} <ArrowRight size={14} weight="bold" />
        </Link>
      </motion.div>
    </div>
  );
}
