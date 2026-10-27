import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';

const DateTime = z.iso.datetime({ offset: true });

/**
 * GET /business/me/phone: the signed-in member's mobile number and whether they proved they hold
 * it (a code by text, R60's column request 9 and 13). The number is the one on their login, set
 * in their staff record; staff are offered texts only once it is verified, and a new number clears
 * the verification.
 */
export const StaffPhoneState = z.object({
  /** E.164, or null when the staff record has no number. */
  phone: z.string().nullable(),
  verifiedAt: DateTime.nullable(),
  /** A code was sent to this number and can still be tried (not used, not expired, tries left). */
  codeSent: z.boolean(),
  /** When Send Code works again (one code a minute); null when it works now. */
  resendAt: DateTime.nullable(),
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
