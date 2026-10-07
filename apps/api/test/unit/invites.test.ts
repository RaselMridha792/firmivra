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
      $executeRaw: vi.fn().mockResolvedValue(1), // the per-person advisory lock
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

/**
 * An invited member m1 of firm b1 (person u1) whose newest invite has `typed` details, and what
 * the invite transaction reads on each run: `inTx` (the membership) and `moved` (rows the
 * membership update changed).
 */
function invitedMember(options: {
  typed: { name: string | null; email: string | null };
  inTx: { status: string }[];
  moved?: number[];
}) {
  const findFirst = vi.fn();
  for (const { status } of options.inTx) {
    findFirst.mockResolvedValueOnce({ id: 'm1', status, role: 'STAFF' });
  }
  const moveMembership = vi.fn();
  for (const count of options.moved ?? [1]) moveMembership.mockResolvedValueOnce({ count });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    membership: { findFirst, updateMany: moveMembership },
    invite: {
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'i2' }),
    },
  };
  const userRow = vi.fn().mockResolvedValue({ name: 'Row Name', email: 'row@lvp.test' });
  const db = {
    forBusiness: () => ({
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'u1',
          role: 'STAFF',
          status: 'INVITED',
          invites: [options.typed],
        }),
      },
      business: { findUnique: vi.fn().mockResolvedValue({ name: 'LVP', status: 'ACTIVE' }) },
      invite: { count: vi.fn().mockResolvedValue(0) },
      user: { findUniqueOrThrow: userRow },
    }),
    forPlatform: () => {
      throw new Error('a resend never looks the person up by email');
    },
    withScope: (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>) => fn(tx),
  } as unknown as Database;
  const sent = { send: vi.fn().mockResolvedValue(undefined) };
  const service = new InvitesService(db, {} as never, sent, audit as never, env);
  const resend = () =>
    service.resendInvite({
      businessId: 'b1',
      membershipId: 'm1',
      invitedBy: { userId: 'o1', role: 'OWNER' },
    });
  return { tx, userRow, sent, resend };
}

describe('InvitesService.resendInvite', () => {
  it('sends the name and email typed for the newest invite, never the user row', async () => {
    const typed = { name: 'Typed Name', email: 'typed@lvp.test' };
    const { tx, userRow, sent, resend } = invitedMember({ typed, inTx: [{ status: 'INVITED' }] });
    await expect(resend()).resolves.toMatchObject({ membershipId: 'm1', ...typed });
    expect(tx.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining(typed) }),
    );
    expect(sent.send).toHaveBeenCalledWith(
      expect.objectContaining({ to: typed.email, name: typed.name }),
    );
    expect(userRow).not.toHaveBeenCalled();
  });

  it('uses the user row only for an invite made before #52 (no typed details)', async () => {
    const { tx, resend } = invitedMember({
      typed: { name: null, email: null },
      inTx: [{ status: 'INVITED' }],
    });
    await expect(resend()).resolves.toMatchObject({ name: 'Row Name', email: 'row@lvp.test' });
    expect(tx.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ name: 'Row Name', email: 'row@lvp.test' }),
      }),
    );
  });

  it('takes the per-person lock, then revokes the open links before moving the membership', async () => {
    const { tx, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }],
    });
    await resend();
    // The lock, the revoke, the membership update, the new invite: called once each, in order.
    const order = [tx.$executeRaw, tx.invite.updateMany, tx.membership.updateMany, tx.invite.create]
      .map((fn) => fn.mock.invocationCallOrder)
      .map((calls) => (calls.length === 1 ? (calls[0] ?? -1) : -1));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('answers 409 NOT_INVITED when a deactivation committed before the invite transaction', async () => {
    const { tx, sent, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'DEACTIVATED' }],
    });
    await expect(resend()).rejects.toMatchObject({ response: { code: 'NOT_INVITED' } });
    expect(tx.membership.updateMany).not.toHaveBeenCalled();
    expect(tx.invite.create).not.toHaveBeenCalled();
    expect(sent.send).not.toHaveBeenCalled();
  });

  it('checks again on the retry: deactivated between the read and the update is 409 too', async () => {
    const { tx, sent, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }, { status: 'DEACTIVATED' }],
      moved: [0],
    });
    await expect(resend()).rejects.toMatchObject({ response: { code: 'NOT_INVITED' } });
    expect(tx.membership.findFirst).toHaveBeenCalledTimes(2);
    expect(tx.invite.create).not.toHaveBeenCalled();
    expect(sent.send).not.toHaveBeenCalled();
  });
});
