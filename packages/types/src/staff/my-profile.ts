import { z } from 'zod';
import { type ApiRequest, parseInput } from '../client.js';
import { clearable, text } from '../clients/text.js';

// Dashboard Review 2 (R2 NEW2): My Profile's Edit Profile. The firm's Owner edits their own name
// and job title; every other role reads them (an Admin is not an Owner). The sign-in email and the
// role are never changed here (security controls stay where they are), and notification
// preferences and password stay in My Settings and the Security card. An employee's details are
// the Owner's to change, in Staff Management's Edit Staff.

const MY_PROFILE = '/business/me/profile';
const Name = text(60);

/** GET /business/me/profile: the signed-in member's own details at this firm. */
export const StaffMyProfile = z.object({
  firstName: z.string(),
  lastName: z.string(),
  email: z.string(),
  jobTitle: z.string().nullable(),
  /** Only the firm's Owner edits their own profile (R2 NEW2). */
  canEdit: z.boolean(),
});
export type StaffMyProfile = z.infer<typeof StaffMyProfile>;

/**
 * PATCH /business/me/profile: the Owner's own first and last name and job title (403 FORBIDDEN for
 * any other role). Audited as `profile.updated` with the field names only.
 */
export const UpdateStaffMyProfileRequest = z.strictObject({
  firstName: Name,
  lastName: Name,
  /** '' or null clears it. */
  jobTitle: clearable(text(100)),
});
export type UpdateStaffMyProfileRequest = z.input<typeof UpdateStaffMyProfileRequest>;

/** `api.staffProfile`: the signed-in member's own profile in the selected firm. */
export function createStaffMyProfileClient(request: ApiRequest) {
  return {
    get: async (): Promise<StaffMyProfile> => request(StaffMyProfile, MY_PROFILE),
    update: async (body: UpdateStaffMyProfileRequest): Promise<StaffMyProfile> =>
      request(StaffMyProfile, MY_PROFILE, {
        method: 'PATCH',
        body: parseInput(UpdateStaffMyProfileRequest, body),
      }),
  };
}
export type StaffMyProfileClient = ReturnType<typeof createStaffMyProfileClient>;
