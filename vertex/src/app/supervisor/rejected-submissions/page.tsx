"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { SUPERVISOR_NAV_ITEMS } from "@/components/portal/supervisorNav";

export default function SupervisorRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Country Supervisor" navItems={SUPERVISOR_NAV_ITEMS} />;
}