// R8 step 2, the tenant isolation suite. Table-driven over every route the API serves, read
// from the Nest router at test time (routes.ts), so a new route without a case fails here:
// - a member of firm Q gets 404 naming firm P (x-business-id), on every firm route;
// - a member of firm Q gets 404 on firm P's records by id, on every route that takes one;
// - a client of firm P gets 404 at firm Q's portal, on every client route;
// - client Y gets 404 on client X's records in the same firm;
// - none of those refusals changed a row of firm P;
// - firm Q's lists and client Y's portal lists show none of firm P's or client X's records;
// - the Super Admin routes refuse firm and client sessions, and the firm and portal routes
//   refuse a Super Admin;
// - and the positive control: firm P's own Owner and client X reach every case (2xx, or the
//   case's `expect`), so a 404 above is the wall and not a broken case.
//
// Adding a route: put its case in test/isolation/cases/<module>.ts (one file per module; see
// world.ts for the shapes). A route with a record param needs `cases`; a record it names that no
// file creates yet needs `records`; a route that is neither a firm nor a portal route goes in
// `excluded` with the reason.
import { readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { type ApiRoute, apiRoutes, fillPath, paramsOf } from './routes.js';
import { type CaseModule, type OwnIds, type Person, type RecordCase, World } from './world.js';

/** Every cases/<module>.ts, merged; the same key in two files is an error. */
async function loadCases() {
  const dir = new URL('./cases/', import.meta.url);
  const merged = {
    records: {} as NonNullable<CaseModule['records']>,
    cases: {} as Record<string, RecordCase & { file: string }>,
    excluded: {} as Record<string, string>,
    duplicates: [] as string[],
  };
  for (const file of readdirSync(dir)
    .filter((f) => f.endsWith('.ts'))
    .sort()) {
    const mod = (await import(new URL(file, dir).href)) as CaseModule;
    for (const [key, def] of Object.entries(mod.records ?? {})) {
      if (key in merged.records) merged.duplicates.push(`record ${key} (${file})`);
      merged.records[key] = def;
    }
    for (const [key, c] of Object.entries(mod.cases ?? {})) {
      if (key in merged.cases) merged.duplicates.push(`case ${key} (${file})`);
      merged.cases[key] = { ...c, file };
    }
    for (const [key, why] of Object.entries(mod.excluded ?? {})) {
      if (key in merged.excluded) merged.duplicates.push(`excluded ${key} (${file})`);
      merged.excluded[key] = why;
    }
  }
  return merged;
}
const { records: RECORDS, cases: CASES, excluded: EXCLUDED, duplicates } = await loadCases();

/**
 * Path params that are not records, each tied to the routes that use it, with a value valid for
 * any firm. The same name on any other route is a record param and needs a case.
 */
const FIXED_PARAMS: { param: string; value: string; routes: RegExp }[] = [
  { param: 'year', value: '2025', routes: /\/tax-years\/:year(\/history)?$/ },
  { param: 'kind', value: 'terms', routes: /\/legal\/:kind(\/versions(\/:version)?)?$/ },
  { param: 'version', value: '1', routes: /\/legal\/:kind\/versions\/:version$/ },
  { param: 'key', value: 'tax-bracket', routes: /\/calculators\/:key$/ },
  { param: 'step', value: 'branding', routes: /\/setup\/steps\/:step$/ },
];
const fixedOf = (path: string): Record<string, string> =>
  Object.fromEntries(
    FIXED_PARAMS.filter((f) => f.routes.test(path)).map((f) => [f.param, f.value]),
  );

const isFirmRoute = (r: ApiRoute) =>
  !r.isPublic &&
  r.roles.some((role) => ['OWNER', 'ADMIN', 'STAFF'].includes(role)) &&
  !r.path.startsWith('/api/v1/portal/');
const isPortalRoute = (r: ApiRoute) =>
  !r.isPublic && r.path.startsWith('/api/v1/portal/:firmSlug/') && r.roles.includes('CLIENT');
const isAdminRoute = (r: ApiRoute) => !r.isPublic && r.roles.includes('SUPER_ADMIN');
/** Every param but the firm's slug and the fixed ones names a record. */
const recordParams = (r: ApiRoute) =>
  paramsOf(r.path).filter((p) => p !== 'firmSlug' && !(p in fixedOf(r.path)));
const keyOf = (r: ApiRoute) => `${r.method} ${r.path}`;
const is2xx = (status: number) => status >= 200 && status < 300;

const fx = inject('fixtures');
const tag = randomUUID().slice(0, 8);
let app: INestApplication;
let routes: ApiRoute[];
const db = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
const own = {} as Record<'p' | 'q', OwnIds>;
const firms = {} as Record<'p' | 'q', { id: string; slug: string }>;
const person = (key: string): Person => ({ id: randomUUID(), email: `iso-${key}-${tag}@iso.test` });
const people = {
  ownerP: person('owner-p'),
  clientY: person('client-y'),
  ownerQ: person('owner-q'),
  clientQ: person('client-q'),
};
const admin: Person = fx.users.admin;
/** The world the refusal tests share: one of each record. */
let base: World;
const tokens = new Map<string, string>();

async function tokenFor(who: Person, pool: 'STAFF' | 'CLIENT' | 'ADMIN'): Promise<string> {
  const cached = tokens.get(who.id);
  if (cached) return cached;
  const { token } = await app.get(TokenService).signLocal(who.id, pool);
  tokens.set(who.id, token);
  return token;
}

const as = {
  firm: (who: Person, firmId: string) => ({ who, pool: 'STAFF' as const, firmId }),
  client: (who: Person) => ({ who, pool: 'CLIENT' as const }),
  admin: () => ({ who: admin, pool: 'ADMIN' as const }),
};
type Actor = { who: Person; pool: 'STAFF' | 'CLIENT' | 'ADMIN'; firmId?: string };

async function call(route: ApiRoute, path: string, actor: Actor, body?: object): Promise<Response> {
  const method = route.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete';
  let req = request(app.getHttpServer())
    [method](path)
    .set('authorization', `Bearer ${await tokenFor(actor.who, actor.pool)}`);
  if (actor.firmId) req = req.set('x-business-id', actor.firmId);
  return route.method === 'GET' || route.method === 'DELETE' ? req : req.send(body ?? {});
}

const show = (res: Response) => `${res.status} ${JSON.stringify(res.body).slice(0, 300)}`;

/** A world of firm P's records with at least `keys` in it. */
function buildWorld(keys: string[]): Promise<World> {
  return runInScope(db, { kind: 'business', businessId: firms.p.id }, async (tx) => {
    const world = new World(RECORDS, {
      tx,
      businessId: firms.p.id,
      owner: people.ownerP,
      own: own.p,
    });
    await world.getAll(keys);
    return world;
  });
}

/** A hash of every row of firm P, table by table, except the audit log (reads write to it). */
async function fingerprint(): Promise<Record<string, string>> {
  const tables = await db.$queryRaw<{ name: string }[]>`
    SELECT c.table_name AS name FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_schema = c.table_schema AND t.table_name = c.table_name
    WHERE c.table_schema = 'public' AND c.column_name = 'business_id'
      AND t.table_type = 'BASE TABLE' AND c.table_name <> 'audit_logs'
    ORDER BY 1`;
  return runInScope(db, { kind: 'business', businessId: firms.p.id }, async (tx) => {
    const out: Record<string, string> = {};
    for (const { name } of tables) {
      const [row] = await tx.$queryRawUnsafe<{ n: number; h: string }[]>(
        `SELECT count(*)::int AS n, md5(coalesce(string_agg(t::text, '|' ORDER BY t::text), ''))
           AS h FROM "${name.replace(/"/g, '')}" t WHERE business_id = $1::uuid`,
        firms.p.id,
      );
      out[name] = `${row?.n ?? 0}:${row?.h ?? ''}`;
    }
    return out;
  });
}

beforeAll(async () => {
  await runInScope(db, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key.startsWith('client') ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake ${key}` },
      });
    }
    for (const k of ['p', 'q'] as const) {
      firms[k] = await tx.business.create({
        data: { slug: `iso-${k}-${tag}`, name: `Fake Firm ${k} ${tag}`, status: 'ACTIVE' },
        select: { id: true, slug: true },
      });
    }
  });
  for (const k of ['p', 'q'] as const) {
    const [ownerKey, clientKey] =
      k === 'p' ? (['ownerP', 'clientY'] as const) : (['ownerQ', 'clientQ'] as const);
    await runInScope(db, { kind: 'business', businessId: firms[k].id }, async (tx) => {
      const businessId = firms[k].id;
      await tx.membership.create({
        data: { businessId, userId: people[ownerKey].id, role: 'OWNER', status: 'ACTIVE' },
      });
      const login = people[clientKey];
      const client = await tx.client.create({
        data: { businessId, displayName: `Fake ${clientKey}`, email: login.email },
      });
      await tx.clientAccount.create({
        data: {
          businessId,
          userId: login.id,
          clientId: client.id,
          email: login.email,
          status: 'ACTIVE',
        },
      });
      const service = (kind: 'ANNUAL_TAX' | 'BOOKKEEPING', name: string) =>
        tx.service.create({ data: { businessId, kind, name } }).then((s) => s.id);
      own[k] = {
        service: await service('ANNUAL_TAX', 'Fake annual tax'),
        bookkeeping: await service('BOOKKEEPING', 'Fake bookkeeping'),
        taxStatus: (await tx.taxStatus.create({ data: { businessId, name: 'Fake status' } })).id,
      };
    });
  }
  base = await buildWorld(Object.keys(RECORDS));

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
  routes = apiRoutes(app);
});

afterAll(async () => {
  await app?.close();
  await db.$disconnect();
});

const fill = (route: ApiRoute, firmSlug: string, records: Record<string, string> = {}) =>
  fillPath(route.path, { firmSlug, ...fixedOf(route.path), ...records });

/**
 * Routes whose record params all have a case. The sweeps run over these; a route without its
 * case fails the coverage test instead.
 */
const ready = (r: ApiRoute) => {
  const c = CASES[keyOf(r)];
  return recordParams(r).every((p) => c?.params[p] !== undefined);
};

const recordsOf = (c: RecordCase, world: World) =>
  Object.fromEntries(Object.entries(c.params).map(([param, key]) => [param, world.rec[key]!]));

const bodyOf = (c: RecordCase | undefined, ids: OwnIds, world: World) =>
  typeof c?.body === 'function'
    ? c.body({
        own: ids,
        rec: Object.fromEntries((c.bodyRecords ?? []).map((k) => [k, world.rec[k]!])),
      })
    : c?.body;

const HOW_TO_ADD =
  'Add it in test/isolation/cases/<module>.ts: `cases` maps "METHOD /api/v1/path" to ' +
  '{ params: { <param>: "<record>" }, body?, expect? }; a record no file creates yet goes in ' +
  '`records` as { create(ctx) { ...return id } } (see world.ts); a route that is neither a firm ' +
  'nor a portal route goes in `excluded` with the reason.';

describe('tenant isolation (R8 step 2)', () => {
  it('every route is covered: a case per record route, an excluded reason for the rest', () => {
    expect(duplicates, 'the same key in two case files').toEqual([]);
    const problems: string[] = [];
    const keys = new Set(routes.map(keyOf));
    for (const route of routes) {
      const key = keyOf(route);
      if (isAdminRoute(route)) {
        if (key in EXCLUDED) problems.push(`${key}: a Super Admin route is swept, not excluded`);
        continue;
      }
      const checked = isFirmRoute(route) || isPortalRoute(route);
      if (!checked) {
        if (!(key in EXCLUDED))
          problems.push(`${key}: not a firm, portal or Super Admin route, and not excluded`);
        continue;
      }
      if (key in EXCLUDED) problems.push(`${key}: a firm or portal route can't be excluded`);
      const params = recordParams(route);
      const c = CASES[key];
      if (params.length === 0) {
        if (c) problems.push(`${key} (${c.file}): has no record param, so no case`);
        continue;
      }
      if (!c) {
        problems.push(`${key}: no case for :${params.join(', :')}`);
        continue;
      }
      const mapped = Object.keys(c.params).sort().join(',');
      if (mapped !== [...params].sort().join(','))
        problems.push(
          `${key} (${c.file}): params map ${mapped || 'nothing'}, the path has ${params.join(',')}`,
        );
      for (const rec of [...Object.values(c.params), ...(c.bodyRecords ?? [])])
        if (!(rec in base.rec))
          problems.push(`${key} (${c.file}): no record "${rec}" in any records export`);
    }
    for (const [key, c] of Object.entries(CASES))
      if (!keys.has(key)) problems.push(`${key} (${c.file}): no such route`);
    for (const [key, why] of Object.entries(EXCLUDED)) {
      if (!keys.has(key)) problems.push(`${key}: excluded, but no such route`);
      if (why.trim().length < 10) problems.push(`${key}: excluded without a reason`);
    }
    expect(problems, HOW_TO_ADD).toEqual([]);
  });

  describe('refusals', () => {
    let before: Record<string, string>;
    beforeAll(async () => {
      before = await fingerprint();
    });

    it('a member of firm Q gets 404 naming firm P, on every firm route', async () => {
      const failures: string[] = [];
      for (const route of routes.filter(isFirmRoute).filter(ready)) {
        const c = CASES[keyOf(route)];
        const path = fill(route, firms.p.slug, c ? recordsOf(c, base) : {});
        const res = await call(
          route,
          path,
          as.firm(people.ownerQ, firms.p.id),
          bodyOf(c, own.p, base),
        );
        if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
      }
      expect(failures).toEqual([]);
    });

    it("a member of firm Q gets 404 on firm P's records by id, in firm Q", async () => {
      const failures: string[] = [];
      for (const route of routes.filter(isFirmRoute).filter(ready)) {
        const c = CASES[keyOf(route)];
        if (!c) continue;
        const res = await call(
          route,
          fill(route, firms.q.slug, recordsOf(c, base)),
          as.firm(people.ownerQ, firms.q.id),
          bodyOf(c, own.q, base),
        );
        if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
      }
      expect(failures).toEqual([]);
    });

    it("a client of firm P gets 404 at firm Q's portal, on every client route", async () => {
      const failures: string[] = [];
      for (const route of routes.filter(isPortalRoute).filter(ready)) {
        const c = CASES[keyOf(route)];
        const res = await call(
          route,
          fill(route, firms.q.slug, c ? recordsOf(c, base) : {}),
          as.client(base.client!),
          bodyOf(c, own.q, base),
        );
        if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
      }
      expect(failures).toEqual([]);
    });

    it("client Y gets 404 on client X's records in the same firm", async () => {
      const failures: string[] = [];
      for (const route of routes.filter(isPortalRoute).filter(ready)) {
        const c = CASES[keyOf(route)];
        if (!c) continue;
        // Only another client's own records are walled off; a firm-wide record is not.
        if (!Object.values(c.params).some((key) => RECORDS[key]?.clientPrivate)) continue;
        const res = await call(
          route,
          fill(route, firms.p.slug, recordsOf(c, base)),
          as.client(people.clientY),
          bodyOf(c, own.p, base),
        );
        if (res.status !== 404) failures.push(`${keyOf(route)}: ${show(res)}`);
      }
      expect(failures).toEqual([]);
    });

    it("a client of firm P signed in at firm Q's portal is not a client there", async () => {
      const route = routes.find((r) => keyOf(r) === 'GET /api/v1/portal/:firmSlug/me')!;
      const res = await call(route, fill(route, firms.q.slug), as.client(base.client!));
      expect([401, 403, 404]).toContain(res.status);
      expect(JSON.stringify(res.body)).not.toContain(base.rec.client!);
    });

    it("no refused request changed a row of firm P's", async () => {
      const after = await fingerprint();
      expect(Number(after.clients?.split(':')[0])).toBeGreaterThan(0);
      expect(after).toEqual(before);
    });
  });

  describe('lists, counts and search', () => {
    const firmPIds = () => [firms.p.id, ...Object.values(base.rec), ...Object.values(own.p)];
    const privateIds = () =>
      Object.entries(base.rec)
        .filter(([key]) => RECORDS[key]?.clientPrivate)
        .map(([, id]) => id);
    const leaked = (res: Response, ids: string[]) => {
      const text = JSON.stringify(res.body);
      return ids.filter((id) => text.includes(id));
    };

    it("firm Q's lists show none of firm P's records", async () => {
      const failures: string[] = [];
      let answered = 0;
      for (const route of routes.filter((r) => isFirmRoute(r) && r.method === 'GET')) {
        if (recordParams(route).length) continue;
        const res = await call(
          route,
          fill(route, firms.q.slug),
          as.firm(people.ownerQ, firms.q.id),
        );
        if (is2xx(res.status)) answered++;
        const ids = leaked(res, firmPIds());
        if (ids.length) failures.push(`${keyOf(route)}: ${ids.join(', ')}`);
      }
      expect(failures).toEqual([]);
      expect(answered).toBeGreaterThan(10);
    });

    it("client Y's portal lists show none of client X's records", async () => {
      const failures: string[] = [];
      let answered = 0;
      for (const route of routes.filter((r) => isPortalRoute(r) && r.method === 'GET')) {
        if (recordParams(route).length) continue;
        const res = await call(route, fill(route, firms.p.slug), as.client(people.clientY));
        if (is2xx(res.status)) answered++;
        const ids = leaked(res, privateIds());
        if (ids.length) failures.push(`${keyOf(route)}: ${ids.join(', ')}`);
      }
      expect(failures).toEqual([]);
      expect(answered).toBeGreaterThan(5);
    });

    it("the same lists do show firm P's and client X's own records (the check isn't empty)", async () => {
      const firmHits = new Set<string>();
      for (const route of routes.filter((r) => isFirmRoute(r) && r.method === 'GET')) {
        if (recordParams(route).length) continue;
        const res = await call(
          route,
          fill(route, firms.p.slug),
          as.firm(people.ownerP, firms.p.id),
        );
        for (const id of leaked(res, firmPIds())) firmHits.add(id);
      }
      const clientHits = new Set<string>();
      for (const route of routes.filter((r) => isPortalRoute(r) && r.method === 'GET')) {
        if (recordParams(route).length) continue;
        const res = await call(route, fill(route, firms.p.slug), as.client(base.client!));
        for (const id of leaked(res, privateIds())) clientHits.add(id);
      }
      expect(firmHits.has(base.rec.client!)).toBe(true);
      expect(clientHits.has(base.rec.engagement!)).toBe(true);
    });
  });

  describe('the Super Admin site', () => {
    const refused = (status: number) => [401, 403, 404].includes(status);
    const anyId = () => randomUUID();

    it('every Super Admin route refuses a firm Owner and a client', async () => {
      const failures: string[] = [];
      const adminRoutes = routes.filter(isAdminRoute);
      expect(adminRoutes.length).toBeGreaterThan(5);
      for (const route of adminRoutes) {
        const path = fillPath(
          route.path,
          { businessId: firms.p.id, firmSlug: firms.p.slug },
          anyId,
        );
        for (const actor of [as.firm(people.ownerP, firms.p.id), as.client(base.client!)]) {
          const res = await call(route, path, actor, {});
          if (!refused(res.status)) failures.push(`${keyOf(route)} as ${actor.pool}: ${show(res)}`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('every firm and portal route refuses a Super Admin', async () => {
      const failures: string[] = [];
      for (const route of routes.filter((r) => isFirmRoute(r) || isPortalRoute(r)).filter(ready)) {
        const c = CASES[keyOf(route)];
        const path = fill(route, firms.p.slug, c ? recordsOf(c, base) : {});
        const actor = isPortalRoute(route) ? as.admin() : { ...as.admin(), firmId: firms.p.id };
        const res = await call(route, path, actor, bodyOf(c, own.p, base));
        if (!refused(res.status)) failures.push(`${keyOf(route)}: ${show(res)}`);
      }
      expect(failures).toEqual([]);
    });
  });

  it("the positive control: firm P's Owner and client X reach every case", async () => {
    const failures: string[] = [];
    for (const route of routes.filter((r) => isFirmRoute(r) || isPortalRoute(r)).filter(ready)) {
      const c = CASES[keyOf(route)];
      if (!c) continue;
      // Reads share the base world; each write gets a fresh one, so no case sees another's write.
      const world =
        route.method === 'GET'
          ? base
          : await buildWorld([...Object.values(c.params), ...(c.bodyRecords ?? []), 'client']);
      const portal = isPortalRoute(route);
      const res = await call(
        route,
        fill(route, firms.p.slug, recordsOf(c, world)),
        portal ? as.client(world.client!) : as.firm(people.ownerP, firms.p.id),
        bodyOf(c, own.p, world),
      );
      const ok = c.expect === undefined ? is2xx(res.status) : res.status === c.expect;
      if (!ok) failures.push(`${keyOf(route)} (${c.file}): ${show(res)}`);
    }
    expect(failures).toEqual([]);
  });
});
