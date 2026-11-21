"use client";

import PortalShell, { type PortalNavItem } from "./PortalShell";
import { PORTAL_FOR_ROLE } from "./navForRole";
import { useMe } from "./me";

/**
 * Pages a role reaches by a permission the admin gave it (role management,
 * 2026-11-21): jobs and sectors under /marketing, open to every internal
 * role. They open in the user's own portal (its label and nav) and show a
 * message instead of the page to a role without the permission. Hiding is
 * all this does: FastAPI checks the permission on every request.
 */

export type Gate =
  | { state: "loading"; shell: Shell }
  | { state: "denied"; shell: Shell }
  | { state: "allowed"; shell: Shell };

interface Shell {
  roleLabel: string;
  navItems: PortalNavItem[];
}

export function usePermissionGate(permission: string): Gate {
  const me = useMe();
  const shell = (me && PORTAL_FOR_ROLE[me.role]) || { roleLabel: "Vertex", navItems: [] };
  if (me === undefined) return { state: "loading", shell };
  return { state: me && me.permissions.includes(permission) ? "allowed" : "denied", shell };
}

export function NoPermission({ shell }: { shell: Shell }) {
  return (
    <PortalShell roleLabel={shell.roleLabel} navItems={shell.navItems}>
      <div className="card p-10 text-center text-midnight-900/60">
        Your role doesn&apos;t have permission for this page. An administrator can give it on Roles &amp; Permissions.
      </div>
    </PortalShell>
  );
}

export default function PermissionShell({ permission, children }: { permission: string; children: React.ReactNode }) {
  const gate = usePermissionGate(permission);
  if (gate.state === "denied") return <NoPermission shell={gate.shell} />;
  return (
    <PortalShell roleLabel={gate.shell.roleLabel} navItems={gate.shell.navItems}>
      {gate.state === "loading" ? <div className="card p-10 text-center text-midnight-900/50">Loading…</div> : children}
    </PortalShell>
  );
}
