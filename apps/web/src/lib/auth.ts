import type { IdentityPool } from '@firmivra/types';
import { api } from './api';

/**
 * Sign-in for the three sites (docs/AUTH-DESIGN.md). Our screens always call our API, which
 * sets the HttpOnly cookie. Local development uses POST /api/v1/dev/token for seeded users;
 * the Cognito-backed endpoints (/auth/sign-in, /auth/mfa) arrive in Sprint 1 (FIR-S1-T1).
 */
export const AUTH_MODE = process.env.NEXT_PUBLIC_AUTH_MODE === 'local' ? 'local' : 'cognito';

export async function signIn(email: string, pool: IdentityPool): Promise<void> {
  if (AUTH_MODE === 'local') {
    await api.devToken({ email, pool });
    return;
  }
  throw new Error('Sign-in with Cognito arrives in Sprint 1 (FIR-S1-T1).');
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
