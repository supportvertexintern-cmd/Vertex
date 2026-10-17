"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { MANAGEMENT_NAV_ITEMS } from "@/components/portal/managementNav";

export default function ManagementRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Management" navItems={MANAGEMENT_NAV_ITEMS} />;
}