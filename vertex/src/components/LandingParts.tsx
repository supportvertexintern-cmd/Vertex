import { Fragment } from "react";
import Link from "next/link";
import {
  ArrowSquareOut,
  Buildings,
  Certificate,
  ChartBar,
  ChatCircleText,
  CheckCircle,
  ClipboardText,
  CreditCard,
  FileText,
  GlobeHemisphereWest,
  Graph,
  GraduationCap,
  HandCoins,
  Handshake,
  Phone,
  QrCode,
  SealCheck,
  ShareNetwork,
  ShieldCheck,
  Users,
  type Icon as PhosphorIcon,
} from "@phosphor-icons/react";
import type { LandingIcon, LandingLink } from "@/server/services/landingContent";

/**
 * Small pieces the landing pages render marketing's blocks with
 * (server/services/landingContent.ts). Client-safe: no server imports.
 */

/** The block icons' names (vertex_be ICONS), as this site draws them. */
export const LANDING_ICONS: Record<LandingIcon, PhosphorIcon> = {
  users: Users,
  shield: ShieldCheck,
  building: Buildings,
  handshake: Handshake,
  clipboard: ClipboardText,
  document: FileText,
  coins: HandCoins,
  globe: GlobeHemisphereWest,
  seal: SealCheck,
  check: CheckCircle,
  phone: Phone,
  graduation: GraduationCap,
  certificate: Certificate,
  share: ShareNetwork,
  qr: QrCode,
  chat: ChatCircleText,
  network: Graph,
  chart: ChartBar,
  open: ArrowSquareOut,
  payments: CreditCard,
};

/** A block's icon, or the given one when the block names none. */
export function iconFor(name: LandingIcon | undefined, fallback: PhosphorIcon): PhosphorIcon {
  return (name && LANDING_ICONS[name]) || fallback;
}

/** Text with its line breaks ("\n") shown. */
export function Lines({ text }: { text: string }) {
  const lines = text.split("\n");
  return (
    <>
      {lines.map((line, i) => (
        <Fragment key={i}>
          {i > 0 && <br />}
          {line}
        </Fragment>
      ))}
    </>
  );
}

/**
 * A block's link: a site path through next/link, an anchor or a mailto/tel
 * address as a plain link, an https address in a new tab. vertex_be allows
 * only these.
 */
export function LandingAnchor({
  link,
  className,
  children,
}: {
  link: LandingLink;
  className?: string;
  children?: React.ReactNode;
}) {
  const content = children ?? link.label;
  if (link.href.startsWith("/")) {
    return (
      <Link href={link.href} className={className}>
        {content}
      </Link>
    );
  }
  const external = link.href.startsWith("https://");
  return (
    <a href={link.href} className={className} {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
      {content}
    </a>
  );
}

/** A phone number's digits, for wa.me and tel: links ("+44 20 3026 3403" -> "442030263403"). */
export const phoneDigits = (phone: string): string => phone.replace(/[^0-9]/g, "");

/** A video chapter's time as the player shows it (173 -> "2:53"). */
export const timeLabel = (seconds: number): string =>
  `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
