"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";
import VideoPlayer from "@/components/VideoPlayer";
import PartnerEnquiryForm from "@/components/PartnerEnquiryForm";
import {
  ArrowRight,
  ArrowUpRight,
  Buildings,
  Check,
  CheckCircle,
  ChatCircleText,
  EnvelopeSimple,
  Factory,
  ForkKnife,
  Handshake,
  HardHat,
  MapPin,
  Package,
  Phone,
  Plus,
  SealCheck,
  ShieldCheck,
  Users,
  Wrench,
} from "@phosphor-icons/react";
import { LANDING_VIDEO } from "@/lib/media";
import { LandingAnchor, Lines, iconFor, phoneDigits, timeLabel } from "@/components/LandingParts";
import type { Landing } from "@/server/services/landingContent";

/* ===== Not shown on the page (kept from the earlier design) ===== */

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
    href: "#partner-form",
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

// The fields of a public job (server/services/publicJobs.ts) this page shows.
interface FeaturedJob {
  id: string;
  title: string;
  country: string;
  city: string | null;
  salary_range: string | null;
  created_at: string | Date;
}

// The page's text is marketing's (the landing CMS; app/page.tsx reads it
// through server/services/landingContent.ts). A block marketing hid is
// null, and its section isn't shown.
export default function HomeClient({ jobs, content }: { jobs: FeaturedJob[]; content: Landing }) {
  const hero = content["web.hero"];
  const partner = content["web.partner_enquiry"];
  const process = content["web.process"];
  const audiences = content["web.audiences"];
  const featured = content["web.jobs"];
  const why = content["shared.why_vertex"];
  const workforce = content["web.workforce"];
  const referral = content["web.referral"];
  const faq = content["web.faq"];
  const contact = content["shared.contact"];
  const ending = content["web.ending"];

  return (
    <div className="overflow-x-hidden">
      {/* ===== Hero ===== */}
      {hero && (
      <section className="relative bg-midnight-950 text-ivory-50">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-1/4 right-0 w-[600px] h-[600px] rounded-full bg-midnight-600/15 blur-[130px]" />
        </div>

        <div className="relative max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 grid lg:grid-cols-[1.1fr_0.9fr] gap-12 items-center pt-24 pb-20">
          <div className="max-w-2xl">
            <p className="eyebrow-dark mb-6">
              <span className="eyebrow-rule" />
              {hero.eyebrow}
            </p>

            <h1 className="text-4xl sm:text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight mb-8">
              <Lines text={hero.headline} />
              {hero.highlight && (
                <>
                  {" "}
                  <span className="text-gold-300">{hero.highlight}</span>
                </>
              )}
            </h1>

            <p className="text-lg text-ivory-50/65 leading-relaxed mb-10 max-w-xl font-light">
              <Lines text={hero.intro} />
            </p>

            {hero.buttons.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-4 mb-10">
                {hero.buttons.map((button, idx) =>
                  idx === 0 ? (
                    <LandingAnchor key={idx} link={button} className="btn-gold px-8 py-3.5">
                      {button.label} <ArrowRight size={16} weight="bold" />
                    </LandingAnchor>
                  ) : (
                    <LandingAnchor key={idx} link={button} className="btn-ghost-dark px-8 py-3.5" />
                  ),
                )}
              </div>
            )}

            {hero.trust_line && (
              <div className="flex items-center gap-3 text-ivory-50/50">
                <SealCheck size={18} weight="fill" className="text-gold-400" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">{hero.trust_line}</span>
              </div>
            )}
          </div>

          {/* Landing video */}
          <FadeIn delay={0.1}>
            <VideoPlayer
              src={LANDING_VIDEO}
              alt={hero.video_alt}
              chapters={hero.video_chapters.map((ch) => ({ ...ch, timeLabel: timeLabel(ch.seconds) }))}
              fallback={hero.video_fallback}
            />
          </FadeIn>
        </div>
      </section>
      )}

      {/* ===== Partner enquiry form ===== */}
      {/* The section stays without marketing's text: other links on the site lead to #partner-form. */}
      <section id="partner-form" className="bg-midnight-900 text-ivory-50 py-16 md:py-24 scroll-mt-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8 lg:grid lg:grid-cols-[1fr_1fr] lg:gap-10 lg:gap-16 lg:items-start">
          {/* Left column: Benefits + Process + Already a Partner */}
          {partner ? (
          <FadeIn className="mb-10 lg:mb-0">
            <p className="eyebrow-dark mb-4">
              <span className="eyebrow-rule" />
              {partner.eyebrow}
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-6">
              <Lines text={partner.title} />
              {partner.highlight && (
                <>
                  {" "}
                  <span className="text-gold-300">{partner.highlight}</span>
                </>
              )}
            </h2>
            <p className="text-ivory-50/65 leading-relaxed font-light mb-8">
              <Lines text={partner.intro} />
            </p>

            {/* Benefits */}
            <div className="space-y-4 mb-10">
              {partner.benefits.map((benefit, idx) => {
                const Icon = iconFor(benefit.icon, CheckCircle);
                return (
                  <div key={idx} className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-full border border-white/15 flex items-center justify-center text-gold-300 shrink-0">
                      <Icon size={18} weight="regular" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-ivory-50 mb-1 text-sm">{benefit.title}</h3>
                      <p className="text-sm text-ivory-50/50 font-light leading-relaxed">{benefit.text}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Process Steps */}
            <div className="mb-10">
              <h3 className="text-sm font-semibold uppercase tracking-wider text-ivory-50/50 mb-4">
                {partner.steps_title}
              </h3>
              <div className="space-y-4">
                {partner.steps.map((step, idx) => (
                  <div key={idx} className="flex items-start gap-4 p-4 rounded-xl border border-white/10 bg-white/5">
                    <div className="text-2xl font-semibold text-gold-400 tracking-tight shrink-0">
                      {step.marker || String(idx + 1).padStart(2, "0")}
                    </div>
                    <div>
                      <h4 className="font-semibold text-ivory-50 mb-1 text-sm">{step.title}</h4>
                      <p className="text-sm text-ivory-50/50 font-light leading-relaxed">{step.text}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Already a Partner */}
            <div className="p-5 rounded-xl border border-white/10 bg-white/5">
              <p className="text-xs font-semibold uppercase tracking-wider text-ivory-50/50 mb-2">{partner.existing_title}</p>
              <p className="text-sm text-ivory-50/60 mb-3">{partner.existing_text}</p>
              <LandingAnchor link={partner.existing_link} className="text-gold-400 hover:text-gold-300 text-sm font-semibold inline-flex items-center gap-1">
                {partner.existing_link.label} <ArrowRight size={14} weight="bold" />
              </LandingAnchor>
            </div>
          </FadeIn>
          ) : (
            <div />
          )}

          {/* Right column: Form */}
          <FadeIn delay={0.1}>
            <PartnerEnquiryForm variant="dark" email={contact?.email} />
          </FadeIn>
        </div>
      </section>

      {/* ===== How it works ===== */}
      {process && (
      <section id="process" className="bg-ivory-50 py-20 md:py-28 scroll-mt-20">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-14 max-w-2xl">
            <p className="eyebrow mb-4">
              <span className="eyebrow-rule" />
              {process.eyebrow}
            </p>
            <h2 className="section-title"><Lines text={process.title} /></h2>
            {process.subtitle && <p className="section-subtitle">{process.subtitle}</p>}
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {process.cards.map((step, idx) => {
              const Icon = iconFor(step.icon, CheckCircle);
              return (
                <FadeIn key={idx} delay={idx * 0.06} className="h-full">
                  <div className="bg-white border border-midnight-900/10 rounded-2xl p-7 h-full flex flex-col">
                    <div className="flex items-center gap-3 mb-5">
                      <span className="text-xs font-semibold text-gold-600 tracking-[0.15em]">
                        {step.marker || String(idx + 1).padStart(2, "0")}
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
      )}

      {/* ===== Who we serve ===== */}
      {audiences && (
      <section className="bg-ivory-100 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-14 max-w-2xl">
            <p className="eyebrow mb-4">
              <span className="eyebrow-rule" />
              {audiences.eyebrow}
            </p>
            <h2 className="section-title"><Lines text={audiences.title} /></h2>
            {audiences.subtitle && <p className="section-subtitle">{audiences.subtitle}</p>}
          </FadeIn>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {audiences.cards.map((a, idx) => {
              const Icon = iconFor(a.icon, Users);
              return (
                <FadeIn key={idx} delay={idx * 0.05} className="h-full">
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
      )}

      {/* ===== Featured jobs ===== */}
      {featured && (
      <section className="bg-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10 flex flex-col md:flex-row md:items-end justify-between gap-6">
            <div className="max-w-2xl">
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                {featured.eyebrow}
              </p>
              <h2 className="section-title"><Lines text={featured.title} /></h2>
            </div>
            <LandingAnchor
              link={featured.view_all}
              className="group inline-flex items-center gap-2 text-sm font-semibold uppercase tracking-[0.2em] text-midnight-800 hover:text-gold-600 transition-colors shrink-0"
            >
              {featured.view_all.label}
              <ArrowRight size={16} weight="bold" className="transition-transform group-hover:translate-x-1" />
            </LandingAnchor>
          </FadeIn>

          {jobs.length === 0 ? (
            <FadeIn>
              <div className="text-center py-16 border border-midnight-900/10 rounded-2xl bg-white text-midnight-900/50">
                <p className="font-light">{featured.empty_text}</p>
              </div>
            </FadeIn>
          ) : (
            <div className="border-t border-midnight-900/10">
              {jobs.map((job, idx) => (
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
      )}

      {/* ===== Why Vertex ===== */}
      {why && (
      <section className="bg-midnight-950 text-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-12 max-w-2xl">
            <p className="eyebrow-dark mb-4">
              <span className="eyebrow-rule" />
              {why.eyebrow}
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight text-ivory-50">
              <Lines text={why.title} />
            </h2>
            {why.subtitle && <p className="text-ivory-50/50 font-light leading-relaxed mt-4">{why.subtitle}</p>}
          </FadeIn>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {why.cards.map((item, idx) => {
              const Icon = iconFor(item.icon, CheckCircle);
              return (
                <FadeIn key={idx} delay={idx * 0.06} className="h-full">
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
      )}

      {/* ===== Workforce categories & eligibility ===== */}
      {workforce && (
      <section className="bg-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20">
            <FadeIn>
              <p className="eyebrow mb-4">
                <span className="eyebrow-rule" />
                {workforce.eyebrow}
              </p>
              <h2 className="section-title mb-6"><Lines text={workforce.title} /></h2>
              <div className="space-y-4">
                {workforce.tiers.map((tier, idx) => {
                  const Icon = iconFor(tier.icon, Buildings);
                  return (
                    <div
                      key={idx}
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
                {workforce.requirements_eyebrow}
              </p>
              <h2 className="section-title mb-6"><Lines text={workforce.requirements_title} /></h2>
              <ul className="space-y-4 mb-8">
                {workforce.requirements.map((req, idx) => (
                  <li key={idx} className="flex items-center gap-4 text-midnight-900">
                    <CheckCircle size={20} weight="fill" className="text-midnight-600 shrink-0" />
                    <span className="font-medium text-sm">{req}</span>
                  </li>
                ))}
              </ul>
              <LandingAnchor
                link={workforce.cta}
                className="group flex items-center justify-between bg-midnight-900 text-ivory-50 rounded-2xl p-6 hover:bg-midnight-800 transition-colors"
              >
                <span className="font-semibold">{workforce.cta.label}</span>
                <ArrowRight size={20} weight="bold" className="text-gold-300 transition-transform group-hover:translate-x-1" />
              </LandingAnchor>
            </FadeIn>
          </div>
        </div>
      </section>
      )}

      {/* ===== Referral Agents ===== */}
      {referral && (
      <section className="bg-midnight-900 text-ivory-50 py-20 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 lg:gap-20 items-center">
            <FadeIn>
              <p className="eyebrow-dark mb-4">
                <span className="eyebrow-rule" />
                {referral.eyebrow}
              </p>
              <h2 className="text-3xl md:text-4xl font-semibold tracking-tight mb-6">
                <Lines text={referral.title} />
              </h2>
              <p className="text-ivory-50/50 font-light leading-relaxed mb-8 max-w-lg">
                <Lines text={referral.intro} />
              </p>
              <LandingAnchor link={referral.cta} className="btn-gold px-8 py-3.5 inline-flex items-center gap-2">
                {referral.cta.label}
                <ArrowRight size={18} weight="bold" />
              </LandingAnchor>
            </FadeIn>

            <FadeIn delay={0.1}>
              <div className="grid grid-cols-2 gap-4">
                {referral.cards.map((card, idx) => {
                  const Icon = iconFor(card.icon, CheckCircle);
                  // An odd last card spans the row, as the third one always has.
                  const wide = idx === referral.cards.length - 1 && referral.cards.length % 2 === 1;
                  return (
                    <div
                      key={idx}
                      className={`border border-white/10 rounded-2xl p-6 hover:border-gold-400/40 transition-colors${wide ? " col-span-2" : ""}`}
                    >
                      <Icon size={24} weight="light" className="text-gold-300 mb-4" />
                      <h3 className="font-semibold text-ivory-50 mb-2 tracking-tight text-sm">{card.title}</h3>
                      <p className="text-sm text-ivory-50/50 font-light leading-relaxed">{card.text}</p>
                    </div>
                  );
                })}
              </div>
            </FadeIn>
          </div>
        </div>
      </section>
      )}

      {/* ===== FAQ ===== */}
      {faq && (
      <section className="bg-ivory-100 py-20 md:py-28">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-12 text-center">
            <p className="eyebrow mb-4 justify-center">
              <span className="eyebrow-rule" />
              {faq.eyebrow}
            </p>
            <h2 className="section-title"><Lines text={faq.title} /></h2>
          </FadeIn>

          <FadeIn>
            {faq.groups.map((group, gIdx) => {
              const Icon = iconFor(group.icon, ChatCircleText);
              return (
                <div key={gIdx} className={gIdx < faq.groups.length - 1 ? "mb-10" : undefined}>
                  <h3 className="text-sm font-semibold uppercase tracking-wider text-midnight-900/60 mb-4 flex items-center gap-2">
                    <Icon size={16} weight="regular" className="text-gold-600" />
                    {group.title}
                  </h3>
                  <div className="border-t border-midnight-900/10">
                    {group.items.map((item, idx) => (
                      <details key={idx} className="group border-b border-midnight-900/10">
                        <summary className="flex items-center justify-between gap-6 py-6 cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                          <span className="font-semibold text-midnight-900 text-lg tracking-tight">{item.q}</span>
                          <Plus
                            size={20}
                            weight="bold"
                            className="text-gold-600 shrink-0 transition-transform duration-300 group-open:rotate-45"
                          />
                        </summary>
                        <p className="pb-6 text-midnight-900/60 font-light leading-relaxed max-w-2xl">
                          <Lines text={item.a} />
                        </p>
                      </details>
                    ))}
                  </div>
                </div>
              );
            })}

            {(faq.more_text || faq.more_link) && (
              <p className="text-center mt-10 text-sm text-midnight-900/50 font-light">
                {faq.more_text}
                {faq.more_text && faq.more_link && " "}
                {faq.more_link && (
                  <LandingAnchor link={faq.more_link} className="font-semibold text-midnight-800 hover:text-gold-600 transition-colors" />
                )}
              </p>
            )}
          </FadeIn>
        </div>
      </section>
      )}

      {/* ===== Contact strip ===== */}
      {contact && (
      <section className="bg-midnight-900 text-ivory-50 py-16 border-b border-white/10">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <FadeIn className="mb-10">
            <p className="eyebrow-dark mb-4">
              <span className="eyebrow-rule" />
              {contact.eyebrow}
            </p>
            <h2 className="text-2xl md:text-3xl font-semibold tracking-tight"><Lines text={contact.title} /></h2>
          </FadeIn>

          <div className="grid md:grid-cols-3 gap-px bg-white/10 border border-white/10 rounded-2xl overflow-hidden">
            <FadeIn className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <ChatCircleText size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">WhatsApp</div>
                <a
                  href={`https://wa.me/${phoneDigits(contact.whatsapp)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  {contact.whatsapp}
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.06} className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <Phone size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">Office</div>
                <a
                  href={`tel:+${phoneDigits(contact.office)}`}
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  {contact.office}
                </a>
              </div>
            </FadeIn>
            <FadeIn delay={0.12} className="h-full">
              <div className="bg-midnight-900 p-7 h-full">
                <EnvelopeSimple size={24} weight="light" className="text-gold-300 mb-4" />
                <div className="text-[11px] font-semibold uppercase tracking-[0.25em] text-ivory-50/40 mb-3">Email</div>
                <a
                  href={`mailto:${contact.email}`}
                  className="text-ivory-50/80 hover:text-gold-300 text-sm font-mono transition-colors"
                >
                  {contact.email}
                </a>
              </div>
            </FadeIn>
          </div>
        </div>
      </section>
      )}

      {/* ===== Final CTA ===== */}
      {ending && (
      <section className="bg-midnight-950 text-ivory-50 py-24 md:py-28">
        <div className="max-w-3xl mx-auto px-4 text-center">
          <FadeIn>
            <p className="eyebrow-dark mb-6 justify-center">
              <span className="eyebrow-rule" />
              {ending.eyebrow}
            </p>
            <h2 className="text-3xl md:text-5xl font-semibold tracking-tight leading-[1.05] mb-6">
              <Lines text={ending.title} />
            </h2>
            <p className="text-ivory-50/50 text-lg font-light mb-10 max-w-xl mx-auto">
              <Lines text={ending.text} />
            </p>
            {ending.buttons.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-4 justify-center">
                {ending.buttons.map((button, idx) => (
                  <LandingAnchor
                    key={idx}
                    link={button}
                    className={idx === 0 ? "btn-gold px-8 py-3.5" : "btn-ghost-dark px-8 py-3.5"}
                  />
                ))}
              </div>
            )}
          </FadeIn>
        </div>
      </section>
      )}
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
        {service.href.startsWith("#") ? (
          <a href={service.href} className="btn-primary w-full py-3 text-[12px] inline-flex items-center justify-center gap-2">
            {service.cta} <ArrowRight size={14} weight="bold" />
          </a>
        ) : (
          <Link href={service.href} className="btn-primary w-full py-3 text-[12px]">
            {service.cta} <ArrowRight size={14} weight="bold" />
          </Link>
        )}
      </motion.div>
    </div>
  );
}
