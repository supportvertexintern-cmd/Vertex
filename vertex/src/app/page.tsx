import type { Metadata } from "next";
import HomeClient from "@/components/HomeClient";
import { getLandingPage } from "@/server/services/landingContent";
import { getPublicJobsList } from "@/server/services/publicJobs";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Global Recruitment & Mobility | Vertex International Recruitment Ltd.",
  description:
    "Vertex International Recruitment Ltd. connects talented professionals, employers, agencies and institutional partners through ethical recruitment, compliant mobility solutions, and dedicated end-to-end support.",
};

// SRS FR-1.5: real database jobs only — no placeholder fallback. An empty
// result renders HomeClient's built-in "No jobs available yet" state.
// Read from FastAPI (server/services/publicJobs.ts).
async function getFeaturedJobs() {
  try {
    const { jobs } = await getPublicJobsList({ limit: 6 });
    return jobs;
  } catch {
    return [];
  }
}

export default async function HomePage() {
  // The text is marketing's (the landing CMS), or the built-in text.
  const [jobs, landing] = await Promise.all([getFeaturedJobs(), getLandingPage()]);

  return <HomeClient jobs={jobs} content={landing.blocks} />;
}
