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
  /**
   * A button for the firm's website that opens the link (`publicEmbedCode`). An inline iframe
   * can't be shown on another site until framing is allowed for it (CloudFront's security headers
   * send X-Frame-Options SAMEORIGIN), so no code that can't work is offered.
   */
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

/**
 * The website code for a public page: a self-contained button (a link styled inline, so it needs
 * nothing from the firm's site) that opens `url` in a new tab, labelled with the item's name. It
 * works on any site builder that takes HTML (WordPress, Wix, GoDaddy, Shopify, plain HTML). An
 * inline iframe comes back once framing is enabled for the firm's site (an infra change).
 */
export function publicEmbedCode(url: string, title: string): string {
  const style =
    'display:inline-block;padding:12px 20px;border-radius:8px;background:#1f3a5f;color:#ffffff;' +
    'font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:600;line-height:1.2;' +
    'text-decoration:none';
  return `<a href="${attribute(url)}" target="_blank" rel="noopener" style="${style}">${attribute(title)}</a>`;
}
