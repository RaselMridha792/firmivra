// End-to-end: R12 step 5, the firm's calculators (contract in packages/types/src/calculators).
// Everyone at the firm reads the list; Owner and Admin turn a calculator on or off and edit its
// title and disclaimer (Staff 403). A firm without a row gets the default definition (placeholder
// figures) and reading never creates a row; the first change does, once, even when two arrive
// together. Clients read enabled calculators only (a turned-off key is 404). Another firm gets
// 404 and changes nothing. Changes are audited with the key and field names, never the text.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { z } from 'zod';
import {
  CalculatorList,
  FirmCalculatorList,
  TaxReturnCalculator,
  TaxReturnConfig,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';

// Strict copies of the contract's shapes, so a leaked field (businessId, id) fails. The parsed
// list types still come from the contract's own schemas below.
const Config = z.strictObject(TaxReturnConfig.shape);
const MyCalc = z.strictObject({ ...TaxReturnCalculator.shape, config: Config });
const FirmCalc = MyCalc.extend({ enabled: z.boolean(), sortOrder: z.number().int() }).strict();
const FirmList = z.strictObject({ items: z.array(FirmCalc) });
const MyList = z.strictObject({ items: z.array(MyCalc) });
type FirmCalc = z.infer<typeof FirmCalc>;

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `r12k-${key}-${run}@r12.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  pendingClientA: person('client-pending-a'),
  ownerB: person('owner-b'),
  clientB: person('client-b'),
  ownerC: person('owner-c'),
};
type Person = (typeof people)[keyof typeof people];
type Firm = 'a' | 'b' | 'c';
const firms = {} as Record<Firm, { id: string; slug: string }>;

let app: INestApplication;
const tokens = new Map<string, string>();
let lastViewer = 0;
const newViewer = () => `198.51.${Math.floor(++lastViewer / 250)}.${lastViewer % 250}`;

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: Parameters<typeof runInScope<T>>[2],
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}

async function tokenFor(email: string): Promise<string> {
  const cached = tokens.get(email);
  if (cached) return cached;
  const res = await request(app.getHttpServer())
    .post('/api/v1/dev/token')
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`)
    .send({ email })
    .expect(200);
  const token = (res.body as { token: string }).token;
  tokens.set(email, token);
  return token;
}

/** A firm call (Bearer: no cookie, so no Origin needed). A string body is sent as raw JSON. */
async function call(
  method: 'get' | 'patch',
  path: string,
  who: Person,
  firm: Firm = 'a',
  body?: object | string,
): Promise<Response> {
  const req = request(app.getHttpServer())
    [method](`/api/v1/business/calculators${path}`)
    .set('x-business-id', firms[firm].id)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
  if (body === undefined) return req;
  return typeof body === 'string'
    ? req.set('content-type', 'application/json').send(body)
    : req.send(body);
}

async function portal(who: Person, path = '', firm: Firm = 'a'): Promise<Response> {
  return request(app.getHttpServer())
    .get(`/api/v1/portal/${firms[firm].slug}/me/calculators${path}`)
    .set('authorization', `Bearer ${await tokenFor(who.email)}`)
    .set('x-forwarded-for', `${newViewer()}, 10.0.0.5`);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res;
};
const list = async (who: Person = people.ownerA, firm: Firm = 'a') => {
  const body = ok(await call('get', '', who, firm)).body as unknown;
  FirmCalculatorList.parse(body);
  return FirmList.parse(body).items;
};
const update = async (body: object, who: Person = people.ownerA, firm: Firm = 'a') =>
  FirmCalc.parse(ok(await call('patch', '/tax_return', who, firm, body)).body);
const mine = async (who: Person = people.clientA, firm: Firm = 'a') => {
  const body = ok(await portal(who, '', firm)).body as unknown;
  CalculatorList.parse(body);
  return MyList.parse(body).items;
};
const rowsOf = (firm: Firm) =>
  asOwner({ kind: 'business', businessId: firms[firm].id }, (tx) =>
    tx.calculatorDefinition.findMany({ where: { businessId: firms[firm].id } }),
  );
const taxReturn = (items: FirmCalc[]) => {
  const found = items.find((c) => c.key === 'tax_return');
  if (!found) throw new Error('no tax_return calculator');
  return found;
};

/**
 * Starts the calls while a table lock holds back every write to calculator_definitions, waits
 * until `writers` of them are queued on it, then lets them go at once. Without the lock the calls
 * may run one after the other, and a check-then-insert would pass; with it, such code collides on
 * the unique key (500) every time.
 */
async function releasedTogether(
  writers: number,
  start: () => Promise<Response>[],
): Promise<Response[]> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    let calls: Promise<Response>[] = [];
    await runInScope(
      owner,
      { kind: 'platform' },
      async (tx) => {
        await tx.$executeRaw`LOCK TABLE calculator_definitions IN SHARE ROW EXCLUSIVE MODE`;
        calls = start();
        for (let i = 0; i < 200; i += 1) {
          // pg_locks lists every database on the server: count this one's waiters only.
          const [queued] = await tx.$queryRaw<{ n: number }[]>`
            SELECT count(*)::int AS n FROM pg_locks
            WHERE database = (SELECT oid FROM pg_database WHERE datname = current_database())
              AND relation = 'calculator_definitions'::regclass AND NOT granted`;
          if ((queued?.n ?? 0) >= writers) return;
          await new Promise((resolve) => setTimeout(resolve, 25));
        }
        throw new Error(`fewer than ${writers} writes reached calculator_definitions`);
      },
      { timeout: 15_000 },
    );
    return await Promise.all(calls);
  } finally {
    await owner.$disconnect();
  }
}

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.toLowerCase().includes('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake R12k ${key}` },
      });
    }
    for (const key of ['a', 'b', 'c'] as const) {
      const slug = `r12k-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  const members = [
    ['a', people.ownerA.id, 'OWNER'],
    ['a', people.adminA.id, 'ADMIN'],
    ['a', people.staffA.id, 'STAFF'],
    ['b', people.ownerB.id, 'OWNER'],
    ['c', people.ownerC.id, 'OWNER'],
  ] as const;
  for (const [firm, userId, role] of members) {
    const businessId = firms[firm].id;
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  const clients = [
    ['a', people.clientA, 'ACTIVE'],
    ['a', people.pendingClientA, 'PENDING_APPROVAL'],
    ['b', people.clientB, 'ACTIVE'],
  ] as const;
  for (const [firm, p, status] of clients) {
    const businessId = firms[firm].id;
    await asOwner({ kind: 'business', businessId }, (tx) =>
      tx.clientAccount.create({ data: { businessId, userId: p.id, email: p.email, status } }),
    );
  }

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

describe('a firm with no definition yet', () => {
  it('everyone at the firm reads the default placeholder definition; reading creates no row', async () => {
    for (const who of [people.ownerA, people.adminA, people.staffA]) {
      const items = await list(who);
      expect(items.map((c) => c.key)).toEqual(['tax_return']);
      const c = taxReturn(items);
      expect(c).toMatchObject({ title: 'Tax Return Calculator', enabled: true, sortOrder: 0 });
      expect(c.config.placeholder).toBe(true);
      expect(c.disclaimer.length).toBeGreaterThan(0);
    }
    expect(await mine()).toHaveLength(1);
    expect(MyCalc.parse(ok(await portal(people.clientA, '/tax_return')).body).key).toBe(
      'tax_return',
    );
    expect(await rowsOf('a')).toEqual([]);
  });

  it('a stored config that is not a valid definition shows the placeholder figures', async () => {
    await asOwner({ kind: 'business', businessId: firms.c.id }, (tx) =>
      tx.calculatorDefinition.create({
        data: {
          businessId: firms.c.id,
          key: 'tax_return',
          title: 'Firm C calculator (fake)',
          disclaimer: 'Firm C disclaimer (fake).',
          config: { taxYear: 2025, note: 'Sample figures for local development only.' },
          sortOrder: 2,
        },
      }),
    );
    const c = taxReturn(await list(people.ownerC, 'c'));
    expect(c).toMatchObject({ title: 'Firm C calculator (fake)', sortOrder: 2, enabled: true });
    expect(c.config.placeholder).toBe(true);
    expect(c.config.filingStatuses).toHaveLength(4);
  });
});

describe('who changes what', () => {
  it('clients get 403 on the firm routes; staff members get 401 on the portal', async () => {
    expect((await call('get', '', people.clientA)).status).toBe(403);
    expect(
      (await call('patch', '/tax_return', people.clientA, 'a', { enabled: false })).status,
    ).toBe(403);
    expect((await portal(people.ownerA)).status).toBe(401);
  });

  it('Staff read but cannot change (403, nothing written)', async () => {
    const before = await rowsOf('a');
    for (const body of [{ enabled: false }, { title: 'Staff title' }, {}]) {
      const res = await call('patch', '/tax_return', people.staffA, 'a', body);
      expect([res.status, codeOf(res)]).toEqual([403, 'FORBIDDEN']);
    }
    expect(await rowsOf('a')).toEqual(before);
  });

  it('two first changes at once create one row, and both apply', async () => {
    const both = await releasedTogether(2, () => [
      call('patch', '/tax_return', people.ownerA, 'a', { title: 'Estimate your 2025 return' }),
      call('patch', '/tax_return', people.adminA, 'a', {
        disclaimer: 'An estimate, not tax advice (fake firm A).',
      }),
    ]);
    expect(both).toHaveLength(2);
    for (const res of both) ok(res);
    const rows = await rowsOf('a');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      title: 'Estimate your 2025 return',
      disclaimer: 'An estimate, not tax advice (fake firm A).',
      enabled: true,
    });
    // The row holds no copy of the default figures: they keep coming from the defaults.
    expect(rows[0]?.config).toEqual({});
    expect(taxReturn(await list()).config).toEqual(
      taxReturn(await list(people.ownerB, 'b')).config,
    );
    const audit = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.a.id, action: 'calculator.updated' } }),
    );
    expect(audit.filter((r) => (r.metadata as { created?: boolean }).created)).toHaveLength(1);
  });

  it('Owner and Admin turn it off and on; the title is trimmed', async () => {
    const off = await update({ enabled: false }, people.adminA);
    expect(off).toMatchObject({ enabled: false, title: 'Estimate your 2025 return' });
    expect(taxReturn(await list(people.staffA)).enabled).toBe(false);
    const on = await update({ enabled: true, title: '  Tax estimate  ' });
    expect(on).toMatchObject({ enabled: true, title: 'Tax estimate' });
    expect(on.config.placeholder).toBe(true);
  });
});

describe('the portal', () => {
  it('clients see enabled calculators only; a turned-off key is 404', async () => {
    await update({ enabled: false });
    expect(await mine()).toEqual([]);
    const gone = await portal(people.clientA, '/tax_return');
    expect([gone.status, codeOf(gone)]).toEqual([404, 'NOT_FOUND']);

    await update({ enabled: true, title: 'Tax estimate', disclaimer: 'Estimate only (fake A).' });
    const items = await mine();
    expect(items).toEqual([expect.objectContaining({ key: 'tax_return', title: 'Tax estimate' })]);
    expect(items[0]).not.toHaveProperty('enabled');
    const one = MyCalc.parse(ok(await portal(people.clientA, '/tax_return')).body);
    expect(one.disclaimer).toBe('Estimate only (fake A).');
  });

  it('an unknown key is 400; a pending client and another firm’s client are 404', async () => {
    const bad = await portal(people.clientA, '/mortgage');
    expect([bad.status, codeOf(bad)]).toEqual([400, 'VALIDATION_FAILED']);
    for (const who of [people.pendingClientA, people.clientB]) {
      expect((await portal(who)).status).toBe(404);
      expect((await portal(who, '/tax_return')).status).toBe(404);
    }
    // Firm A's client on firm B's portal: no account there, so nothing of either firm.
    expect((await portal(people.clientA, '', 'b')).status).toBe(404);
    expect((await portal(people.clientA, '/tax_return', 'b')).status).toBe(404);
  });
});

describe('another firm', () => {
  it('gets 404 on firm A and changes nothing; its own list is its own', async () => {
    const before = await rowsOf('a');
    const read = await call('get', '', people.ownerB, 'a');
    expect([read.status, codeOf(read)]).toEqual([404, 'NOT_FOUND']);
    const write = await call('patch', '/tax_return', people.ownerB, 'a', { enabled: false });
    expect([write.status, codeOf(write)]).toEqual([404, 'NOT_FOUND']);
    expect(await rowsOf('a')).toEqual(before);

    const own = taxReturn(await list(people.ownerB, 'b'));
    expect(own).toMatchObject({ title: 'Tax Return Calculator', enabled: true });
    expect(await mine(people.clientB, 'b')).toHaveLength(1);

    // Firm B turning its own off leaves firm A's clients alone.
    await update({ enabled: false }, people.ownerB, 'b');
    expect(await mine(people.clientB, 'b')).toEqual([]);
    expect(await mine()).toHaveLength(1);
    expect(await rowsOf('a')).toEqual(before);
  });
});

describe('validation', () => {
  it('bad bodies and keys are 400 and change nothing', async () => {
    const before = await rowsOf('a');
    for (const body of [
      {},
      { config: { taxYear: 2025 } },
      { enabled: 'yes' },
      { title: '' },
      { title: '   ' },
      { title: 'x'.repeat(81) },
      { title: 'Line\nbreak' },
      { disclaimer: 'x'.repeat(2_001) },
      { title: 'Tax‮estimate' },
      // NUL and half a surrogate pair: refused. Postgres text cannot hold NUL, and the driver
      // would store half a pair as U+FFFD (200, with text other than what was sent).
      '{"title":"Tax\\u0000estimate"}',
      '{"disclaimer":"Estimate\\u0000only"}',
      '{"title":"Tax \\ud800 estimate"}',
      '{"disclaimer":"Estimate \\udc00 only"}',
    ]) {
      const res = await call('patch', '/tax_return', people.ownerA, 'a', body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
    for (const key of ['mortgage', 'TAX_RETURN', '%00']) {
      const res = await call('patch', `/${key}`, people.ownerA, 'a', { enabled: true });
      expect([res.status, codeOf(res)], key).toEqual([400, 'VALIDATION_FAILED']);
    }
    expect(await rowsOf('a')).toEqual(before);
  });

  it('a surrogate pair (an emoji) is fine', async () => {
    const c = await update({ title: 'Tax estimate \u{1F9FE}' });
    expect(c.title).toBe('Tax estimate \u{1F9FE}');
    await update({ title: 'Tax estimate' });
  });
});

describe('audit', () => {
  it('logs each change with the key and field names, never the text', async () => {
    await update({ disclaimer: 'Secret-ish disclaimer (fake)', title: 'Secret-ish title' });
    await update({ title: 'Tax estimate', disclaimer: 'Estimate only (fake A).' });
    const rows = await asOwner({ kind: 'business', businessId: firms.a.id }, (tx) =>
      tx.auditLog.findMany({
        where: { businessId: firms.a.id, action: 'calculator.updated' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(rows.length).toBeGreaterThan(3);
    const [definition] = await rowsOf('a');
    for (const r of rows) {
      expect(r.entityType).toBe('calculator');
      expect(r.entityId).toBe(definition?.id);
      expect(r.actorUserId).toBeTruthy();
    }
    expect(JSON.stringify(rows.map((r) => r.metadata))).not.toContain('Secret-ish');
    expect(rows.map((r) => r.metadata)).toContainEqual({
      key: 'tax_return',
      fields: ['title', 'disclaimer'],
      created: false,
    });
    expect(rows.map((r) => r.metadata)).toContainEqual({
      key: 'tax_return',
      fields: ['enabled'],
      created: false,
      enabled: false,
    });
    // Firm B's change is in firm B's log only.
    const b = await asOwner({ kind: 'business', businessId: firms.b.id }, (tx) =>
      tx.auditLog.findMany({ where: { businessId: firms.b.id, action: 'calculator.updated' } }),
    );
    expect(b).toHaveLength(1);
    expect(rows.map((r) => r.id)).not.toContain(b[0]?.id);
  });
});
