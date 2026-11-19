'use client';

import type { TemplateBrandingView } from '@firmivra/types';

// TP-F07 and CM-F08: rich content as an email shows it (images, fonts, alignment, the button), in
// a frame that runs nothing (sandbox). The HTML comes from the API, cleaned already.

/** A rendered message's HTML as its own small page, for the sandboxed frame. */
export const previewDocument = (html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:12px;font:14px/1.5 system-ui,sans-serif;color:CanvasText;background:Canvas;overflow-wrap:anywhere}img{max-width:100%;height:auto}a.fv-button{display:inline-block;padding:10px 18px;border-radius:6px;background:LinkText;color:Canvas;font-weight:600;text-decoration:none}</style></head><body>${html}</body></html>`;

/** The content in a sandboxed frame (`data-testid` lets a test read inside it). */
export function HtmlFrame({
  html,
  title,
  className = 'h-80',
  testId = 'preview-body',
}: {
  html: string;
  title: string;
  className?: string;
  testId?: string;
}) {
  return (
    <iframe
      title={title}
      sandbox=""
      srcDoc={previewDocument(html)}
      className={`w-full rounded-lg border border-divider bg-surface ${className}`}
      data-testid={testId}
    />
  );
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const paragraph = (s: string) => escape(s).replace(/\r?\n/g, '<br>');
const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};
const squash = (s: string) =>
  s
    .replace(/<[^>]+>/g, ' ')
    .replace(/&(amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

/**
 * Templates Review Two Y10: the content with the firm's branding as it goes out (see the API's
 * TemplateBrandingView): a letter's letterhead above, then the body, the firm signature (letters
 * only), the footer and the disclaimer; a footer or disclaimer the body already has is not added
 * again, as at send. The branding is plain text from Branding & Letterhead, escaped here.
 */
export function brandedHtml(body: string, b: TemplateBrandingView): string {
  const has = squash(body);
  const absent = (part: string | null) => (part && !has.includes(squash(part)) ? part : null);
  const head = b.letterhead
    ? `<header data-part="letterhead">${
        b.letterhead.logoUrl
          ? `<img src="${escape(b.letterhead.logoUrl)}" alt="${escape(b.letterhead.name)}" style="max-height:56px">`
          : ''
      }<p><strong>${escape(b.letterhead.name)}</strong>${b.letterhead.lines
        .map((l) => `<br>${escape(l)}`)
        .join('')}</p><hr></header>`
    : '';
  const footer = absent(b.footer);
  const disclaimer = absent(b.disclaimer);
  return [
    head,
    body,
    b.signature ? `<p data-part="signature">${paragraph(b.signature)}</p>` : '',
    footer ? `<p data-part="footer">${paragraph(footer)}</p>` : '',
    disclaimer ? `<p data-part="disclaimer"><small>${paragraph(disclaimer)}</small></p>` : '',
  ].join('');
}

/**
 * Y10: prints a letter as it is previewed, from a frame of its own that runs nothing (only
 * printing is allowed); the page around it is not printed.
 */
export function printHtml(html: string, title: string): void {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-same-origin allow-modals');
  frame.setAttribute('title', title);
  frame.setAttribute('aria-hidden', 'true');
  frame.className = 'fixed size-0 border-0';
  frame.srcdoc = previewDocument(html);
  frame.onload = () => {
    frame.contentWindow?.print();
    window.setTimeout(() => frame.remove(), 60_000);
  };
  document.body.appendChild(frame);
}
