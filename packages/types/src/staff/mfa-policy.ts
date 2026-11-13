import { z } from 'zod';
import { PASSWORD_MAX_LENGTH } from '../auth/schemas.js';
import { type ApiRequest, parseInput } from '../client.js';
import { StaffId } from './schemas.js';

// SM14 part C, SEC-6 (the security guide: "MFA is enabled and required by default... Only the firm
// owner or an explicitly authorized security administrator may change the requirement; require
// fresh authentication, confirmation and audit logging"). The firm's requirement lives in
// staff_security_defaults (mfa_required, and the documented exception when it is off); a security
// administrator is an Admin with memberships.is_security_admin, granted by owner-level access.
// Staff sign-in asks every staff login for a code whatever the firm records (the staff user pool
// requires it, and a login is shared across firms): "off" records an approved exception.

const DateTime = z.iso.datetime({ offset: true });

/** GET /business/security/mfa-policy. */
export const MfaPolicy = z.object({
  required: z.boolean(),
  /** The documented, approved exception while it is off; null while required. */
  exception: z
    .object({
      note: z.string(),
      approvedBy: z.object({ userId: z.uuid(), name: z.string() }).nullable(),
      at: DateTime,
    })
    .nullable(),
  /** The signed-in member may change it: an Owner, or an Admin who is a security administrator. */
  canChange: z.boolean(),
  /** Always true: Firmivra's sign-in asks every staff login for a code (pool-wide). */
  enforcedAtSignIn: z.literal(true),
});
export type MfaPolicy = z.infer<typeof MfaPolicy>;

/**
 * PUT /business/security/mfa-policy: the current password first (a fresh sign-in, 400
 * VALIDATION_FAILED on `currentPassword` when wrong; tries limited), and the confirm. Turning it off
 * needs the documented exception (`note`: why, and who approved it). 403 for anyone else.
 */
export const UpdateMfaPolicyRequest = z
  .strictObject({
    required: z.boolean(),
    note: z.string().trim().max(1000, 'Use at most 1000 characters').optional(),
    currentPassword: z
      .string()
      .min(1, 'Enter your current password')
      .max(PASSWORD_MAX_LENGTH, `Use at most ${PASSWORD_MAX_LENGTH} characters`),
    confirm: z.literal(true, { error: 'Confirm the change first' }),
  })
  .refine((b) => b.required || !!b.note, {
    path: ['note'],
    message: 'Write the approved exception: why, and who approved it',
  });
export type UpdateMfaPolicyRequest = z.input<typeof UpdateMfaPolicyRequest>;

/** GET /business/staff/{id}/security-admin: whether the member is a security administrator. */
export const StaffSecurityAdmin = z.object({
  securityAdmin: z.boolean(),
  /** The signed-in member may change it: owner-level, on an Admin (never themselves). */
  canChange: z.boolean(),
});
export type StaffSecurityAdmin = z.infer<typeof StaffSecurityAdmin>;

/** PUT /business/staff/{id}/security-admin: grant or take away, after the confirm. */
export const SetStaffSecurityAdminRequest = z.strictObject({
  securityAdmin: z.boolean(),
  confirm: z.literal(true, { error: 'Confirm the change first' }),
});
export type SetStaffSecurityAdminRequest = z.input<typeof SetStaffSecurityAdminRequest>;

/** `api.mfaPolicy`: the firm's MFA requirement and its security administrators. */
export function createMfaPolicyClient(request: ApiRequest) {
  const admin = (id: string) => `/business/staff/${parseInput(StaffId, id)}/security-admin`;
  return {
    get: async (): Promise<MfaPolicy> => request(MfaPolicy, '/business/security/mfa-policy'),
    update: async (body: UpdateMfaPolicyRequest): Promise<MfaPolicy> =>
      request(MfaPolicy, '/business/security/mfa-policy', {
        method: 'PUT',
        body: parseInput(UpdateMfaPolicyRequest, body),
      }),
    securityAdmin: async (id: string): Promise<StaffSecurityAdmin> =>
      request(StaffSecurityAdmin, admin(id)),
    setSecurityAdmin: async (
      id: string,
      body: SetStaffSecurityAdminRequest,
    ): Promise<StaffSecurityAdmin> =>
      request(StaffSecurityAdmin, admin(id), {
        method: 'PUT',
        body: parseInput(SetStaffSecurityAdminRequest, body),
      }),
  };
}
export type MfaPolicyClient = ReturnType<typeof createMfaPolicyClient>;
