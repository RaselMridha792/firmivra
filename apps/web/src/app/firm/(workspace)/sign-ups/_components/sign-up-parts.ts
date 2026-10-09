/** Every sign-ups query starts with this key. */
export const SIGN_UPS = ['client-sign-ups'] as const;

/** The sign-ups API's own codes, in the words the firm's staff see. */
export const SIGN_UP_ERRORS: Record<string, string> = {
  NOT_PENDING: 'Someone at your firm already handled this sign-up. The list is now up to date.',
  DUPLICATE_EMAIL:
    'A client of your firm already uses this email. Check the client list before approving.',
  CLIENT_NOT_LINKABLE:
    'This sign-up can no longer be linked to that client. Check the client list before approving.',
};

export const signedUpText = (iso: string) =>
  new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
