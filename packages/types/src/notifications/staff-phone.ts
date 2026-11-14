import { z } from 'zod';
import { Phone } from '../client-auth/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';

const DateTime = z.iso.datetime({ offset: true });

/**
 * GET /business/me/phone: the signed-in member's mobile number and whether they proved they hold
 * it (a code by text, R60's column request 9 and 13). The number is the one on their login, set
 * in their staff record or by the member on My Profile; staff are offered texts only once it is
 * verified, and a new number clears the verification.
 */
export const StaffPhoneState = z.object({
  /** E.164, or null when the staff record has no number. */
  phone: z.string().nullable(),
  verifiedAt: DateTime.nullable(),
  /** A code was sent to this number and can still be tried (not used, not expired, tries left). */
  codeSent: z.boolean(),
  /** When Send Code works again (one code a minute); null when it works now. */
  resendAt: DateTime.nullable(),
  /**
   * Dashboard Review 2 (R2 NEW2): only the firm's Owner sets or removes their own number; an
   * employee's is set by the Owner in Edit Staff, and the employee proves it with a code.
   */
  canChange: z.boolean(),
});
export type StaffPhoneState = z.infer<typeof StaffPhoneState>;

/** POST /business/me/phone/verify: the 6-digit code from the text. */
export const VerifyStaffPhoneRequest = z.strictObject({
  code: z
    .string()
    .trim()
    .regex(/^\d{6}$/, 'Enter the 6-digit code from the text'),
});
export type VerifyStaffPhoneRequest = z.input<typeof VerifyStaffPhoneRequest>;

/**
 * PUT /business/me/phone (Octavia's Overview guide of Oct 18, item 20, narrowed by Dashboard
 * Review 2 R2 NEW2): the firm's Owner sets their own mobile number on My Profile, or removes it
 * (null); 403 FORBIDDEN for any other role, whose number the Owner sets in Edit Staff. Any
 * country, stored as E.164; a new number is not verified until a code proves it.
 */
export const SetStaffPhoneRequest = z.strictObject({ phone: Phone.nullable() });
export type SetStaffPhoneRequest = z.input<typeof SetStaffPhoneRequest>;

/**
 * The error codes of these routes: NO_PHONE (409, the staff record has no number), CODE_WAIT (429,
 * a code went out less than a minute ago; `retryAfter` seconds), CODE_LIMIT (429, the day's codes
 * for this member or the firm's texts are used up), CODE_INVALID (400: wrong, expired, used, or
 * five tries made), PHONE_CHANGED (409, the number changed after the code was sent).
 */
export const STAFF_PHONE_ERRORS = [
  'NO_PHONE',
  'CODE_WAIT',
  'CODE_LIMIT',
  'CODE_INVALID',
  'PHONE_CHANGED',
] as const;

/** `api.staffPhone` (apps/web/src/lib/api.ts): the signed-in member's own number at this firm. */
export function createStaffPhoneClient(request: ApiRequest) {
  const base = '/business/me/phone';
  return {
    get: async (): Promise<StaffPhoneState> => request(StaffPhoneState, base),
    /** My Profile: sets or removes (null) the member's own number. */
    set: async (body: SetStaffPhoneRequest): Promise<StaffPhoneState> =>
      request(StaffPhoneState, base, {
        method: 'PUT',
        body: parseInput(SetStaffPhoneRequest, body),
      }),
    /** Texts a new code to the number. */
    sendCode: async (): Promise<StaffPhoneState> =>
      request(StaffPhoneState, `${base}/code`, { method: 'POST', body: {} }),
    verify: async (body: VerifyStaffPhoneRequest): Promise<StaffPhoneState> =>
      request(StaffPhoneState, `${base}/verify`, {
        method: 'POST',
        body: parseInput(VerifyStaffPhoneRequest, body),
      }),
  };
}
export type StaffPhoneClient = ReturnType<typeof createStaffPhoneClient>;
