// End-to-end: the firm's queue of portal sign-ups (R3 step 4) in AUTH_MODE=local: list, approve
// (new client record, or linking an existing one only by the #37 rule), decline. Contract:
// docs/api/client-auth.yaml ("Firm side"). The ClientCodeSender is replaced by an outbox.
// Octavia's Client Sign-ups (Oct 25, D1): tabs with the firm's counts, newest first, search, the
// firm's days, the potential-match flag, one request with its history, and the approval mode.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type {
  ApproveSignUpResponse,
  ClientSignUpDetail,
  ClientSignUpList,
  ClientSignUpSettings,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { LOCAL_PASSWORD } from '../../src/auth/identity/local-identity.provider.js';
import { CLIENT_CODE_SENDER } from '../../src/client-auth/client-code-sender.js';
import { configureApp } from '../../src/configure-app.js';
import { type Env, loadEnv } from '../../src/config/env.js';

const fx = inject('fixtures');
let app: INestApplication;
let env: Env;
type Notice = { kind: 'approved' | 'declined'; to: string; signInUrl?: string };
const outbox: Notice[] = [];

const tag = randomUUID().slice(0, 8);
const firmX = { id: '', slug: `r3-queue-x-${tag}` };
const firmY = { id: '', slug: `r3-queue-y-${tag}` };
type Person = { id: string; email: string };
const person = (key: string): Person => ({
  id: randomUUID(),
  email: `r3-q-${key.toLowerCase()}-${tag}@example.com`,
});
const staff = { ownerX: person('ownerX'), adminX: person('adminX'), staffX: person('staffX') };
const ownerY = person('ownerY');

type SignUp = Person & { accountId: string };
const signUps = {} as Record<
  | 'plain'
  | 'jane'
  | 'john'
  | 'sam'
  | 'race'
  | 'decline'
  | 'unverified'
  | 'declined'
  | 'ofY'
  | 'clientsRace1'
  | 'clientsRace2'
  | 'clientsRace3'
  | 'archived'
  | 'notice'
  | 'phoned'
  | 'late',
  SignUp
>;
const records = {} as Record<
  'jane' | 'johnLinked' | 'other' | 'ofY' | 'archived' | 'phoned',
  string
>;
/** When true, the client notices fail (a mail outage). */
let noticesFail = false;

let lastViewer = 0;
const newViewer = () => `198.20.0.${++lastViewer}`;
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

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

/** A signed-in firm call (Bearer: no cookie, so no Origin needed) in `businessId`. */
async function as(
  who: Person,
  method: 'get' | 'post',
  path: string,
  body?: object,
  businessId = firmX.id,
) {
  const token = await tokenFor(who.email);
  const req = request(app.getHttpServer())
    [method](`/api/v1/client-sign-ups${path}`)
    .set('authorization', `Bearer ${token}`)
    .set('x-business-id', businessId)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  return body ? req.send(body) : req;
}
const approve = (s: SignUp, body?: object, by: Person = staff.ownerX) =>
  as(by, 'post', `/${s.accountId}/approve`, body);
const decline = (s: SignUp, body?: object, by: Person = staff.ownerX) =>
  as(by, 'post', `/${s.accountId}/decline`, body);

const account = (s: SignUp, businessId = firmX.id) =>
  asOwner({ kind: 'business', businessId }, (tx) =>
    tx.clientAccount.findUniqueOrThrow({
      where: { id: s.accountId },
      select: {
        status: true,
        clientId: true,
        approvedByUserId: true,
        declinedByUserId: true,
        declineReason: true,
      },
    }),
  );

/** A portal sign-up of `firm`, as steps 2-3 leave it; minutes after a fixed start, for order. */
async function signUp(
  key: keyof typeof signUps,
  firm: { id: string },
  minute: number,
  fields: {
    status?: 'PENDING_APPROVAL' | 'DECLINED';
    verified?: boolean;
    email?: string;
    at?: Date;
  } = {},
) {
  const p = person(key);
  const email = fields.email ?? p.email;
  // Each its own number (minute 1 is +17705550101), so no sign-up matches another's record.
  const phone = `+177055501${String(minute).padStart(2, '0')}`;
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: p.id,
        cognitoSub: p.id,
        pool: 'CLIENT',
        email,
        name: `Fake ${key}`,
        phone,
      },
    }),
  );
  const verified = fields.verified ?? true;
  const created = await asOwner({ kind: 'business', businessId: firm.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firm.id,
        userId: p.id,
        email,
        accountType: key === 'jane' ? 'BUSINESS' : 'INDIVIDUAL',
        status: fields.status ?? 'PENDING_APPROVAL',
        emailVerifiedAt: verified ? new Date() : null,
        phoneVerifiedAt: verified ? new Date() : null,
        createdAt: fields.at ?? new Date(Date.UTC(2026, 9, 7, 9, minute)),
      },
    }),
  );
  signUps[key] = { id: p.id, email, accountId: created.id };
}

/** A client record the firm already has (added by staff, or from Begin Online). */
async function record(
  key: keyof typeof records,
  firm: { id: string },
  email: string | null,
  phone: string | null = null,
) {
  const created = await asOwner({ kind: 'business', businessId: firm.id }, (tx) =>
    tx.client.create({
      data: { businessId: firm.id, displayName: `Record ${key}`, email, phone },
      select: { id: true },
    }),
  );
  records[key] = created.id;
}

beforeAll(async () => {
  for (const firm of [firmX, firmY]) {
    firm.id = (
      await asOwner({ kind: 'platform' }, (tx) =>
        tx.business.create({ data: { slug: firm.slug, name: firm.slug, status: 'ACTIVE' } }),
      )
    ).id;
  }
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of [...Object.values(staff), ownerY]) {
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool: 'STAFF', email: p.email, name: 'Fake staff' },
      });
    }
  });
  for (const [businessId, p, role] of [
    [firmX.id, staff.ownerX, 'OWNER'],
    [firmX.id, staff.adminX, 'ADMIN'],
    [firmX.id, staff.staffX, 'STAFF'],
    [firmY.id, ownerY, 'OWNER'],
  ] as const) {
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId: p.id, role, status: 'ACTIVE' } }),
    );
  }

  await signUp('plain', firmX, 1);
  await signUp('jane', firmX, 2);
  await signUp('john', firmX, 3);
  await signUp('sam', firmX, 4);
  await signUp('race', firmX, 5);
  await signUp('decline', firmX, 6);
  await signUp('unverified', firmX, 0, { verified: false });
  await signUp('declined', firmX, 7, { status: 'DECLINED' });
  await signUp('ofY', firmY, 1);
  await signUp('clientsRace1', firmX, 8);
  await signUp('clientsRace2', firmX, 9);
  await signUp('clientsRace3', firmX, 10);
  await signUp('archived', firmX, 11);
  await signUp('notice', firmX, 12);
  await signUp('phoned', firmX, 13);
  // 23:30 on Oct 7 in the firm's zone (New York) is already Oct 8 in UTC.
  await signUp('late', firmX, 14, { at: new Date(Date.UTC(2026, 9, 8, 3, 30)) });

  // Jane's record: her email, no portal login yet.
  await record('jane', firmX, signUps.jane.email);
  // John's email, but the record already has a primary login (an older account).
  await record('johnLinked', firmX, signUps.john.email);
  const older = person('johnOlder');
  await asOwner({ kind: 'platform' }, (tx) =>
    tx.user.create({
      data: { id: older.id, cognitoSub: older.id, pool: 'CLIENT', email: older.email, name: 'J' },
    }),
  );
  await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firmX.id,
        userId: older.id,
        email: older.email,
        status: 'ACTIVE',
        clientId: records.johnLinked,
        portalRole: 'PRIMARY',
      },
    }),
  );
  // Sam has no record. (A firm never holds two records with one email: #52's unique index.)
  await record('other', firmX, `r3-q-someone-else-${tag}@example.com`);
  // Firm Y's record with Jane's email: never linkable from firm X.
  await record('ofY', firmY, signUps.jane.email);
  // An archived record with the sign-up's email: restored first, never linked.
  await record('archived', firmX, signUps.archived.email);
  await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
    tx.client.update({ where: { id: records.archived }, data: { archivedAt: new Date() } }),
  );
  // Another email, but Phoned's number written another way: a potential match by phone.
  await record('phoned', firmX, `r3-q-phoned-record-${tag}@example.com`, '(770) 555-0113');
  // Sam's name on a record with another email and no phone: a name alone is never a match.
  await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
    tx.client.create({
      data: {
        businessId: firmX.id,
        displayName: 'Fake sam',
        email: `r3-q-not-sam-${tag}@example.com`,
      },
    }),
  );

  env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const notice = (kind: Notice['kind']) => (m: { to: string; signInUrl?: string }) => {
    if (noticesFail) return Promise.reject(new Error('mail is down'));
    outbox.push({ kind, to: m.to, ...(m.signInUrl ? { signInUrl: m.signInUrl } : {}) });
    return Promise.resolve();
  };
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(CLIENT_CODE_SENDER)
    .useValue({
      emailCode: () => Promise.resolve(),
      smsCode: () => Promise.resolve(),
      alreadyRegistered: () => Promise.resolve(),
      signUpApproved: notice('approved'),
      signUpDeclined: notice('declined'),
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

describe('the queue', () => {
  it("lists verified sign-ups newest first, page by page, with each tab's count", async () => {
    const ids = (res: Response) =>
      (res.body as ClientSignUpList).items.map((i) => i.clientAccountId);
    const of = (...keys: (keyof typeof signUps)[]) => keys.map((k) => signUps[k].accountId);
    const first = await as(staff.adminX, 'get', '?limit=4');
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      total: 13,
      page: 1,
      limit: 4,
      counts: { PENDING_APPROVAL: 13, APPROVED: 0, DECLINED: 1 },
    });
    expect(ids(first)).toEqual(of('late', 'phoned', 'notice', 'archived'));
    // The unverified sign-up never shows; firm Y's never either.
    expect(ids(await as(staff.adminX, 'get', '?limit=4&page=2'))).toEqual(
      of('clientsRace3', 'clientsRace2', 'clientsRace1', 'decline'),
    );
    expect(ids(await as(staff.adminX, 'get', '?limit=4&page=4'))).toEqual(of('plain'));
    expect(ids(await as(staff.adminX, 'get', '?limit=2&sort=oldest'))).toEqual(of('plain', 'jane'));

    const jane = (await as(staff.adminX, 'get', '?search=FAKE%20JANE')).body as ClientSignUpList;
    expect(jane.items[0]).toMatchObject({
      name: 'Fake jane',
      email: signUps.jane.email,
      phone: '+17705550102',
      accountType: 'BUSINESS',
      status: 'PENDING_APPROVAL',
      approvedAt: null,
      declinedAt: null,
      match: 'POTENTIAL_MATCH',
      client: null,
    });
    // A search narrows the result, never the tabs' counts.
    expect(jane).toMatchObject({ total: 1, counts: { PENDING_APPROVAL: 13 } });
    expect(
      ids(await as(staff.adminX, 'get', `?search=${signUps.sam.email.toUpperCase()}`)),
    ).toEqual(of('sam'));

    // Jane, John and Archived share an email with a record, Phoned a phone number.
    expect(ids(await as(staff.adminX, 'get', '?match=POTENTIAL_MATCH&limit=100'))).toEqual(
      of('phoned', 'archived', 'john', 'jane'),
    );
    expect((await as(staff.adminX, 'get', '?match=NO_MATCH')).body).toMatchObject({ total: 9 });

    // Submitted days are the firm's (New York): Late counts on Oct 7, not Oct 8.
    const day = async (q: string) =>
      ((await as(staff.adminX, 'get', `?${q}&limit=100`)).body as ClientSignUpList).total;
    expect(await day('from=2026-10-07&to=2026-10-07')).toBe(13);
    expect(await day('from=2026-10-08')).toBe(0);
    expect(await day('to=2026-10-06')).toBe(0);

    expect(ids(await as(staff.adminX, 'get', '?status=DECLINED'))).toEqual(of('declined'));
    for (const q of ['?cursor=x', '?status=ACTIVE', '?from=2026-10-08&to=2026-10-07']) {
      const bad = await as(staff.adminX, 'get', q);
      expect([q, bad.status, codeOf(bad)]).toEqual([q, 400, 'VALIDATION_FAILED']);
    }
  });

  it("is for the firm's owner and admins only; other firms learn nothing", async () => {
    const res = await as(staff.staffX, 'get', '');
    expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    expect((await as(ownerY, 'get', '')).status).toBe(404);
    expect((await request(app.getHttpServer()).get('/api/v1/client-sign-ups')).status).toBe(401);

    // Firm Y's own queue holds only its own sign-up.
    const own = await as(ownerY, 'get', '', undefined, firmY.id);
    expect((own.body as ClientSignUpList).items.map((i) => i.clientAccountId)).toEqual([
      signUps.ofY.accountId,
    ]);
    // Firm Y acting on firm X's sign-up: 404, nothing changes.
    const cross = await as(ownerY, 'post', `/${signUps.plain.accountId}/approve`, {}, firmY.id);
    expect([cross.status, codeOf(cross)]).toEqual([404, 'NOT_FOUND']);
    expect((await account(signUps.plain)).status).toBe('PENDING_APPROVAL');
    // Nor can it read one, or firm X's settings through its own firm.
    const peek = await as(ownerY, 'get', `/${signUps.plain.accountId}`, undefined, firmY.id);
    expect([peek.status, codeOf(peek)]).toEqual([404, 'NOT_FOUND']);
    for (const path of [`/${signUps.plain.accountId}`, '/settings']) {
      const denied = await as(staff.staffX, 'get', path);
      expect([path, denied.status]).toEqual([path, 403]);
    }
  });

  it('opens one request with its history and the records it may belong to, audited', async () => {
    const res = await as(staff.adminX, 'get', `/${signUps.jane.accountId}`);
    expect(res.status).toBe(200);
    const jane = res.body as ClientSignUpDetail;
    expect(jane).toMatchObject({ status: 'PENDING_APPROVAL', match: 'POTENTIAL_MATCH' });
    // Firm Y's record with Jane's email is never shown here.
    expect(jane.candidates).toEqual([
      {
        clientId: records.jane,
        clientNumber: expect.stringMatching(/^CL-\d+$/) as string,
        displayName: 'Record jane',
        matchedOn: ['email'],
      },
    ]);
    expect(jane.history.map((h) => [h.kind, h.actorName])).toEqual([
      ['SUBMITTED', null],
      ['EMAIL_VERIFIED', null],
      ['PHONE_VERIFIED', null],
    ]);
    const phoned = (await as(staff.adminX, 'get', `/${signUps.phoned.accountId}`))
      .body as ClientSignUpDetail;
    expect(phoned.candidates.map((c) => [c.clientId, c.matchedOn])).toEqual([
      [records.phoned, ['phone']],
    ]);
    const sam = (await as(staff.adminX, 'get', `/${signUps.sam.accountId}`))
      .body as ClientSignUpDetail;
    // A record with Sam's name only is not a match (S03).
    expect([sam.match, sam.candidates]).toEqual(['NO_MATCH', []]);

    const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'client_sign_up.viewed', entityId: signUps.jane.accountId },
        select: { metadata: true, actorUserId: true },
      }),
    );
    expect(audit).toEqual({ metadata: { candidates: 1 }, actorUserId: staff.adminX.id });

    for (const id of [signUps.unverified.accountId, signUps.ofY.accountId, randomUUID(), 'x']) {
      const missing = await as(staff.adminX, 'get', `/${id}`);
      expect([missing.status, codeOf(missing)]).toEqual([404, 'NOT_FOUND']);
    }
  });

  it('reads the approval mode: Manual Review until the firm changes it', async () => {
    const res = await as(staff.ownerX, 'get', '/settings');
    expect(res.status).toBe(200);
    expect(res.body as ClientSignUpSettings).toEqual({
      mode: 'MANUAL',
      version: 1,
      changedAt: null,
    });
  });

  it('keeps a phone match waiting: approving it as a new client is refused', async () => {
    const res = await approve(signUps.phoned);
    expect([res.status, codeOf(res)]).toEqual([409, 'POTENTIAL_MATCH']);
    expect(await account(signUps.phoned)).toMatchObject({
      status: 'PENDING_APPROVAL',
      clientId: null,
    });
  });
});

describe('approve', () => {
  it('creates the client record from the sign-up, opens the portal and tells the client', async () => {
    const res = await approve(signUps.plain);
    expect(res.status).toBe(200);
    const body = res.body as ApproveSignUpResponse;
    expect(body).toMatchObject({ clientAccountId: signUps.plain.accountId, status: 'ACTIVE' });

    const created = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.client.findUniqueOrThrow({
        where: { id: body.clientId },
        select: { displayName: true, email: true, phone: true, accountType: true },
      }),
    );
    expect(created).toEqual({
      displayName: 'Fake plain',
      email: signUps.plain.email,
      phone: '+17705550101',
      accountType: 'INDIVIDUAL',
    });
    expect(await account(signUps.plain)).toMatchObject({
      status: 'ACTIVE',
      clientId: body.clientId,
      approvedByUserId: staff.ownerX.id,
    });
    expect(outbox.at(-1)).toEqual({
      kind: 'approved',
      to: signUps.plain.email,
      signInUrl: `${env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firmX.slug}/sign-in`,
    });
    const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.findMany({
        where: { entityId: { in: [signUps.plain.accountId, body.clientId] } },
        select: { action: true, actorUserId: true, metadata: true },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit).toEqual([
      {
        action: 'client.created',
        actorUserId: staff.ownerX.id,
        metadata: { from: 'portal_sign_up', clientAccountId: signUps.plain.accountId },
      },
      {
        action: 'client_account.approved',
        actorUserId: staff.ownerX.id,
        metadata: { clientId: body.clientId, linked: false },
      },
    ]);

    // The client can now use the portal.
    const signIn = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firmX.slug}/auth/sign-in`)
      .set('origin', new URL(env.PORTAL_BASE_URL).origin)
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .send({ email: signUps.plain.email, password: LOCAL_PASSWORD });
    expect(signIn.body).toMatchObject({
      status: 'SIGNED_IN',
      me: { clientAccounts: [{ status: 'ACTIVE' }] },
    });

    const again = await approve(signUps.plain);
    expect([again.status, codeOf(again)]).toEqual([409, 'NOT_PENDING']);
  });

  it('links an existing record only if its email is the verified one and it has no login', async () => {
    const before = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.client.count({ where: { businessId: firmX.id } }),
    );
    const refused: [string, object, number, string][] = [
      ['record with a login', { clientId: records.johnLinked }, 409, 'CLIENT_NOT_LINKABLE'],
      ['another email', { clientId: records.other }, 409, 'CLIENT_NOT_LINKABLE'],
      ["another firm's record", { clientId: records.ofY }, 404, 'NOT_FOUND'],
      ['unknown record', { clientId: randomUUID() }, 404, 'NOT_FOUND'],
      ['an extra field', { clientId: records.jane, force: true }, 400, 'VALIDATION_FAILED'],
    ];
    for (const [label, body, status, code] of refused) {
      const res = await approve(signUps.john, body);
      expect([label, res.status, codeOf(res)]).toEqual([label, status, code]);
    }
    // John's email is on a record already (with a login): no second client with that email.
    const duplicate = await approve(signUps.john);
    expect([duplicate.status, codeOf(duplicate)]).toEqual([409, 'DUPLICATE_EMAIL']);
    // Nothing changed for John.
    expect(await account(signUps.john)).toMatchObject({
      status: 'PENDING_APPROVAL',
      clientId: null,
    });
    // Jane's record is hers, not John's.
    const wrong = await approve(signUps.john, { clientId: records.jane });
    expect([wrong.status, codeOf(wrong)]).toEqual([409, 'CLIENT_NOT_LINKABLE']);

    // Jane has a record: approving her as a new client is refused, linking works.
    const asNew = await approve(signUps.jane);
    expect([asNew.status, codeOf(asNew)]).toEqual([409, 'DUPLICATE_EMAIL']);
    const linked = await approve(signUps.jane, { clientId: records.jane });
    expect(linked.status).toBe(200);
    expect((linked.body as ApproveSignUpResponse).clientId).toBe(records.jane);
    expect(await account(signUps.jane)).toMatchObject({ status: 'ACTIVE', clientId: records.jane });

    const after = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.client.count({ where: { businessId: firmX.id } }),
    );
    expect(after).toBe(before); // linking creates no record
    const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: signUps.jane.accountId, action: 'client_account.approved' },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toEqual({ clientId: records.jane, linked: true });
  });

  it('two approvals at once: one wins, one client record', async () => {
    const [a, b] = await Promise.all([
      approve(signUps.race),
      approve(signUps.race, undefined, staff.adminX),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const records = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.client.count({ where: { email: signUps.race.email } }),
    );
    expect(records).toBe(1);
  });

  it('a sign-up that never verified both contacts is not in the queue', async () => {
    for (const res of [await approve(signUps.unverified), await decline(signUps.unverified)]) {
      expect([res.status, codeOf(res)]).toEqual([404, 'NOT_FOUND']);
    }
  });
});

describe('decline', () => {
  it('closes the login, keeps the reason for the firm and tells the client', async () => {
    const res = await decline(signUps.decline, { reason: 'Not a client of ours' }, staff.adminX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      clientAccountId: signUps.decline.accountId,
      status: 'DECLINED',
    });
    expect(await account(signUps.decline)).toMatchObject({
      status: 'DECLINED',
      declineReason: 'Not a client of ours',
      declinedByUserId: staff.adminX.id,
    });
    expect(outbox.at(-1)).toEqual({ kind: 'declined', to: signUps.decline.email });

    const signIn = await request(app.getHttpServer())
      .post(`/api/v1/portal/${firmX.slug}/auth/sign-in`)
      .set('origin', new URL(env.PORTAL_BASE_URL).origin)
      .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
      .send({ email: signUps.decline.email, password: LOCAL_PASSWORD });
    expect([signIn.status, codeOf(signIn)]).toEqual([401, 'INVALID_CREDENTIALS']);

    const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { entityId: signUps.decline.accountId, action: 'client_account.declined' },
        select: { metadata: true, actorUserId: true },
      }),
    );
    expect(audit).toEqual({ metadata: { withReason: true }, actorUserId: staff.adminX.id });

    for (const again of [await decline(signUps.decline), await approve(signUps.decline)]) {
      expect([again.status, codeOf(again)]).toEqual([409, 'NOT_PENDING']);
    }
  });
});

describe('#72 review', () => {
  /** A client record created by staff through R10's API, as the owner of firm X. */
  const createClient = async (email: string) => {
    const token = await tokenFor(staff.ownerX.email);
    return request(app.getHttpServer())
      .post('/api/v1/business/clients')
      .set('authorization', `Bearer ${token}`)
      .set('x-business-id', firmX.id)
      .send({ displayName: 'Made by staff', email });
  };

  it('approve and a new client with the same email at once: never two records', async () => {
    for (const key of ['clientsRace1', 'clientsRace2', 'clientsRace3'] as const) {
      const { email } = signUps[key];
      const [approved, created] = await Promise.all([approve(signUps[key]), createClient(email)]);
      const ok = [approved.status === 200, created.status === 201].filter(Boolean);
      expect([key, ok.length]).toEqual([key, 1]);
      const loser = approved.status === 200 ? created : approved;
      expect([key, loser.status, codeOf(loser)]).toEqual([key, 409, 'DUPLICATE_EMAIL']);
      const count = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
        tx.client.count({ where: { businessId: firmX.id, email } }),
      );
      expect([key, count]).toEqual([key, 1]);
    }
  });

  it('counts an archived record as a potential match, but never links it', async () => {
    const listed = await as(staff.ownerX, 'get', '?limit=100');
    const item = (listed.body as ClientSignUpList).items.find(
      (i) => i.clientAccountId === signUps.archived.accountId,
    );
    expect(item?.match).toBe('POTENTIAL_MATCH');
    const res = await approve(signUps.archived, { clientId: records.archived });
    expect([res.status, codeOf(res)]).toEqual([409, 'CLIENT_NOT_LINKABLE']);
  });

  it('refuses extra fields and control characters, and audits the list', async () => {
    const extra = await decline(signUps.archived, { reason: 'Not a client', force: true });
    expect([extra.status, codeOf(extra)]).toEqual([400, 'VALIDATION_FAILED']);
    for (const reason of ['bad\u0000byte', 'bell\u0007', 'escape\u001b[31m']) {
      const res = await decline(signUps.archived, { reason });
      expect([JSON.stringify(reason), res.status]).toEqual([JSON.stringify(reason), 400]);
    }
    const query = await as(staff.ownerX, 'get', '?debug=1');
    expect([query.status, codeOf(query)]).toEqual([400, 'VALIDATION_FAILED']);

    await as(staff.adminX, 'get', '?limit=2');
    const audit = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
      tx.auditLog.findFirstOrThrow({
        where: { action: 'client_sign_ups.listed', actorUserId: staff.adminX.id },
        orderBy: { createdAt: 'desc' },
        select: { metadata: true },
      }),
    );
    expect(audit.metadata).toEqual({ status: 'PENDING_APPROVAL', count: 2 });
  });

  it('approves even when the notice fails, and makes the profile row as R10 does', async () => {
    noticesFail = true;
    try {
      const res = await approve(signUps.notice);
      expect(res.status).toBe(200);
      const { clientId } = res.body as ApproveSignUpResponse;
      const profile = await asOwner({ kind: 'business', businessId: firmX.id }, (tx) =>
        tx.clientProfile.findUnique({ where: { clientId }, select: { clientId: true } }),
      );
      expect(profile).toEqual({ clientId });
    } finally {
      noticesFail = false;
    }
    expect(await account(signUps.notice)).toMatchObject({ status: 'ACTIVE' });
  });
});

describe('after the decisions', () => {
  it('the Approved tab shows the Client ID, and each request says who decided', async () => {
    const approved = (await as(staff.ownerX, 'get', '?status=APPROVED&limit=100'))
      .body as ClientSignUpList;
    const plain = approved.items.find((i) => i.clientAccountId === signUps.plain.accountId);
    const created = await account(signUps.plain);
    expect(plain).toMatchObject({
      status: 'APPROVED',
      match: null,
      client: { clientId: created.clientId, displayName: 'Fake plain' },
    });
    expect(plain?.approvedAt).not.toBeNull();
    expect(approved.counts.APPROVED).toBe(approved.total);

    const detail = (await as(staff.ownerX, 'get', `/${signUps.plain.accountId}`))
      .body as ClientSignUpDetail;
    expect(detail.history.at(-1)).toMatchObject({ kind: 'APPROVED', actorName: 'Fake staff' });
    expect(detail.candidates).toEqual([]);
    const declined = (await as(staff.ownerX, 'get', `/${signUps.decline.accountId}`))
      .body as ClientSignUpDetail;
    expect(declined).toMatchObject({ status: 'DECLINED', declineReason: 'Not a client of ours' });
    expect(declined.history.at(-1)).toMatchObject({ kind: 'DECLINED', actorName: 'Fake staff' });
  });
});
