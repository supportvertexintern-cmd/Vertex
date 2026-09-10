"use client";

import PortalShell from "@/components/portal/PortalShell";
import { ADMIN_NAV_ITEMS } from "@/components/portal/adminNav";
import AdminSettings from "@/components/AdminSettings";

export default function AdminSettingsPage() {
  return (
    <PortalShell roleLabel="System Administrator" navItems={ADMIN_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Configuration
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-8">Settings.</h1>
      <AdminSettings />
    </PortalShell>
  );
}
