"use client";

import ExceptionsPageContent from "@/components/portal/exceptions/ExceptionsPageContent";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";

export default function SupervisorExceptionsPage() {
  return <ExceptionsPageContent roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS} />;
}
