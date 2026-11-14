import {
  ApiRequestError,
  parseInput,
  type StaffMyProfile,
  type StaffMyProfileClient,
  UpdateStaffMyProfileRequest,
} from '@firmivra/types';

/**
 * An in-memory `api.staffProfile` (Dashboard Review 2, R2 NEW2): the signed-in member's own name,
 * email and job title. Only the Owner edits them; any other role gets 403, as the API answers.
 */
export function createStaffProfileMock({
  role = 'OWNER',
}: { role?: string } = {}): StaffMyProfileClient {
  const owner = role === 'OWNER';
  const s: StaffMyProfile = {
    firstName: 'Mock',
    lastName: 'Owner',
    email: 'owner@lvp.test',
    jobTitle: 'Managing Partner (fake)',
    canEdit: owner,
  };
  const pause = () => new Promise((r) => setTimeout(r, 150));
  return {
    get: async () => {
      await pause();
      return { ...s };
    },
    update: async (body) => {
      await pause();
      if (!owner)
        throw new ApiRequestError(403, 'FORBIDDEN', "Your firm's Owner changes these details.");
      const next = parseInput(UpdateStaffMyProfileRequest, body);
      Object.assign(s, {
        firstName: next.firstName,
        lastName: next.lastName,
        ...(next.jobTitle !== undefined ? { jobTitle: next.jobTitle } : {}),
      });
      return { ...s };
    },
  };
}
