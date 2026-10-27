import {
  ApiRequestError,
  parseInput,
  type StaffPhoneClient,
  type StaffPhoneState,
  VerifyStaffPhoneRequest,
} from '@firmivra/types';

/** Locally every code is this, as the API in AUTH_MODE=local. */
const LOCAL_CODE = '000000';
const GAP_MS = 60_000;

/**
 * An in-memory `api.staffPhone`: the signed-in member has a fake number that is not verified yet.
 * Send Code opens a code for a minute's gap; 000000 verifies. The notifications mock does not
 * follow it (its preferences stay email only); the API offers SMS once the number is verified.
 */
export function createStaffPhoneMock(): StaffPhoneClient {
  const s: StaffPhoneState = {
    phone: '+17705550123',
    verifiedAt: null,
    codeSent: false,
    resendAt: null,
  };
  const pause = () => new Promise((r) => setTimeout(r, 150));
  const current = (): StaffPhoneState => {
    if (s.resendAt && Date.parse(s.resendAt) <= Date.now()) s.resendAt = null;
    return { ...s };
  };
  return {
    get: async () => {
      await pause();
      return current();
    },
    sendCode: async () => {
      await pause();
      if (s.resendAt && Date.parse(s.resendAt) > Date.now()) {
        throw new ApiRequestError(
          429,
          'CODE_WAIT',
          'A code was sent less than a minute ago. Wait a moment, then send another.',
        );
      }
      s.codeSent = true;
      s.resendAt = new Date(Date.now() + GAP_MS).toISOString();
      return current();
    },
    verify: async (body) => {
      await pause();
      const { code } = parseInput(VerifyStaffPhoneRequest, body);
      if (!s.codeSent || code !== LOCAL_CODE) {
        throw new ApiRequestError(400, 'CODE_INVALID', 'That code is not right.');
      }
      Object.assign(s, { verifiedAt: new Date().toISOString(), codeSent: false, resendAt: null });
      return current();
    },
  };
}
