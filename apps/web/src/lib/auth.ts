import {
  createAdminAuthClient,
  createPortalAuthClient,
  createRequest,
  createStaffAuthClient,
  type IdentityPool,
  type PortalAuthClient,
} from '@firmivra/types';
import { createPortalAuthMock, type PortalAuthMockOptions } from '../mocks/client-auth';
import { api } from './api';
import { mocked } from './mock';

/**
 * Sign-in for the three sites (docs/AUTH-DESIGN.md, contract in docs/api/auth.yaml). Our
 * screens always call our API, which sets the HttpOnly cookies; JavaScript never sees a token.
 */
export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === 'local' ? 'local' : 'cognito';

/** Firm site: sign-in, MFA, forgot and reset password, activation, invites (/api/v1/auth). */
export const staffAuth = createStaffAuthClient({ baseUrl: '/api/v1' });

/** Super Admin site: sign-in, MFA, forgot and reset password (/api/v1/admin/auth). */
export const adminAuth = createAdminAuthClient({ baseUrl: '/api/v1' });

/**
 * Client portal of one firm: info, legal, sign-up and verification, sign-in, session and /me
 * (/api/v1/portal/{firmSlug}, contract in docs/api/client-auth.yaml). Call it in the browser:
 * the portal cookies only go to that firm's API routes, never to page requests.
 */
export const portalAuth = (firmSlug: string): PortalAuthClient =>
  process.env.NODE_ENV !== 'production' && mocked('portalAuth')
    ? portalAuthMock(firmSlug)
    : createPortalAuthClient(createRequest({ baseUrl: '/api/v1' }), firmSlug);

/** Mock mode: one mock per firm, so a sign-up or a sign-in lasts while the visitor moves around. */
const portalMocks = new Map<string, PortalAuthClient>();
const CLIENT_SESSIONS = ['ACTIVE', 'PENDING_APPROVAL', 'SIGNED_OUT'] as const;
const clientSession = process.env.NEXT_PUBLIC_API_MOCK_CLIENT;

/**
 * The mock client's starting session: NEXT_PUBLIC_API_MOCK_CLIENT=ACTIVE (default, a signed-in
 * client), PENDING_APPROVAL (waiting for the firm) or SIGNED_OUT. A page load starts it again.
 */
function portalAuthMock(firmSlug: string): PortalAuthClient {
  const slug = firmSlug.toLowerCase();
  let mock = portalMocks.get(slug);
  if (!mock) {
    const start = CLIENT_SESSIONS.find((s) => s === clientSession) ?? 'ACTIVE';
    const signedIn: PortalAuthMockOptions['signedIn'] = start === 'SIGNED_OUT' ? undefined : start;
    mock = createPortalAuthMock(slug, { signedIn });
    portalMocks.set(slug, mock);
  }
  return mock;
}

/** Local development quick sign-in as a seeded user (POST /api/v1/dev/token). */
export async function signIn(email: string, pool: IdentityPool): Promise<void> {
  if (AUTH_MODE === 'local') {
    await api.devToken({ email, pool });
    return;
  }
  throw new Error('Quick sign-in is local only: use staffAuth or adminAuth.');
}

export async function signOut(): Promise<void> {
  if (AUTH_MODE === 'local') await api.devSignOut();
}

/** Seeded fake users (packages/db/prisma/seed-data.ts), shown on local sign-in screens only. */
export const DEV_USERS: Record<IdentityPool, { email: string; label: string }[]> = {
  ADMIN: [{ email: 'superadmin@firmivra.test', label: 'Super Admin' }],
  STAFF: [
    { email: 'owner@lvp.test', label: 'LVP owner' },
    { email: 'staff@lvp.test', label: 'LVP staff' },
    { email: 'owner@firm-b.test', label: 'Test Firm B owner' },
  ],
  CLIENT: [
    { email: 'client@lvp.test', label: 'LVP client' },
    { email: 'client@firm-b.test', label: 'Test Firm B client' },
  ],
};
