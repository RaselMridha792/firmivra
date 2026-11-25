import type { Area } from './hosts';

/**
 * Who may show supported public pages in a frame (booking, intake, and portal entry embeds).
 * Everything else keeps today's behaviour: no frame-ancestors on any other
 * route (the app frames its own PDF previews) and CloudFront's X-Frame-Options SAMEORIGIN.
 *
 * EMBED_ALLOWED_ORIGINS: the websites that may embed, comma separated (each trimmed, empties ignored), each a bare
 * `https://host[:port]` origin (no path, no wildcard). Read on every request, like the hosts.
 */
export const EMBED_ALLOWED_ORIGINS = 'EMBED_ALLOWED_ORIGINS';

/** `/{slug}/book/{typeId}` (one optional trailing slash), nothing longer. */
const BOOKING_PATH = /^\/[A-Za-z0-9-]{1,63}\/book\/[^/]+\/?$/;
const INTAKE_PATH =
  /^\/[A-Za-z0-9-]{1,63}\/(?:begin\/[A-Za-z0-9-]{1,63}|start\/[A-Za-z0-9_-]{43})\/?$/;

/** One entry as a clean https origin, or null: no path, query, credentials, wildcard or `*`. */
function cleanOrigin(entry: string): string | null {
  if (!/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?$/.test(entry)) return null;
  try {
    const url = new URL(entry);
    return url.origin === entry.toLowerCase() ? url.origin : null;
  } catch {
    return null;
  }
}

/** The valid origins of EMBED_ALLOWED_ORIGINS; invalid entries are dropped, duplicates once. */
export function embedAllowedOrigins(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const entries = (env[EMBED_ALLOWED_ORIGINS] ?? '')
    .split(',')
    .map((e) => e.trim())
    .filter(Boolean);
  return [...new Set(entries.map(cleanOrigin).filter((o): o is string => o !== null))];
}

/**
 * The enforced `Content-Security-Policy` value for one request, or null when the route gets none.
 * Only the portal's booking page (`/{slug}/book/{typeId}`) gets one: `frame-ancestors` with the
 * allowed origins, or `'none'` when there are none. `pathname` is the public path (before the
 * proxy rewrites it to the route folder).
 */
export function bookingFrameAncestors(
  area: Area | null,
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (area !== 'portal' || !BOOKING_PATH.test(pathname)) return null;
  const origins = embedAllowedOrigins(env);
  return `frame-ancestors ${origins.length ? origins.join(' ') : "'none'"}`;
}

/** A public intake Begin Online page may be framed by a configured website. */
export function publicEmbedFrameAncestors(
  area: Area | null,
  pathname: string,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (area !== 'portal' || !INTAKE_PATH.test(pathname)) {
    return null;
  }
  const origins = embedAllowedOrigins(env);
  return `frame-ancestors ${origins.length ? origins.join(' ') : "'none'"}`;
}
