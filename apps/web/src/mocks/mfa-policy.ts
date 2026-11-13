import {
  ApiRequestError,
  type MfaPolicy,
  type MfaPolicyClient,
  parseInput,
  SetStaffSecurityAdminRequest,
  StaffId,
  UpdateMfaPolicyRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// `api.mfaPolicy` in mock mode (SM14 part C, SEC-6): the firm's two-factor requirement and its
// security administrators. The mock signs in as the Owner; "Current-Password-1" is the current
// password. Synthetic data only.
const CURRENT = 'Current-Password-1';
const ME = '0199b6a2-0000-7000-8000-0000000000c1';

export function createMfaPolicyMock(): MfaPolicyClient {
  let policy: MfaPolicy | undefined;
  const admins = new Map<string, boolean>();
  const current = () =>
    (policy ??= { required: true, exception: null, canChange: true, enforcedAtSignIn: true });
  return {
    get: async () => {
      await mockDelay();
      return structuredClone(current());
    },
    update: async (body) => {
      await mockDelay();
      const input = parseInput(UpdateMfaPolicyRequest, body);
      if (input.currentPassword !== CURRENT)
        throw new ApiRequestError(
          400,
          'VALIDATION_FAILED',
          'Your current password is not right',
          undefined,
          undefined,
          [{ path: 'currentPassword', message: 'Your current password is not right' }],
        );
      policy = {
        ...current(),
        required: input.required,
        exception: input.required
          ? null
          : {
              note: input.note ?? '',
              approvedBy: { userId: ME, name: 'Morgan Avery' },
              at: new Date().toISOString(),
            },
      };
      return structuredClone(policy);
    },
    securityAdmin: async (id) => {
      await mockDelay();
      const key = parseInput(StaffId, id);
      return { securityAdmin: admins.get(key) ?? false, canChange: true };
    },
    setSecurityAdmin: async (id, body) => {
      await mockDelay();
      const key = parseInput(StaffId, id);
      const { securityAdmin } = parseInput(SetStaffSecurityAdminRequest, body);
      admins.set(key, securityAdmin);
      return { securityAdmin, canChange: true };
    },
  };
}
