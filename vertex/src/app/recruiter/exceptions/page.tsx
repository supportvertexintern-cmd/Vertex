"use client";

import ExceptionsPageContent from "@/components/portal/exceptions/ExceptionsPageContent";
import { RECRUITER_NAV_ITEMS } from "@/components/portal/recruiterNav";

export default function RecruiterExceptionsPage() {
  return <ExceptionsPageContent roleLabel="Regional Recruiter" navItems={RECRUITER_NAV_ITEMS} />;
}
