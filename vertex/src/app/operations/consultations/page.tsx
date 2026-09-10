"use client";

import PortalShell from "@/components/portal/PortalShell";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";
import ConsultationBookingsList from "@/components/portal/ConsultationBookingsList";

export default function OperationsConsultationsPage() {
  return (
    <PortalShell roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS}>
      <ConsultationBookingsList />
    </PortalShell>
  );
}
