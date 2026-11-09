// Admin → Monitoring (2026-11-07): what the website's routes and pages share.

/** Partners & Logins' filters, passed on by the list and its CSV alike. */
export const PARTNER_FILTERS = ["q", "country", "status", "login_status", "attention", "created_from", "created_to", "created_by"] as const;

/** Locked Accounts → History's filters (login protection, 4.1). */
export const LOCKOUT_FILTERS = ["q", "step", "ended_by", "needs_review", "date_from", "date_to"] as const;

/** The cooldown of each lockout step (login protection, decision L1). */
export const LOCKOUT_STEPS: Record<number, string> = { 1: "15 minutes", 2: "1 hour", 3: "4 hours", 4: "24 hours" };

/** The credit DB-IP's free database asks for (CC BY 4.0), wherever a country is shown. */
export const GEOIP_CREDIT = "Countries: IP geolocation by DB-IP (db-ip.com), CC BY 4.0.";

/** An address with its country, when the bundled database knows it. */
export function place(ip: string | null | undefined, country: string | null | undefined): string {
  if (!ip) return "—";
  return country ? `${ip} (${country})` : ip;
}
