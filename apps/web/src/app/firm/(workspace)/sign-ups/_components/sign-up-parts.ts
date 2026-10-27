import type { SignUpEvent, SignUpListStatus } from '@firmivra/types';

/** Every sign-ups query starts with this key. */
export const SIGN_UPS = ['client-sign-ups'] as const;

/** The sign-ups API's own codes, in the words the firm's staff see. */
export const SIGN_UP_ERRORS: Record<string, string> = {
  NOT_PENDING: 'Someone at your firm already handled this sign-up. The list is now up to date.',
  DUPLICATE_EMAIL:
    'A client of your firm already uses this email. Review the existing client record first.',
  POTENTIAL_MATCH:
    'This sign-up may belong to a client your firm already has, so it stays waiting. Review the existing client record first.',
  CLIENT_NOT_LINKABLE:
    'This sign-up can no longer be linked to that client. Check the client list before approving.',
  NOT_FOUND: 'This sign-up is no longer here. It may belong to another firm or have been removed.',
  STALE_VERSION:
    'This changed since you opened it, and it is now up to date. Review it again before you decide.',
  IDEMPOTENCY_KEY_REUSED: 'This was already sent with other details. Close and start again.',
  NOT_A_CANDIDATE: 'That client record is not one this sign-up may belong to.',
  NO_SUCH_CONTACT:
    'The client record has no such contact. Call a contact that is already on the record.',
  CHECKS_REQUIRED:
    'Record the three checks for this client record first: the call reached them, their identity is verified, and they gave permission. Checks count for 24 hours.',
  NO_PORTAL_LOGIN: 'This client record has no portal login to restore. Link the record instead.',
};

/** The tabs, in the design's order and words. */
export const TABS: { status: SignUpListStatus; label: string; noun: string }[] = [
  { status: 'PENDING_APPROVAL', label: 'Waiting for Approval', noun: 'waiting' },
  { status: 'APPROVED', label: 'Approved', noun: 'approved' },
  { status: 'DECLINED', label: 'Declined', noun: 'declined' },
];

/** "Oct 24, 2026", in the browser's zone. */
export const dayText = (iso: string) =>
  new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

/** "Oct 24, 2026 at 10:42 AM", as the design's activity list writes it. */
export const momentText = (iso: string) =>
  `${dayText(iso)} at ${new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}`;

/** Each history step's line in the activity list. */
export const EVENT_TEXT: Record<SignUpEvent['kind'], string> = {
  SUBMITTED: 'Application submitted',
  EMAIL_VERIFIED: 'Email verified',
  PHONE_VERIFIED: 'Phone verified',
  CHECKS_RECORDED: 'Checks recorded',
  NOT_A_MATCH: 'Marked not a match',
  KEPT_PENDING: 'Kept pending',
  LINKED: 'Linked to the existing record',
  ACCESS_RESTORED: 'Access restored to the existing login',
  APPROVED: 'Approved',
  DECLINED: 'Declined',
};
