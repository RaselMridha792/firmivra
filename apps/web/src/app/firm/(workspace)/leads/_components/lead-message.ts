import type { LeadBulkResult } from '@firmivra/types';
import { fullName } from './lead-shared';

// Send Email / Send SMS (Leads): who a message goes to, the API's refusals in words, and the result
// line. Plain functions, shared by the composer and its unit test.

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
