import type { TxClient } from '@firmivra/db';
import { toPlainText } from './html.js';

/**
 * Templates Review Two Y10 (decided Nov 19): an email sent from a template (Communications and
 * Messages) carries the firm's footer and disclaimer (Templates > Branding & Letterhead), added
 * once at send. A body that already has one of them keeps it as it is, so neither appears twice.
 * The firm signature is never added to an email (the sender's own My Signature stays as it is),
 * there is no letterhead in an email, and texts and portal messages are unchanged.
 */
export interface FirmFooter {
  footer: string | null;
  disclaimer: string | null;
}

export async function firmFooter(tx: TxClient, businessId: string): Promise<FirmFooter> {
  const b = await tx.templateBranding.findUnique({
    where: { businessId },
    select: { footerText: true, disclaimer: true },
  });
  return { footer: b?.footerText?.trim() || null, disclaimer: b?.disclaimer?.trim() || null };
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** The footer and disclaimer that the text does not already carry, in that order. */
function missing(
  text: string,
  f: FirmFooter,
): { footer: string | null; disclaimer: string | null } {
  const has = squash(text);
  const absent = (part: string | null) => (part && !has.includes(squash(part)) ? part : null);
  return { footer: absent(f.footer), disclaimer: absent(f.disclaimer) };
}

const escape = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
const paragraph = (s: string) => escape(s).replace(/\r?\n/g, '<br />');

/** An email's HTML with the firm's footer and disclaimer, each once. */
export function withFirmFooterHtml(html: string, f: FirmFooter): string {
  const add = missing(toPlainText(html), f);
  return [
    html,
    add.footer ? `<p>${paragraph(add.footer)}</p>` : '',
    add.disclaimer ? `<p><small>${paragraph(add.disclaimer)}</small></p>` : '',
  ].join('');
}

/** A plain-text email with the firm's footer and disclaimer, each once. */
export function withFirmFooterText(text: string, f: FirmFooter): string {
  const add = missing(text, f);
  return [text, add.footer, add.disclaimer].filter((x): x is string => !!x).join('\n\n');
}
