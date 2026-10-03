"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { OPERATIONS_NAV_ITEMS } from "@/components/portal/operationsNav";

export default function OperationsRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Operations" navItems={OPERATIONS_NAV_ITEMS} />;
}