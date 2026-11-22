import { z } from 'zod';

/**
 * Public links (Octavia's review of Oct 20, `docs/specs/review-2026-10-21/CHANGE-LIST.md`, top):
 * the one shape every public item answers with, so the firm can use a stable link on its website.
 * Three items have one: an intake form (Intake Forms, I3), an appointment type (Appointments, A4)
 * and a service package (Services & Pricing, S12). Each answers `GET /business/<its collection>/{id}/public-link`
 * with a `PublicLink`; intake and booking links may carry an iframe and a separate button, while
 * the package link uses a button. The screens show it with `PublicLinkBlock` from `@firmivra/ui`
 * (through `components/public-link.tsx`).
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
   * The code for the firm's website: a styled button that opens the link in a new tab
   * (`publicButtonCode`; `publicEmbedCode` is the same with the default colour). An appointment
   * type's is instead the inline booking frame (`publicIframeCode`, Appointments D3), shown by
   * the firm's own website only when Firmivra lists its address (EMBED_ALLOWED_ORIGINS); its
   * button is then `buttonCode`. Browsers keep the portal's sign-in cookies out of another
   * site's frame, so the frame's sign-in links open in a new tab.
   */
  embedCode: z.string(),
  /** The button as a second choice, when `embedCode` is a frame (an appointment type). */
  buttonCode: z.string().optional(),
  /** Direct portal sign-in entry link; sign-in is always opened in a new tab. */
  portalEntryUrl: z.url().optional(),
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

/** The firm's client portal sign-in page, built from configured origin and firm slug. */
export function publicPortalEntryUrl(portalBaseUrl: string, firmSlug: string): string {
  const base = portalBaseUrl.replace(/\/+$/, '');
  return `${base}/${encodeURIComponent(firmSlug)}/sign-in`;
}

/** Text for an HTML attribute value. */
const attribute = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** The embed button's colour when the firm sets none: the portal's default navy. */
export const PUBLIC_BUTTON_COLOR = '#1F3A6B';
const HEX = /^#[0-9a-f]{6}$/i;

/** Relative luminance (WCAG 2) of a `#RRGGBB` colour. */
function luminance(hex: string): number {
  const channel = (i: number) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(1) + 0.7152 * channel(3) + 0.0722 * channel(5);
}

/**
 * Review 2 (Appointments row 3): the embed code of a page that needs the portal's sign-in (an
 * appointment type's booking page). A styled link button, not an iframe: browsers keep the
 * portal's sign-in cookies out of another site's frame, so the button opens the page in a new
 * tab. `color` is the firm's button colour (`#RRGGBB`); the label is white, or near-black on a
 * light colour, whichever reads better.
 */
export function publicButtonCode(url: string, label: string, color?: string | null): string {
  const background = color && HEX.test(color) ? color.toUpperCase() : PUBLIC_BUTTON_COLOR;
  // White text needs a contrast of 4.5:1 (WCAG AA); below that, near-black reads better.
  const text = 1.05 / (luminance(background) + 0.05) >= 4.5 ? '#FFFFFF' : '#111111';
  const style = [
    'display:inline-block',
    'padding:12px 24px',
    'border-radius:8px',
    `background:${background}`,
    `color:${text}`,
    "font:600 16px/1.25 system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif",
    'text-decoration:none',
  ].join(';');
  return `<a href="${attribute(url)}" target="_blank" rel="noopener" style="${attribute(style)}">${attribute(label)}</a>`;
}

/** Text for a JavaScript string inside a `<script>`: JSON, with `<` escaped so it can't close the tag. */
const scriptString = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');

/**
 * Appointments D3: the inline booking frame for the firm's website. An `<iframe>` of the booking
 * page with a minimum height, and a small script that grows it to the page's own height. The page
 * posts `{ type: 'firmivra:height', height }` from inside the frame; the script takes a message
 * only from the booking page's origin and only from this frame's window. The frame shows only on
 * websites Firmivra lists (EMBED_ALLOWED_ORIGINS, the page's frame-ancestors).
 */
export function publicIframeCode(url: string, title: string): string {
  const id = `firmivra-${(url.split('/').pop() ?? '').replace(/[^A-Za-z0-9_-]/g, '') || 'booking'}`;
  const origin = new URL(url).origin;
  const style = 'width:100%;border:0;min-height:480px';
  const script = `(function(){var f=document.getElementById(${scriptString(id)}),o=${scriptString(origin)};window.addEventListener("message",function(e){if(e.origin!==o||!f||e.source!==f.contentWindow)return;var d=e.data;if(d&&d.type==="firmivra:height"&&typeof d.height==="number"&&d.height>0)f.style.height=Math.ceil(Math.min(d.height,20000))+"px"})})();`;
  return `<iframe id="${attribute(id)}" src="${attribute(url)}" title="${attribute(title)}" style="${attribute(style)}" loading="lazy"></iframe>
<script>${script}</script>`;
}

/**
 * Default website button code for public links. Intake and booking routes build their iframe with
 * `publicIntakeEmbedCode` and `publicIframeCode` respectively.
 */
export function publicEmbedCode(url: string, title: string): string {
  return publicButtonCode(url, title);
}

/** Q45: the public intake form inline embed, with the same origin-checked height bridge. */
export function publicIntakeEmbedCode(url: string, title: string): string {
  return publicIframeCode(url, title);
}
