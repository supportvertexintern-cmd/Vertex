"use client";

import SectorsAndRequirements from "@/components/portal/SectorsAndRequirements";
import PortalShell from "@/components/portal/PortalShell";
import { NoPermission, usePermissionGate } from "@/components/portal/PermissionShell";

// Marketing keeps the sectors and each destination's required documents in
// step with the programmes it posts (2026-11-06). Since role management
// (2026-11-21), any role holding reference.manage, in its own portal.
export default function MarketingSectorsPage() {
  const gate = usePermissionGate("reference.manage");
  if (gate.state === "denied") return <NoPermission shell={gate.shell} />;
  if (gate.state === "loading") {
    return (
      <PortalShell roleLabel={gate.shell.roleLabel} navItems={gate.shell.navItems}>
        <div className="card p-10 text-center text-midnight-900/50">Loading…</div>
      </PortalShell>
    );
  }
  return <SectorsAndRequirements roleLabel={gate.shell.roleLabel} navItems={gate.shell.navItems} />;
}
