import {
  ADMIN_COMM_MERGE_FIELDS,
  type AdminCommErrorCode,
  type AdminCommMergeField,
} from '@firmivra/types';

/** `{{ firm.name }}` and `{{firm.name}}` both count; the key is what `mergeFields` lists. */
const TOKEN = /\{\{\s*([a-z_]+(?:\.[a-z_]+)*)\s*\}\}/g;

/** The merge fields a subject and body use, once each, in the order they first appear. */
export function mergeFieldsIn(...texts: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  for (const t of texts) for (const m of (t ?? '').matchAll(TOKEN)) seen.add(m[1]!);
  return [...seen];
}

/** Fills each token from `values`; a field with no value is left empty and reported. */
export function fillMergeFields(
  text: string,
  values: Partial<Record<string, string | null>>,
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const filled = text.replace(TOKEN, (_, key: string) => {
    const v = values[key];
    if (!v) missing.add(key);
    return v ?? '';
  });
  return { text: filled, missing: [...missing] };
}

/** Each field's sample (template previews without a contact). */
export function sampleValues(): Record<AdminCommMergeField, string> {
  return Object.fromEntries(
    Object.entries(ADMIN_COMM_MERGE_FIELDS).map(([k, v]) => [k, v.sample]),
  ) as Record<AdminCommMergeField, string>;
}

/** The values for one recipient: the contact, their firm, the sender. */
export function contactValues(input: {
  name: string;
  email: string | null;
  firmName: string | null;
  senderName: string;
}): Record<AdminCommMergeField, string | null> {
  const name = input.name.trim();
  return {
    'contact.first_name': name.split(/\s+/)[0] || null,
    'contact.name': name || null,
    'contact.email': input.email,
    'firm.name': input.firmName,
    'sender.name': input.senderName,
    'platform.name': 'Firmivra',
  };
}

const E164 = /^\+[1-9]\d{7,14}$/;

/** The address a contact has for a channel, or null (409 NO_DESTINATION). */
export function destinationFor(
  channel: 'EMAIL' | 'SMS',
  contact: { email: string | null; phone: string | null },
): string | null {
  if (channel === 'EMAIL') return contact.email?.trim() || null;
  const phone = contact.phone?.replace(/[\s()-]/g, '') ?? '';
  return E164.test(phone) ? phone : null;
}

type MessageStatus =
  | 'DRAFT'
  | 'SCHEDULED'
  | 'SENDING'
  | 'SENT'
  | 'PARTIALLY_SENT'
  | 'FAILED'
  | 'CANCELLED'
  | 'RECEIVED';

/** Why an action does not apply to a message in this state, or null when it does. */
export function messageRefusal(
  action: 'EDIT' | 'SEND' | 'SCHEDULE' | 'CANCEL' | 'RETRY' | 'DELETE',
  status: MessageStatus,
): AdminCommErrorCode | null {
  switch (action) {
    case 'EDIT':
    case 'SEND':
    case 'SCHEDULE':
      return status === 'DRAFT' || status === 'SCHEDULED' ? null : 'NOT_EDITABLE';
    case 'CANCEL':
      return status === 'SCHEDULED' ? null : 'NOT_SCHEDULED';
    case 'RETRY':
      return status === 'FAILED' || status === 'PARTIALLY_SENT' ? null : 'NOT_RETRYABLE';
    case 'DELETE':
      return status === 'DRAFT' ? null : 'NOT_DRAFT';
  }
}

/** The message's status once every recipient's send has a result. */
export function outcomeOf(
  results: readonly ('SENT' | 'FAILED')[],
): 'SENT' | 'PARTIALLY_SENT' | 'FAILED' {
  const sent = results.filter((r) => r === 'SENT').length;
  if (sent === results.length) return 'SENT';
  return sent === 0 ? 'FAILED' : 'PARTIALLY_SENT';
}

/**
 * A provider's reason as the database's error code (`^[a-z][a-z0-9_.]{0,59}$`):
 * "InvalidRecipient" becomes "invalid_recipient".
 */
export function errorCodeOf(reason: string | undefined): string {
  const code = (reason ?? '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[^a-z0-9_.]+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 60);
  return code || 'send_failed';
}

/** A schedule at least a minute ahead (the database allows a minute of clock skew, no more). */
export const inFuture = (iso: string, now = new Date()) => Date.parse(iso) > now.getTime();

/** True when a message arrived after the member's read mark. */
export const isUnread = (lastMessageAt: Date | null, readAt: Date | undefined) =>
  !!lastMessageAt && (!readAt || lastMessageAt > readAt);

/** The list's order: newest or oldest by the last message (or creation), or unread first. */
export function orderConversations<
  T extends { id: string; lastMessageAt: Date | null; createdAt: Date; unread: boolean },
>(rows: T[], sort: 'NEWEST' | 'OLDEST' | 'UNREAD_FIRST'): T[] {
  const at = (r: T) => (r.lastMessageAt ?? r.createdAt).getTime();
  return [...rows].sort((a, b) => {
    if (sort === 'UNREAD_FIRST' && a.unread !== b.unread) return a.unread ? -1 : 1;
    const d = sort === 'OLDEST' ? at(a) - at(b) : at(b) - at(a);
    return d !== 0 ? d : b.id.localeCompare(a.id);
  });
}
