// End-to-end: Send Portal Invitation (Business Advisory B3; Rasel, Oct 25). The firm sends a
// sealed link to the client's email on file; the portal's invitation page opens it only while it is
// the client's latest delivered, unrevoked, unexpired invitation for that email; a login or a
// waiting sign-up ends it. Staff reach only their own clients; firm B reaches none of firm A's.
// Synthetic data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import { ClientPortalAccess, OpenedPortalInvitation } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { NotifyDeliveryError } from '../../src/notify/notify.service.js';
import { NOTIFY_SERVICE, type NotifyMessage } from '../../src/notify/notify.types.js';

const Access = z.strictObject(ClientPortalAccess.shape);
const Opened = z.strictObject(OpenedPortalInvitation.shape);

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r56pi-${key}-${run}@r56.test` });
const people = {
  ownerA: person('owner-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
};
const slugs = { a: `r56pi-a-${run}`, b: `r56pi-b-${run}` };
const ids = { firmA: '', firmB: '', mine: '', other: '', noEmail: '', linked: '', bounce: '' };
const emails = {
  mine: `robin-${run}@example.test`,
  other: `sam-${run}@example.test`,
  bounce: `bounce-${run}@example.test`,
};

let app: INestApplication;
let portalOrigin = '';
const outbox: NotifyMessage[] = [];
const tokens = new Map<string, string>();

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

async function firm(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  body?: object,
  businessId = ids.firmA,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/clients/${path}`)
    .set('x-business-id', businessId)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body ? req.send(body) : req;
}
const access = (clientId: string, who = people.ownerA) =>
  firm('get', `${clientId}/portal-access`, who);
const send = (clientId: string, who = people.ownerA) =>
  firm('post', `${clientId}/portal-invitation`, who, { confirm: true });
let lastViewer = 0;
const open = (token: string, slug = slugs.a) =>
  request(app.getHttpServer())
    .post(`/api/v1/portal/${slug}/invitation`)
    .set('x-forwarded-for', `198.19.${++lastViewer}.1, 10.0.0.5`)
    .set('origin', portalOrigin)
    .send({ token });

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
/** The token of the newest invitation email to `to`. */
const lastToken = (to: string) => {
  const mail = [...outbox].reverse().find((m) => m.to === to);
  expect(mail?.template).toBe('client.portal-invitation');
  const link = (mail?.data as { link: string }).link;
  expect(link).toMatch(new RegExp(`/${slugs.a}/invitation#token=`));
  return link.split('#token=')[1]!;
};
const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner);
const inFirm = async <T>(
  fn: (tx: Parameters<Parameters<typeof runInScope>[2]>[0]) => Promise<T>,
) => {
  const db = owner();
  return runInScope(db, { kind: 'business', businessId: ids.firmA }, fn).finally(() =>
    db.$disconnect(),
  );
};
/** A client portal login for `email` at firm A: linked to `clientId`, or a waiting sign-up. */
const login = async (email: string, clientId: string | null) => {
  const userId = randomUUID();
  const db = owner();
  await runInScope(db, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: { id: userId, cognitoSub: userId, pool: 'CLIENT', email, name: 'Fake client' },
    }),
  );
  await db.$disconnect();
  await inFirm((tx) =>
    tx.clientAccount.create({
      data: {
        businessId: ids.firmA,
        userId,
        clientId,
        email,
        status: clientId ? 'ACTIVE' : 'PENDING_APPROVAL',
        emailVerifiedAt: new Date(),
      },
    }),
  );
};

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: `Fake ${key}` },
      });
    }
    ids.firmA = (
      await tx.business.create({ data: { slug: slugs.a, name: 'Firm A', status: 'ACTIVE' } })
    ).id;
    ids.firmB = (
      await tx.business.create({ data: { slug: slugs.b, name: 'Firm B', status: 'ACTIVE' } })
    ).id;
  });
  await runInScope(db, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const A = { businessId: ids.firmA };
    for (const [userId, role] of [
      [people.ownerA.id, 'OWNER'],
      [people.staffA.id, 'STAFF'],
    ] as const) {
      await tx.membership.create({ data: { ...A, userId, role, status: 'ACTIVE' } });
    }
    const client = (data: { displayName: string; email?: string; assignedUserId?: string }) =>
      tx.client.create({ data: { ...A, ...data }, select: { id: true } }).then((c) => c.id);
    ids.mine = await client({
      displayName: 'Robin Example',
      email: emails.mine,
      assignedUserId: people.staffA.id,
    });
    ids.other = await client({ displayName: 'Sam Example', email: emails.other });
    ids.noEmail = await client({ displayName: 'No Email Example' });
    ids.linked = await client({
      displayName: 'Linked Example',
      email: `linked-${run}@example.test`,
    });
    ids.bounce = await client({ displayName: 'Bounce Example', email: emails.bounce });
  });
  await runInScope(db, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: people.ownerB.id, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
  await db.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  portalOrigin = new URL(env.PORTAL_BASE_URL).origin;
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(NOTIFY_SERVICE)
    .useValue({
      send: (message: NotifyMessage) => {
        if (message.to === emails.bounce) {
          return Promise.reject(
            new NotifyDeliveryError(message.template, 'email', 'MessageRejected'),
          );
        }
        outbox.push(message);
        return Promise.resolve();
      },
    })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
  await login(`linked-${run}@example.test`, ids.linked);
});

afterAll(async () => {
  await app.close();
});

describe('portal access', () => {
  it('shows the recipient on file and no invitation yet; Staff only for their own clients', async () => {
    const view = Access.parse(ok(await access(ids.mine)));
    expect(view).toMatchObject({
      clientId: ids.mine,
      clientName: 'Robin Example',
      recipient: { name: 'Robin Example', email: emails.mine },
      logins: [],
      invitation: null,
      blocked: null,
    });
    ok(await access(ids.mine, people.staffA));
    expect((await access(ids.other, people.staffA)).status).toBe(404);
  });

  it('says why an invitation cannot be sent', async () => {
    expect(Access.parse(ok(await access(ids.noEmail))).blocked).toBe('NO_EMAIL');
    const linked = Access.parse(ok(await access(ids.linked)));
    expect(linked.blocked).toBe('HAS_LOGIN');
    expect(linked.logins).toEqual([
      expect.objectContaining({ email: `linked-${run}@example.test`, status: 'ACTIVE' }),
    ]);
    const refused = await send(ids.noEmail);
    expect(refused.status).toBe(409);
    expect(codeOf(refused)).toBe('NO_EMAIL');
    expect(codeOf(await send(ids.linked))).toBe('HAS_LOGIN');
    expect((await firm('post', `${ids.mine}/portal-invitation`, people.ownerA, {})).status).toBe(
      400,
    );
  });
});

describe('sending and opening an invitation', () => {
  it('emails a sealed link that the firm portal opens for that client only', async () => {
    const sent = Access.parse(ok(await send(ids.mine, people.staffA), 201));
    expect(sent.invitation).toMatchObject({
      state: 'OPEN',
      delivered: true,
      sentBy: 'Fake staffA',
      revokedAt: null,
    });
    expect(outbox.at(-1)).toMatchObject({
      template: 'client.portal-invitation',
      to: emails.mine,
      businessId: ids.firmA,
    });
    const token = lastToken(emails.mine);
    const opened = Opened.parse(ok(await open(token)));
    expect(opened).toMatchObject({
      firmName: 'Firm A',
      name: 'Robin Example',
      maskedEmail: `r•••@example.test`,
    });
    expect(opened.expiresAt).toBe(sent.invitation!.expiresAt.replace(/\.\d+Z$/, '.000Z'));
    // Another firm's portal, a changed token and nonsense are all the same 410.
    expect(codeOf(await open(token, slugs.b))).toBe('INVITATION_INVALID');
    expect(codeOf(await open(`${token.slice(0, -4)}AAAA`))).toBe('INVITATION_INVALID');
    expect(codeOf(await open('x'.repeat(40)))).toBe('INVITATION_INVALID');
    const trail = await inFirm((tx) =>
      tx.auditLog.findMany({
        where: { entityId: ids.mine, action: { startsWith: 'client.portal_invitation' } },
        select: { action: true, metadata: true },
      }),
    );
    expect(trail.map((r) => r.action).sort()).toEqual([
      'client.portal_invitation_opened',
      'client.portal_invitation_sent',
    ]);
    expect(JSON.stringify(trail)).not.toContain(emails.mine);
  });

  it('a new invitation replaces the old link; revoking ends the new one', async () => {
    const first = lastToken(emails.mine);
    ok(await send(ids.mine), 201);
    const second = lastToken(emails.mine);
    expect(codeOf(await open(first))).toBe('INVITATION_INVALID');
    ok(await open(second));
    const revoked = Access.parse(
      ok(await firm('post', `${ids.mine}/portal-invitation/revoke`, people.ownerA)),
    );
    expect(revoked.invitation?.state).toBe('REVOKED');
    expect(codeOf(await open(second))).toBe('INVITATION_INVALID');
    const again = await firm('post', `${ids.mine}/portal-invitation/revoke`, people.ownerA);
    expect(codeOf(again)).toBe('NOT_OPEN');
  });

  it('at most three a day per client', async () => {
    ok(await send(ids.mine), 201);
    const view = Access.parse(ok(await access(ids.mine)));
    expect(view.blocked).toBe('DAILY_LIMIT');
    expect(codeOf(await send(ids.mine))).toBe('DAILY_LIMIT');
    // The third one still opens.
    ok(await open(lastToken(emails.mine)));
  });

  it('an email that could not be sent is recorded and its link never opens', async () => {
    const view = Access.parse(ok(await send(ids.bounce), 201));
    expect(view.invitation).toMatchObject({ delivered: false, state: 'NOT_SENT' });
    expect(outbox.some((m) => m.to === emails.bounce)).toBe(false);
  });

  it('a changed email ends the link, and a sign-up or login ends the invitation', async () => {
    ok(await send(ids.other), 201);
    const token = lastToken(emails.other);
    await inFirm((tx) =>
      tx.client.update({ where: { id: ids.other }, data: { email: `new-${emails.other}` } }),
    );
    expect(codeOf(await open(token))).toBe('INVITATION_INVALID');
    await inFirm((tx) =>
      tx.client.update({ where: { id: ids.other }, data: { email: emails.other } }),
    );
    ok(await open(token));
    await login(emails.other, null);
    const conflict = await open(token);
    expect(conflict.status).toBe(409);
    expect(codeOf(conflict)).toBe('ALREADY_SIGNED_UP');
    const view = Access.parse(ok(await access(ids.other)));
    expect(view.blocked).toBe('SIGN_UP_WAITING');
    expect(view.invitation?.state).toBe('ACCEPTED');
  });
});

describe('another firm', () => {
  it('reaches none of it', async () => {
    for (const res of [
      await firm('get', `${ids.mine}/portal-access`, people.ownerB, undefined, ids.firmB),
      await firm(
        'post',
        `${ids.mine}/portal-invitation`,
        people.ownerB,
        { confirm: true },
        ids.firmB,
      ),
      await firm('post', `${ids.mine}/portal-invitation/revoke`, people.ownerB, {}, ids.firmB),
    ]) {
      expect(res.status).toBe(404);
    }
  });
});
