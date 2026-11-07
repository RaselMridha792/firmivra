import sanitizeHtml from 'sanitize-html';
import { CONTENT_FONTS, EMAIL_IMAGE_LIMITS } from '@firmivra/types';

// What a template's HTML may hold. A template is rich text (headings, paragraphs, lists, links,
// images, tables, buttons as links), sanitized when it is saved or imported and again after it is
// rendered with data; Communications cleans its emails with it too. Scripts, event handlers,
// forms, styles beyond text alignment (left, centre, right), the content fonts (CM-F10) and an
// image's width, classes beyond the button link's, and links to anything but http, https, mailto
// and tel are removed.

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** CM-F10: one of the content fonts first (quoted or not), then plain fallback names. */
const FONT_FAMILY = new RegExp(
  `^(?:${CONTENT_FONTS.map((f) => `['"]?${escapeRegex(f.label)}['"]?`).join('|')})(?:\\s*,\\s*['"]?[A-Za-z][A-Za-z -]*['"]?)*$`,
  'i',
);

/** A call-to-action link drawn as a button (the editor's BUTTON_LINK_CLASS, TP-F07). */
export const BUTTON_CLASS = 'fv-button';
/**
 * The button's look, inline, since an email has no stylesheet: set here for every button link,
 * never taken from the author (the firm's action blue on white).
 */
export const BUTTON_STYLE =
  'display:inline-block;padding:10px 18px;border-radius:6px;background-color:#005fcc;color:#ffffff;font-weight:600;text-decoration:none';

/** The width an image is shown at, kept within the email limits, or null when none is given. */
function widthOf(attribs: sanitizeHtml.Attributes): number | null {
  const given = attribs.width ?? /(?:^|;)\s*width\s*:\s*(\d+)px/i.exec(attribs.style ?? '')?.[1];
  const n = given === undefined ? NaN : Number.parseInt(given, 10);
  if (!Number.isFinite(n)) return null;
  return Math.min(EMAIL_IMAGE_LIMITS.maxWidth, Math.max(EMAIL_IMAGE_LIMITS.minWidth, n));
}

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'blockquote',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'sub',
    'sup',
    'ul',
    'ol',
    'li',
    'a',
    'img',
    'table',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'td',
    'th',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel', 'class'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    '*': ['style', 'colspan', 'rowspan'],
  },
  // A link keeps only the button class; no other element keeps a class.
  allowedClasses: { a: [BUTTON_CLASS] },
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center)$/], 'font-family': [FONT_FAMILY] },
    a: {
      display: [/^inline-block$/],
      padding: [/^10px 18px$/],
      'border-radius': [/^6px$/],
      'background-color': [/^#005fcc$/],
      color: [/^#ffffff$/],
      'font-weight': [/^600$/],
      'text-decoration': [/^none$/],
    },
    img: { width: [/^\d+px$/], 'max-width': [/^100%$/], height: [/^auto$/] },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  transformTags: {
    // A browser's font command writes <font face>: the content keeps the face as a style.
    font: (_tag, attribs) => ({
      tagName: 'span',
      attribs: attribs.face
        ? { style: `font-family:${attribs.face}` }
        : ({} as sanitizeHtml.Attributes),
    }),
    // A link that opens a new window must not hand it the opener. A button link (https only)
    // gets the button's own look; any other style or class on a link is dropped.
    a: (_tag, attribs) => {
      const { class: classes, style, ...rest } = attribs;
      void style;
      const button =
        (classes ?? '').split(/\s+/).includes(BUTTON_CLASS) &&
        /^https:\/\//i.test(attribs.href ?? '');
      return {
        tagName: 'a',
        attribs: {
          ...rest,
          ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
          ...(button ? { class: BUTTON_CLASS, style: BUTTON_STYLE } : {}),
        },
      };
    },
    // Shown at the width the author placed, never wider than the email.
    img: (_tag, attribs) => {
      const width = widthOf(attribs);
      return {
        tagName: 'img',
        attribs: {
          src: attribs.src ?? '',
          alt: attribs.alt ?? '',
          ...(attribs.title ? { title: attribs.title } : {}),
          ...(width === null ? {} : { width: String(width) }),
          style: `${width === null ? '' : `width:${width}px;`}max-width:100%;height:auto`,
        },
      };
    },
  },
};

const tags = (s: string) => (s.match(/<[a-zA-Z!/]/g) ?? []).length;
const handlers = (s: string) => (s.match(/\son[a-z]+\s*=/gi) ?? []).length;
const scripts = (s: string) => (s.match(/javascript:/gi) ?? []).length;

/**
 * Sanitized HTML, and a count of the parts removed (tags, event handlers, unsafe links), for the
 * import result. The count is approximate: it compares the markup before and after.
 */
export function sanitize(html: string): { html: string; removed: number } {
  const clean = sanitizeHtml(html, OPTIONS);
  const removed =
    Math.max(0, tags(html) - tags(clean)) +
    Math.max(0, handlers(html) - handlers(clean)) +
    Math.max(0, scripts(html) - scripts(clean));
  return { html: clean, removed };
}

/** Plain text from HTML (an SMS or a text part): tags go, paragraphs and breaks become lines. */
export function toPlainText(html: string): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, '\n')
    .replace(/<\/\s*(p|div|h[1-4]|li|tr|blockquote)\s*>/gi, '\n');
  return sanitizeHtml(withBreaks, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Plain text with the tags and markup characters removed, nothing else (an SMS body). */
export function stripTags(text: string): string {
  return sanitizeHtml(text, { allowedTags: [], allowedAttributes: {} })
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

const PORTAL_TAGS = [
  'p',
  'br',
  'div',
  'span',
  'h3',
  'h4',
  'blockquote',
  'strong',
  'b',
  'em',
  'i',
  'u',
  's',
  'ul',
  'ol',
  'li',
  'a',
  'img',
];

/**
 * An announcement's HTML for the client portal (CM-F08, the lead's Nov 7 answer): the template
 * rules, narrower. Alignment (left, centre, right), the content fonts and the button link stay;
 * links are https only and open apart (`noopener noreferrer`); images come only from the firm's
 * own email-images address (`images`); scripts, other styles and other attributes go. The portal
 * shows nothing else; a snippet keeps `toPlainText`.
 */
export function sanitizeForPortal(html: string, images: (src: string) => boolean): string {
  const base = OPTIONS.transformTags ?? {};
  const link = base['a'] as sanitizeHtml.Transformer;
  return sanitizeHtml(html, {
    ...OPTIONS,
    allowedTags: PORTAL_TAGS,
    allowedAttributes: {
      a: ['href', 'class', 'target', 'rel'],
      img: ['src', 'alt', 'width'],
      '*': ['style'],
    },
    allowedSchemes: ['https'],
    // An image is kept only at the firm's own address (`images`, the portal's configured origin:
    // https in production, http on a developer's machine), so the scheme follows that rule.
    allowedSchemesByTag: { img: ['https', 'http'] },
    transformTags: {
      ...base,
      a: (tag, attribs) => {
        // Not https: its words stay, as text.
        if (!/^https:\/\//i.test(attribs.href ?? '')) return { tagName: 'span', attribs: {} };
        const out = link(tag, attribs);
        return {
          tagName: 'a',
          attribs: { ...out.attribs, target: '_blank', rel: 'noopener noreferrer' },
        };
      },
    },
    exclusiveFilter: (frame) => frame.tag === 'img' && !images(frame.attribs.src ?? ''),
  }).trim();
}
