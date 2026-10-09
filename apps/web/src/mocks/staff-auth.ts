import {
  ActivateRequest,
  ActivationCheckRequest,
  type ActivationCheckResponse,
  ApiRequestError,
  MfaRequest,
  MfaSetupRequest,
  parseInput,
  type StaffAuthClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { createMeMock, mockBusiness } from './me';

/**
 * Activation links that work in mock mode, /activate#token=<token>: `valid` is a new person (the
 * password form, then authenticator setup), `account` already has a login (sign in to accept),
 * `expired` is 410 INVITE_EXPIRED. Any other token, or a used one, is 404 INVITE_INVALID.
 */
const MOCK_ACTIVATION_TOKENS = {
  valid: 'valid-token-0199-new-owner',
  account: 'account-token-0199-has-login',
  expired: 'expired-token-0199-old-invite',
} as const;

const SECRET = 'JBSWY3DPEHPK3PXP';

/**
 * Mock of the firm site's activation (`staffAuth` in src/lib/auth.ts), so /activate works in mock
 * mode without the API, through the first authenticator setup; the code 000000 is right, as with
 * AUTH_MODE=local. Sign-in, refresh, sign-out and accepting an invite stay the real calls. A page
 * load starts again. Synthetic data only.
 */
export function createStaffAuthMock(real: StaffAuthClient): StaffAuthClient {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const invite = (name: string, role: 'OWNER' | 'STAFF', hasAccount: boolean) => {
    const email = `${name.toLowerCase().replace(' ', '.')}@example.test`;
    return { email, name, role, business: mockBusiness, expiresAt, hasAccount };
  };
  const invites: Record<string, ActivationCheckResponse> = {
    [MOCK_ACTIVATION_TOKENS.valid]: invite('Avery Owner', 'OWNER', false),
    [MOCK_ACTIVATION_TOKENS.account]: invite('Jordan Staff', 'STAFF', true),
  };
  const used = new Set<string>();
  const fail = (status: number, code: string, message: string) =>
    new ApiRequestError(status, code, message);
  const open = (token: string) => {
    if (token === MOCK_ACTIVATION_TOKENS.expired) {
      throw fail(410, 'INVITE_EXPIRED', 'This link has expired. Ask for a new invite.');
    }
    const found = invites[token];
    if (!found || used.has(token)) {
      throw fail(404, 'INVITE_INVALID', 'This link is not valid any more');
    }
    return found;
  };

  return {
    ...real,
    checkActivation: async (body) => {
      await mockDelay();
      return structuredClone(open(parseInput(ActivationCheckRequest, body).token));
    },
    activate: async (body) => {
      await mockDelay();
      const { token } = parseInput(ActivateRequest, body);
      if (open(token).hasAccount) {
        throw fail(409, 'ACCOUNT_EXISTS', 'You already have a login: sign in to accept the invite');
      }
      used.add(token);
      return { status: 'MFA_SETUP_REQUIRED', session: 'mock-activation-session' };
    },
    startMfaSetup: async (body) => {
      await mockDelay();
      parseInput(MfaSetupRequest, body);
      const otpauthUri = `otpauth://totp/Firmivra:mock?secret=${SECRET}&issuer=Firmivra`;
      return { session: 'mock-mfa-setup-session', secret: SECRET, otpauthUri };
    },
    submitMfaCode: async (body) => {
      if (parseInput(MfaRequest, body).code !== '000000') {
        await mockDelay();
        throw fail(401, 'MFA_CODE_INVALID', 'Invalid verification code');
      }
      return { status: 'SIGNED_IN', me: await createMeMock().me() };
    },
  };
}
