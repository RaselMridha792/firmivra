// End-to-end: R8 step 1, support access (contract in packages/types/src/support-access). A Super
// Admin asks a firm for access, one open request per firm and Super Admin. The firm's Owner and
// Admins see the requests without the person who asked; only an Owner answers: approve for 1 to
// 72 hours on the database's clock, decline a pending request, revoke an active grant. A grant
// expires on its own. Every ask and answer is in both audit logs; the firm's rows never name a
// Super Admin in their metadata.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AdminSupportAccess, AdminSupportAccessList, FirmSupportAccess } from '@firmivra/types';
import { z } from 'zod';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// The contract drops unknown keys; these tests refuse them, so a leaked field (who asked) fails.
const FirmView = z.strictObject(FirmSupportAccess.shape);
const FirmList = z.strictObject({ items: z.array(FirmView), nextCursor: z.string().nullable() });

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r8sa-${key}-${run}@r8sa.test` });
const people = {
  ownerA: person('owner-a'),
  ownerA2: person('owner-a2'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  ownerB: person('owner-b'),
  super1: person('super1'),
  super2: person('super2'),
};
const supers = [people.super1, people.super2];
const firms = {} as Record<'a' | 'b', { id: string; name: string; slug: string }>;
const HOUR = 60 * 60_000;

let app: INestApplication;
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

/** The firm's side, /business/support-access, as `who` in firm `at`. */
async function firmCall(
  method: 'get' | 'post',
  path: string,
  who: { email: string },
  at: 'a' | 'b' = 'a',
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/support-access${path}`)
    .set('x-business-id', firms[at].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

/** The Super Admins' side, /admin/... */
async function adminCall(
  method: 'get' | 'post',
  path: string,
  who: { email: string } = people.super1,
  body?: object,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/admin${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function ask(
  at: 'a' | 'b',
  who = people.super1,
  reason = `Checking an upload (fake) ${run}`,
) {
  const res = await adminCall('post', `/firms/${firms[at].id}/support-access`, who, { reason });
  expect(res.status, JSON.stringify(res.body)).toBe(201);
  return AdminSupportAccess.parse(res.body);
}

async function answer(id: string, action: 'approve' | 'decline' | 'revoke', at: 'a' | 'b' = 'a') {
  const who = at === 'a' ? people.ownerA : people.ownerB;
  const res = await firmCall('post', `/${id}/${action}`, who, at, {});
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return FirmView.parse(res.body);
}

async function firmList(query = '', who = people.ownerA, at: 'a' | 'b' = 'a') {
  const res = await firmCall('get', query, who, at);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return FirmList.parse(res.body);
}

async function adminList(query: string) {
  const res = await adminCall('get', `/support-access${query}`);
  expect(res.status, JSON.stringify(res.body)).toBe(200);
  return AdminSupportAccessList.parse(res.body);
}

const owner = () => createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);

/** The audit rows about one request: the firm's (its id) or the platform's (null). */
async function auditOf(grantId: string, businessId: string | null) {
  const db = owner();
  const rows = await runInScope(
    db,
    businessId ? { kind: 'business', businessId } : { kind: 'platform' },
    (tx) =>
      tx.auditLog.findMany({
        where: { businessId, entityType: 'support_access_grant', entityId: grantId },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { action: true, actorUserId: true, metadata: true },
      }),
  );
  await db.$disconnect();
  return rows.map((r) => [r.action, r.actorUserId, r.metadata]);
}

/** Moves an approved grant's expiry into the past, past R0's rules, as only a test may. */
async function expire(grantId: string) {
  const db = owner();
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
    await tx.$executeRaw`
      UPDATE support_access_grants SET expires_at = now() - interval '1 minute'
      WHERE id = ${grantId}::uuid`;
  });
  await db.$disconnect();
}

type Db = ReturnType<typeof owner>;

/**
 * Takes a lock in a transaction of its own (`take`) and holds it until `release`. `pid` is that
 * transaction's backend, which `blockedBy` looks for.
 */
async function hold(db: Db, take: (tx: TxClient) => Promise<unknown>) {
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  let ready = (_pid: number) => {};
  const taken = new Promise<number>((resolve) => (ready = resolve));
  const done = db.$transaction(
    async (tx) => {
      const [me] = await tx.$queryRaw<{ pid: number }[]>`SELECT pg_backend_pid() AS pid`;
      await take(tx);
      ready(me?.pid ?? 0);
      await held;
    },
    { timeout: 20_000 },
  );
  const pid = await Promise.race([taken, done.then(() => 0)]);
  return {
    pid,
    release: async () => {
      release();
      await done;
    },
  };
}

/** Waits until some backend waits for a lock that backend `pid` holds. */
async function blockedBy(db: Db, pid: number) {
  for (let tries = 0; tries < 200; tries++) {
    const [row] = await db.$queryRaw<{ n: number }[]>`
      SELECT count(*)::int AS n FROM pg_stat_activity
      WHERE ${pid}::int = ANY(pg_blocking_pids(pid))`;
    if ((row?.n ?? 0) > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Nothing waited for backend ${pid}`);
}

beforeAll(async () => {
  const db = owner();
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.startsWith('super') ? 'ADMIN' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R8 ${key}` },
      });
    }
    for (const s of supers) await tx.platformAdmin.create({ data: { userId: s.id } });
    for (const key of ['a', 'b'] as const) {
      const slug = `r8sa-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: `Fake Firm ${key.toUpperCase()} ${run}`, status: 'ACTIVE' },
        select: { id: true, name: true, slug: true },
      });
    }
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.ownerA2.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(db, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await db.$disconnect();

  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({
    imports: [AppModule.forRoot(env)],
  }).compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

/** The requests the tests share, filled in order. */
const asked = {} as Record<
  'super1A' | 'super2A' | 'super2B' | 'super2A2' | 'super1A2',
  AdminSupportAccess
>;

describe('a Super Admin asks', () => {
  it("201 with the firm and the person; in both logs, the firm's row without the person", async () => {
    asked.super1A = await ask('a');
    expect(asked.super1A).toMatchObject({
      firm: firms.a,
      admin: { userId: people.super1.id, name: 'Fake R8 super1' },
      reason: `Checking an upload (fake) ${run}`,
      status: 'PENDING',
      expiresAt: null,
      endedAt: null,
    });
    expect(await auditOf(asked.super1A.id, firms.a.id)).toEqual([
      ['support.requested', people.super1.id, {}],
    ]);
    expect(await auditOf(asked.super1A.id, null)).toEqual([
      ['support.requested', people.super1.id, { businessId: firms.a.id }],
    ]);
  });

  it('one open request per firm and Super Admin (409, firm id in any case); of two at once, one', async () => {
    const path = `/firms/${firms.a.id.toUpperCase()}/support-access`;
    const again = await adminCall('post', path, people.super1, { reason: 'Again' });
    expect([again.status, codeOf(again)]).toEqual([409, 'SUPPORT_REQUEST_OPEN']);
    const both = await Promise.all(
      [1, 2].map((n) =>
        adminCall('post', `/firms/${firms.b.id}/support-access`, people.super2, {
          reason: `At once ${n}`,
        }),
      ),
    );
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
    asked.super2B = AdminSupportAccess.parse(both.find((r) => r.status === 201)?.body);
    // Another Super Admin may ask the same firm.
    asked.super2A = await ask('a', people.super2);
  });

  it('a firm that is not active is never asked: 409 FIRM_NOT_ACTIVE', async () => {
    const db = owner();
    const suspended = await runInScope(db, { kind: 'platform' }, (tx) =>
      tx.business.create({
        data: { slug: `r8sa-s-${run}`, name: `Fake Firm S ${run}`, status: 'SUSPENDED' },
        select: { id: true },
      }),
    );
    await db.$disconnect();
    const res = await adminCall('post', `/firms/${suspended.id}/support-access`, people.super1, {
      reason: 'Fake reason',
    });
    expect([res.status, codeOf(res)]).toEqual([409, 'FIRM_NOT_ACTIVE']);
  });

  it("refuses bad input (400), an unknown firm (404) and a firm's session (401)", async () => {
    const path = `/firms/${firms.b.id}/support-access`;
    for (const body of [
      {},
      { reason: '' },
      { reason: 'two\nlines' },
      { reason: 'x'.repeat(501) },
      { reason: 'ok', hours: 2 },
    ]) {
      const res = await adminCall('post', path, people.super1, body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const bad = await adminCall('post', '/firms/nope/support-access', people.super1, {
      reason: 'x',
    });
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    const unknown = await adminCall(
      'post',
      `/firms/${randomUUID()}/support-access`,
      people.super1,
      {
        reason: 'x',
      },
    );
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'NOT_FOUND']);
    const firmSession = await adminCall('post', path, people.ownerA, { reason: 'x' });
    expect(firmSession.status).toBe(401);
  });
});

describe("the firm's side", () => {
  it('a Super Admin session is refused on the firm side (AUTH-DESIGN: pool must match)', async () => {
    for (const path of ['', `/${asked.super1A.id}/approve`]) {
      const res = await firmCall(
        path ? 'post' : 'get',
        path,
        people.super1,
        'a',
        path ? {} : undefined,
      );
      expect(res.status, path).toBe(401);
    }
  });

  it("the firm's log shows the ask as Firmivra Support, with no IP or user agent", async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/business/audit-log?action=support.requested')
      .set('x-business-id', firms.a.id)
      .set('authorization', `Bearer ${await tokenFor(people.ownerA.email)}`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const items = (res.body as { items: { entity: { id: string }; actor: unknown; ip: unknown }[] })
      .items;
    const row = items.find((i) => i.entity.id === asked.super1A.id);
    expect(row).toMatchObject({
      actor: { kind: 'PLATFORM', userId: null, name: 'Firmivra Support' },
      ip: null,
    });
    expect(JSON.stringify(row)).not.toContain(people.super1.id);
  });

  it('Owner and Admin see the requests without the person; Staff 403; firm B only its own', async () => {
    for (const who of [people.ownerA, people.adminA]) {
      const { items } = await firmList('', who);
      expect(items.map((i) => i.id)).toEqual(
        expect.arrayContaining([asked.super1A.id, asked.super2A.id]),
      );
      const text = JSON.stringify(items);
      for (const s of supers) {
        for (const leak of [s.id, s.email, 'super']) expect(text).not.toContain(leak);
      }
    }
    const staff = await firmCall('get', '', people.staffA);
    expect([staff.status, codeOf(staff)]).toEqual([403, 'FORBIDDEN']);
    const b = await firmList('', people.ownerB, 'b');
    expect(b.items.map((i) => i.id)).toEqual([asked.super2B.id]);
  });

  it("only an Owner answers: Admin and Staff 403, another firm's Owner 404, a bad id 400", async () => {
    const id = asked.super1A.id;
    for (const who of [people.adminA, people.staffA]) {
      for (const action of ['approve', 'decline', 'revoke']) {
        const res = await firmCall('post', `/${id}/${action}`, who, 'a', {});
        expect([res.status, codeOf(res)], action).toEqual([403, 'FORBIDDEN']);
      }
    }
    for (const action of ['approve', 'decline', 'revoke']) {
      const other = await firmCall('post', `/${id}/${action}`, people.ownerB, 'b', {});
      expect([other.status, codeOf(other)], action).toEqual([404, 'NOT_FOUND']);
    }
    const unknown = await firmCall('post', `/${randomUUID()}/approve`, people.ownerA, 'a', {});
    expect([unknown.status, codeOf(unknown)]).toEqual([404, 'NOT_FOUND']);
    const bad = await firmCall('post', '/nope/approve', people.ownerA, 'a', {});
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
  });

  it('approve: 1 to 72 whole hours from now on the database clock, once; in both logs', async () => {
    const id = asked.super1A.id;
    for (const hours of [0, 73, 1.5, '12', null]) {
      const res = await firmCall('post', `/${id}/approve`, people.ownerA, 'a', { hours });
      expect([res.status, codeOf(res)], String(hours)).toEqual([400, 'VALIDATION_FAILED']);
    }
    const before = Date.now();
    // The id in capitals is the same request.
    const res = await firmCall('post', `/${id.toUpperCase()}/approve`, people.ownerA, 'a', {
      hours: 2,
    });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const approved = FirmView.parse(res.body);
    expect(approved).toMatchObject({
      id,
      status: 'ACTIVE',
      approvedBy: { userId: people.ownerA.id, name: 'Fake R8 ownerA' },
      endedAt: null,
    });
    const expiresAt = Date.parse(approved.expiresAt ?? '');
    expect(expiresAt).toBeGreaterThan(before + 2 * HOUR - 60_000);
    expect(expiresAt).toBeLessThan(Date.now() + 2 * HOUR + 60_000);
    for (const action of ['approve', 'decline']) {
      const again = await firmCall('post', `/${id}/${action}`, people.ownerA, 'a', {});
      expect([again.status, codeOf(again)], action).toEqual([409, 'SUPPORT_REQUEST_DECIDED']);
    }
    // An active grant is open too: no second request beside it.
    const ask2 = await adminCall('post', `/firms/${firms.a.id}/support-access`, people.super1, {
      reason: 'While active',
    });
    expect([ask2.status, codeOf(ask2)]).toEqual([409, 'SUPPORT_REQUEST_OPEN']);
    expect(await auditOf(id, firms.a.id)).toEqual([
      ['support.requested', people.super1.id, {}],
      ['support.approved', people.ownerA.id, { hours: 2 }],
    ]);
    expect(await auditOf(id, null)).toEqual([
      ['support.requested', people.super1.id, { businessId: firms.a.id }],
      ['support.approved', people.ownerA.id, { businessId: firms.a.id, hours: 2 }],
    ]);
    const { items } = await adminList(`?businessId=${firms.a.id}&status=ACTIVE`);
    expect(items.find((i) => i.id === id)).toMatchObject({ expiresAt: approved.expiresAt });
  });

  it('decline a pending request; then nothing more, and a new request may follow', async () => {
    const id = asked.super2A.id;
    const declined = await answer(id, 'decline');
    expect(declined).toMatchObject({ status: 'DECLINED', approvedBy: null, expiresAt: null });
    expect(declined.endedAt).not.toBeNull();
    for (const [action, code] of [
      ['approve', 'SUPPORT_REQUEST_DECIDED'],
      ['decline', 'SUPPORT_REQUEST_DECIDED'],
      ['revoke', 'SUPPORT_GRANT_NOT_ACTIVE'],
    ]) {
      const res = await firmCall('post', `/${id}/${action}`, people.ownerA, 'a', {});
      expect([res.status, codeOf(res)], action).toEqual([409, code]);
    }
    expect((await auditOf(id, null)).map(([action]) => action)).toEqual([
      'support.requested',
      'support.declined',
    ]);
    asked.super2A2 = await ask('a', people.super2);
  });

  it('the database has the last word: an Owner demoted while approving gets 403', async () => {
    const id = asked.super2A2.id;
    const db = owner();
    try {
      // Hold the request's row, so the approval waits after its role check.
      const row = await hold(
        db,
        (tx) =>
          tx.$queryRaw`SELECT id FROM support_access_grants WHERE id = ${id}::uuid FOR UPDATE`,
      );
      const approving = firmCall('post', `/${id}/approve`, people.ownerA2, 'a', {});
      try {
        await blockedBy(db, row.pid);
        await runInScope(db, { kind: 'business', businessId: firms.a.id }, (tx) =>
          tx.membership.updateMany({
            where: { businessId: firms.a.id, userId: people.ownerA2.id },
            data: { role: 'ADMIN' },
          }),
        );
      } finally {
        await row.release();
      }
      const res = await approving;
      // Refused by R0's trigger after the role check had passed (the guard's 403 says otherwise).
      expect([res.status, res.body]).toEqual([
        403,
        {
          error: expect.objectContaining({
            code: 'FORBIDDEN',
            message: 'Only an Owner answers support access requests',
          }) as unknown,
        },
      ]);
    } finally {
      await db.$disconnect();
    }
    const { items } = await firmList('?status=PENDING');
    expect(items.map((i) => i.id)).toContain(id);
    expect((await auditOf(id, firms.a.id)).map(([action]) => action)).toEqual([
      'support.requested',
    ]);
  });

  it('revoke an active grant (a pending one is 409); 24 hours when approve names none', async () => {
    const id = asked.super2B.id;
    const pending = await firmCall('post', `/${id}/revoke`, people.ownerB, 'b', {});
    expect([pending.status, codeOf(pending)]).toEqual([409, 'SUPPORT_GRANT_NOT_ACTIVE']);
    const approved = await answer(id, 'approve', 'b');
    expect(Date.parse(approved.expiresAt ?? '') - Date.now()).toBeGreaterThan(24 * HOUR - 120_000);
    const revoked = await answer(id, 'revoke', 'b');
    expect(revoked).toMatchObject({ status: 'REVOKED', approvedBy: { userId: people.ownerB.id } });
    expect(revoked.endedAt).not.toBeNull();
    const again = await firmCall('post', `/${id}/revoke`, people.ownerB, 'b', {});
    expect([again.status, codeOf(again)]).toEqual([409, 'SUPPORT_GRANT_NOT_ACTIVE']);
    expect(await auditOf(id, firms.b.id)).toEqual([
      ['support.requested', people.super2.id, {}],
      ['support.approved', people.ownerB.id, { hours: 24 }],
      ['support.revoked', people.ownerB.id, {}],
    ]);
    expect((await auditOf(id, null)).map(([action, actor]) => [action, actor])).toEqual([
      ['support.requested', people.super2.id],
      ['support.approved', people.ownerB.id],
      ['support.revoked', people.ownerB.id],
    ]);
  });

  it('an ask that finds another ask in progress is 409 at once; 72 hours is the most', async () => {
    const db = owner();
    const key = `fv-support-access:${firms.b.id}:${people.super2.id}`;
    try {
      // Another ask by the same Super Admin for the same firm holds the pair's lock.
      const other = await hold(db, async (tx) => {
        const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`
          SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS ok`;
        if (lock?.ok !== true) throw new Error('The test could not take the lock');
      });
      try {
        const res = await adminCall('post', `/firms/${firms.b.id}/support-access`, people.super2, {
          reason: 'Meanwhile',
        });
        expect([res.status, codeOf(res)]).toEqual([409, 'SUPPORT_REQUEST_OPEN']);
      } finally {
        await other.release();
      }
    } finally {
      await db.$disconnect();
    }
    const asked2 = await ask('b', people.super2);
    const before = Date.now();
    const res = await firmCall('post', `/${asked2.id}/approve`, people.ownerB, 'b', { hours: 72 });
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const expiresAt = Date.parse(FirmView.parse(res.body).expiresAt ?? '');
    expect(expiresAt).toBeGreaterThan(before + 72 * HOUR - 60_000);
    expect(expiresAt).toBeLessThan(Date.now() + 72 * HOUR + 60_000);
  });

  it('a grant expires on its own: EXPIRED, no revoke, and a new request may follow', async () => {
    await expire(asked.super1A.id);
    const { items } = await firmList('?status=EXPIRED');
    expect(items.map((i) => i.id)).toEqual([asked.super1A.id]);
    const res = await firmCall('post', `/${asked.super1A.id}/revoke`, people.ownerA, 'a', {});
    expect([res.status, codeOf(res)]).toEqual([409, 'SUPPORT_GRANT_NOT_ACTIVE']);
    asked.super1A2 = await ask('a', people.super1);
  });
});

describe("the Super Admins' list", () => {
  it("one firm's or every firm's: pending, then active, then the rest, newest first; paged", async () => {
    // The older of the two pending requests becomes active.
    await answer(asked.super2A2.id, 'approve');
    const all = await adminList(`?businessId=${firms.a.id.toUpperCase()}&limit=100`);
    expect(all.items.every((i) => i.firm.id === firms.a.id)).toBe(true);
    expect(all.items.map((i) => [i.id, i.status, i.admin.name])).toEqual([
      [asked.super1A2.id, 'PENDING', 'Fake R8 super1'],
      [asked.super2A2.id, 'ACTIVE', 'Fake R8 super2'],
      [asked.super2A.id, 'DECLINED', 'Fake R8 super2'],
      [asked.super1A.id, 'EXPIRED', 'Fake R8 super1'],
    ]);

    const paged: string[] = [];
    let cursor: string | null = null;
    do {
      const c: string = cursor ? `&cursor=${encodeURIComponent(cursor)}` : '';
      const page = await adminList(`?businessId=${firms.a.id}&limit=1${c}`);
      paged.push(...page.items.map((i) => i.id));
      cursor = page.nextCursor;
    } while (cursor);
    expect(paged).toEqual(all.items.map((i) => i.id));

    const revoked = await adminList('?status=REVOKED&limit=100');
    expect(revoked.items.map((i) => i.id)).toContain(asked.super2B.id);
    const bad = await adminCall('get', '/support-access?cursor=nope');
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    const firmSession = await adminCall('get', '/support-access', people.ownerA);
    expect(firmSession.status).toBe(401);
  });
});
