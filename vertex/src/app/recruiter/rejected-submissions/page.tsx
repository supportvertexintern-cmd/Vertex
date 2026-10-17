"use client";

import RejectedSubmissionsPage from "@/components/portal/RejectedSubmissionsPage";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";

export default function RecruiterRejectedSubmissionsPage() {
  return <RejectedSubmissionsPage roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS} />;
}