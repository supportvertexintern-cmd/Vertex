// Admin → Monitoring (2026-11-07): what the website's routes and pages share.

/** Partners & Logins' filters, passed on by the list and its CSV alike. */
export const PARTNER_FILTERS = ["q", "country", "status", "login_status", "created_from", "created_to", "created_by"] as const;

/** The credit DB-IP's free database asks for (CC BY 4.0), wherever a country is shown. */
export const GEOIP_CREDIT = "Countries: IP geolocation by DB-IP (db-ip.com), CC BY 4.0.";

/** An address with its country, when the bundled database knows it. */
export function place(ip: string | null | undefined, country: string | null | undefined): string {
  if (!ip) return "—";
  return country ? `${ip} (${country})` : ip;
}
