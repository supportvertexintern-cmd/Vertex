"use client";

import ExceptionsPageContent from "@/components/portal/exceptions/ExceptionsPageContent";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";

export default function InhouseExceptionsPage() {
  return <ExceptionsPageContent roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS} />;
}
