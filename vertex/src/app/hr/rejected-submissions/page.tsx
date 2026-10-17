"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { HR_NAV_ITEMS } from "@/components/portal/hrNav";

export default function HrRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Human Resources" navItems={HR_NAV_ITEMS} />;
}