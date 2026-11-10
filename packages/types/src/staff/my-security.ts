import { z } from 'zod';
import { PASSWORD_MAX_LENGTH, Password } from '../auth/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';
import { StaffSessionItem } from './schemas.js';

// SM14 part B, the self-service account actions of the approved account authority rules: every
// staff member, whatever their role, signs out their own other sessions and changes their own
// password (Octavia's Staff Management review of Oct 23, "Own sessions" and "Own password"). The
// Security card on My Profile. Managing someone else's sessions or password stays with
// Staff Management's Access & Security (Owner and Admin, the authority rule).

const MY = '/business/me';

/** One of my open sessions in this firm; `current` is the one this request came from. */
export const MySessionItem = StaffSessionItem.extend({ current: z.boolean() });
export type MySessionItem = z.infer<typeof MySessionItem>;

/** GET /business/me/sessions: my open sessions in this firm, seen in the last 7 days. */
export const MySessionList = z.object({ items: z.array(MySessionItem) });
export type MySessionList = z.infer<typeof MySessionList>;

/** POST /business/me/sessions/sign-out-others: every session but this one, after the confirm. */
export const SignOutOtherSessionsRequest = z.strictObject({
  confirm: z.literal(true, { error: 'Confirm the action first' }),
});
export type SignOutOtherSessionsRequest = z.input<typeof SignOutOtherSessionsRequest>;

/** The answer of both actions: how many other sessions in this firm were signed out. */
export const MySecurityResult = z.object({
  ok: z.literal(true),
  sessionsRevoked: z.number().int(),
});
export type MySecurityResult = z.infer<typeof MySecurityResult>;

/**
 * POST /business/me/password: the current password (a fresh sign-in check) and a new one by the
 * password rules. A wrong current password is 400 VALIDATION_FAILED on `currentPassword`; a
 * password the identity provider refuses is 400 PASSWORD_REJECTED. Tries are limited.
 */
export const ChangeMyPasswordRequest = z
  .strictObject({
    currentPassword: z
      .string()
      .min(1, 'Enter your current password')
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`),
    newPassword: Password,
  })
  .refine((b) => b.newPassword !== b.currentPassword, {
    path: ['newPassword'],
    message: 'Choose a password you are not using now',
  });
export type ChangeMyPasswordRequest = z.input<typeof ChangeMyPasswordRequest>;

/** `api.mySecurity`: the signed-in member's own sessions and password, in the selected firm. */
export function createMySecurityClient(request: ApiRequest) {
  return {
    sessions: async (): Promise<MySessionItem[]> =>
      (await request(MySessionList, `${MY}/sessions`)).items,
    /** Sign Out All Other Sessions: this session stays signed in. */
    signOutOthers: async (body: SignOutOtherSessionsRequest): Promise<MySecurityResult> =>
      request(MySecurityResult, `${MY}/sessions/sign-out-others`, {
        method: 'POST',
        body: parseInput(SignOutOtherSessionsRequest, body),
      }),
    /** Change My Password: the other sessions in this firm are signed out. */
    changePassword: async (body: ChangeMyPasswordRequest): Promise<MySecurityResult> =>
      request(MySecurityResult, `${MY}/password`, {
        method: 'POST',
        body: parseInput(ChangeMyPasswordRequest, body),
      }),
  };
}
export type MySecurityClient = ReturnType<typeof createMySecurityClient>;
