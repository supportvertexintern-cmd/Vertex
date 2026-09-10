"use client";

import PortalShell from "@/components/portal/PortalShell";
import { FINANCE_NAV_ITEMS } from "@/components/portal/financeNav";
import ConsultationBookingsList from "@/components/portal/ConsultationBookingsList";

export default function FinanceConsultationsPage() {
  return (
    <PortalShell roleLabel="Finance" navItems={FINANCE_NAV_ITEMS}>
      <ConsultationBookingsList />
    </PortalShell>
  );
}
