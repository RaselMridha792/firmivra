// End-to-end: the R6 bell items that R2's and R3's flows produce through the Notifier helper.
// `staff.joined` when an invite is activated or accepted (the firm's Owners and Admins, never the
// joiner), `client.signup-submitted` when a portal sign-up completes (Owners and Admins), and
// `account.password-changed` when a password is reset (the person themself: the staff bell in
// each firm they work at, the portal bell for a PRIMARY login only). Each is read back through
// the notifications list, never seen by another firm, and stores the record's id with only the
// values its text needs. Firms and people are this file's own: shared fixtures keep exactly their
// memberships and client accounts.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { NotificationList, portalCookies } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { ACTIVATION_MAILER, type ActivationEmail } from '../../src/auth/activation-mailer.js';
import { LOCAL_RESET_CODE } from '../../src/auth/identity/local-identity.provider.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NOTIFY_SERVICE } from '../../src/notify/notify.types.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string, pool: 'STAFF' | 'CLIENT') => ({
  id: randomUUID(),
  email: `r6p-${key}-${run}@r6p.test`,
  name: `Fake R6p ${key}`,
  pool,
});
const people = {
  ownerA: person('owner-a', 'STAFF'),
  adminA: person('admin-a', 'STAFF'),
  /** A Staff member of firm A and of firm B. */
  staffA: person('staff-a', 'STAFF'),
  ownerB: person('owner-b', 'STAFF'),
  adminB: person('admin-b', 'STAFF'),
  /** Firm B's member, invited to firm A: accepts signed in. */
  joinerB: person('joiner-b', 'STAFF'),
  /** Client c1's PRIMARY login at firm A. */
  primaryA: person('primary-a', 'CLIENT'),
  /** Client c1's SPOUSE login at firm A. */
  spouseA: person('spouse-a', 'CLIENT'),
};
type Who = (typeof people)[keyof typeof people];
const firms = { a: { id: '', slug: `r6p-a-${run}` }, b: { id: '', slug: `r6p-b-${run}` } };

let app: INestApplication;
let portalOrigin = '';
const activations: ActivationEmail[] = [];
let viewers = 0;
const viewer = () => {
  viewers += 1;
  return `198.18.${Math.floor(viewers / 250) + 100}.${(viewers % 250) + 1}, 10.0.0.5`;
};

const tokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', viewer())
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** A signed-in POST (Bearer: no cookie, no Origin), acting in `businessId` when given. */
async function as(who: Who, path: string, body: object, businessId?: string) {
  const req = request(app.getHttpServer())
    .post(path)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  return (businessId ? req.set('x-business-id', businessId) : req).send(body);
}
const publicPost = (path: string, body: object, origin?: string) => {
  const req = request(app.getHttpServer()).post(path).set('x-forwarded-for', viewer());
  return (origin ? req.set('origin', origin) : req).send(body);
};

/** The staff bell of `who` in `businessId`, through the list route. */
async function staffBell(who: Who, businessId: string) {
  const res = await request(app.getHttpServer())
    .get('/api/v1/business/me/notifications')
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', viewer());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return NotificationList.parse(res.body).items;
}
/** The portal bell of `who` at the firm with `slug`. */
async function portalBell(who: Who, slug: string) {
  const res = await request(app.getHttpServer())
    .get(`/api/v1/portal/${slug}/me/notifications`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', viewer());
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return NotificationList.parse(res.body).items;
}
const about = (items: { target: { kind: string; id: string } }[], id: string) =>
  items.filter((i) => i.target.id === id);

async function asOwner<T>(businessId: string | null, work: (tx: TxClient) => Promise<T>) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(
      owner,
      businessId ? { kind: 'business', businessId } : { kind: 'platform' },
      work,
    );
  } finally {
    await owner.$disconnect();
  }
}
/** Every stored bell item about a record, in any firm (owner client): recipient, firm, payload. */
const stored = (entityId: string) =>
  asOwner(null, (tx) =>
    tx.notification.findMany({
      where: { entityId },
      select: { businessId: true, recipientUserId: true, payload: true, category: true },
    }),
  );

beforeAll(async () => {
  await asOwner(null, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: p.pool, email: p.email, name: p.name },
      });
    }
    for (const f of Object.values(firms)) {
      f.id = (
        await tx.business.create({
          data: { slug: f.slug, name: `Fake ${f.slug}`, status: 'ACTIVE' },
        })
      ).id;
    }
  });
  await asOwner(firms.a.id, async (tx) => {
    const A = { businessId: firms.a.id };
    for (const [who, role] of [
      [people.ownerA, 'OWNER'],
      [people.adminA, 'ADMIN'],
      [people.staffA, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId: who.id, role, status: 'ACTIVE' } });
    }
    const c1 = await tx.client.create({ data: { ...A, displayName: 'A Client (fake)' } });
    for (const [who, portalRole] of [
      [people.primaryA, 'PRIMARY'],
      [people.spouseA, 'SPOUSE'],
    ] as const) {
      await tx.clientAccount.create({
        data: {
          ...A,
          userId: who.id,
          clientId: c1.id,
          email: who.email,
          portalRole,
          status: 'ACTIVE',
        },
      });
    }
    for (const kind of ['TERMS', 'PRIVACY'] as const) {
      await tx.firmLegalDocument.create({
        data: { ...A, kind, version: 1, body: `# ${kind}`, publishedByUserId: people.ownerA.id },
      });
    }
  });
  await asOwner(firms.b.id, async (tx) => {
    const B = { businessId: firms.b.id };
    for (const [who, role] of [
      [people.ownerB, 'OWNER'],
      [people.adminB, 'ADMIN'],
      [people.staffA, 'STAFF'],
      [people.joinerB, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...B, userId: who.id, role, status: 'ACTIVE' } });
    }
  });

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(ACTIVATION_MAILER)
    .useValue({
      send: (mail: ActivationEmail) => (activations.push(mail), Promise.resolve()),
    })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({
      emailCode: () => Promise.resolve(),
      smsCode: () => Promise.resolve(),
      alreadyRegistered: () => Promise.resolve(),
      signUpApproved: () => Promise.resolve(),
      signUpDeclined: () => Promise.resolve(),
    })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({ send: () => Promise.resolve() })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app?.close();
});

/** Invites `email` to firm A as Staff (by firm A's owner) and returns the link's token. */
async function inviteToA(email: string): Promise<{ token: string; membershipId: string }> {
  const res = await as(
    people.ownerA,
    '/api/v1/auth/invites',
    { email, name: 'Invited Person', role: 'STAFF' },
    firms.a.id,
  );
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  const mail = [...activations].reverse().find((m) => m.to === email.toLowerCase());
  const token = mail?.link.split('#token=')[1];
  if (!token) throw new Error('no activation link');
  return { token, membershipId: (res.body as { membershipId: string }).membershipId };
}

describe('staff.joined (R2 invites)', () => {
  it('an activated invite reaches the Owners and Admins only, in that firm only', async () => {
    const email = `r6p-new-${run}@r6p.test`;
    const { token, membershipId } = await inviteToA(email);
    await publicPost('/api/v1/auth/activate', { token, password: 'New-staff-password-1' }).expect(
      200,
    );

    for (const who of [people.ownerA, people.adminA]) {
      const items = about(await staffBell(who, firms.a.id), membershipId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        category: 'ACCOUNT',
        title: 'New team member',
        body: 'Invited Person joined the team.',
        target: { kind: 'membership', id: membershipId, clientId: null },
        readAt: null,
      });
    }
    expect(about(await staffBell(people.staffA, firms.a.id), membershipId)).toEqual([]);
    // Firm B, also its members who work at firm A, never see it.
    for (const who of [people.ownerB, people.adminB, people.staffA]) {
      expect(about(await staffBell(who, firms.b.id), membershipId)).toEqual([]);
    }
    const rows = await stored(membershipId);
    expect(rows.map((r) => [r.businessId, r.recipientUserId]).sort()).toEqual(
      [
        [firms.a.id, people.ownerA.id],
        [firms.a.id, people.adminA.id],
      ].sort(),
    );
    // The record is the membership's id; the payload holds only the name its text shows.
    for (const r of rows) expect(r.payload).toEqual({ name: 'Invited Person', client: null });
  });

  it('an accepted invite reaches firm A Owners and Admins, never the joiner', async () => {
    const { token, membershipId } = await inviteToA(people.joinerB.email);
    const accepted = await as(people.joinerB, '/api/v1/auth/activation/accept', { token });
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(200);

    const rows = await stored(membershipId);
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual(
      [people.ownerA.id, people.adminA.id].sort(),
    );
    expect(rows.every((r) => r.businessId === firms.a.id && r.category === 'ACCOUNT')).toBe(true);
    expect(about(await staffBell(people.joinerB, firms.a.id), membershipId)).toEqual([]);
    expect(about(await staffBell(people.ownerB, firms.b.id), membershipId)).toEqual([]);
  });
});

describe('client.signup-submitted (R3 portal sign-up)', () => {
  it('a completed sign-up reaches the Owners and Admins of that firm only', async () => {
    let cookie = '';
    const signUp = async (path: string, body: object) => {
      const res = await request(app.getHttpServer())
        .post(`/api/v1/portal/${firms.a.slug}/auth/sign-up${path}`)
        .set('x-forwarded-for', '198.18.250.1, 10.0.0.5')
        .set('origin', portalOrigin)
        .set('cookie', cookie)
        .send(body);
      const set = ((res.headers['set-cookie'] as unknown as string[] | undefined) ?? []).find((c) =>
        c.startsWith(`${portalCookies(firms.a.slug).signUp}=`),
      );
      if (set) cookie = set.split(';')[0] ?? cookie;
      expect(res.status, JSON.stringify(res.body)).toBe(200);
      return res;
    };
    const email = `r6p-signup-${run}@example.com`;
    await signUp('', {
      name: 'Jane Signup',
      email,
      phone: '+17705550171',
      password: 'Client-password-1',
      accountType: 'INDIVIDUAL',
      accepted: { termsVersion: 1, privacyVersion: 1 },
    });
    const accountId = (
      await asOwner(firms.a.id, (tx) =>
        tx.clientAccount.findFirstOrThrow({ where: { email }, select: { id: true } }),
      )
    ).id;
    await signUp('/verify-email', { code: '000000' });
    // Not complete yet: nothing in the queue's bell.
    expect(await stored(accountId)).toEqual([]);
    const done = await signUp('/verify-phone', { code: '000000' });
    expect(done.body).toMatchObject({ step: 'DONE' });

    for (const who of [people.ownerA, people.adminA]) {
      const items = about(await staffBell(who, firms.a.id), accountId);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'New client sign-up',
        body: 'Jane Signup is waiting for approval.',
        target: { kind: 'client_account', id: accountId, clientId: null },
      });
    }
    expect(about(await staffBell(people.staffA, firms.a.id), accountId)).toEqual([]);
    expect(about(await staffBell(people.ownerB, firms.b.id), accountId)).toEqual([]);
    const rows = await stored(accountId);
    expect(rows.map((r) => r.recipientUserId).sort()).toEqual(
      [people.ownerA.id, people.adminA.id].sort(),
    );
    // No email or phone: the account's id, and the name the text shows.
    for (const r of rows) expect(r.payload).toEqual({ name: 'Jane Signup', client: null });
  });
});

describe('account.password-changed (R2 and R3 password reset)', () => {
  it('a staff reset reaches the person in each firm they work at, nobody else', async () => {
    await publicPost('/api/v1/auth/reset-password', {
      email: people.staffA.email,
      code: LOCAL_RESET_CODE,
      password: 'Brand-new-password-9',
    }).expect(200);

    const rows = await stored(people.staffA.id);
    expect(rows.map((r) => [r.businessId, r.recipientUserId]).sort()).toEqual(
      [
        [firms.a.id, people.staffA.id],
        [firms.b.id, people.staffA.id],
      ].sort(),
    );
    // The person's own id is the record; staff payloads carry an empty client slot.
    for (const r of rows) expect([r.category, r.payload]).toEqual(['ACCOUNT', { client: null }]);
    for (const businessId of [firms.a.id, firms.b.id]) {
      const items = about(await staffBell(people.staffA, businessId), people.staffA.id);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Password changed',
        target: { kind: 'user', id: people.staffA.id },
      });
    }
    for (const [who, businessId] of [
      [people.ownerA, firms.a.id],
      [people.adminA, firms.a.id],
      [people.ownerB, firms.b.id],
    ] as const) {
      expect(about(await staffBell(who, businessId), people.staffA.id)).toEqual([]);
    }
  });

  it('a wrong code writes nothing', async () => {
    const res = await publicPost('/api/v1/auth/reset-password', {
      email: people.ownerB.email,
      code: '123456',
      password: 'Brand-new-password-9',
    });
    expect(res.status).toBe(400);
    expect(await stored(people.ownerB.id)).toEqual([]);
  });

  it('a portal reset reaches the PRIMARY login on the portal bell; a SPOUSE login gets none', async () => {
    for (const who of [people.primaryA, people.spouseA]) {
      const res: Response = await publicPost(
        `/api/v1/portal/${firms.a.slug}/auth/reset-password`,
        { email: who.email, code: LOCAL_RESET_CODE, password: 'Brand-new-password-9' },
        portalOrigin,
      );
      expect(res.status, JSON.stringify(res.body)).toBe(200);
    }
    const rows = await stored(people.primaryA.id);
    expect(rows.map((r) => [r.businessId, r.recipientUserId, r.payload])).toEqual([
      [firms.a.id, people.primaryA.id, {}],
    ]);
    const items = about(await portalBell(people.primaryA, firms.a.slug), people.primaryA.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      category: 'ACCOUNT',
      title: 'Password changed',
      target: { kind: 'user', id: people.primaryA.id, clientId: null },
    });
    expect(await stored(people.spouseA.id)).toEqual([]);
    // Firm B's portal: the client has no login there (404), and nothing was written there.
    const other = await request(app.getHttpServer())
      .get(`/api/v1/portal/${firms.b.slug}/me/notifications`)
      .set('authorization', `Bearer ${await tokenFor(people.primaryA.email)}`)
      .set('x-forwarded-for', viewer());
    expect(other.status).toBe(404);
  });
});
