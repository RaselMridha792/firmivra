import { ApiRequestError } from '@firmivra/types';

/**
 * Short English text for every error code the API sends, in one place for every screen.
 * A screen with its own codes passes them as overrides:
 *   errorMessage(error, { DUPLICATE_NAME: 'A status with this name already exists.' })
 * Never show `error.message` from the API directly: these texts are the ones users see.
 */
const MESSAGES: Record<string, string> = {
  // Sign-in, sessions and invites
  INVALID_CREDENTIALS: 'Email or password is incorrect.',
  MFA_CODE_INVALID: 'That code is not right. Try the newest code from your authenticator app.',
  CHALLENGE_EXPIRED: 'Sign-in timed out. Please sign in again.',
  UNAUTHENTICATED: 'Please sign in again.',
  RESET_CODE_INVALID: 'That code is not right or has expired.',
  PASSWORD_REJECTED: 'Choose a different password.',
  INVITE_INVALID: 'This invitation link is not valid. Ask for a new invite.',
  INVITE_EXPIRED: 'This invitation has expired. Ask for a new invite.',
  ALREADY_MEMBER: 'This person is already on the team.',
  // Access
  FORBIDDEN: "You don't have permission to do this.",
  BUSINESS_INACTIVE: 'This firm is not active right now. Contact Firmivra support.',
  BUSINESS_SETUP_REQUIRED: 'Your firm needs to finish setup first.',
  BUSINESS_REQUIRED: 'Choose a firm first.',
  KIOSK_LOCKED: 'An in-person signing is open. Enter your password to return.',
  NOT_FOUND: "We couldn't find that. It may have been removed.",
  // Input and conflicts
  VALIDATION_FAILED: 'Some details need fixing. Check the highlighted fields.',
  BAD_REQUEST: 'Something in this request is not right. Check it and try again.',
  UNPROCESSABLE: "This can't be done right now. Check the details and try again.",
  CONFLICT: 'This was changed somewhere else. Reload and try again.',
  // Limits and failures
  RATE_LIMITED: 'Too many attempts. Wait a few minutes and try again.',
  ORIGIN_NOT_ALLOWED: 'Something went wrong. Reload the page and try again.',
  UNSUPPORTED_MEDIA_TYPE: 'Something went wrong. Reload the page and try again.',
  INTERNAL_ERROR: 'Something went wrong on our side. Try again in a moment.',
  NOT_IMPLEMENTED: "This isn't available yet.",
};

const NETWORK = "We can't reach Firmivra. Check your connection and try again.";
const UNKNOWN = 'Something went wrong. Try again in a moment.';

export function errorMessage(error: unknown, overrides: Record<string, string> = {}): string {
  if (error instanceof ApiRequestError) {
    const text = overrides[error.code] ?? MESSAGES[error.code];
    if (text) return text;
    if (error.status === 429) return MESSAGES['RATE_LIMITED'] ?? UNKNOWN;
    if (error.status >= 500) return MESSAGES['INTERNAL_ERROR'] ?? UNKNOWN;
    return UNKNOWN;
  }
  // fetch rejects with a TypeError when the network or the server is unreachable.
  if (error instanceof TypeError) return NETWORK;
  return UNKNOWN;
}

/** The API error code, or undefined for network and other errors. */
export const errorCode = (error: unknown): string | undefined =>
  error instanceof ApiRequestError ? error.code : undefined;
