import {
  createAdminAuthClient,
  createPortalAuthClient,
  createRequest,
  createStaffAuthClient,
  type IdentityPool,
} from '@firmivra/types';
import { api } from './api';

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
export const portalAuth = (firmSlug: string) =>
  createPortalAuthClient(createRequest({ baseUrl: '/api/v1' }), firmSlug);

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
