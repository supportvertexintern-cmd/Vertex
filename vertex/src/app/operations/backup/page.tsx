"use client";

import PortalShell from "@/components/portal/PortalShell";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";
import BackupExport from "@/components/BackupExport";

export default function OperationsBackupPage() {
  return (
    <PortalShell roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS}>
      <p className="eyebrow mb-3">
        <span className="eyebrow-rule" />
        Data
      </p>
      <h1 className="section-title text-3xl md:text-4xl mb-8">Backup.</h1>
      <BackupExport />
    </PortalShell>
  );
}
