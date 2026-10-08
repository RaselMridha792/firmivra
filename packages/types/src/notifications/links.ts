import { FirmSlug } from '../schemas.js';
import { NotificationTarget, type NotificationTargetKind } from './schemas.js';

/** The site the bell is on: the firm workspace, or one firm's portal (`/{firmSlug}/...`). */
export type NotificationSite = { site: 'firm' } | { site: 'portal'; firmSlug: string };

/** Firm site pages, by kind: under the client's record when the record has a client. */
const FIRM: Record<NotificationTargetKind, ((clientId: string) => string) | string | null> = {
  document: (c) => `/clients/${c}/documents`,
  document_request: (c) => `/clients/${c}/documents`,
  intake: (c) => `/clients/${c}`,
  engagement: (c) => `/clients/${c}`,
  tax_return: (c) => `/clients/${c}`,
  message_thread: (c) => `/clients/${c}/messages`,
  invoice: (c) => `/clients/${c}/invoices`,
  appointment: '/calendar',
  client_account: '/sign-ups',
  // The client's private notes never reach the firm; the member's own account has no page yet.
  client_note_reminder: null,
  user: null,
};

/** Portal pages, by kind, after `/{firmSlug}`. */
const PORTAL: Record<NotificationTargetKind, string | null> = {
  document: '/documents',
  document_request: '/documents',
  intake: '/intake',
  engagement: '/services',
  tax_return: '/taxes',
  message_thread: '/messages',
  client_note_reminder: '/messages',
  appointment: '/appointments',
  invoice: '/invoices',
  user: '/profile',
  // A sign-up waiting is the firm's business.
  client_account: null,
};

/**
 * Where opening a notification goes on this site (a public path such as
 * `/clients/{id}/documents` or `/lvp/documents`), or null when the site has no page for it (show
 * the item without a link). Built only from the target's kind and ids, never from text the API
 * sends, so a link always stays on the site. A target that does not parse also gives null.
 */
export function notificationLink(target: unknown, where: NotificationSite): string | null {
  const parsed = NotificationTarget.safeParse(target);
  if (!parsed.success) return null;
  const { kind, clientId } = parsed.data;
  if (where.site === 'portal') {
    const slug = FirmSlug.safeParse(where.firmSlug);
    const page = PORTAL[kind];
    return slug.success && page ? `/${slug.data}${page}` : null;
  }
  const page = FIRM[kind];
  if (typeof page !== 'function') return page;
  return clientId ? page(clientId) : null;
}
