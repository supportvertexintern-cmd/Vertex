import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRight,
  Buildings,
  CheckCircle,
  GlobeHemisphereWest,
  Heart,
  MapPin,
  ShieldCheck,
  Sparkle,
} from "@phosphor-icons/react/dist/ssr";

export const metadata: Metadata = {
  title: "About Us",
  description:
    "Vertex International Recruitment Ltd. — a UK-incorporated human capital and mobility enterprise connecting talent, employers, agencies and institutional partners worldwide.",
};

const FACTS = [
  { value: "UK", label: "Incorporated & Governed" },
  { value: "3", label: "Global Regional Hubs" },
  /*{ value: "ISO 9001", label: "Aligned Quality Standard" },*/
  { value: "16943308", label: "Company Registration No." },
];

const VALUES = [
  {
    icon: ShieldCheck,
    title: "Uncompromising Integrity",
    description: "Zero tolerance for misrepresentation, document fraud, unethical placement, or unlawful recruitment practices.",
  },
  {
    icon: Heart,
    title: "Human-Centric Precision",
    description: "Compliance discipline paired with concierge-level care, at every stage of the journey.",
  },
  {
    icon: CheckCircle,
    title: "Transparency by Design",
    description: "Mobility must be clear, documented and auditable — verified offers, transparent milestones, accountable communication.",
  },
  {
    icon: Buildings,
    title: "Institutional Resilience",
    description: "Long-term talent pipelines that adapt to regulatory shifts, geopolitical change, and economic cycles.",
  },
  {
    icon: GlobeHemisphereWest,
    title: "Global Stewardship",
    description: "Ethical recruitment practices that protect candidate rights and strengthen responsible migration corridors.",
  },
];

const HUBS = [
  {
    icon: MapPin,
    title: "European Command",
    location: "London, United Kingdom",
    text: "The global headquarters — housing executive leadership, legal compliance, strategic finance, European employer relations, and Schengen-area mobility processing.",
  },
  {
    icon: MapPin,
    title: "Middle East & Gulf Operations",
    location: "UAE Strategic Hub",
    text: "Supporting technical, engineering, semi-skilled, hospitality, infrastructure, energy, and GCC-related placement activity, with advanced consular liaison capability.",
  },
  {
    icon: MapPin,
    title: "Africa Regional Directorate",
    location: "Multi-City Presence",
    text: "Deep sourcing for unskilled, semi-skilled, and specialist technical talent, with in-person verification, cultural orientation, and pre-departure preparation.",
  },
];

export default function AboutPage() {
  return (
    <div>
      {/* Hero */}
      <section className="bg-midnight-950 text-ivory-50 py-24 md:py-28">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <p className="eyebrow-dark mb-6">
            <span className="eyebrow-rule" />
            About Vertex International Recruitment Ltd.
          </p>
          <h1 className="text-4xl md:text-6xl font-semibold tracking-tight leading-[1.05] max-w-3xl mb-8">
            Connecting talent. Enabling mobility. Building futures.
          </h1>
          <p className="text-ivory-50/60 text-lg font-light max-w-2xl leading-relaxed">
            A UK-incorporated, globally integrated human capital and mobility enterprise — engineering complete
            cross-border career journeys at the intersection of high-integrity recruitment, travel arrival
            compliance, and concierge-level relocation logistics.
          </p>
        </div>
      </section>

      {/* Mission + facts */}
      <section className="py-20 md:py-28 bg-ivory-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="eyebrow mb-5">
                <span className="eyebrow-rule" />
                Our mission
              </p>
              <h2 className="section-title mb-6">
                Where human ambition meets institutional capability.
              </h2>
              <p className="text-midnight-900/60 font-light leading-relaxed mb-4">
                Vertex is designed to solve critical labour market asymmetries across continents by connecting
                disciplined, career-driven professionals with international opportunities. Headquartered in the
                United Kingdom and operating through regional command centres across Europe, Asia, the Middle
                East and Africa, we manage structured recruitment, visa facilitation, work permit coordination,
                travel advisory, and settlement support.
              </p>
              <p className="text-midnight-900/60 font-light leading-relaxed mb-10">
                Our institutional scope covers the full mobility lifecycle: candidate sourcing, credential
                verification, secured job offers, work permit facilitation, visa guidance, travel coordination,
                arrival reception, accommodation support, and post-placement follow-up.
              </p>
              <Link href="/jobs" className="btn-primary">
                Explore Opportunities <ArrowRight size={16} weight="bold" />
              </Link>
            </div>
            <div className="grid grid-cols-2 border-t border-l border-midnight-900/10">
              {FACTS.map((fact) => (
                <div key={fact.label} className="border-b border-r border-midnight-900/10 p-8 md:p-10">
                  <div className="text-2xl md:text-3xl font-semibold tracking-tight text-midnight-900">{fact.value}</div>
                  <div className="text-midnight-900/45 text-[11px] uppercase tracking-[0.2em] mt-2">{fact.label}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Values */}
      <section className="py-20 md:py-28 bg-ivory-100">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14 max-w-2xl">
            <p className="eyebrow mb-5">
              <span className="eyebrow-rule" />
              What guides us
            </p>
            <h2 className="section-title">Our values.</h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-5">
            {VALUES.map((v) => {
              const Icon = v.icon;
              return (
                <div
                  key={v.title}
                  className="bg-white border border-midnight-900/10 rounded-2xl p-7 hover:border-gold-500/60 transition-colors"
                >
                  <div className="w-12 h-12 rounded-full border border-midnight-900/15 flex items-center justify-center text-midnight-800 mb-6">
                    <Icon size={22} weight="regular" />
                  </div>
                  <h3 className="font-semibold text-midnight-900 mb-2 tracking-tight">{v.title}</h3>
                  <p className="text-midnight-900/55 text-sm font-light leading-relaxed">{v.description}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Global presence */}
      <section className="py-20 md:py-28 bg-midnight-950 text-ivory-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="mb-14 max-w-2xl">
            <p className="eyebrow-dark mb-5">
              <span className="eyebrow-rule" />
              Global presence
            </p>
            <h2 className="text-3xl md:text-4xl font-semibold tracking-tight">
              A fully integrated multi-hub model.
            </h2>
            <p className="text-ivory-50/55 font-light leading-relaxed mt-4 max-w-2xl">
              Supported by physical presence, licensed affiliate networks, secure digital infrastructure, and
              satellite representative offices — connecting candidates from Africa, Asia and South America with
              opportunities across Europe, Canada, Australia, UAE, South Korea, New Zealand, the USA and beyond.
            </p>
          </div>
          <div className="grid md:grid-cols-3 gap-5">
            {HUBS.map((hub) => {
              const Icon = hub.icon;
              return (
                <div key={hub.title} className="border border-white/10 rounded-2xl p-7 hover:border-gold-400/40 transition-colors">
                  <Icon size={22} weight="light" className="text-gold-300 mb-5" />
                  <h3 className="font-semibold text-ivory-50 mb-1 tracking-tight">{hub.title}</h3>
                  <p className="text-gold-300/80 text-[11px] font-semibold uppercase tracking-[0.15em] mb-4">{hub.location}</p>
                  <p className="text-sm text-ivory-50/55 font-light leading-relaxed">{hub.text}</p>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Compliance & quality */}
      <section className="py-20 md:py-28 bg-ivory-50">
        <div className="max-w-[1400px] mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid lg:grid-cols-2 gap-14 items-center">
            <div>
              <p className="eyebrow mb-5">
                <span className="eyebrow-rule" />
                Compliance & quality assurance
              </p>
              <h2 className="section-title mb-6">Our reputation rests on it.</h2>
              <p className="text-midnight-900/60 font-light leading-relaxed">
                Vertex operates under UK corporate governance expectations and maintains strong standards around
                documentation integrity, contractual clarity, data protection, anti-bribery, anti-corruption,
                modern slavery prevention, anti-human trafficking safeguards, and ethical recruitment principles.
                Our Quality Management approach is aligned with ISO 9001:2015 standards, supporting consistent,
                repeatable excellence across the Vertex delivery framework.
              </p>
            </div>
            <div className="bg-white border border-midnight-900/10 rounded-2xl p-8 md:p-10">
              <Sparkle size={28} weight="light" className="text-gold-600 mb-5" />
              <p className="text-midnight-900 font-medium leading-relaxed mb-4">
                "Vertex is not a transactional staffing vendor. We operate as a long-term institutional partner,
                coordinating recruitment, mobility, compliance, travel, and settlement through one accountable
                structure."
              </p>
              <p className="text-midnight-900/45 text-sm uppercase tracking-[0.15em] font-semibold">
                Strategic Institutional Partnership
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="bg-midnight-950 py-20 md:py-24 text-ivory-50 text-center">
        <div className="max-w-2xl mx-auto px-4">
          <h2 className="text-3xl md:text-5xl font-semibold tracking-tight mb-6">
            Ready to start your global mobility journey?
          </h2>
          <p className="text-ivory-50/50 font-light mb-10">
            Whether you're an employer, a licensed agency, a travel or visa partner, or a candidate ready to
            pursue opportunities abroad — start with Vertex.
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link href="/apply" className="btn-gold px-9 py-4">
              Apply Now
            </Link>
            <Link href="/contact" className="btn-ghost-dark px-9 py-4">
              Partner With Vertex
            </Link>
          </div>
        </div>
      </section>
    </div>
  );
}
