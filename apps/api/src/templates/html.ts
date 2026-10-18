import sanitizeHtml from 'sanitize-html';

// What a template's HTML may hold. A template is rich text (headings, paragraphs, lists, links,
// images, tables, buttons as links), sanitized when it is saved or imported and again after it is
// rendered with data. Scripts, event handlers, forms, styles beyond text alignment, and links to
// anything but http, https, mailto and tel are removed.

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
  allowedStyles: {
    '*': { 'text-align': [/^(left|right|center|justify)$/] },
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  // A link that opens a new window must not hand it the opener.
  transformTags: {
    a: (tag, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
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
