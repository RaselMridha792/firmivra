// End-to-end: staff invites and activation (R2 step 6) in AUTH_MODE=local. Contract:
// docs/api/auth.yaml. The ActivationMailer is replaced by an outbox the tests read.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { HttpException, type INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, databaseErrorCode, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type {
  ActivationCheckResponse,
  IdentityPool,
  InviteResponse,
  MeResponse,
  MfaSetupResponse,
  SignInResult,
} from '@firmivra/types';
import { ACTIVATION_MAILER, type ActivationEmail } from '../../src/auth/activation-mailer.js';
import { IDENTITY_PROVIDER } from '../../src/auth/identity/identity-provider.js';
import {
  LOCAL_MFA_CODE,
  LocalIdentityProvider,
} from '../../src/auth/identity/local-identity.provider.js';
import { INVITE_LIMITS, InvitesService } from '../../src/auth/invites.service.js';
import { TokenService } from '../../src/auth/token.service.js';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let env: Env;
const outbox: ActivationEmail[] = [];

/**
 * The local stand-in with a gate: `holdNextSetPassword()` keeps the next password change waiting
 * until released, which opens the window a slow Cognito call would (#41 review races).
 */
class GatedIdentity extends LocalIdentityProvider {
  private gate?: { entered: () => void; released: Promise<void> };

  holdNextSetPassword() {
    let entered!: () => void;
    let release!: () => void;
    const reached = new Promise<void>((resolve) => (entered = resolve));
    this.gate = { entered, released: new Promise<void>((resolve) => (release = resolve)) };
    return { reached, release };
  }

  override async setPassword(pool: IdentityPool, sub: string, password: string): Promise<void> {
    const gate = this.gate;
    this.gate = undefined;
    if (gate) {
      gate.entered();
      await gate.released;
    }
    return super.setPassword(pool, sub, password);
  }
}
let identity: GatedIdentity;
const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** People of this file only: invites change memberships, so shared fixtures stay untouched. */
const people = {
  adminA: { id: randomUUID(), email: `r2-inv-admin-${randomUUID()}@a.test` },
  formerA: { id: randomUUID(), email: `r2-inv-former-${randomUUID()}@a.test` },
  staffOfB: { id: randomUUID(), email: `r2-inv-elsewhere-${randomUUID()}@b.test` },
  setupOwner: { id: randomUUID(), email: `r2-inv-setup-${randomUUID()}@c.test` },
  laterOwner: { id: randomUUID(), email: `r2-inv-later-${randomUUID()}@d.test` },
  cappedOwner: { id: randomUUID(), email: `r2-inv-capped-${randomUUID()}@e.test` },
};
/** Firms of this file: one in setup, one suspended later, one for the per-firm cap. */
const firms = {
  setup: { id: '', status: 'PENDING_SETUP' as const, owner: people.setupOwner },
  later: { id: '', status: 'ACTIVE' as const, owner: people.laterOwner },
  capped: { id: '', status: 'ACTIVE' as const, owner: people.cappedOwner },
};

let lastViewer = 0;
const newViewer = () => `198.51.100.${++lastViewer}`;

/** One dev token per person (they last an hour): the dev route allows 30 a minute per IP. */
const devTokens = new Map<string, string>();
async function tokenFor(email: string): Promise<string> {
  const cached = devTokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const { token } = res.body as { token: string };
  devTokens.set(email, token);
  return token;
}

/** A signed-in call (Bearer, so no cookie and no Origin needed), acting in `businessId`. */
async function as(email: string, path: string, body: object, businessId?: string) {
  const token = await tokenFor(email);
  const req = request(app.getHttpServer())
    .post(path)
    .set('authorization', `Bearer ${token}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return (businessId ? req.set('x-business-id', businessId) : req).send(body);
}

const publicPost = (path: string, body: object, viewer = newViewer()) =>
  request(app.getHttpServer()).post(path).set('x-forwarded-for', `${viewer}, 10.0.0.5`).send(body);

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const invite = (email: string, role: 'ADMIN' | 'STAFF', by = fx.users.ownerA.email) =>
  as(by, '/api/v1/auth/invites', { email, name: 'Invited Person', role }, fx.firmA.id);

/** The token from the last activation email to `email`, read from the link's fragment. */
function tokenSentTo(email: string): string {
  const mail = [...outbox].reverse().find((m) => m.to === email.toLowerCase());
  if (!mail) throw new Error(`no activation email to ${email}`);
  const [, token] = mail.link.split('#token=');
  if (!token) throw new Error('no token in the link');
  return token;
}

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: 'Real Name' },
      });
    }
  });
  for (const firm of Object.values(firms)) {
    const slug = `r2-inv-${randomUUID().slice(0, 8)}`;
    firm.id = (
      await asOwner({ kind: 'platform' }, (tx) =>
        tx.business.create({ data: { slug, name: slug, status: firm.status } }),
      )
    ).id;
  }
  for (const [businessId, userId, role, status] of [
    [fx.firmA.id, people.adminA.id, 'ADMIN', 'ACTIVE'],
    [fx.firmA.id, people.formerA.id, 'STAFF', 'DEACTIVATED'],
    [fx.firmB.id, people.staffOfB.id, 'STAFF', 'ACTIVE'],
    ...Object.values(firms).map((f) => [f.id, f.owner.id, 'OWNER', 'ACTIVE'] as const),
  ] as const) {
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status } }),
    );
  }

  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(IDENTITY_PROVIDER)
    .useFactory({
      factory: (tokens: TokenService) => (identity = new GatedIdentity(tokens)),
      inject: [TokenService],
    })
    .overrideProvider(ACTIVATION_MAILER)
    .useValue({
      send: (mail: ActivationEmail) => {
        outbox.push(mail);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.init();
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('invite and activate a new person', () => {
  it('invites, activates, sets up MFA and signs in with an ACTIVE membership', async () => {
    const email = `R2-New-${randomUUID()}@A.test`;
    const res = await invite(email, 'STAFF');
    expect(res.status).toBe(201);
    const body = res.body as InviteResponse;
    expect(body).toMatchObject({
      email: email.toLowerCase(),
      name: 'Invited Person',
      role: 'STAFF',
    });
    const days = (Date.parse(body.expiresAt) - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.9);
    expect(days).toBeLessThanOrEqual(7);

    const mail = outbox.at(-1);
    expect(
      mail?.link.startsWith(`${new URL('/activate', env.APP_BASE_URL).toString()}#token=`),
    ).toBe(true);
    expect(mail?.link).not.toContain('?');
    const token = tokenSentTo(email);

    const check = await publicPost('/api/v1/auth/activation/check', { token }).expect(200);
    expect(check.body as ActivationCheckResponse).toMatchObject({
      email: email.toLowerCase(),
      role: 'STAFF',
      business: { id: fx.firmA.id },
      hasAccount: false,
    });

    const viewer = newViewer();
    const activated = await publicPost(
      '/api/v1/auth/activate',
      { token, password: 'New-staff-password-1', name: 'Chosen Name' },
      viewer,
    ).expect(200);
    const step = activated.body as SignInResult;
    expect(step.status).toBe('MFA_SETUP_REQUIRED');
    if (step.status !== 'MFA_SETUP_REQUIRED') throw new Error('unreachable');
    const setup = await publicPost('/api/v1/auth/mfa/setup', { session: step.session }, viewer);
    const done = await publicPost(
      '/api/v1/auth/mfa',
      { session: (setup.body as MfaSetupResponse).session, code: LOCAL_MFA_CODE },
      viewer,
    ).expect(200);
    const signedIn = done.body as SignInResult;
    if (signedIn.status !== 'SIGNED_IN') throw new Error(`unexpected ${signedIn.status}`);
    expect(signedIn.me.user.name).toBe('Chosen Name');
    expect(signedIn.me.memberships.map((m) => [m.business.id, m.role, m.status])).toEqual([
      [fx.firmA.id, 'STAFF', 'ACTIVE'],
    ]);

    // One use only.
    expect(codeOf(await publicPost('/api/v1/auth/activation/check', { token }))).toBe(
      'INVITE_INVALID',
    );
    expect(
      codeOf(
        await publicPost('/api/v1/auth/activate', { token, password: 'New-staff-password-2' }),
      ),
    ).toBe('INVITE_INVALID');

    // Both steps are audited in firm A, by the inviter and by the new person; the metadata holds
    // ids only, never the token or the address.
    const rows = await asOwner({ kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: body.membershipId },
        select: { action: true, businessId: true, actorUserId: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(rows).toEqual([
      {
        action: 'membership.invited',
        businessId: fx.firmA.id,
        actorUserId: fx.users.ownerA.id,
        metadata: { inviteId: body.id, role: 'STAFF', resent: false },
      },
      {
        action: 'membership.activated',
        businessId: fx.firmA.id,
        actorUserId: signedIn.me.user.id,
        metadata: { inviteId: body.id, via: 'activate' },
      },
    ]);
    const stored = JSON.stringify(rows);
    expect(stored).not.toContain(token);
    expect(stored).not.toContain(email.toLowerCase());
  });

  it('refuses an unknown token, and an expired link with 410', async () => {
    expect(
      codeOf(await publicPost('/api/v1/auth/activation/check', { token: 'x'.repeat(43) })),
    ).toBe('INVITE_INVALID');

    // R0's trigger never lets an invite's dates change, so the expired link is inserted as such.
    const late = { id: randomUUID(), email: `r2-late-${randomUUID()}@a.test` };
    const token = randomBytes(32).toString('base64url');
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: { id: late.id, cognitoSub: late.id, pool: 'STAFF', email: late.email, name: 'Late' },
      }),
    );
    await asOwner({ kind: 'business', businessId: fx.firmA.id }, async (tx) => {
      const membership = await tx.membership.create({
        data: { businessId: fx.firmA.id, userId: late.id, role: 'STAFF', status: 'INVITED' },
      });
      await tx.invite.create({
        data: {
          businessId: fx.firmA.id,
          membershipId: membership.id,
          tokenHash: createHash('sha256').update(token).digest('hex'),
          name: 'Late',
          email: late.email,
          createdAt: new Date(Date.now() - 8 * 86_400_000),
          expiresAt: new Date(Date.now() - 86_400_000),
          invitedByUserId: fx.users.ownerA.id,
        },
      });
    });
    const res = await publicPost('/api/v1/auth/activation/check', { token });
    expect([res.status, codeOf(res)]).toEqual([410, 'INVITE_EXPIRED']);
    const activate = await publicPost('/api/v1/auth/activate', {
      token,
      password: 'Late-password-12',
    });
    expect([activate.status, codeOf(activate)]).toEqual([410, 'INVITE_EXPIRED']);
  });
});

describe('who may invite', () => {
  it('owner: admins and staff; admin: staff only; nobody else; never an owner', async () => {
    expect((await invite(`r2-o-a-${randomUUID()}@a.test`, 'ADMIN')).status).toBe(201);
    expect(
      (await invite(`r2-a-s-${randomUUID()}@a.test`, 'STAFF', people.adminA.email)).status,
    ).toBe(201);

    const adminAdmin = await invite(`r2-a-a-${randomUUID()}@a.test`, 'ADMIN', people.adminA.email);
    expect([adminAdmin.status, codeOf(adminAdmin)]).toEqual([403, 'FORBIDDEN']);
    for (const by of [fx.users.staffA.email, fx.users.clientA.email]) {
      expect((await invite(`r2-no-${randomUUID()}@a.test`, 'STAFF', by)).status).toBe(403);
    }
    // Another firm's owner learns nothing about firm A.
    expect(
      (await invite(`r2-out-${randomUUID()}@a.test`, 'STAFF', fx.users.ownerB.email)).status,
    ).toBe(404);
    const owner = await as(
      fx.users.ownerA.email,
      '/api/v1/auth/invites',
      { email: `r2-own-${randomUUID()}@a.test`, name: 'X', role: 'OWNER' },
      fx.firmA.id,
    );
    expect([owner.status, codeOf(owner)]).toEqual([400, 'VALIDATION_FAILED']);
  });
});

describe('invite again', () => {
  it('refuses an active member of the firm with 409 ALREADY_MEMBER', async () => {
    const res = await invite(fx.users.staffA.email, 'STAFF');
    expect([res.status, codeOf(res)]).toEqual([409, 'ALREADY_MEMBER']);
  });

  it('resends an open invite: a new link, and the old one stops working', async () => {
    const email = `r2-again-${randomUUID()}@a.test`;
    const first = (await invite(email, 'STAFF')).body as InviteResponse;
    const oldToken = tokenSentTo(email);
    const second = (await invite(email, 'STAFF')).body as InviteResponse;
    expect(second.membershipId).toBe(first.membershipId);
    expect(second.id).not.toBe(first.id);
    expect(codeOf(await publicPost('/api/v1/auth/activation/check', { token: oldToken }))).toBe(
      'INVITE_INVALID',
    );
    await publicPost('/api/v1/auth/activation/check', { token: tokenSentTo(email) }).expect(200);
  });

  it('two invites for the same new person at once give one person, one membership', async () => {
    const email = `r2-twice-${randomUUID()}@a.test`;
    const [a, b] = await Promise.all([invite(email, 'STAFF'), invite(email, 'STAFF')]);
    expect([a.status, b.status]).toEqual([201, 201]);
    expect((a.body as InviteResponse).membershipId).toBe((b.body as InviteResponse).membershipId);
    const counts = await asOwner({ kind: 'platform' }, async (tx) => ({
      users: await tx.user.count({ where: { email, pool: 'STAFF' } }),
    }));
    expect(counts.users).toBe(1);
  });

  it('InvitesService.resendInvite (Team API) needs an open invite', async () => {
    const service = app.get(InvitesService);
    const { membershipId } = (await invite(`r2-resend-${randomUUID()}@a.test`, 'STAFF'))
      .body as InviteResponse;
    const ownerA = { userId: fx.users.ownerA.id, role: 'OWNER' as const };
    await expect(
      service.resendInvite({ businessId: fx.firmA.id, membershipId, invitedBy: ownerA }),
    ).resolves.toMatchObject({ membershipId });
    const active = await asOwner({ kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.membership.findFirstOrThrow({
        where: { userId: fx.users.staffA.id },
        select: { id: true },
      }),
    );
    await expect(
      service.resendInvite({ businessId: fx.firmA.id, membershipId: active.id, invitedBy: ownerA }),
    ).rejects.toMatchObject({ response: { code: 'NOT_INVITED' } });
  });

  it('invites a deactivated member again', async () => {
    const res = await invite(people.formerA.email, 'STAFF');
    expect(res.status).toBe(201);
    const membership = await asOwner({ kind: 'business', businessId: fx.firmA.id }, (tx) =>
      tx.membership.findFirstOrThrow({
        where: { userId: people.formerA.id },
        select: { status: true },
      }),
    );
    expect(membership.status).toBe('INVITED');
  });
});

describe('someone who already works at another firm', () => {
  it('gets the same invite answer, cannot reset their password, and joins by signing in', async () => {
    const res = await invite(people.staffOfB.email.toUpperCase(), 'STAFF');
    expect(res.status).toBe(201);
    const body = res.body as InviteResponse;
    // Same shape and values as for a new person: the given name, not their real one.
    expect(Object.keys(body).sort()).toEqual(
      ['email', 'expiresAt', 'id', 'membershipId', 'name', 'role'].sort(),
    );
    expect(body).toMatchObject({ email: people.staffOfB.email, name: 'Invited Person' });

    const token = tokenSentTo(people.staffOfB.email);
    const check = await publicPost('/api/v1/auth/activation/check', { token }).expect(200);
    expect((check.body as ActivationCheckResponse).hasAccount).toBe(true);

    // An invite token must never set a new password on an existing login.
    const activate = await publicPost('/api/v1/auth/activate', {
      token,
      password: 'Take-over-pass-1',
    });
    expect([activate.status, codeOf(activate)]).toEqual([409, 'ACCOUNT_EXISTS']);

    // Only the invited person can accept, signed in: not another staff member, not a client,
    // and never a Super Admin session (it does not work on the firm site at all).
    for (const other of [fx.users.staffA.email, fx.users.clientA.email]) {
      const wrong = await as(other, '/api/v1/auth/activation/accept', { token });
      expect([other, wrong.status, codeOf(wrong)]).toEqual([other, 404, 'INVITE_INVALID']);
    }
    const admin = await as(fx.users.admin.email, '/api/v1/auth/activation/accept', { token });
    expect(admin.status).toBe(401);
    expect((await publicPost('/api/v1/auth/activation/accept', { token })).status).toBe(401);

    const accepted = await as(people.staffOfB.email, '/api/v1/auth/activation/accept', { token });
    expect(accepted.status).toBe(200);
    const me = accepted.body as MeResponse;
    expect(me.memberships.map((m) => [m.business.id, m.status]).sort()).toEqual(
      [
        [fx.firmA.id, 'ACTIVE'],
        [fx.firmB.id, 'ACTIVE'],
      ].sort(),
    );
    expect(
      codeOf(await as(people.staffOfB.email, '/api/v1/auth/activation/accept', { token })),
    ).toBe('INVITE_INVALID');
  });
});

describe('a link is used once, even under races (#41 review)', () => {
  /** Sends at once (supertest sends only when awaited) and gives back the answer later. */
  const start = (path: string, body: object) => publicPost(path, body).then((res) => res);
  const signInWith = (email: string, password: string) =>
    publicPost('/api/v1/auth/sign-in', { email, password });

  it('two activations at once: one sets the password, the other changes nothing', async () => {
    const email = `r2-race-${randomUUID()}@a.test`;
    await invite(email, 'STAFF');
    const token = tokenSentTo(email);

    const gate = identity.holdNextSetPassword();
    const first = start('/api/v1/auth/activate', { token, password: 'First-password-12' });
    await gate.reached; // the first request holds the link and waits in Cognito
    const second = start('/api/v1/auth/activate', { token, password: 'Second-password-1' });
    await pause(300); // the second is now waiting for the link
    gate.release();

    const [a, b] = await Promise.all([first, second]);
    expect(a.status).toBe(200);
    expect([404, 409]).toContain(b.status);
    expect((await signInWith(email, 'First-password-12')).status).toBe(200);
    const loser = await signInWith(email, 'Second-password-1');
    expect([loser.status, codeOf(loser)]).toEqual([401, 'INVALID_CREDENTIALS']);
  });

  it('a resend during an activation never flips the new member back to INVITED', async () => {
    const email = `r2-resend-race-${randomUUID()}@a.test`;
    const { membershipId } = (await invite(email, 'STAFF')).body as InviteResponse;
    const token = tokenSentTo(email);
    const sent = outbox.length;

    const gate = identity.holdNextSetPassword();
    const activation = start('/api/v1/auth/activate', {
      token,
      password: 'Racing-password-1',
    });
    await gate.reached;
    const resend = invite(email, 'STAFF');
    await pause(300);
    gate.release();

    const [activated, resent] = await Promise.all([activation, resend]);
    expect(activated.status).toBe(200);
    expect([resent.status, codeOf(resent)]).toEqual([409, 'ALREADY_MEMBER']);
    expect(outbox.length).toBe(sent); // no new link went out
    const state = await asOwner({ kind: 'business', businessId: fx.firmA.id }, async (tx) => ({
      membership: await tx.membership.findUniqueOrThrow({
        where: { id: membershipId },
        select: { status: true },
      }),
      openInvites: await tx.invite.count({
        where: { membershipId, acceptedAt: null, revokedAt: null },
      }),
    }));
    expect(state).toEqual({ membership: { status: 'ACTIVE' }, openInvites: 0 });
  });

  it('a resend that wins first leaves the old link unable to set a password', async () => {
    const email = `r2-resend-first-${randomUUID()}@a.test`;
    await invite(email, 'STAFF');
    const oldToken = tokenSentTo(email);
    await invite(email, 'STAFF');
    const res = await publicPost('/api/v1/auth/activate', {
      token: oldToken,
      password: 'Old-link-password-1',
    });
    expect([res.status, codeOf(res)]).toEqual([404, 'INVITE_INVALID']);
    expect((await signInWith(email, 'Old-link-password-1')).status).toBe(401);
  });
});

describe('firm status (#41 review)', () => {
  it("lets a firm in setup invite its team (the wizard's Team and access step)", async () => {
    const res = await as(
      people.setupOwner.email,
      '/api/v1/auth/invites',
      { email: `r2-setup-team-${randomUUID()}@c.test`, name: 'Setup Staff', role: 'ADMIN' },
      firms.setup.id,
    );
    expect(res.status).toBe(201);
  });

  it('refuses invites into a suspended or closed firm, also without the route guard', async () => {
    const service = app.get(InvitesService);
    await expect(
      service.createInvite({
        businessId: fx.suspended.id,
        email: `r2-into-suspended-${randomUUID()}@s.test`,
        name: 'Nobody',
        role: 'OWNER',
        invitedBy: null,
      }),
    ).rejects.toMatchObject({ response: { code: 'BUSINESS_INACTIVE' } });
  });

  it('refuses activation once the firm is suspended', async () => {
    const email = `r2-later-${randomUUID()}@d.test`;
    const res = await as(
      people.laterOwner.email,
      '/api/v1/auth/invites',
      { email, name: 'Later Staff', role: 'STAFF' },
      firms.later.id,
    );
    expect(res.status).toBe(201);
    const token = tokenSentTo(email);
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.business.update({ where: { id: firms.later.id }, data: { status: 'SUSPENDED' } }),
    );
    for (const path of ['/api/v1/auth/activation/check', '/api/v1/auth/activate']) {
      const r = await publicPost(path, { token, password: 'Later-password-12' });
      expect([path, r.status, codeOf(r)]).toEqual([path, 404, 'INVITE_INVALID']);
    }
  });
});

describe('invite caps, counted in the database (#41 review)', () => {
  it('sends one person at most INVITE_LIMITS.perPerson links a day', async () => {
    const email = `r2-many-${randomUUID()}@a.test`;
    for (let i = 0; i < INVITE_LIMITS.perPerson; i++) {
      expect((await invite(email, 'STAFF')).status).toBe(201);
    }
    const capped = await invite(email, 'STAFF');
    expect([capped.status, codeOf(capped)]).toEqual([429, 'RATE_LIMITED']);
  });

  it('sends at most INVITE_LIMITS.perFirm links a day per firm, before creating any login', async () => {
    const limit = INVITE_LIMITS.perFirm;
    INVITE_LIMITS.perFirm = 2;
    try {
      const send = (email: string) =>
        as(
          people.cappedOwner.email,
          '/api/v1/auth/invites',
          { email, name: 'Capped Staff', role: 'STAFF' },
          firms.capped.id,
        );
      for (const n of [1, 2]) {
        expect((await send(`r2-capped-${n}-${randomUUID()}@e.test`)).status).toBe(201);
      }
      const third = `r2-capped-3-${randomUUID()}@e.test`;
      const res = await send(third);
      expect([res.status, codeOf(res)]).toEqual([429, 'RATE_LIMITED']);
      const users = await asOwner({ kind: 'platform' }, (tx) =>
        tx.user.count({ where: { email: third } }),
      );
      expect(users).toBe(0);
    } finally {
      INVITE_LIMITS.perFirm = limit;
    }
  });
});

describe('resend, deactivation and activation races, and the typed details (#57 review)', () => {
  // The owner client reads and holds rows; the app-role client deactivates as the API would.
  let ownerDb: ReturnType<typeof createPrismaClient>;
  let appDb: ReturnType<typeof createPrismaClient>;
  let service: InvitesService;
  beforeAll(() => {
    ownerDb = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
    appDb = createPrismaClient(fx.appUrl, TEST_CLIENT_OPTIONS);
    service = app.get(InvitesService);
  });
  afterAll(async () => {
    await Promise.all([ownerDb.$disconnect(), appDb.$disconnect()]);
  });

  const inFirm = <T>(businessId: string, work: (tx: TxClient) => Promise<T>) =>
    runInScope(ownerDb, { kind: 'business', businessId }, work);

  /** A staff login that already exists (for example at another firm), under `name`. */
  async function newPerson(label: string, name: string) {
    const person = { id: randomUUID(), email: `r2-${label}-${randomUUID()}@race.test` };
    await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.user.create({ data: { ...person, cognitoSub: person.id, pool: 'STAFF', name } }),
    );
    return person;
  }

  /** A firm of its own with an active owner: each race sends up to INVITE_LIMITS.perFirm links. */
  async function newFirm(label: string) {
    const owner = await newPerson(`${label}-owner`, 'Race Owner');
    const slug = `r2-${label}-${randomUUID().slice(0, 8)}`;
    const { id } = await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug, name: slug, status: 'ACTIVE' }, select: { id: true } }),
    );
    await inFirm(id, (tx) =>
      tx.membership.create({
        data: { businessId: id, userId: owner.id, role: 'OWNER', status: 'ACTIVE' },
      }),
    );
    return { id, ownerEmail: owner.email, owner: { userId: owner.id, role: 'OWNER' as const } };
  }

  const settle = <T>(work: Promise<T>): Promise<PromiseSettledResult<T>> =>
    work.then(
      (value) => ({ status: 'fulfilled' as const, value }),
      (reason: unknown) => ({ status: 'rejected' as const, reason }),
    );

  /** What the API answers for a settled call: '200', '409 NOT_INVITED', or '500' and the cause. */
  function answer(result: PromiseSettledResult<unknown>): string {
    if (result.status === 'fulfilled') return '200';
    const e: unknown = result.reason;
    if (e instanceof HttpException && e.getStatus() < 500) {
      return `${e.getStatus()} ${(e.getResponse() as { code?: string }).code ?? ''}`;
    }
    return `500 ${databaseErrorCode(e) ?? (e as { code?: string }).code ?? String(e)}`;
  }

  /** The membership's status and how many of its links are still open. */
  const stateOf = (businessId: string, membershipId: string) =>
    inFirm(businessId, async (tx) => ({
      status: (
        await tx.membership.findUniqueOrThrow({
          where: { id: membershipId },
          select: { status: true },
        })
      ).status,
      open: await tx.invite.count({ where: { membershipId, acceptedAt: null, revokedAt: null } }),
    }));

  /** Whether a link still opens the activation screen. */
  async function opens(token: string): Promise<boolean> {
    try {
      await service.check(token);
      return true;
    } catch {
      return false;
    }
  }

  /** How many of the links emailed to `email` still work. */
  async function workingLinks(email: string): Promise<number> {
    const tokens = outbox.filter((m) => m.to === email).map((m) => m.link.split('#token=')[1]);
    return (await Promise.all(tokens.map((token) => opens(token ?? '')))).filter(Boolean).length;
  }

  /**
   * A deactivation straight in the database as the API's role (the Team API is not on main):
   * the membership only, or as the Team API does it, its open links first.
   */
  const deactivate = (businessId: string, membershipId: string, linksFirst: boolean) =>
    runInScope(appDb, { kind: 'business', businessId }, async (tx) => {
      if (linksFirst) {
        await tx.$executeRaw`UPDATE invites SET revoked_at = now() WHERE membership_id =
          ${membershipId}::uuid AND accepted_at IS NULL AND revoked_at IS NULL`;
      }
      await tx.$executeRaw`UPDATE memberships SET status = 'DEACTIVATED'
        WHERE id = ${membershipId}::uuid`;
    });

  /**
   * A transaction in the firm that takes what `take` locks, so the next one to want it waits.
   * `waiting(n)` resolves once n backends wait on the holder, directly or behind each other;
   * `release(work)` runs `work` in the holder's transaction, then commits.
   */
  async function hold(businessId: string, take: (tx: TxClient) => Promise<void>) {
    type Work = ((tx: TxClient) => Promise<unknown>) | undefined;
    let release!: (work: Work) => void;
    const released = new Promise<Work>((resolve) => (release = resolve));
    let holding!: (pid: number) => void;
    const pid = new Promise<number>((resolve) => (holding = resolve));
    const done = inFirm(businessId, async (tx) => {
      await take(tx);
      const [row] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      if (!row) throw new Error('no backend');
      holding(row.pid);
      const work = await released;
      await work?.(tx);
    });
    const holder = await Promise.race([pid, done.then(() => Promise.reject(new Error('ended')))]);
    const waiting = async (n: number) => {
      for (const until = Date.now() + 10_000; Date.now() < until; await pause(10)) {
        const [row] = await ownerDb.$queryRaw<{ n: number }[]>`
          WITH RECURSIVE waiting(pid) AS (
            SELECT pid FROM pg_stat_activity WHERE ${holder}::int = ANY(pg_blocking_pids(pid))
            UNION
            SELECT a.pid FROM pg_stat_activity a JOIN waiting w ON w.pid = ANY(pg_blocking_pids(a.pid))
          )
          SELECT count(*)::int AS n FROM waiting`;
        if ((row?.n ?? 0) >= n) return;
      }
      throw new Error(`fewer than ${n} waiting for the holder`);
    };
    return {
      waiting,
      release: (work?: (tx: TxClient) => Promise<unknown>) => {
        release(work);
        return done;
      },
    };
  }

  /** Holds the membership row as an update would, so the next writer of it waits. */
  const holdMembership = (businessId: string, membershipId: string) =>
    hold(businessId, async (tx) => {
      const rows = await tx.$queryRaw<unknown[]>`SELECT 1 FROM memberships
        WHERE id = ${membershipId}::uuid FOR NO KEY UPDATE`;
      if (rows.length !== 1) throw new Error('no membership to hold');
    });

  /** Holds InvitesService's lock on invites to this person at this firm (its key). */
  const holdInviteLock = (businessId: string, userId: string) =>
    hold(businessId, async (tx) => {
      const key = `staff-invite:${businessId}:${userId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
    });

  /** An invite made before #52: no typed name or email, as R2's code wrote them then. */
  const legacyInvite = (
    firm: { id: string; owner: { userId: string } },
    person: { id: string },
    role: 'ADMIN' | 'STAFF' = 'STAFF',
  ) =>
    inFirm(firm.id, async (tx) => {
      const { id } = await tx.membership.create({
        data: { businessId: firm.id, userId: person.id, role, status: 'INVITED' },
      });
      await tx.invite.create({
        data: {
          businessId: firm.id,
          membershipId: id,
          tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
          expiresAt: new Date(Date.now() + 86_400_000),
          invitedByUserId: firm.owner.userId,
        },
      });
      return id;
    });

  it('a resend never re-invites a member deactivated first: 200 or 409 NOT_INVITED, never 500', async () => {
    const firm = await newFirm('rd');
    const failures: string[] = [];
    for (let round = 0; round < 20; round++) {
      const email = `r2-rd-${round}-${randomUUID()}@race.test`;
      const { membershipId } = await service.createInvite({
        businessId: firm.id,
        email,
        name: 'Race Invitee',
        role: 'STAFF',
        invitedBy: firm.owner,
      });
      const [resent, deactivated] = await Promise.all([
        settle(service.resendInvite({ businessId: firm.id, membershipId, invitedBy: firm.owner })),
        // 0 to 108 ms later, so it lands at different points of the resend (or after it); the
        // second half of the rounds deactivates as the Team API does, the open links first.
        settle(pause((round % 10) * 12).then(() => deactivate(firm.id, membershipId, round >= 10))),
      ]);
      const said = answer(resent);
      const { status } = await stateOf(firm.id, membershipId);
      const working = await workingLinks(email);
      if (
        !['200', '409 NOT_INVITED'].includes(said) ||
        deactivated.status === 'rejected' ||
        status !== 'DEACTIVATED' ||
        working > 0
      ) {
        failures.push(
          `round ${round}: resend ${said}, deactivate ${answer(deactivated)}, ` +
            `member ${status}, ${working} working link(s)`,
        );
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('a re-invite and an activation of the same membership never deadlock, whoever is first', async () => {
    const firm = await newFirm('lock');
    const failures: string[] = [];
    const winners = new Set<string>();
    for (let round = 0; round < 16; round++) {
      const reinviteFirst = round % 2 === 0;
      const viaResend = round % 4 >= 2;
      const hasLogin = round % 8 >= 4; // accepts with an existing login, else activates
      const person = hasLogin
        ? await newPerson('lock', 'Lock Person')
        : { id: '', email: `r2-lock-${round}-${randomUUID()}@race.test` };
      const invite = () =>
        service.createInvite({
          businessId: firm.id,
          email: person.email,
          name: 'Lock Invitee',
          role: 'STAFF',
          invitedBy: firm.owner,
        });
      const { membershipId } = await invite();
      const token = tokenSentTo(person.email);
      const reinvite = (): Promise<unknown> =>
        viaResend
          ? service.resendInvite({ businessId: firm.id, membershipId, invitedBy: firm.owner })
          : invite();
      const join = (): Promise<unknown> =>
        hasLogin
          ? service.accept(token, { userId: person.id, cognitoSub: person.id, pool: 'STAFF' })
          : service.activate(token, 'Lock-race-password-1');

      // The first one waits for the held membership (holding the link if it took it), then the
      // second comes for the same rows. Had a re-invite taken the membership before the links,
      // it would deadlock with an activation here.
      const hold = await holdMembership(firm.id, membershipId);
      const first = settle(reinviteFirst ? reinvite() : join());
      await hold.waiting(1);
      const second = settle(reinviteFirst ? join() : reinvite());
      await hold.waiting(2);
      await hold.release();
      const [r, j] = reinviteFirst ? [await first, await second] : [await second, await first];
      const said = { reinvite: answer(r), join: answer(j) };
      const state = await stateOf(firm.id, membershipId);
      const refused = viaResend ? '409 NOT_INVITED' : '409 ALREADY_MEMBER';
      if (said.join === '200' && said.reinvite === refused && state.status === 'ACTIVE') {
        winners.add(`joined, ${state.open} open`);
      } else if (said.reinvite === '200' && said.join === '404 INVITE_INVALID') {
        winners.add(`re-invited: ${state.status}, ${state.open} open`);
      } else {
        failures.push(
          `round ${round} (${reinviteFirst ? 're-invite' : 'join'} first, ` +
            `${viaResend ? 'resend' : 'invite again'}, ${hasLogin ? 'accept' : 'activate'}): ` +
            `re-invite ${said.reinvite}, join ${said.join}, member ${state.status}`,
        );
      }
    }
    expect(failures).toEqual([]);
    expect([...winners].sort()).toEqual(['joined, 0 open', 're-invited: INVITED, 1 open']);
  }, 60_000);

  it('two resends at once both answer, and only one link works', async () => {
    const firm = await newFirm('twice');
    const failures: string[] = [];
    for (let round = 0; round < 10; round++) {
      const email = `r2-twice-${round}-${randomUUID()}@race.test`;
      const { membershipId } = await service.createInvite({
        businessId: firm.id,
        email,
        name: 'Twice Invitee',
        role: 'STAFF',
        invitedBy: firm.owner,
      });
      const resend = () =>
        settle(service.resendInvite({ businessId: firm.id, membershipId, invitedBy: firm.owner }));
      const said = (await Promise.all([resend(), resend()])).map(answer).join(' and ');
      const { open } = await stateOf(firm.id, membershipId);
      const working = await workingLinks(email);
      if (said !== '200 and 200' || open !== 1 || working !== 1) {
        failures.push(`round ${round}: ${said}, ${open} open, ${working} working link(s)`);
      }
    }
    expect(failures).toEqual([]);
  }, 60_000);

  it('a resend that waited for a re-invite keeps what the re-invite set: role and typed name', async () => {
    const firm = await newFirm('stale');
    const rounds: unknown[] = [];
    for (const before52 of [false, true]) {
      // Already staff at another firm. Invited as an admin under a misspelt name, or before #52
      // (no typed details, so a resend falls back to the user row).
      const person = await newPerson('stale', 'Name At Another Firm');
      const membershipId = before52
        ? await legacyInvite(firm, person, 'ADMIN')
        : (
            await service.createInvite({
              businessId: firm.id,
              email: person.email,
              name: 'Old Typo Nmae',
              role: 'ADMIN',
              invitedBy: firm.owner,
            })
          ).membershipId;
      // Another owner invites them again as staff, the name corrected, as createInvite does it
      // and under its lock: the resend has read the membership by then, and waits for the lock.
      const reinvite = await holdInviteLock(firm.id, person.id);
      const resend = settle(
        service.resendInvite({ businessId: firm.id, membershipId, invitedBy: firm.owner }),
      );
      await reinvite.waiting(1);
      await reinvite.release(async (tx) => {
        await tx.invite.updateMany({
          where: { membershipId, acceptedAt: null, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        await tx.membership.update({ where: { id: membershipId }, data: { role: 'STAFF' } });
        await tx.invite.create({
          data: {
            businessId: firm.id,
            membershipId,
            tokenHash: createHash('sha256').update(randomBytes(32)).digest('hex'),
            name: 'Fixed Name',
            email: person.email,
            expiresAt: new Date(Date.now() + 86_400_000),
            invitedByUserId: firm.owner.userId,
          },
        });
      });
      const said = await resend;
      const after = await inFirm(firm.id, async (tx) => ({
        member: await tx.membership.findUniqueOrThrow({
          where: { id: membershipId },
          select: { role: true },
        }),
        open: await tx.invite.findMany({
          where: { membershipId, acceptedAt: null, revokedAt: null },
          select: { name: true, email: true },
        }),
      }));
      const mail = outbox.at(-1);
      rounds.push({
        before52,
        answer:
          said.status === 'fulfilled'
            ? { role: said.value.role, name: said.value.name }
            : answer(said),
        member: after.member.role,
        open: after.open.map((i) => [i.name, i.email === person.email]),
        emailed: mail?.to === person.email ? mail.name : null,
      });
    }
    expect(rounds).toEqual(
      [false, true].map((before52) => ({
        before52,
        answer: { role: 'STAFF', name: 'Fixed Name' },
        member: 'STAFF',
        open: [['Fixed Name', true]],
        emailed: 'Fixed Name',
      })),
    );
  });

  it("keeps the typed name and email; a resend sends those, never the person's user row", async () => {
    const firm = await newFirm('typed');
    // Already staff at another firm, under the name they use there.
    const person = await newPerson('typed', 'Name At Another Firm');
    const res = await as(
      firm.ownerEmail,
      '/api/v1/auth/invites',
      { email: ` ${person.email.toUpperCase()} `, name: '  Typed Name  ', role: 'STAFF' },
      firm.id,
    );
    expect(res.status).toBe(201);
    const first = res.body as InviteResponse;
    const resent = await service.resendInvite({
      businessId: firm.id,
      membershipId: first.membershipId,
      invitedBy: firm.owner,
    });
    const typed = { name: 'Typed Name', email: person.email };
    expect([first, resent]).toMatchObject([typed, typed]);
    expect(outbox.at(-1)).toMatchObject({ inviteId: resent.id, to: typed.email, name: typed.name });
    const rows = await inFirm(firm.id, (tx) =>
      tx.invite.findMany({
        where: { membershipId: first.membershipId },
        orderBy: { createdAt: 'asc' },
        select: { id: true, name: true, email: true },
      }),
    );
    expect(rows).toEqual([
      { id: first.id, ...typed },
      { id: resent.id, ...typed },
    ]);
  });

  it('resends an invite from before #52 (no typed details) to the user row, kept from then on', async () => {
    const firm = await newFirm('legacy');
    const person = await newPerson('legacy', 'Legacy Row Name');
    const membershipId = await legacyInvite(firm, person);
    const resent = await service.resendInvite({
      businessId: firm.id,
      membershipId,
      invitedBy: firm.owner,
    });
    const fromRow = { name: 'Legacy Row Name', email: person.email };
    expect(resent).toMatchObject(fromRow);
    const stored = await inFirm(firm.id, (tx) =>
      tx.invite.findUniqueOrThrow({
        where: { id: resent.id },
        select: { name: true, email: true },
      }),
    );
    expect(stored).toEqual(fromRow);
  });

  it('fits a user row name invites.name would refuse, for an invite from before #52', async () => {
    const firm = await newFirm('fit');
    // users.name took up to 200 characters and control characters (it has no CHECK).
    const rows = [
      { rowName: 'N'.repeat(150), fitted: 'N'.repeat(120) },
      { rowName: 'Tab\tName\u0007', fitted: 'Tab Name' },
    ];
    const got: unknown[] = [];
    for (const { rowName } of rows) {
      const person = await newPerson('fit', rowName);
      const membershipId = await legacyInvite(firm, person);
      const said = await settle(
        service.resendInvite({ businessId: firm.id, membershipId, invitedBy: firm.owner }),
      );
      if (said.status === 'rejected') {
        got.push(answer(said));
        continue;
      }
      const stored = await inFirm(firm.id, (tx) =>
        tx.invite.findUniqueOrThrow({ where: { id: said.value.id }, select: { name: true } }),
      );
      // Answered, stored and emailed.
      got.push([said.value.name, stored.name, outbox.at(-1)?.name]);
    }
    expect(got).toEqual(rows.map(({ fitted }) => [fitted, fitted, fitted]));
  });

  it("the platform's owner invite (R4, invitedBy null) keeps the typed details too", async () => {
    const slug = `r2-r4-${randomUUID().slice(0, 8)}`;
    const { id: businessId } = await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.business.create({
        data: { slug, name: slug, status: 'PENDING_SETUP' },
        select: { id: true },
      }),
    );
    const email = `r2-r4-owner-${randomUUID()}@race.test`;
    const result = await service.createInvite({
      businessId,
      email: ` ${email.toUpperCase()} `,
      name: '  Primary Admin  ',
      role: 'OWNER',
      invitedBy: null,
    });
    expect(result).toMatchObject({ name: 'Primary Admin', email, role: 'OWNER' });
    const stored = await inFirm(businessId, (tx) =>
      tx.invite.findUniqueOrThrow({
        where: { id: result.id },
        select: { name: true, email: true, invitedByUserId: true },
      }),
    );
    expect(stored).toEqual({ name: 'Primary Admin', email, invitedByUserId: null });
  });

  it("holds the platform's owner invite (R4) to the route's rules: 400, and no login is made", async () => {
    const slug = `r2-r4-bad-${randomUUID().slice(0, 8)}`;
    const { id: businessId } = await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.business.create({
        data: { slug, name: slug, status: 'PENDING_SETUP' },
        select: { id: true },
      }),
    );
    const email = `r2-r4-bad-${randomUUID()}@race.test`;
    const notAnEmail = `r2-r4-not-an-email-${randomUUID()}`;
    // R4's application takes a primary admin's full name of up to 200 characters.
    const cases = [
      { name: 'x'.repeat(121) },
      { name: 'x'.repeat(200) },
      { name: 'Bell\u0007Name' },
      { email: notAnEmail },
    ];
    const said: string[] = [];
    for (const bad of cases) {
      const result = await settle(
        service.createInvite({
          businessId,
          email,
          name: 'Primary Admin',
          ...bad,
          role: 'OWNER',
          invitedBy: null,
        }),
      );
      said.push(answer(result));
    }
    expect(said).toEqual(cases.map(() => '400 VALIDATION_FAILED'));
    const users = await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.user.count({ where: { email: { in: [email, notAnEmail] } } }),
    );
    expect(users).toBe(0);
    expect(outbox.filter((m) => m.to === email || m.to === notAnEmail)).toEqual([]);
  });

  it('refuses a name the database would refuse with 400, before writing anything', async () => {
    const email = `r2-bad-name-${randomUUID()}@a.test`;
    for (const name of ['x'.repeat(121), 'Tab\tName', 'Bell\u0007Name']) {
      const res = await as(
        fx.users.ownerA.email,
        '/api/v1/auth/invites',
        { email, name, role: 'STAFF' },
        fx.firmA.id,
      );
      expect([name, res.status, codeOf(res)]).toEqual([name, 400, 'VALIDATION_FAILED']);
    }
    const users = await runInScope(ownerDb, { kind: 'platform' }, (tx) =>
      tx.user.count({ where: { email } }),
    );
    expect(users).toBe(0);
  });
});
