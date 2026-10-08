// End-to-end: T02 firm settings, setup wizard and the firm's Terms and Privacy
// (docs/api/settings.yaml). Owner and Admin only, also while Pending Setup; one firm never sees
// or changes another's; audit entries carry field names, steps and versions, never values.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it, vi } from 'vitest';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { testDatabaseUrls } from '@firmivra/db/testing';
import { FirmLegalOverview, FirmSettings, FirmSetup, LegalDocument } from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import {
  FieldEncryption,
  FieldEncryptionError,
} from '../../src/field-encryption/field-encryption.service.js';
import { einContext } from '../../src/settings/settings.service.js';

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
const person = (key: string) => ({ id: randomUUID(), email: `t02-${key}-${run}@t02.test` });
const people = {
  ownerA: person('owner-a'),
  adminA: person('admin-a'),
  staffA: person('staff-a'),
  clientA: person('client-a'),
  ownerB: person('owner-b'),
  ownerPending: person('owner-pending'),
  ownerRace: person('owner-race'),
  ownerStuck: person('owner-stuck'),
  ownerDetails: person('owner-details'),
};
const firms = {} as Record<
  'a' | 'b' | 'pending' | 'race' | 'stuck' | 'details',
  { id: string; slug: string }
>;

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

type Method = 'get' | 'patch' | 'put' | 'post';
async function call(
  method: Method,
  path: string,
  who: { email: string } | undefined,
  businessId: string | undefined,
  body?: object,
): Promise<Response> {
  const token = who ? await tokenFor(who.email) : undefined;
  let req = request(app.getHttpServer())[method](`/api/v1/business${path}`);
  if (token) req = req.set('authorization', `Bearer ${token}`);
  if (businessId) req = req.set('x-business-id', businessId);
  return body === undefined ? req : req.send(body);
}

const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;

async function auditRows(businessId: string, action: string) {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  const rows = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
    tx.auditLog.findMany({ where: { businessId, action }, orderBy: { createdAt: 'asc' } }),
  );
  await owner.$disconnect();
  return rows;
}

beforeAll(async () => {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const [key, p] of Object.entries(people)) {
      const pool = key === 'clientA' ? 'CLIENT' : 'STAFF';
      await tx.user.create({
        data: { id: p.id, cognitoSub: p.id, pool, email: p.email, name: `Fake T02 ${key}` },
      });
    }
    const make = async (key: keyof typeof firms, status: 'ACTIVE' | 'PENDING_SETUP') => {
      const slug = `t02-${key}-${run}`;
      firms[key] = await tx.business.create({
        data: { slug, name: slug, status },
        select: { id: true, slug: true },
      });
    };
    await make('a', 'ACTIVE');
    await make('b', 'ACTIVE');
    await make('pending', 'PENDING_SETUP');
    await make('race', 'PENDING_SETUP');
    await make('stuck', 'PENDING_SETUP');
    await make('details', 'PENDING_SETUP');
  });
  const members = [
    [firms.a.id, people.ownerA.id, 'OWNER'],
    [firms.a.id, people.adminA.id, 'ADMIN'],
    [firms.a.id, people.staffA.id, 'STAFF'],
    [firms.b.id, people.ownerB.id, 'OWNER'],
    [firms.pending.id, people.ownerPending.id, 'OWNER'],
    [firms.race.id, people.ownerRace.id, 'OWNER'],
    [firms.stuck.id, people.ownerStuck.id, 'OWNER'],
    [firms.details.id, people.ownerDetails.id, 'OWNER'],
  ] as const;
  for (const [businessId, userId, role] of members) {
    await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } }),
    );
  }
  await runInScope(owner, { kind: 'business', businessId: firms.a.id }, (tx) =>
    tx.clientAccount.create({
      data: {
        businessId: firms.a.id,
        userId: people.clientA.id,
        email: people.clientA.email,
        status: 'ACTIVE',
      },
    }),
  );
  // Finished before, but still Pending Setup (and no step progress, like a seeded firm).
  await runInScope(owner, { kind: 'business', businessId: firms.stuck.id }, (tx) =>
    tx.businessSettings.create({
      data: { businessId: firms.stuck.id, setupCompletedAt: new Date('2026-10-01T09:00:00Z') },
    }),
  );
  await owner.$disconnect();

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
  // Listening, so supertest shares one server; requests sent together never close it.
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app.close();
});

describe('GET and PATCH /business/settings', () => {
  it('owner and admin only; other firms 404; a suspended firm 403', async () => {
    const res = await call('get', '/settings', people.ownerA, firms.a.id);
    expect(res.status).toBe(200);
    const settings = FirmSettings.parse(res.body);
    expect(settings.business).toEqual({
      id: firms.a.id,
      slug: firms.a.slug,
      legalName: null,
      status: 'ACTIVE',
    });
    // A firm that never saved settings gets the column defaults.
    expect(settings).toMatchObject({
      country: 'US',
      timezone: 'America/New_York',
      clientSignUpEnabled: true,
      primaryColor: null,
      logoUrl: null,
    });
    expect((await call('get', '/settings', people.adminA, firms.a.id)).status).toBe(200);

    for (const who of [people.staffA, people.clientA]) {
      const denied = await call('get', '/settings', who, firms.a.id);
      expect([denied.status, codeOf(denied)]).toEqual([403, 'FORBIDDEN']);
    }
    const outsider = await call('get', '/settings', people.ownerB, firms.a.id);
    expect([outsider.status, codeOf(outsider)]).toEqual([404, 'NOT_FOUND']);
    expect((await call('get', '/settings', undefined, firms.a.id)).status).toBe(401);
    const suspended = await call('get', '/settings', fx.users.ownerSuspended, fx.suspended.id);
    expect(suspended.status).toBe(403);
  });

  it('changes only the fields sent, in this firm only, and audits the field names', async () => {
    const res = await call('patch', '/settings', people.adminA, firms.a.id, {
      name: '  T02 Firm A ',
      contactEmail: 'Office@T02.Test',
      website: 'https://t02.example.com',
      primaryColor: '#1D4ED8',
      accentColor: '#C9A227',
      portalName: 'T02 Portal',
      welcomeMessage: 'Welcome to the sample portal.',
      clientSignUpEnabled: false,
      timezone: 'America/Chicago',
    });
    expect(res.status).toBe(200);
    expect(FirmSettings.parse(res.body)).toMatchObject({
      name: 'T02 Firm A',
      contactEmail: 'office@t02.test',
      primaryColor: '#1d4ed8',
      accentColor: '#c9a227',
      clientSignUpEnabled: false,
      timezone: 'America/Chicago',
    });

    const cleared = await call('patch', '/settings', people.ownerA, firms.a.id, {
      website: '',
      portalName: null,
    });
    expect(cleared.body).toMatchObject({
      website: null,
      portalName: null,
      contactEmail: 'office@t02.test',
      welcomeMessage: 'Welcome to the sample portal.',
    });

    const other = FirmSettings.parse(
      (await call('get', '/settings', people.ownerB, firms.b.id)).body,
    );
    expect(other).toMatchObject({ name: firms.b.slug, contactEmail: null, primaryColor: null });

    const audits = await auditRows(firms.a.id, 'settings.updated');
    // Sorted by size: two writes in one millisecond would otherwise come back in either order.
    const metadata = audits.map((a) => a.metadata as { fields: string[] });
    expect(metadata.sort((x, y) => y.fields.length - x.fields.length)).toEqual([
      {
        fields: [
          'accentColor',
          'clientSignUpEnabled',
          'contactEmail',
          'name',
          'portalName',
          'primaryColor',
          'timezone',
          'website',
          'welcomeMessage',
        ],
      },
      { fields: ['portalName', 'website'] },
    ]);
    expect(audits.map((a) => a.actorUserId).sort()).toEqual(
      [people.adminA.id, people.ownerA.id].sort(),
    );
    expect(JSON.stringify(audits)).not.toContain('office@t02.test');
  });

  it('refuses locked, unknown and bad fields with 400, and staff with 403', async () => {
    for (const body of [
      { slug: 'taken' },
      { status: 'ACTIVE' },
      { legalName: 'Renamed LLC' },
      { businessId: firms.b.id },
      { logoKey: `tenant/${firms.b.id}/logo.png` },
      {},
      { timezone: 'Bad/Zone' },
      { website: 'http://t02.example.com' },
      { primaryColor: 'blue' },
    ]) {
      const res = await call('patch', '/settings', people.ownerA, firms.a.id, body);
      expect([res.status, codeOf(res)]).toEqual([400, 'VALIDATION_FAILED']);
    }
    const staff = await call('patch', '/settings', people.staffA, firms.a.id, { name: 'X' });
    expect(staff.status).toBe(403);
    const after = FirmSettings.parse(
      (await call('get', '/settings', people.ownerA, firms.a.id)).body,
    );
    expect(after.business.slug).toBe(firms.a.slug);
    expect(after.name).toBe('T02 Firm A');
  });
});

describe('setup wizard', () => {
  const setup = async (method: Method, path = '') =>
    call(method, `/setup${path}`, people.ownerPending, firms.pending.id);

  it('saves steps in wizard order while Pending Setup; Finish needs all four', async () => {
    expect(FirmSetup.parse((await setup('get')).body)).toEqual({
      completedSteps: [],
      completedAt: null,
    });
    const settings = await call('get', '/settings', people.ownerPending, firms.pending.id);
    expect((settings.body as FirmSettings).business.status).toBe('PENDING_SETUP');

    await setup('put', '/steps/team').then((r) => expect(r.status).toBe(200));
    const twice = await setup('put', '/steps/branding');
    await setup('put', '/steps/team');
    expect((await setup('get')).body).toEqual({
      completedSteps: ['branding', 'team'],
      completedAt: null,
    });
    expect(twice.body).toEqual({ completedSteps: ['branding', 'team'], completedAt: null });
    expect((await setup('put', '/steps/finish')).status).toBe(400);

    const early = await setup('post', '/complete');
    expect([early.status, codeOf(early)]).toEqual([409, 'SETUP_INCOMPLETE']);
    expect((early.body as { error: { message: string } }).error.message).toContain(
      'Business details, Client portal',
    );
    const steps = await auditRows(firms.pending.id, 'setup.step_completed');
    expect(steps.map((a) => a.metadata)).toEqual([{ step: 'team' }, { step: 'branding' }]);
  });

  it('Finish makes the firm Active once; repeating changes nothing', async () => {
    await setup('put', '/steps/businessDetails');
    await setup('put', '/steps/clientPortal');
    const done = await setup('post', '/complete');
    expect(done.status).toBe(200);
    const finished = FirmSetup.parse(done.body);
    expect(finished.completedSteps).toHaveLength(4);
    expect(finished.completedAt).not.toBeNull();

    const settings = await call('get', '/settings', people.ownerPending, firms.pending.id);
    expect((settings.body as FirmSettings).business.status).toBe('ACTIVE');
    expect((await setup('post', '/complete')).body).toEqual(finished);
    expect((await setup('put', '/steps/team')).body).toEqual(finished);
    expect(await auditRows(firms.pending.id, 'setup.finished')).toHaveLength(1);
  });

  it('saves at the same moment never fail: first steps, and Save Draft with Finish', async () => {
    const race = (method: Method, path: string, body?: object) =>
      call(method, path, people.ownerRace, firms.race.id, body);
    // No settings row yet: four first saves at once must all land.
    const steps = ['branding', 'businessDetails', 'team', 'clientPortal'];
    const saved = await Promise.all(steps.map((step) => race('put', `/setup/steps/${step}`)));
    expect(saved.map((r) => r.status)).toEqual([200, 200, 200, 200]);
    expect((await race('get', '/setup')).body).toMatchObject({ completedSteps: steps });

    for (const n of [1, 2, 3, 4, 5]) {
      const results = await Promise.all([
        race('patch', '/settings', { name: `Race firm ${n}`, portalName: `Portal ${n}` }),
        race('post', '/setup/complete'),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
    }
    const after = FirmSettings.parse((await race('get', '/settings')).body);
    expect([after.business.status, after.name]).toEqual(['ACTIVE', 'Race firm 5']);
  });

  it('a firm finished before reports every step; Finish activates it if still Pending', async () => {
    const stuck = (method: Method, path: string) =>
      call(method, path, people.ownerStuck, firms.stuck.id);
    const before = FirmSetup.parse((await stuck('get', '/setup')).body);
    expect(before).toEqual({
      completedSteps: ['branding', 'businessDetails', 'team', 'clientPortal'],
      completedAt: '2026-10-01T09:00:00.000Z',
    });
    expect((await stuck('post', '/setup/complete')).body).toEqual(before);
    const settings = FirmSettings.parse((await stuck('get', '/settings')).body);
    expect(settings.business.status).toBe('ACTIVE');
    expect(await auditRows(firms.stuck.id, 'setup.finished')).toHaveLength(0);
  });

  it('is not open to staff or to another firm', async () => {
    expect((await call('put', '/setup/steps/team', people.staffA, firms.a.id)).status).toBe(403);
    const outsider = await call('post', '/setup/complete', people.ownerB, firms.pending.id);
    expect(outsider.status).toBe(404);
  });
});

describe('Terms and Privacy', () => {
  const legal = (method: Method, path: string, who = people.ownerA, body?: object) =>
    call(method, `/legal${path}`, who, who === people.ownerB ? firms.b.id : firms.a.id, body);

  it('publishes numbered versions; the newest is current; older ones stay readable', async () => {
    expect((await legal('get', '/terms')).body).toEqual({ current: null, versions: [] });
    const first = await legal('post', '/terms/versions', people.adminA, { body: '# Terms v1' });
    expect(first.status).toBe(201);
    expect(LegalDocument.parse(first.body)).toMatchObject({ kind: 'terms', version: 1 });

    // Publishing at the same moment still gives consecutive versions.
    const together = await Promise.all(
      [2, 3, 4].map(() => legal('post', '/terms/versions', people.ownerA, { body: '# Terms' })),
    );
    expect(together.map((r) => (r.body as LegalDocument).version).sort()).toEqual([2, 3, 4]);

    const overview = FirmLegalOverview.parse((await legal('get', '/terms')).body);
    expect(overview.current?.version).toBe(4);
    expect(overview.versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect((await legal('get', '/terms/versions/1')).body).toMatchObject({ body: '# Terms v1' });
    expect((await legal('get', '/privacy')).body).toEqual({ current: null, versions: [] });

    const audits = await auditRows(firms.a.id, 'legal.published');
    expect(audits.map((a) => a.metadata)).toContainEqual({ kind: 'terms', version: 1 });
    expect(JSON.stringify(audits)).not.toContain('Terms v1');
  });

  it('404 for an unpublished version, 400 for bad paths and text, 403 for staff', async () => {
    expect((await legal('get', '/terms/versions/99')).status).toBe(404);
    for (const path of [
      '/terms/versions/0',
      '/terms/versions/01',
      '/terms/versions/1e0',
      '/cookies',
    ]) {
      expect((await legal('get', path)).status).toBe(400);
    }
    expect((await legal('post', '/terms/versions', people.ownerA, { body: '  ' })).status).toBe(
      400,
    );
    const staff = await legal('post', '/terms/versions', people.staffA, { body: '# Mine' });
    expect(staff.status).toBe(403);
  });

  it("never shows one firm's versions to another", async () => {
    expect((await legal('get', '/terms', people.ownerB)).body).toEqual({
      current: null,
      versions: [],
    });
    const outsider = await call('get', '/legal/terms/versions/1', people.ownerB, firms.a.id);
    expect(outsider.status).toBe(404);
  });
});

describe('business details (setup Step 2)', () => {
  const details = (body: object) =>
    call('patch', '/settings', people.ownerDetails, firms.details.id, body);
  const storedRow = async (businessId: string) => {
    const owner = createPrismaClient(testDatabaseUrls('test_api').owner);
    const row = await runInScope(owner, { kind: 'business', businessId }, (tx) =>
      tx.businessSettings.findUnique({
        where: { businessId },
        select: { einEnc: true, einLast4: true, teamSize: true },
      }),
    );
    await owner.$disconnect();
    return row;
  };

  it("saves them; the EIN is sealed with the firm's key and only its last 4 come back", async () => {
    const res = await details({
      entityType: 'S_CORP',
      ein: '12-3456789',
      teamSize: 12,
      services: ['PAYROLL', 'TAX_PREPARATION', 'PAYROLL'],
      description: '  Tax and payroll for small businesses.\nSince 2010.  ',
    });
    expect(res.status).toBe(200);
    const saved = FirmSettings.parse(res.body);
    expect(saved).toMatchObject({
      entityType: 'S_CORP',
      einLast4: '6789',
      teamSize: 12,
      services: ['PAYROLL', 'TAX_PREPARATION'],
      description: 'Tax and payroll for small businesses.\nSince 2010.',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/123456789|12-3456789|"ein"/);
    const read = await call('get', '/settings', people.ownerDetails, firms.details.id);
    expect(FirmSettings.parse(read.body)).toEqual(saved);

    const row = await storedRow(firms.details.id);
    expect(row?.einLast4).toBe('6789');
    const sealed = row?.einEnc;
    if (!sealed) throw new Error('ein_enc not written');
    expect(Buffer.from(sealed).includes('123456789')).toBe(false);
    const encryption = app.get(FieldEncryption);
    await expect(encryption.decrypt(einContext(firms.details.id), sealed)).resolves.toBe(
      '123456789',
    );
    // Bound to this firm: under another firm's context it does not open.
    await expect(encryption.decrypt(einContext(firms.b.id), sealed)).rejects.toMatchObject({
      code: 'DECRYPTION_FAILED',
    });

    const audits = await auditRows(firms.details.id, 'settings.updated');
    expect(audits.map((a) => a.metadata)).toEqual([
      { fields: ['description', 'ein', 'entityType', 'services', 'teamSize'] },
    ]);
  });

  it('removes the EIN with null, and refuses codes outside the lists and bad values', async () => {
    const removed = FirmSettings.parse((await details({ ein: null })).body);
    expect([removed.einLast4, removed.teamSize]).toEqual([null, 12]);
    expect(await storedRow(firms.details.id)).toMatchObject({ einEnc: null, einLast4: null });

    for (const body of [
      { entityType: 'LLP' },
      { entityType: null },
      { services: ['TAXES'] },
      { services: [] },
      { teamSize: 0 },
      { teamSize: 10_001 },
      { teamSize: 2.5 },
      { ein: '12345678' },
      { ein: '12-345678A' },
      { description: 'Tax‮services' },
      { description: 'x'.repeat(2001) },
      { einLast4: '1234' },
      { einEnc: 'AAAA' },
    ]) {
      const res = await details(body);
      expect([res.status, codeOf(res)], JSON.stringify(body)).toEqual([400, 'VALIDATION_FAILED']);
    }
  });

  it('answers 503 ENCRYPTION_UNAVAILABLE and saves nothing when the EIN cannot be sealed', async () => {
    const encryption = app.get(FieldEncryption);
    const seal = vi
      .spyOn(encryption, 'encrypt')
      .mockRejectedValueOnce(new FieldEncryptionError('KEY_NOT_PROVISIONED', 'No key yet'));
    try {
      const res = await details({ teamSize: 30, ein: '987654321' });
      expect([res.status, codeOf(res)]).toEqual([503, 'ENCRYPTION_UNAVAILABLE']);
    } finally {
      seal.mockRestore();
    }
    expect(await storedRow(firms.details.id)).toMatchObject({ teamSize: 12, einLast4: null });
    // Without an EIN the same change goes through.
    expect((await details({ teamSize: 30 })).status).toBe(200);
  });

  it("never shows one firm's details to another", async () => {
    const other = FirmSettings.parse(
      (await call('get', '/settings', people.ownerB, firms.b.id)).body,
    );
    expect(other).toMatchObject({ entityType: null, einLast4: null, teamSize: null, services: [] });
    const outsider = await call('patch', '/settings', people.ownerB, firms.details.id, {
      ein: '111111111',
    });
    expect(outsider.status).toBe(404);
  });
});
