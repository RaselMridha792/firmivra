// InvitesService (R2 step 6) with a stubbed database and identity provider: the paths the e2e
// tests cannot reach reliably (#41 review).
import { GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { InvitesService } from '../../src/auth/invites.service.js';
import { loadEnv } from '../../src/config/env.js';

const env = loadEnv({
  NODE_ENV: 'test',
  AUTH_MODE: 'local',
  LOCAL_AUTH_SECRET: 'unit-test-secret-unit-test-secret-1234',
  DATABASE_URL_APP: 'postgresql://unused',
  APP_BASE_URL: 'http://app.localhost:3000',
  PORTAL_BASE_URL: 'http://portal.localhost:3000',
  ADMIN_BASE_URL: 'http://admin.localhost:3000',
});

const audit = { log: vi.fn().mockResolvedValue(undefined) };
const mailer = { send: vi.fn().mockResolvedValue(undefined) };

describe('InvitesService.activate', () => {
  it('answers 410 when the database clock says the link expired, and sets no password', async () => {
    const membership = {
      id: 'm1',
      role: 'STAFF',
      status: 'INVITED',
      user: { id: 'u1', email: 'new@lvp.test', name: 'New', cognitoSub: 'sub-1' },
    };
    const tx = {
      // invites_rules refuses the acceptance: expired by now() in the database.
      invite: {
        updateMany: vi
          .fn()
          .mockRejectedValue(
            new Error(
              'Database error. Code: `23514`. Message: `invites: a revoked or expired invite cannot be accepted`',
            ),
          ),
      },
    };
    const db = {
      forInvite: () => ({
        invite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'i1',
            businessId: 'b1',
            membershipId: 'm1',
            // Still open by the API's clock.
            expiresAt: new Date(Date.now() + 1_000),
            acceptedAt: null,
            revokedAt: null,
          }),
        },
      }),
      forBusiness: () => ({
        membership: { findUnique: vi.fn().mockResolvedValue(membership) },
        business: {
          findUniqueOrThrow: vi
            .fn()
            .mockResolvedValue({ id: 'b1', slug: 'lvp', name: 'LVP', status: 'ACTIVE' }),
        },
      }),
      withScope: (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as Database;
    const identity = {
      hasPassword: vi.fn().mockResolvedValue(false),
      setPassword: vi.fn().mockResolvedValue(undefined),
    };
    const service = new InvitesService(db, identity as never, mailer, audit as never, env);

    const err = await service.activate('token', 'New-password-12').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GoneException);
    expect((err as GoneException).getResponse()).toMatchObject({ code: 'INVITE_EXPIRED' });
    expect(identity.setPassword).not.toHaveBeenCalled();
  });
});

describe('InvitesService.createInvite', () => {
  it('disables the Cognito login it made when a parallel invite created the person first', async () => {
    const tx = {
      membership: {
        findFirst: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({ id: 'm1' }),
      },
      invite: {
        updateMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({ id: 'i1' }),
      },
    };
    const findUser = vi
      .fn()
      .mockResolvedValueOnce(null) // not there yet
      .mockResolvedValueOnce({ id: 'u-raced' }); // the other request's row
    const db = {
      forBusiness: () => ({
        business: { findUnique: vi.fn().mockResolvedValue({ name: 'LVP', status: 'ACTIVE' }) },
        invite: { count: vi.fn().mockResolvedValue(0) },
      }),
      forPlatform: () => ({
        user: {
          findFirst: findUser,
          create: vi.fn().mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' })),
        },
      }),
      withScope: (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as Database;
    const identity = {
      createUser: vi.fn().mockResolvedValue('sub-orphan'),
      disableUser: vi.fn().mockResolvedValue(undefined),
    };
    const service = new InvitesService(db, identity as never, mailer, audit as never, env);

    await service.createInvite({
      businessId: 'b1',
      email: 'new@lvp.test',
      name: 'New',
      role: 'STAFF',
      invitedBy: null,
    });
    expect(identity.disableUser).toHaveBeenCalledWith('STAFF', 'sub-orphan');
    expect(tx.membership.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: 'u-raced' }) }),
    );
  });
});
