import { z } from 'zod';

/**
 * Public links (Octavia's review of Oct 20, `docs/specs/review-2026-10-21/CHANGE-LIST.md`, top):
 * the one shape every public item answers with, so the firm can put a stable link behind a
 * button on its own website or paste the embed code. Three items have one: an intake form
 * (Intake Forms, I3), an appointment type (Appointments, A4) and a service package (Services &
 * Pricing, S12). Each answers `GET /business/<its collection>/{id}/public-link` with a
 * `PublicLink`, built with `publicItemUrl` and `publicEmbedCode` so the three agree; the screens
 * show it with `PublicLinkBlock` from `@firmivra/ui` (through `components/public-link.tsx`).
 * One exception (Rasel, Oct 22): an intake form has no page of its own. Only a service's main form
 * has a link, and it is that service's Begin Online page (`beginOnlinePageUrl`, begin-online), so
 * the `forms` segment below is not used.
 *
 * The link is stable: the same while the item exists, and the same again after it is
 * reactivated. While the item is a draft, inactive, archived or hidden, the public page refuses
 * new use (and says so) but keeps its history; `state` tells the firm before it copies.
 */
export const PublicItemKind = z.enum(['INTAKE_FORM', 'APPOINTMENT_TYPE', 'PACKAGE']);
export type PublicItemKind = z.infer<typeof PublicItemKind>;

/** LIVE takes new public use; every other state is refused on the public page. */
export const PublicLinkState = z.enum(['LIVE', 'DRAFT', 'INACTIVE', 'ARCHIVED', 'HIDDEN']);
export type PublicLinkState = z.infer<typeof PublicLinkState>;

export const PublicLink = z.object({
  kind: PublicItemKind,
  itemId: z.uuid(),
  /** `{PORTAL_BASE_URL}/{firmSlug}/{segment}/{itemId}` (`publicItemUrl`). */
  url: z.url(),
  /** An iframe of the same page for the firm's website (`publicEmbedCode`). */
  embedCode: z.string(),
  state: PublicLinkState,
});
export type PublicLink = z.infer<typeof PublicLink>;

/** The portal path segment of each kind: `/lvp/forms/…`, `/lvp/book/…`, `/lvp/packages/…`. */
export const PUBLIC_ITEM_SEGMENT: Record<PublicItemKind, string> = {
  INTAKE_FORM: 'forms',
  APPOINTMENT_TYPE: 'book',
  PACKAGE: 'packages',
};

/** The public page of an item, on the portal host from config (never the request's Host). */
export function publicItemUrl(
  portalBaseUrl: string,
  firmSlug: string,
  kind: PublicItemKind,
  itemId: string,
): string {
  const base = portalBaseUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(firmSlug)}/${PUBLIC_ITEM_SEGMENT[kind]}/${encodeURIComponent(itemId)}`;
}

/** Text for an HTML attribute value. */
const attribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The height the embedded page is drawn at; the firm can change it in the pasted code. */
export const PUBLIC_EMBED_HEIGHT = 760;

/**
 * The embed code for a public page: an iframe of `url` in its embed layout (`?embed=1`, no
 * portal header), full width, titled for screen readers with the item's name.
 */
export function publicEmbedCode(url: string, title: string): string {
  const src = `${url}${url.includes('?') ? '&' : '?'}embed=1`;
  return `<iframe src="${attribute(src)}" title="${attribute(title)}" width="100%" height="${PUBLIC_EMBED_HEIGHT}" style="border:0;max-width:100%" loading="lazy"></iframe>`;
}
