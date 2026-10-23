import sanitizeHtml from 'sanitize-html';
import { EMAIL_FONT_SIZES, EMAIL_FONTS, EMAIL_IMAGE_LIMITS } from '@firmivra/types';

// A formatted email's HTML (the lead email composer, L4; contract in packages/types/src/leads/
// email.ts): paragraphs and line breaks, bold, italic, underline, strike, lists and quotes, the
// composer's fonts and sizes, alignment, and images from the firm's own email-image and logo
// addresses, 24 to 600 px wide. Everything else is removed: scripts, links, colours, other fonts,
// other images. Cleaned when a signature is saved, before a lead email is sent, and again when
// the email is rendered.

/** Which image addresses an email may show. */
export type ImageRule = (src: string) => boolean;

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const SLUG = '[a-z0-9](?:[a-z0-9-]*[a-z0-9])?';
const QUERY = '(?:\\?[\\w=&.-]*)?';

/**
 * The firm's email images, its logo and its email logo, on the portal's host (`origin`, from
 * PORTAL_BASE_URL). Without `slug`, any firm's: the renderer's check, after the sender's.
 */
export function firmImages(origin: string, slug?: string): ImageRule {
  const base = escapeRegex(origin.replace(/\/+$/, ''));
  const firm = slug === undefined ? SLUG : escapeRegex(slug);
  const re = new RegExp(
    `^${base}/api/v1/portal/${firm}/(?:email-images/${UUID}\\.(?:png|jpg|gif)|logo${QUERY}|branding/email-logo${QUERY})$`,
  );
  return (src) => re.test(src);
}

/** One of the composer's fonts first (quoted or not), then plain fallback names. */
const FONT_FAMILY = new RegExp(
  `^(?:${EMAIL_FONTS.map((f) => `['"]?${escapeRegex(f.label)}['"]?`).join('|')})(?:\\s*,\\s*['"]?[A-Za-z][A-Za-z -]*['"]?)*$`,
  'i',
);
const FONT_SIZE = new RegExp(`^(?:${EMAIL_FONT_SIZES.join('|')})px$`);

/** The width an image is shown at: its width attribute or style, kept within the limits. */
function widthOf(attribs: sanitizeHtml.Attributes): number | null {
  const given = attribs.width ?? /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(attribs.style ?? '')?.[1];
  const n = given === undefined ? NaN : Number.parseInt(given, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(EMAIL_IMAGE_LIMITS.maxWidth, Math.max(EMAIL_IMAGE_LIMITS.minWidth, n));
}

const options = (images: ImageRule): sanitizeHtml.IOptions => ({
  allowedTags: [
    'p',
    'div',
    'br',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'ul',
    'ol',
    'li',
    'blockquote',
    'h3',
    'h4',
    'img',
  ],
  allowedAttributes: { img: ['src', 'alt', 'width'], '*': ['style'] },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center)$/],
      'font-family': [FONT_FAMILY],
      'font-size': [FONT_SIZE],
      'font-weight': [/^(bold|700)$/],
      'font-style': [/^italic$/],
      'text-decoration': [/^(underline|line-through)$/],
      'text-decoration-line': [/^(underline|line-through)$/],
    },
    img: { width: [/^\d+px$/], 'max-width': [/^100%$/], height: [/^auto$/] },
  },
  allowedSchemes: [],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // A browser's font command writes <font face>; the email keeps the face as a style.
    font: (_tag, attribs) => ({
      tagName: 'span',
      attribs: attribs.face
        ? { style: `font-family:${attribs.face}` }
        : ({} as sanitizeHtml.Attributes),
    }),
    // Shown at the width placed in the composer, never wider than the email.
    img: (_tag, attribs) => {
      const width = widthOf(attribs);
      return {
        tagName: 'img',
        attribs: {
          src: attribs.src ?? '',
          alt: attribs.alt ?? '',
          ...(width === null ? {} : { width: String(width) }),
          style: `${width === null ? '' : `width:${width}px;`}max-width:100%;height:auto`,
        },
      };
    },
  },
  exclusiveFilter: (frame) => frame.tag === 'img' && !images(frame.attribs.src ?? ''),
});

/** The HTML an email may carry; see the top of this file. */
export function cleanEmailHtml(html: string, images: ImageRule): string {
  return sanitizeHtml(html, options(images)).trim();
}

/** Whether cleaned HTML shows anything: some text or an image. */
export function emailHtmlHasContent(clean: string): boolean {
  return (
    /<img\s/i.test(clean) ||
    sanitizeHtml(clean, { allowedTags: [] })
      .replace(/&nbsp;|&#160;/g, ' ')
      .trim() !== ''
  );
}
