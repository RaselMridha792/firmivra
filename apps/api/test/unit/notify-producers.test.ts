// The R6 bell-item producers in R2's and R3's flows never fail the action they report (#227
// review): a Notifier whose notify() rejects leaves invite activate and accept, password reset
// and the sign-up's last step succeeding. Databases and private steps are stubbed; the e2e file
// (notify-producers.e2e.test.ts) covers the items written.
import type { Request } from 'express';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { ChallengeSessions } from '../../src/auth/challenge-session.js';
import { InvitesService } from '../../src/auth/invites.service.js';
import { SignInService } from '../../src/auth/sign-in.service.js';
import { sitePlace } from '../../src/auth/site.js';
import { SignUpService } from '../../src/client-auth/sign-up.service.js';
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

/** A Notifier that fails the way only a programming error could. */
const failingNotifier = () => ({
  notify: vi.fn().mockRejectedValue(new TypeError('notifier broke')),
});

describe('staff.joined: a failing notifier never fails the join', () => {
  const service = (notifier: ReturnType<typeof failingNotifier>) => {
    const tx = {
      invite: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      membership: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const db = {
      forInvite: () => ({
        invite: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'i1',
            businessId: 'b1',
            membershipId: 'm1',
            expiresAt: new Date(Date.now() + 60_000),
            acceptedAt: null,
            revokedAt: null,
          }),
        },
      }),
      forBusiness: () => ({
        membership: {
          findUnique: vi.fn().mockResolvedValue({
            id: 'm1',
            role: 'ADMIN',
            status: 'INVITED',
            user: { id: 'u1', email: 'new@lvp.test', name: 'New', cognitoSub: 'sub-1' },
          }),
        },
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
    return new InvitesService(
      db,
      identity as never,
      { send: vi.fn() },
      { log: vi.fn().mockResolvedValue(undefined) } as never,
      env,
      notifier as never,
    );
  };

  it('activate still answers with the new login', async () => {
    const notifier = failingNotifier();
    await expect(service(notifier).activate('token', 'New-password-12')).resolves.toEqual({
      userId: 'u1',
      sub: 'sub-1',
    });
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'staff.joined', recordId: 'm1', actorUserId: 'u1' }),
    );
  });

  it('accept still succeeds', async () => {
    const notifier = failingNotifier();
    await expect(
      service(notifier).accept('token', { userId: 'u1', cognitoSub: 'sub-1', pool: 'STAFF' }),
    ).resolves.toBeUndefined();
    expect(notifier.notify).toHaveBeenCalledOnce();
  });
});

describe('account.password-changed: a failing notifier never fails the reset', () => {
  it('resetPassword still resolves after Cognito took the code', async () => {
    const notifier = failingNotifier();
    const db = {
      forUser: () => ({
        membership: { findMany: vi.fn().mockResolvedValue([{ businessId: 'b1' }]) },
      }),
    } as unknown as Database;
    const identity = { resetPassword: vi.fn().mockResolvedValue(undefined) };
    const service = new SignInService(
      db,
      identity as never,
      ChallengeSessions.fromEnv(env),
      { log: vi.fn() } as never,
      env,
      notifier as never,
    );
    // The rate limit's reservation and the user lookup are the database's; stubbed here.
    const steps = service as unknown as Record<string, unknown>;
    steps['reserve'] = vi.fn().mockResolvedValue('r1');
    steps['passed'] = vi.fn().mockResolvedValue(undefined);
    steps['findUser'] = vi.fn().mockResolvedValue({ id: 'u1', cognitoSub: 'sub-1' });

    await expect(
      service.resetPassword(sitePlace('firm'), 'staff@lvp.test', '123456', 'Brand-new-password-9'),
    ).resolves.toBeUndefined();
    expect(identity.resetPassword).toHaveBeenCalledOnce();
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'account.password-changed', recordId: 'u1' }),
    );
  });
});

describe('client.signup-submitted: a failing notifier never fails the sign-up', () => {
  it('verifyPhone still answers DONE', async () => {
    const notifier = failingNotifier();
    const tx = {
      clientAccount: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
      legalAcceptance: { createMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const db = {
      withScope: (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
    } as unknown as Database;
    const identity = { updateContact: vi.fn().mockResolvedValue(undefined) };
    const codes = {
      match: vi.fn().mockResolvedValue('code-1'),
      consume: vi.fn().mockResolvedValue(true),
    };
    const service = new SignUpService(
      db,
      identity as never,
      {} as never,
      {} as never,
      codes as never,
      {} as never,
      { log: vi.fn() } as never,
      notifier as never,
      env,
    );
    const s = { businessId: 'b1', userId: 'u1', firmSlug: 'lvp', phone: '+17705550171' };
    // The cookie session and the attempt's rows are the database's; stubbed here.
    const steps = service as unknown as Record<string, unknown>;
    steps['session'] = vi.fn().mockResolvedValue({
      session: { ...s, documents: [] },
      attempt: null,
      expiresAt: Date.now() + 60_000,
    });
    steps['attemptAccount'] = vi.fn().mockResolvedValue({
      id: 'ca1',
      userId: 'u1',
      emailVerifiedAt: new Date(),
      phoneVerifiedAt: null,
      legalAcceptances: [],
    });
    steps['attemptUser'] = vi.fn().mockResolvedValue({ phone: s.phone, cognitoSub: 'sub-1' });
    steps['log'] = vi.fn().mockResolvedValue(undefined);
    steps['stateOf'] = vi.fn().mockResolvedValue({ step: 'DONE' });

    await expect(service.verifyPhone('lvp', '000000', {} as Request)).resolves.toEqual({
      step: 'DONE',
    });
    expect(tx.clientAccount.updateMany).toHaveBeenCalledOnce();
    expect(notifier.notify).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'client.signup-submitted', recordId: 'ca1' }),
    );
  });
});
