// InvitesService (R2 step 6) with a stubbed database and identity provider: the paths the e2e
// tests cannot reach reliably (#41 review).
import { GoneException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '@firmivra/db';
import { CreateInviteRequest } from '@firmivra/types';
import { InvitesService, UNNAMED_INVITE } from '../../src/auth/invites.service.js';
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
/** The R6 helper: these tests cover invites, not the bell item it writes on a join. */
const notifier = { notify: vi.fn().mockResolvedValue({ written: 0 }) } as never;

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
    const service = new InvitesService(
      db,
      identity as never,
      mailer,
      audit as never,
      env,
      notifier,
    );

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
    const service = new InvitesService(
      db,
      identity as never,
      mailer,
      audit as never,
      env,
      notifier,
    );

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

  // R4 calls the service directly with the application's primary admin (fullName up to 200).
  it.each([
    ['a name over 120 characters', { name: 'x'.repeat(121) }],
    ['a 200-character name', { name: 'x'.repeat(200) }],
    ['a control character', { name: 'Bell\u0007Name' }],
    ['a blank name', { name: '   ' }],
    ['an address that is not one', { email: 'not-an-email' }],
  ])("refuses %s with the route's 400, before any login is made", async (_, bad) => {
    const db = { forBusiness: vi.fn(), forPlatform: vi.fn(), withScope: vi.fn() };
    const identity = { createUser: vi.fn() };
    const service = new InvitesService(
      db as unknown as Database,
      identity as never,
      mailer,
      audit as never,
      env,
      notifier,
    );
    await expect(
      service.createInvite({
        businessId: 'b1',
        email: 'owner@new-firm.test',
        name: 'Primary Admin',
        ...bad,
        role: 'OWNER',
        invitedBy: null,
      }),
    ).rejects.toMatchObject({ status: 400, response: { code: 'VALIDATION_FAILED' } });
    expect(identity.createUser).not.toHaveBeenCalled();
    expect(db.forBusiness).not.toHaveBeenCalled();
    expect(db.forPlatform).not.toHaveBeenCalled();
    expect(db.withScope).not.toHaveBeenCalled();
  });
});

type Typed = { name: string | null; email: string | null };

/**
 * An invited member m1 of firm b1 (person u1). `before` is what resendInvite's first read
 * sees: the role, and the newest invite's details as a read before the lock would see them
 * (by default the same as in the transaction). Each run of the invite transaction reads `inTx`
 * (the membership; role STAFF unless given) and the newest invite's `typed` details; `moved` is
 * how many rows each membership update changes.
 */
function invitedMember(options: {
  before?: { role: string; typed: Typed };
  typed: Typed;
  inTx: { status: string; role?: string }[];
  moved?: number[];
  userRow?: { name: string; email: string };
  /** The inviter's membership as the invite transaction reads it (null: no longer active). */
  inviter?: { role: string } | null;
}) {
  const inTx = [...options.inTx];
  const inviter = options.inviter === undefined ? { role: 'OWNER' } : options.inviter;
  // The invitee's membership, one answer per transaction run; the inviter's (read with
  // status ACTIVE) as given.
  const findFirst = vi.fn(async (args: { where: { status?: string } }) => {
    if (args.where.status === 'ACTIVE') return inviter;
    const next = inTx.shift();
    return next ? { id: 'm1', status: next.status, role: next.role ?? 'STAFF' } : undefined;
  });
  const moveMembership = vi.fn();
  for (const count of options.moved ?? [1]) moveMembership.mockResolvedValueOnce({ count });
  const userRow = vi
    .fn()
    .mockResolvedValue(options.userRow ?? { name: 'Row Name', email: 'row@lvp.test' });
  const tx = {
    $executeRaw: vi.fn().mockResolvedValue(1),
    membership: { findFirst, updateMany: moveMembership },
    invite: {
      findFirst: vi.fn().mockResolvedValue(options.typed),
      count: vi.fn().mockResolvedValue(0),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      create: vi.fn().mockResolvedValue({ id: 'i2' }),
    },
    user: { findUniqueOrThrow: userRow },
  };
  const before = options.before ?? { role: 'STAFF', typed: options.typed };
  const withScope = vi.fn(
    (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>, _limits?: unknown) => fn(tx),
  );
  const db = {
    forBusiness: () => ({
      membership: {
        findUnique: vi.fn().mockResolvedValue({
          userId: 'u1',
          role: before.role,
          status: 'INVITED',
          invites: [before.typed],
        }),
      },
      business: { findUnique: vi.fn().mockResolvedValue({ name: 'LVP', status: 'ACTIVE' }) },
      invite: { count: vi.fn().mockResolvedValue(0) },
      user: { findUniqueOrThrow: userRow },
    }),
    forPlatform: () => {
      throw new Error('a resend never looks the person up by email');
    },
    withScope,
  } as unknown as Database;
  const sent = { send: vi.fn().mockResolvedValue(undefined) };
  const audited = { log: vi.fn().mockResolvedValue(undefined) };
  const service = new InvitesService(db, {} as never, sent, audited as never, env, notifier);
  const resend = () =>
    service.resendInvite({
      businessId: 'b1',
      membershipId: 'm1',
      invitedBy: { userId: 'o1', role: 'OWNER' },
    });
  return { tx, userRow, sent, audited, resend, withScope };
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

  // users.name took up to 200 characters and any character. A resend stores only a name the
  // route's rule (CreateInviteRequest.name) takes, so it fits invites_name too.
  const rowEmail = 'row@lvp.test';
  it.each([
    ['one the rule takes: kept, trimmed as the route trims it', '  Zoë Ng  ', rowEmail, 'Zoë Ng'],
    ['over 120 characters: the email', 'N'.repeat(121), rowEmail, rowEmail],
    ['with control characters: the email', 'Tab\tName\u0007', rowEmail, rowEmail],
    ['with a line separator: the email', 'Line\u2028Break', rowEmail, rowEmail],
    ['with a right-to-left override: the email', 'Pat \u202Etxt.exe', rowEmail, rowEmail],
    ['of spaces only: the email', '   ', rowEmail, rowEmail],
    [
      'the rule refuses, with an email over 120 characters: UNNAMED_INVITE',
      '\u0007',
      `${'e'.repeat(120)}@lvp.test`,
      UNNAMED_INVITE,
    ],
  ])(
    'names an invite made before #52 from a user row name %s',
    async (_, rowName, email, named) => {
      const { tx, sent, resend } = invitedMember({
        typed: { name: null, email: null },
        inTx: [{ status: 'INVITED' }],
        userRow: { name: rowName, email },
      });
      await expect(resend()).resolves.toMatchObject({ name: named });
      expect(tx.invite.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ name: named }) }),
      );
      expect(sent.send).toHaveBeenCalledWith(expect.objectContaining({ name: named }));
      expect(CreateInviteRequest.shape.name.parse(named)).toBe(named);
    },
  );

  it('never stores a user row name with U+2028, U+202E and 130 characters: the email instead', async () => {
    const rowName = `${'A'.repeat(64)}\u2028${'B'.repeat(32)}\u202E${'C'.repeat(32)}`;
    expect(rowName).toHaveLength(130);
    const { tx, sent, resend } = invitedMember({
      typed: { name: null, email: null },
      inTx: [{ status: 'INVITED' }],
      userRow: { name: rowName, email: rowEmail },
    });
    await expect(resend()).resolves.toMatchObject({ name: rowEmail, email: rowEmail });
    const [[stored]] = tx.invite.create.mock.calls as [[{ data: { name: string } }]];
    expect(stored.data.name).toBe(rowEmail);
    // The route's rule takes it unchanged, and so does invites_name: not blank, at most 120
    // characters, no control characters.
    expect(CreateInviteRequest.shape.name.parse(stored.data.name)).toBe(stored.data.name);
    expect(stored.data.name.trim()).not.toBe('');
    expect([...stored.data.name].length).toBeLessThanOrEqual(120);
    expect(stored.data.name).not.toMatch(/\p{Cc}/u);
    expect(sent.send).toHaveBeenCalledWith(expect.objectContaining({ name: rowEmail }));
  });

  it('takes the per-person lock, reads the details, then revokes the links before moving the membership', async () => {
    const { tx, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }],
    });
    await resend();
    // The lock, the newest invite's details, the revoke, the membership update, the new invite:
    // called once each, in order.
    const order = [
      tx.$executeRaw,
      tx.invite.findFirst,
      tx.invite.updateMany,
      tx.membership.updateMany,
      tx.invite.create,
    ]
      .map((fn) => fn.mock.invocationCallOrder)
      .map((calls) => (calls.length === 1 ? (calls[0] ?? -1) : -1));
    expect(order.every((n) => n > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('keeps a re-invite that committed before its transaction: the role and details read there', async () => {
    // Read first as an ADMIN invite under a misspelt name; by the time the lock is taken another
    // owner has invited the person again as STAFF, with the name corrected.
    const { tx, sent, audited, resend } = invitedMember({
      before: { role: 'ADMIN', typed: { name: 'Old Typo Nmae', email: 'pat@lvp.test' } },
      typed: { name: 'Fixed Name', email: 'pat@lvp.test' },
      inTx: [{ status: 'INVITED', role: 'STAFF' }],
    });
    await expect(resend()).resolves.toMatchObject({ role: 'STAFF', name: 'Fixed Name' });
    // And only while the membership still has the role read under the lock.
    expect(tx.membership.updateMany).toHaveBeenCalledWith({
      where: { id: 'm1', status: 'INVITED', role: 'STAFF' },
      data: { status: 'INVITED', role: 'STAFF' },
    });
    expect(tx.invite.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ name: 'Fixed Name' }) }),
    );
    expect(sent.send).toHaveBeenCalledWith(expect.objectContaining({ name: 'Fixed Name' }));
    expect(audited.log).toHaveBeenCalledWith(
      'membership.invited',
      { type: 'membership', id: 'm1' },
      { inviteId: 'i2', role: 'STAFF', resent: true },
    );
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

  it("refuses an inviter who is no longer an active member, read in the invite's transaction", async () => {
    const { tx, sent, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }],
      inviter: null,
    });
    await expect(resend()).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(tx.invite.create).not.toHaveBeenCalled();
    expect(sent.send).not.toHaveBeenCalled();
  });

  it("refuses an inviter demoted to a role that can't invite this one", async () => {
    const { tx, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED', role: 'ADMIN' }],
      before: { role: 'ADMIN', typed: { name: 'Typed Name', email: 'typed@lvp.test' } },
      inviter: { role: 'ADMIN' },
    });
    await expect(resend()).rejects.toMatchObject({ response: { code: 'FORBIDDEN' } });
    expect(tx.invite.create).not.toHaveBeenCalled();
  });

  it('checks again on the retry: deactivated between the read and the update is 409 too', async () => {
    const { tx, sent, resend } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }, { status: 'DEACTIVATED' }],
      moved: [0],
    });
    await expect(resend()).rejects.toMatchObject({ response: { code: 'NOT_INVITED' } });
    // The invitee's membership was read in both runs (the inviter's only in the first).
    const reads = tx.membership.findFirst.mock.calls.filter(([a]) => a.where.status !== 'ACTIVE');
    expect(reads).toHaveLength(2);
    expect(tx.invite.create).not.toHaveBeenCalled();
    expect(sent.send).not.toHaveBeenCalled();
  });
});

/**
 * A link to member m1 of firm b1 (person u1, no password yet) and a database whose withScope
 * records the limits it is given.
 */
function openLink() {
  const tx = {
    invite: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    membership: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  };
  const withScope = vi.fn(
    (_scope: unknown, fn: (t: typeof tx) => Promise<unknown>, _limits?: unknown) => fn(tx),
  );
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
          role: 'STAFF',
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
    withScope,
  } as unknown as Database;
  const identity = {
    hasPassword: vi.fn().mockResolvedValue(false),
    setPassword: vi.fn().mockResolvedValue(undefined),
  };
  const service = new InvitesService(db, identity as never, mailer, audit as never, env, notifier);
  return { service, identity, withScope };
}

// Prisma's limits (5 s) apply to every transaction but these (database.module.ts).
describe('InvitesService transaction limits', () => {
  it('activation may run 15 s: it sets the Cognito password inside its transaction', async () => {
    const { service, identity, withScope } = openLink();
    await service.activate('token', 'New-password-12');
    expect(identity.setPassword).toHaveBeenCalledOnce();
    expect(withScope.mock.calls.map((call) => call[2])).toEqual([{ timeout: 15_000 }]);
  });

  it('accepting with a login keeps the defaults: it calls nothing outside in its transaction', async () => {
    const { service, withScope } = openLink();
    await service.accept('token', { userId: 'u1', cognitoSub: 'sub-1', pool: 'STAFF' });
    expect(withScope.mock.calls.map((call) => call[2])).toEqual([undefined]);
  });

  it('an invite or a resend may run 15 s: revoking a link waits for an activation holding it', async () => {
    const { resend, withScope } = invitedMember({
      typed: { name: 'Typed Name', email: 'typed@lvp.test' },
      inTx: [{ status: 'INVITED' }],
    });
    await resend();
    expect(withScope.mock.calls.map((call) => call[2])).toEqual([{ timeout: 15_000 }]);
  });
});
