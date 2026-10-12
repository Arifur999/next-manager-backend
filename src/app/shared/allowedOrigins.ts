import { env } from "../../config/env.js";

// FRONTEND_URL may be a single origin or a comma-separated list (e.g. both the
// www and bare-domain variants of a site).
const staticAllowedOrigins = env.FRONTEND_URL.split(",")
    .map((url) => url.trim())
    .filter(Boolean);

const isDevelopment = env.NODE_ENV !== "production";

/**
 * Whether a browser origin may talk to this API, over HTTP (CORS) and over the
 * chat socket. Never a wildcard subdomain: a free preview host accepted as a
 * credentialed origin would be a cross-tenant read one config change away.
 */
export function isAllowedOrigin(origin?: string): boolean {
    // No Origin header: same-origin navigations, curl, server-to-server. The
    // Next.js server calls this API without one on every server-rendered page.
    if (!origin) return true;
    if (staticAllowedOrigins.includes(origin)) return true;
    if (isDevelopment && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) return true;
    return false;
}
