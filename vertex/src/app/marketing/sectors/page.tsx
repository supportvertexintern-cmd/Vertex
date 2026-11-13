"use client";

import SectorsAndRequirements from "@/components/portal/SectorsAndRequirements";
import { MARKETING_NAV_ITEMS } from "@/components/portal/marketingNav";

// Marketing keeps the sectors and each destination's required documents in
// step with the programmes it posts (2026-11-06).
export default function MarketingSectorsPage() {
  return <SectorsAndRequirements roleLabel="Marketing" navItems={MARKETING_NAV_ITEMS} />;
}
