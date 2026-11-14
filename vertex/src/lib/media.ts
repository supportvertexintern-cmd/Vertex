// The public marketing videos (2026-11-03): served straight from Cloudflare
// R2's public bucket, so the site pays no egress for them. csp.ts allows
// exactly this origin for media (media-src); a video anywhere else won't play.
// The origin lives in csp.ts, which must stay import-free (see there).
import { MEDIA_ORIGIN } from "./csp";

export { MEDIA_ORIGIN };

export const LANDING_VIDEO = `${MEDIA_ORIGIN}/landing/vertex-landing-v2.mp4`;
export const PARTNER_REEL = `${MEDIA_ORIGIN}/media/vertex-partner-reel-v3.mp4`;
