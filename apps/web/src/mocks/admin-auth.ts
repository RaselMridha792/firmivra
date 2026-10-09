import {
  type AdminAuthClient,
  ApiRequestError,
  MeResponse,
  parseInput,
  SignOutRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock of the Super Admin site's session (`adminAuth` in src/lib/auth.ts): the console starts
 * signed in as an invented Super Admin, so its pages open in mock mode without the API. Only
 * `me`, `refresh` and `signOut` are mocked; sign-in, MFA and password reset stay the real calls.
 * After signOut, `me` and `refresh` answer 401 UNAUTHENTICATED, so the layout opens /sign-in; a
 * page reload signs back in, as the portal mock does. Synthetic data only.
 */
export function createAdminAuthMock(real: AdminAuthClient): AdminAuthClient {
  // The same person as ADMIN in mocks/firm-applications.ts: keep these the same. Not shared
  // through an import, so the record never lands in the production bundle.
  const me = MeResponse.parse({
    user: {
      id: '0199b6a2-0000-7000-8000-0000000000a1',
      email: 'morgan.admin@example.test',
      name: 'Morgan Admin',
      pool: 'ADMIN',
    },
    memberships: [],
    clientAccounts: [],
    platformAdmin: true,
  });
  let signedIn = true;
  const unauthenticated = () => new ApiRequestError(401, 'UNAUTHENTICATED', 'Sign in required');

  return {
    ...real,
    me: async () => {
      await mockDelay();
      if (!signedIn) throw unauthenticated();
      return structuredClone(me);
    },
    refresh: async () => {
      await mockDelay();
      if (!signedIn) throw unauthenticated();
      return { ok: true };
    },
    signOut: async (body = {}) => {
      await mockDelay();
      parseInput(SignOutRequest, body);
      signedIn = false;
      return { ok: true };
    },
  };
}
