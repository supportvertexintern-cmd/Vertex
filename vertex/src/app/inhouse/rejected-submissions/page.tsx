"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { INHOUSE_NAV_ITEMS } from "@/components/portal/inhouseNav";

export default function InhouseRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="In-House Supervisor" navItems={INHOUSE_NAV_ITEMS} />;
}