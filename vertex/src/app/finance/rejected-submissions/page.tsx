"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { FINANCE_NAV_ITEMS } from "@/components/portal/financeNav";

export default function FinanceRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Finance" navItems={FINANCE_NAV_ITEMS} />;
}