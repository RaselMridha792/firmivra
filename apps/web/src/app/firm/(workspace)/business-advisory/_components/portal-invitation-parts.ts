import type { ClientPortalAccess, PortalInvitationBlock } from '@firmivra/types';

/** Why the invitation cannot be sent, and where the member fixes it. */
export function blockText(
  block: PortalInvitationBlock,
  clientId: string,
): { text: string; link?: { href: string; label: string } } {
  switch (block) {
    case 'NO_EMAIL':
      return {
        text: 'The client has no email address on file.',
        link: { href: `/clients/${clientId}`, label: "Add one on the client's record" },
      };
    case 'HAS_LOGIN':
      return { text: 'The client already has a portal login.' };
    case 'SIGN_UP_WAITING':
      return {
        text: "A sign-up with the client's email is waiting for approval.",
        link: { href: '/sign-ups', label: 'Review it in Sign-ups' },
      };
    case 'ARCHIVED':
      return { text: 'The client is archived. Restore the client to invite them.' };
    case 'DAILY_LIMIT':
      return { text: 'Three invitations were sent today. Try again tomorrow.' };
  }
}

const day = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** The last invitation, as the Portal Access card says it; null when none was sent. */
export function invitationLine(
  access: ClientPortalAccess,
): { text: string; tone: 'success' | 'warning' | 'neutral' | 'danger' } | null {
  const i = access.invitation;
  if (!i) return null;
  const by = i.sentBy ? ` by ${i.sentBy}` : '';
  const sent = `Invitation sent ${day(i.sentAt)}${by}`;
  switch (i.state) {
    case 'OPEN':
      return { text: `${sent}. The link works until ${day(i.expiresAt)}.`, tone: 'warning' };
    case 'ACCEPTED':
      return { text: `${sent}. The client signed up.`, tone: 'success' };
    case 'EXPIRED':
      return { text: `${sent}. The link expired ${day(i.expiresAt)}.`, tone: 'neutral' };
    case 'REVOKED':
      return { text: `${sent}. Revoked ${day(i.revokedAt ?? i.sentAt)}.`, tone: 'neutral' };
    case 'NOT_SENT':
      return {
        text: `Invitation of ${day(i.sentAt)} could not be emailed. Try again.`,
        tone: 'danger',
      };
  }
}

/** What a primary portal login opens, as the dialog lists it before sending. */
export const PORTAL_ACCESS =
  'Primary portal login: documents and requests, messages, forms to sign, invoices and the advisory plans and resources shared with the client.';
