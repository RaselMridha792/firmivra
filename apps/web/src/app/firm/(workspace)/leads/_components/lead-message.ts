import type { LeadBulkResult } from '@firmivra/types';
import { fullName } from './lead-shared';

// Send Email / Send SMS (Leads): who a message goes to, the API's refusals in words, the result
// line, and a formatted email's plain form and signature. Plain functions, shared by the composer
// and its unit test.

/** Who a message goes to, as the screen that opens the composer knows them. */
export interface MessageRecipient {
  id: string;
  name: string;
  email: string;
  phone: string | null;
}

export const recipientOf = (lead: {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string | null;
}): MessageRecipient => ({
  id: lead.id,
  name: fullName(lead.firstName, lead.lastName, lead.email),
  email: lead.email,
  phone: lead.phone,
});

/** The API's refusals in the composer's words (never the generic "Something went wrong"). */
export const MESSAGE_ERRORS: Record<string, string> = {
  SMS_UNAVAILABLE:
    'Text messages are not set up for this firm yet, so nothing was sent. Email works meanwhile; Firmivra support can switch texts on.',
  FORBIDDEN: 'You cannot message these leads.',
};

/** The email images' and the signature's refusals (lib/upload.ts checks a file first). */
export const EMAIL_EXTRA_ERRORS: Record<string, string> = {
  FILE_TYPE_NOT_ALLOWED: 'Use a PNG, JPG or GIF image.',
  FILE_EMPTY: 'That image is empty.',
  FILE_TOO_LARGE: 'That image is too large: at most 2 MB.',
  UPLOAD_MISMATCH: 'The image changed while it was uploading. Try again.',
  UPLOAD_EXPIRED: 'The upload took too long. Try again.',
  SIGNATURE_EMPTY: 'Write a signature first.',
  SIGNATURE_TOO_LONG:
    'The signature is too long to save. Shorten the text or use fewer fonts and sizes.',
};

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  '#39': "'",
  apos: "'",
  nbsp: ' ',
};

/**
 * A formatted email's plain form (the email's text part and the 5000-character count): one line
 * per paragraph, line break or list item, no tags, entities read, no zero-width marks.
 */
export function htmlToText(html: string): string {
  return (
    html
      // Text straight before a new block ("Name<div>Firm</div>") ends its line too.
      .replace(/([^>\n])(<(?:p|div|h3|h4|blockquote|ul|ol)\b)/gi, '$1\n$2')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|h3|h4|li|blockquote|ul|ol)>/gi, '\n')
      .replace(/<li[^>]*>/gi, '- ')
      .replace(/<[^>]*>/g, '')
      .replace(/&(amp|lt|gt|quot|#39|apos|nbsp);/g, (_, name: string) => ENTITIES[name] ?? '')
      .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
      .replace(/[\u200B\u00A0]/g, (c) => (c === '\u00A0' ? ' ' : ''))
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
  );
}

/** The email as sent: the message, then the member's signature after a blank line. */
export const withSignature = (message: string, signature: string | null): string =>
  signature ? `${message}<p><br></p>${signature}` : message;

/** The result line after sending: how many went, and why the others did not. */
export function sendSummary(
  result: LeadBulkResult,
  recipients: readonly MessageRecipient[],
  channel: 'EMAIL' | 'SMS',
): string {
  const noPhone = channel === 'SMS' ? recipients.filter((r) => !r.phone).length : 0;
  const undelivered = Math.max(0, result.skipped - noPhone);
  const what = channel === 'SMS' ? 'Text' : 'Email';
  const parts = [
    result.changed === 0
      ? `${what} not sent.`
      : `${what} sent to ${result.changed} ${result.changed === 1 ? 'lead' : 'leads'}.`,
  ];
  if (noPhone)
    parts.push(
      `${noPhone} without a saved phone number ${noPhone === 1 ? 'was' : 'were'} left out.`,
    );
  if (undelivered)
    parts.push(
      `${undelivered} could not be sent (no longer available to you, or the provider refused it); try again later.`,
    );
  return parts.join(' ');
}
