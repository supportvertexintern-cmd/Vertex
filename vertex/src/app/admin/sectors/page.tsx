"use client";

import SectorsAndRequirements from "@/components/portal/SectorsAndRequirements";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";

export default function SectorsPage() {
  return <SectorsAndRequirements roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS} />;
}
