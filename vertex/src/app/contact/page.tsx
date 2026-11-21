import ContactClient from "./ContactClient";
import { getLandingPage } from "@/server/services/landingContent";

// Read per request, never at build time (FastAPI isn't there to answer).
export const dynamic = "force-dynamic";

// The WhatsApp, office and main email details are marketing's (the landing
// CMS's shared.contact), or the built-in ones if FastAPI can't answer.
export default async function ContactPage() {
  const { contact } = await getLandingPage();
  return <ContactClient contact={contact} />;
}
