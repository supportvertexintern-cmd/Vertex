"use client";

import ExceptionsPageContent from "@/components/portal/exceptions/ExceptionsPageContent";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";

export default function ManagementExceptionsPage() {
  return <ExceptionsPageContent roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS} />;
}
