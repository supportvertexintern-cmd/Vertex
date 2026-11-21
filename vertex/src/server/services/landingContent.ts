import { callBackend } from "@/lib/backend";
import { log } from "@/lib/log";
import DEFAULTS from "./landing.defaults.json";

/**
 * The website's landing blocks (the landing CMS, 2026-11-21): what marketing
 * published, read from FastAPI (GET /api/v1/content/landing?app=web in
 * vertex_be/app/api/v1/landing.py), for the home page, and the shared
 * contact details the footer, the WhatsApp button and the contact page use.
 *
 * Never fails: a block FastAPI doesn't send, one in a newer format than
 * this site knows, or no answer at all shows the built-in text
 * (landing.defaults.json, exported from vertex_be by
 * scripts/export_landing_defaults.py). A block marketing hid is null.
 *
 * Every page reads the contact details, so the answer is kept for
 * CACHE_MS: a publish shows within that time. A failure is kept for
 * RETRY_MS, so FastAPI being down doesn't slow every page.
 */

const CACHE_MS = 30_000;
const RETRY_MS = 10_000;
const TIMEOUT_MS = 3_000;

/** The bodies' format this site renders (vertex_be BLOCK_VERSION). */
export const BLOCK_VERSION = DEFAULTS.version;

// The shapes: vertex_be/app/services/landing_content.py, already checked there.
export type LandingIcon =
  | "users" | "shield" | "building" | "handshake" | "clipboard" | "document" | "coins" | "globe" | "seal" | "check"
  | "phone" | "graduation" | "certificate" | "share" | "qr" | "chat" | "network" | "chart" | "open" | "payments";

export interface LandingLink { label: string; href: string }
export interface LandingCard { icon?: LandingIcon; title: string; text: string; marker?: string }
export interface LandingQuestion { q: string; a: string }

export interface CardsSection { eyebrow: string; title: string; subtitle?: string; cards: LandingCard[] }

export interface WebLanding {
  "web.hero": {
    eyebrow: string;
    headline: string;
    highlight?: string;
    intro: string;
    buttons: LandingLink[];
    trust_line?: string;
    video_alt: string;
    video_fallback: string;
    video_chapters: { label: string; seconds: number }[];
  };
  "web.partner_enquiry": {
    eyebrow: string;
    title: string;
    highlight?: string;
    intro: string;
    benefits: LandingCard[];
    steps_title: string;
    steps: LandingCard[];
    existing_title: string;
    existing_text: string;
    existing_link: LandingLink;
  };
  "web.process": CardsSection;
  "web.audiences": CardsSection;
  "web.jobs": { eyebrow: string; title: string; view_all: LandingLink; empty_text: string };
  "web.workforce": {
    eyebrow: string;
    title: string;
    tiers: LandingCard[];
    requirements_eyebrow: string;
    requirements_title: string;
    requirements: string[];
    cta: LandingLink;
  };
  "web.referral": { eyebrow: string; title: string; intro: string; cta: LandingLink; cards: LandingCard[] };
  "web.faq": {
    eyebrow: string;
    title: string;
    groups: { title: string; icon?: LandingIcon; items: LandingQuestion[] }[];
    more_text?: string;
    more_link?: LandingLink;
  };
  "web.ending": { eyebrow: string; title: string; text: string; buttons: LandingLink[] };
  "shared.why_vertex": CardsSection;
  "shared.contact": ContactDetails & { eyebrow: string; title: string };
}

export interface ContactDetails { whatsapp: string; office: string; email: string }

export type BlockKey = keyof WebLanding;

/** Each block's body, or null where marketing hid it. */
export type Landing = { [K in BlockKey]: WebLanding[K] | null };

export interface LandingPage {
  blocks: Landing;
  /** The contact details, shown even where the home page's contact strip is hidden. */
  contact: ContactDetails;
}

export const BUILT_IN = DEFAULTS.blocks as unknown as WebLanding;
const KEYS = Object.keys(BUILT_IN) as BlockKey[];

interface Answer {
  version: number;
  blocks: { key: string; visible: boolean; body: Record<string, unknown> | null; revision: number }[];
}

let cached: { page: LandingPage; until: number } | null = null;

/** The website's landing blocks, as visitors see them. */
export async function getLandingPage(): Promise<LandingPage> {
  const now = Date.now();
  if (cached && cached.until > now) return cached.page;
  const result = await callBackend<Answer>("/api/v1/content/landing", {
    query: { app: "web" },
    asUser: false,
    timeoutMs: TIMEOUT_MS,
  });
  const page = result.ok ? merge(result.body.data) : builtIn();
  if (!result.ok) log.warn("landing.fallback", { status: result.status, code: result.error.code });
  cached = { page, until: now + (result.ok ? CACHE_MS : RETRY_MS) };
  return page;
}

/** For tests: forget the cached answer. */
export function resetLandingCache(): void {
  cached = null;
}

export function builtIn(): LandingPage {
  return { blocks: { ...BUILT_IN }, contact: contactOf(BUILT_IN["shared.contact"]) };
}

/** FastAPI's answer over the built-in text, block by block. */
export function merge(answer: Answer): LandingPage {
  const blocks = { ...BUILT_IN } as Landing;
  // A newer format than this site renders: keep the text it knows.
  if (answer?.version === BLOCK_VERSION && Array.isArray(answer.blocks)) {
    for (const block of answer.blocks) {
      if (!isKey(block?.key)) continue;
      if (block.visible === false) (blocks as Record<BlockKey, unknown>)[block.key] = null;
      else if (isObject(block.body)) (blocks as Record<BlockKey, unknown>)[block.key] = block.body;
    }
  }
  const contact = blocks["shared.contact"];
  return { blocks, contact: contactOf(contact ?? BUILT_IN["shared.contact"]) };
}

function contactOf(c: ContactDetails): ContactDetails {
  return { whatsapp: c.whatsapp, office: c.office, email: c.email };
}

const isKey = (key: unknown): key is BlockKey => typeof key === "string" && (KEYS as string[]).includes(key);
const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
