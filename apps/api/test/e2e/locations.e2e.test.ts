// End-to-end: Settings > Locations (R1; contract in packages/types/src/settings/locations.ts).
// Add, Edit (stale save, duplicates), Set as Primary, Activate (the plan's limit), Deactivate now
// or later (Super Administrator; the main location never), Reassign Manager, Deactivate Manager
// (the acting fallback), Manage Staff, the photo, scheduled changes (edit, cancel, finished), the
// job, the activity, and the appointments' options. Owner and Admin only; an Admin without MANAGE
// on SETTINGS is refused the Super Administrator's routes; firm B never sees firm A's. Synthetic
// data only.
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import {
  LOCATION_DUPLICATE_MESSAGE,
  LocationAction,
  LocationActionList,
  LocationActivity,
  LocationList,
  LocationOptions,
  LocationProfile,
  SchedulingOptions,
  UploadPutTicket,
} from '@firmivra/types';
import { AppModule } from '../../src/app.module.js';
import { TokenService } from '../../src/auth/token.service.js';
import { configureApp } from '../../src/configure-app.js';
import { loadEnv } from '../../src/config/env.js';
import { LocationActionsJob } from '../../src/locations/location-actions.job.js';
import { DOCUMENTS_CONFIG } from '../../src/storage/config.js';
import { DOCUMENT_STORAGE, type DocumentStorage } from '../../src/storage/document-storage.js';
import { sha256 } from '../office-files.js';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>');

class MemoryStorage implements DocumentStorage {
  readonly objects = new Map<string, Buffer>();
  presignUpload(file: { key: string; contentType: string }) {
    return Promise.resolve({
      method: 'PUT' as const,
      url: `memory:${file.key}`,
      headers: { 'content-type': file.contentType },
    });
  }
  completeUpload() {
    return Promise.resolve('MISSING' as const);
  }
  abortUpload() {
    return Promise.resolve();
  }
  head(key: string) {
    const b = this.objects.get(key);
    return Promise.resolve(b ? { sizeBytes: b.length, sha256: null, contentEncoding: null } : null);
  }
  read(key: string) {
    return Promise.resolve(this.objects.get(key) ?? null);
  }
  remove(key: string) {
    this.objects.delete(key);
    return Promise.resolve();
  }
  presignDownload(file: { key: string }) {
    return Promise.resolve(`memory:${file.key}?download`);
  }
  put(ticket: UploadPutTicket, bytes: Buffer) {
    this.objects.set(ticket.url.slice('memory:'.length), bytes);
  }
}
const storage = new MemoryStorage();

const fx = inject('fixtures');
const run = randomUUID().slice(0, 8);
interface Person {
  id: string;
  email: string;
  key: string;
}
const person = (key: string): Person => ({
  id: randomUUID(),
  email: `r1l-${key.toLowerCase()}-${run}@r1.test`,
  key,
});
const people = {
  ownerA: person('ownerA'),
  adminA: person('adminA'),
  admin2A: person('admin2A'),
  staffA: person('staffA'),
  mgrA: person('mgrA'),
  mgr2A: person('mgr2A'),
  mgr3A: person('mgr3A'),
  mgr4A: person('mgr4A'),
  mgr5A: person('mgr5A'),
  goneA: person('goneA'),
  ownerB: person('ownerB'),
  ownerC: person('ownerC'),
};
type Who = Person;
const { ownerA, adminA, admin2A, staffA, mgrA, mgr2A, mgr3A, mgr4A, mgr5A, goneA, ownerB, ownerC } =
  people;
const firms = {} as Record<'a' | 'b' | 'c', string>;
const ids = {} as Record<'svc1' | 'svc2' | 'svcGone' | 'client' | 'type', string>;

let app: INestApplication;
let viewers = 0;
const viewer = () => `198.61.${100 + Math.floor(++viewers / 250)}.${viewers % 250}, 10.0.0.5`;
const DAY = 24 * 60 * 60_000;
const later = (days: number) => new Date(Date.now() + days * DAY).toISOString();

async function asOwner<T>(
  scope: Parameters<typeof runInScope>[1],
  work: (tx: TxClient) => Promise<T>,
): Promise<T> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    return await runInScope(owner, scope, work);
  } finally {
    await owner.$disconnect();
  }
}
const inFirm = <T>(firm: 'a' | 'b' | 'c', work: (tx: TxClient) => Promise<T>) =>
  asOwner({ kind: 'business', businessId: firms[firm] }, work);

type Method = 'get' | 'post' | 'patch' | 'put' | 'delete';
async function call(
  method: Method,
  path: string,
  who: Who,
  body?: object,
  firm: 'a' | 'b' | 'c' = 'a',
): Promise<Response> {
  const { token } = await app.get(TokenService).signLocal(who.id, 'STAFF');
  const req = request(app.getHttpServer())
    [method](`/api/v1/business${path}`)
    .set('x-business-id', firms[firm])
    .set('x-forwarded-for', viewer())
    .set('authorization', `Bearer ${token}`);
  return body === undefined ? req : req.send(body);
}
const codeOf = (res: Response) => (res.body as { error?: { code: string } }).error?.code;
const expectError = (res: Response, status: number, code: string) =>
  expect([res.status, codeOf(res)], JSON.stringify(res.body)).toEqual([status, code]);
const ok = (res: Response, status = 200) => {
  expect(res.status, JSON.stringify(res.body)).toBe(status);
  return res.body as unknown;
};
let streets = 0;
const mark = (what: string) => `${what} ${run} ${randomUUID().slice(0, 6)}`;
const newLocation = (over: object = {}) => ({
  name: mark('Fake Office'),
  addressLine1: `${++streets} Fake Street ${run}`,
  city: 'Auburn',
  state: 'CA',
  postalCode: '95603',
  phone: '+15305550100',
  email: 'Office@Example.test',
  serviceIds: [ids.svc1],
  hours: [
    { weekday: 2, opensAt: '13:00', closesAt: '17:00' },
    { weekday: 2, opensAt: '09:00', closesAt: '12:00' },
  ],
  staffUserIds: [staffA.id],
  managerUserId: mgrA.id,
  ...over,
});
const create = async (over: object = {}, who: Who = ownerA, firm: 'a' | 'b' | 'c' = 'a') =>
  LocationProfile.parse(ok(await call('post', '/locations', who, newLocation(over), firm), 201));
const profile = async (id: string, who: Who = ownerA) =>
  LocationProfile.parse(ok(await call('get', `/locations/${id}`, who)));
const editBody = (p: LocationProfile, over: object = {}) => ({
  name: p.name,
  kind: p.kind,
  addressLine1: p.addressLine1,
  addressLine2: p.addressLine2,
  city: p.city,
  state: p.state,
  postalCode: p.postalCode,
  phone: p.phone,
  alternatePhone: p.alternatePhone,
  email: p.email,
  timeZone: p.timeZone,
  notes: p.notes,
  serviceIds: p.services.map((s) => s.id),
  hours: p.hours,
  staffUserIds: p.staff.map((s) => s.userId),
  expectedUpdatedAt: p.updatedAt,
  ...over,
});
const auditOf = (entityId: string) =>
  inFirm('a', (tx) =>
    tx.auditLog.findMany({
      where: { entityId },
      select: { action: true, metadata: true, entityType: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
  );
const actionRow = (id: string) =>
  inFirm('a', (tx) => tx.firmOfficeAction.findFirstOrThrow({ where: { id } }));
/** Makes a pending action due (the database lets a PENDING action's time change). */
const makeDue = (id: string) =>
  inFirm(
    'a',
    (tx) =>
      tx.$executeRaw`UPDATE firm_office_actions SET effective_at = now() - interval '1 minute' WHERE id = ${id}::uuid`,
  );
const pendingOf = async (locationId: string) =>
  LocationActionList.parse(
    ok(await call('get', `/locations/actions?status=PENDING&locationId=${locationId}`, ownerA)),
  ).items;
const membershipOf = (userId: string) =>
  inFirm('a', (tx) => tx.membership.findFirstOrThrow({ where: { businessId: firms.a, userId } }));

beforeAll(async () => {
  await asOwner({ kind: 'platform' }, async (tx) => {
    for (const p of Object.values(people)) {
      await tx.user.create({
        data: {
          id: p.id,
          cognitoSub: p.id,
          pool: 'STAFF',
          email: p.email,
          name: `Fake R1L ${p.key}`,
          phone: '+15305550199',
        },
      });
    }
    for (const key of ['a', 'b', 'c'] as const) {
      const slug = `r1l-${key}-${run}`;
      firms[key] = (
        await tx.business.create({
          data: { slug, name: `Fake Firm ${slug}`, status: 'ACTIVE' },
          select: { id: true },
        })
      ).id;
    }
    // Firm C's plan: 1 location included and 1 bought.
    const plan = await tx.platformPlan.create({
      data: {
        code: `R1L_${run.toUpperCase()}`,
        name: `Fake Plan ${run}`,
        basePriceCents: 9_900,
        billingCycle: 'MONTHLY',
        includedSeats: 3,
        includedLocations: 1,
        displayOrder: 99,
      },
      select: { id: true },
    });
    await tx.platformFirmSubscription.create({
      data: {
        businessId: firms.c,
        planId: plan.id,
        status: 'ACTIVE',
        billingCycle: 'MONTHLY',
        seatsIncluded: 3,
        locationsIncluded: 1,
        locationsPurchased: 1,
      },
    });
  });
  const roles = [
    ['a', ownerA, 'OWNER'],
    ['a', adminA, 'ADMIN'],
    ['a', admin2A, 'ADMIN'],
    ['a', staffA, 'STAFF'],
    ['a', mgrA, 'STAFF'],
    ['a', mgr2A, 'STAFF'],
    ['a', mgr3A, 'STAFF'],
    ['a', mgr4A, 'STAFF'],
    ['a', mgr5A, 'STAFF'],
    ['a', goneA, 'STAFF'],
    ['b', ownerB, 'OWNER'],
    ['c', ownerC, 'OWNER'],
  ] as const;
  for (const [firm, p, role] of roles) {
    await inFirm(firm, (tx) =>
      tx.membership.create({
        data: {
          businessId: firms[firm],
          userId: p.id,
          role,
          status: 'ACTIVE',
          jobTitle: `Title ${p.key}`,
        },
      }),
    );
  }
  await inFirm('a', async (tx) => {
    const businessId = firms.a;
    await tx.membership.updateMany({
      where: { businessId, userId: goneA.id },
      data: { status: 'DEACTIVATED' },
    });
    // An Admin whose own grid takes MANAGE on SETTINGS away: not a Super Administrator.
    const admin2 = await tx.membership.findFirstOrThrow({
      where: { businessId, userId: admin2A.id },
    });
    await tx.memberPermission.create({
      data: {
        businessId,
        membershipId: admin2.id,
        module: 'SETTINGS',
        capability: 'MANAGE',
        granted: false,
      },
    });
    const service = (name: string, archived = false) =>
      tx.service
        .create({
          data: {
            businessId,
            kind: 'ANNUAL_TAX',
            name,
            ...(archived ? { archivedAt: new Date() } : {}),
          },
        })
        .then((s) => s.id);
    ids.svc1 = await service('Fake Tax Prep');
    ids.svc2 = await service('Fake Bookkeeping');
    ids.svcGone = await service('Fake Retired', true);
    ids.client = (
      await tx.client.create({ data: { businessId, displayName: 'Fake Client R1L' } })
    ).id;
    ids.type = (
      await tx.appointmentType.create({
        data: { businessId, name: 'Fake Meeting', durationMinutes: 30, locationKind: 'IN_PERSON' },
      })
    ).id;
  });
  const env = loadEnv({
    ...process.env,
    NODE_ENV: 'test',
    AUTH_MODE: 'local',
    LOG_LEVEL: 'silent',
    DATABASE_URL_APP: fx.appUrl,
  });
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot(env)] })
    .overrideProvider(DOCUMENT_STORAGE)
    .useValue(storage)
    .overrideProvider(DOCUMENTS_CONFIG)
    .useValue({ bucket: 'test', region: 'us-east-1', forcePathStyle: true, scanMode: 'local' })
    .compile();
  const nest = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });
  configureApp(nest, env);
  await nest.listen(0, '127.0.0.1');
  app = nest;
});

afterAll(async () => {
  await app?.close();
});

describe('Add Location and the list', () => {
  it('creates a location with its services, hours, staff and manager, and lists it', async () => {
    const p = await create({ addressLine2: 'Suite 200', notes: 'Fake notes' });
    expect(p).toMatchObject({
      kind: 'OFFICE',
      status: 'ACTIVE',
      // The firm's first ACTIVE location becomes primary by itself (Rasel, Oct 22).
      isMain: true,
      addressLine2: 'Suite 200',
      email: 'office@example.test',
      timeZone: null,
      effectiveTimeZone: 'America/New_York',
      staffCount: 1,
      managerIsActing: false,
      pendingAction: null,
      futureAppointments: 0,
      photoUrl: null,
    });
    expect(p.manager).toEqual({
      userId: mgrA.id,
      name: 'Fake R1L mgrA',
      jobTitle: 'Title mgrA',
      email: mgrA.email,
      phone: '+15305550199',
    });
    expect(p.services).toEqual([{ id: ids.svc1, name: 'Fake Tax Prep', kind: 'ANNUAL_TAX' }]);
    expect(p.hours).toEqual([
      { weekday: 2, opensAt: '09:00', closesAt: '12:00' },
      { weekday: 2, opensAt: '13:00', closesAt: '17:00' },
    ]);
    expect(p.staff.map((s) => s.userId)).toEqual([staffA.id]);

    const byName = LocationList.parse(
      ok(await call('get', `/locations?search=${encodeURIComponent(p.name)}`, ownerA)),
    );
    expect(byName.items.map((i) => i.id)).toEqual([p.id]);
    expect(byName.total).toBe(1);
    const byManager = LocationList.parse(
      ok(
        await call('get', `/locations?search=${encodeURIComponent('R1L mgrA')}&limit=100`, adminA),
      ),
    );
    expect(byManager.items.map((i) => i.id)).toContain(p.id);
    const filtered = LocationList.parse(
      ok(
        await call(
          'get',
          `/locations?city=auburn&status=ACTIVE&managerUserId=${mgrA.id}&limit=100`,
          ownerA,
        ),
      ),
    );
    expect(filtered.items.map((i) => i.id)).toContain(p.id);
    expect(filtered.kpis.subscription.allowed).toBeNull();
    expect(filtered.kpis.active).toBe(filtered.kpis.subscription.used);

    const audit = await auditOf(p.id);
    expect(audit.map((r) => r.action)).toEqual(['firm_office.created']);
    expect(JSON.stringify(audit)).not.toMatch(/Fake|Street|example/);
  });

  it('sorts, pages and counts', async () => {
    const page1 = LocationList.parse(
      ok(await call('get', '/locations?sort=name&order=desc&limit=1&page=1', ownerA)),
    );
    const page2 = LocationList.parse(
      ok(await call('get', '/locations?sort=name&order=desc&limit=1&page=2', ownerA)),
    );
    expect(page1.items).toHaveLength(1);
    expect(page1.total).toBeGreaterThanOrEqual(1);
    if (page1.total > 1) expect(page2.items[0]?.id).not.toBe(page1.items[0]?.id);
    expect(page1.kpis.total).toBe(page1.total);
  });

  it('refuses a duplicate name or address with the exact words, but not the same EIN or a virtual twin', async () => {
    const p = await create();
    const same = await call(
      'post',
      '/locations',
      ownerA,
      newLocation({ name: `  ${p.name.toUpperCase()} ` }),
    );
    expectError(same, 409, 'DUPLICATE_LOCATION');
    expect((same.body as { error: { message: string } }).error.message).toBe(
      LOCATION_DUPLICATE_MESSAGE,
    );
    const address = await call(
      'post',
      '/locations',
      ownerA,
      newLocation({
        addressLine1: `${p.addressLine1!.toUpperCase()}.`,
        city: 'AUBURN',
        postalCode: '95603-1234',
      }),
    );
    expectError(address, 409, 'DUPLICATE_LOCATION');
    // Virtual locations have no address: two of them never collide.
    const virtual = {
      kind: 'VIRTUAL',
      addressLine1: null,
      city: null,
      state: null,
      postalCode: null,
    };
    await create(virtual);
    await create(virtual);
  });

  it('refuses a manager or staff who is not active, a retired service and a bad time zone (400)', async () => {
    expectError(
      await call('post', '/locations', ownerA, newLocation({ managerUserId: goneA.id })),
      400,
      'MANAGER_NOT_ELIGIBLE',
    );
    expectError(
      await call('post', '/locations', ownerA, newLocation({ managerUserId: ownerB.id })),
      400,
      'MANAGER_NOT_ELIGIBLE',
    );
    expectError(
      await call('post', '/locations', ownerA, newLocation({ staffUserIds: [goneA.id] })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/locations', ownerA, newLocation({ serviceIds: [ids.svcGone] })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', '/locations', ownerA, newLocation({ timeZone: 'Mars/Olympus_Mons' })),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call(
        'post',
        '/locations',
        ownerA,
        newLocation({
          hours: [
            { weekday: 1, opensAt: '09:00', closesAt: '12:00' },
            { weekday: 1, opensAt: '11:00', closesAt: '13:00' },
          ],
        }),
      ),
      400,
      'VALIDATION_FAILED',
    );
  });

  it('keeps a location’s own time zone, and the firm’s as none', async () => {
    const own = await create({ timeZone: 'America/Los_Angeles' });
    expect([own.timeZone, own.effectiveTimeZone]).toEqual([
      'America/Los_Angeles',
      'America/Los_Angeles',
    ]);
    const firmZone = await create({ timeZone: 'America/New_York' });
    expect([firmZone.timeZone, firmZone.effectiveTimeZone]).toEqual([null, 'America/New_York']);
  });
});

describe('Edit Location and Manage Staff', () => {
  it('saves with the loaded version, refuses a stale one and a duplicate, and keeps retired links', async () => {
    const p = await create();
    const other = await create();
    // A service retired after it was linked stays linked, unseen.
    await inFirm('a', (tx) =>
      tx.firmOfficeService.create({
        data: { businessId: firms.a, officeId: p.id, serviceId: ids.svcGone },
      }),
    );
    const saved = LocationProfile.parse(
      ok(
        await call(
          'patch',
          `/locations/${p.id}`,
          adminA,
          editBody(p, {
            name: `${p.name} edited`,
            serviceIds: [ids.svc2],
            hours: [{ weekday: 5, opensAt: '08:00', closesAt: '16:00' }],
            staffUserIds: [staffA.id, mgr2A.id],
          }),
        ),
      ),
    );
    expect(saved.name).toBe(`${p.name} edited`);
    expect(saved.services.map((s) => s.id)).toEqual([ids.svc2]);
    expect(saved.hours).toEqual([{ weekday: 5, opensAt: '08:00', closesAt: '16:00' }]);
    expect(saved.staffCount).toBe(2);
    expect(saved.updatedAt).not.toBe(p.updatedAt);
    const links = await inFirm('a', (tx) =>
      tx.firmOfficeService.findMany({ where: { officeId: p.id }, select: { serviceId: true } }),
    );
    expect(links.map((l) => l.serviceId).sort()).toEqual([ids.svc2, ids.svcGone].sort());

    expectError(
      await call('patch', `/locations/${p.id}`, ownerA, editBody(p)),
      409,
      'SAVE_CONFLICT',
    );
    expectError(
      await call('patch', `/locations/${p.id}`, ownerA, editBody(saved, { name: other.name })),
      409,
      'DUPLICATE_LOCATION',
    );
    const audit = await auditOf(p.id);
    expect(audit.map((r) => r.action)).toContain('firm_office.updated');
    expect(audit.find((r) => r.action === 'firm_office.updated')?.metadata).toMatchObject({
      fields: expect.arrayContaining(['name', 'services', 'hours', 'staff']),
    });
  });

  it('sets the staff (a later Edit with the old version conflicts), refusing inactive people', async () => {
    const p = await create();
    const staffed = LocationProfile.parse(
      ok(
        await call('put', `/locations/${p.id}/staff`, ownerA, {
          staffUserIds: [mgr2A.id, mgr3A.id],
        }),
      ),
    );
    expect(staffed.staff.map((s) => s.userId).sort()).toEqual([mgr2A.id, mgr3A.id].sort());
    expect(staffed.staffCount).toBe(2);
    expectError(
      await call('put', `/locations/${p.id}/staff`, ownerA, { staffUserIds: [goneA.id] }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/locations/${p.id}`, ownerA, editBody(p)),
      409,
      'SAVE_CONFLICT',
    );
    expect((await auditOf(p.id)).map((r) => r.action)).toContain('firm_office.staff_set');
  });
});

describe('Set as Primary, Activate and the plan’s limit', () => {
  it('makes the first location activated the primary when the firm has none (Rasel, Oct 22)', async () => {
    const first = await create(
      { status: 'INACTIVE', managerUserId: ownerB.id, staffUserIds: [], serviceIds: [] },
      ownerB,
      'b',
    );
    expect(first.isMain).toBe(false);
    const on = LocationProfile.parse(
      ok(await call('post', `/locations/${first.id}/activate`, ownerB, undefined, 'b')),
    );
    expect(on).toMatchObject({ status: 'ACTIVE', isMain: true });
  });

  it('moves the primary location, and refuses an inactive one', async () => {
    const one = await create();
    const two = await create();
    const first = LocationProfile.parse(
      ok(await call('post', `/locations/${one.id}/primary`, ownerA)),
    );
    expect(first.isMain).toBe(true);
    const second = LocationProfile.parse(
      ok(await call('post', `/locations/${two.id}/primary`, adminA)),
    );
    expect(second.isMain).toBe(true);
    expect((await profile(one.id)).isMain).toBe(false);
    const third = await create({ isMain: true });
    expect(third.isMain).toBe(true);
    expect((await profile(two.id)).isMain).toBe(false);
    const inactive = await create({ status: 'INACTIVE' });
    expectError(
      await call('post', `/locations/${inactive.id}/primary`, ownerA),
      400,
      'VALIDATION_FAILED',
    );
    expect((await auditOf(two.id)).map((r) => r.action)).toContain('firm_office.primary_set');
  });

  it('stops at the plan’s locations: Add and Activate answer 409 LOCATION_LIMIT', async () => {
    const make = (over: object = {}) =>
      call(
        'post',
        '/locations',
        ownerC,
        newLocation({ managerUserId: ownerC.id, staffUserIds: [], serviceIds: [], ...over }),
        'c',
      );
    ok(await make(), 201);
    ok(await make(), 201);
    expectError(await make(), 409, 'LOCATION_LIMIT');
    const spare = LocationProfile.parse(ok(await make({ status: 'INACTIVE' }), 201));
    expectError(
      await call('post', `/locations/${spare.id}/activate`, ownerC, undefined, 'c'),
      409,
      'LOCATION_LIMIT',
    );
    const list = LocationList.parse(ok(await call('get', '/locations', ownerC, undefined, 'c')));
    expect(list.kpis).toEqual({ total: 3, active: 2, subscription: { used: 2, allowed: 2 } });
  });
});

describe('Deactivate Location', () => {
  it('deactivates now: appointments stay, new bookings refuse it, the main location never', async () => {
    const p = await create();
    const startsAt = new Date(Date.now() + 3 * DAY);
    await inFirm('a', (tx) =>
      tx.appointment.create({
        data: {
          businessId: firms.a,
          clientId: ids.client,
          staffUserId: ownerA.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 30 * 60_000),
          locationKind: 'IN_PERSON',
          officeId: p.id,
        },
      }),
    );
    expect((await profile(p.id)).futureAppointments).toBe(1);
    const options = SchedulingOptions.parse(ok(await call('get', '/appointments/options', ownerA)));
    expect((options.offices ?? []).map((o) => o.id)).toContain(p.id);

    const off = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/deactivate`, ownerA, {})),
    );
    expect(off.status).toBe('INACTIVE');
    expect(off.futureAppointments).toBe(1);
    const done = LocationActionList.parse(
      ok(await call('get', `/locations/actions?locationId=${p.id}`, ownerA)),
    ).items;
    expect(done).toMatchObject([
      { kind: 'DEACTIVATE_LOCATION', status: 'DONE', failureCode: null },
    ]);
    expect(done[0]?.finishedAt).not.toBeNull();
    expect(done[0]?.createdBy).toEqual({ userId: ownerA.id, name: 'Fake R1L ownerA' });

    const after = SchedulingOptions.parse(ok(await call('get', '/appointments/options', ownerA)));
    expect((after.offices ?? []).map((o) => o.id)).not.toContain(p.id);
    const booking = await call('post', '/appointments/schedule', ownerA, {
      idempotencyKey: randomUUID(),
      contact: { kind: 'CLIENT', id: ids.client },
      typeId: ids.type,
      startsAt: later(5),
      endsAt: new Date(Date.parse(later(5)) + 30 * 60_000).toISOString(),
      method: 'IN_PERSON',
      officeId: p.id,
      staffUserIds: [ownerA.id],
      sendConfirmation: false,
    });
    expectError(booking, 400, 'VALIDATION_FAILED');
    // Again: nothing more to do.
    ok(await call('post', `/locations/${p.id}/deactivate`, ownerA, {}));
    const back = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/activate`, ownerA)),
    );
    expect(back.status).toBe('ACTIVE');
    const actions = (await auditOf(p.id)).map((r) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['firm_office.deactivated', 'firm_office.activated']),
    );

    const main = await create({ isMain: true });
    expectError(
      await call('post', `/locations/${main.id}/deactivate`, ownerA, {}),
      409,
      'LOCATION_IS_PRIMARY',
    );
  });

  it('schedules a deactivation, one at a time, edited and cancelled by the Super Administrator', async () => {
    const p = await create();
    const first = later(1);
    const scheduled = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/deactivate`, ownerA, { effectiveAt: first })),
    );
    expect(scheduled.status).toBe('ACTIVE');
    expect(scheduled.pendingAction).toMatchObject({
      kind: 'DEACTIVATE_LOCATION',
      status: 'PENDING',
      locationId: p.id,
      effectiveAt: first,
      originalEffectiveAt: first,
      finishedAt: null,
    });
    const actionId = scheduled.pendingAction!.id;
    expectError(
      await call('post', `/locations/${p.id}/deactivate`, ownerA, { effectiveAt: later(2) }),
      409,
      'PENDING_ACTION_EXISTS',
    );
    expectError(
      await call('post', `/locations/${p.id}/manager`, ownerA, { managerUserId: mgr2A.id }),
      409,
      'PENDING_ACTION_EXISTS',
    );
    expectError(
      await call('post', `/locations/${p.id}/deactivate`, ownerA, { effectiveAt: later(400) }),
      400,
      'VALIDATION_FAILED',
    );
    const moved = later(3);
    const edited = LocationAction.parse(
      ok(await call('patch', `/locations/actions/${actionId}`, adminA, { effectiveAt: moved })),
    );
    expect([edited.effectiveAt, edited.originalEffectiveAt]).toEqual([moved, first]);
    expectError(
      await call('patch', `/locations/actions/${actionId}`, ownerA, { effectiveAt: later(-1) }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('patch', `/locations/actions/${actionId}`, ownerA, { newManagerUserId: mgr2A.id }),
      400,
      'VALIDATION_FAILED',
    );
    const cancelled = LocationAction.parse(
      ok(await call('post', `/locations/actions/${actionId}/cancel`, ownerA)),
    );
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.finishedAt).not.toBeNull();
    expectError(
      await call('post', `/locations/actions/${actionId}/cancel`, ownerA),
      409,
      'ACTION_FINISHED',
    );
    expectError(
      await call('patch', `/locations/actions/${actionId}`, ownerA, { effectiveAt: later(5) }),
      409,
      'ACTION_FINISHED',
    );
    expect((await profile(p.id)).pendingAction).toBeNull();
    const audit = (await auditOf(actionId)).map((r) => r.action);
    expect(audit).toEqual([
      'firm_office_action.scheduled',
      'firm_office_action.updated',
      'firm_office_action.cancelled',
    ]);
  });
});

describe('Reassign Manager and Deactivate Manager', () => {
  it('reassigns now to an active member, never to the same one or someone inactive', async () => {
    const p = await create();
    const moved = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/manager`, adminA, { managerUserId: mgr2A.id })),
    );
    expect(moved.manager?.userId).toBe(mgr2A.id);
    expect(moved.managerIsActing).toBe(false);
    expectError(
      await call('post', `/locations/${p.id}/manager`, ownerA, { managerUserId: mgr2A.id }),
      400,
      'VALIDATION_FAILED',
    );
    expectError(
      await call('post', `/locations/${p.id}/manager`, ownerA, { managerUserId: goneA.id }),
      400,
      'MANAGER_NOT_ELIGIBLE',
    );
    const actions = LocationActionList.parse(
      ok(await call('get', `/locations/actions?locationId=${p.id}`, ownerA)),
    ).items;
    expect(actions[0]).toMatchObject({
      kind: 'REASSIGN_MANAGER',
      status: 'DONE',
      manager: { userId: mgrA.id },
      newManager: { userId: mgr2A.id },
    });
    expect((await auditOf(p.id)).map((r) => r.action)).toContain('firm_office.manager_reassigned');
  });

  it('deactivates a manager now: their locations get the replacement, their access ends, nobody else’s', async () => {
    const p = await create({ managerUserId: mgr3A.id, staffUserIds: [staffA.id] });
    const session = await inFirm('a', async (tx) => {
      const m = await tx.membership.findFirstOrThrow({ where: { userId: mgr3A.id } });
      return tx.staffSession.create({
        data: {
          businessId: firms.a,
          membershipId: m.id,
          tokenHash: randomUUID().replace(/-/g, '').padEnd(64, '0'),
          device: 'Fake browser',
        },
      });
    });
    const action = LocationAction.parse(
      ok(
        await call('post', `/locations/managers/${mgr3A.id}/deactivate`, ownerA, {
          replacementUserId: mgr4A.id,
        }),
      ),
    );
    expect(action).toMatchObject({
      kind: 'DEACTIVATE_MANAGER',
      status: 'DONE',
      locationId: null,
      manager: { userId: mgr3A.id },
      newManager: { userId: mgr4A.id },
    });
    expect((await profile(p.id)).manager?.userId).toBe(mgr4A.id);
    expect((await membershipOf(mgr3A.id)).status).toBe('DEACTIVATED');
    expect((await membershipOf(staffA.id)).status).toBe('ACTIVE');
    const revoked = await inFirm('a', (tx) =>
      tx.staffSession.findFirstOrThrow({ where: { id: session.id } }),
    );
    expect(revoked.revokedAt).not.toBeNull();
    const m = await membershipOf(mgr3A.id);
    expect((await auditOf(m.id)).map((r) => r.action)).toContain('membership.deactivated');
  });

  it('falls back to the main location’s manager as acting, and refuses self, a peer Admin and conflicts', async () => {
    const main = await create({ isMain: true, managerUserId: mgrA.id });
    const p = await create({ managerUserId: mgr5A.id });
    // A pending reassignment of one of their locations blocks deactivating them.
    ok(
      await call('post', `/locations/${p.id}/manager`, ownerA, {
        managerUserId: mgr2A.id,
        effectiveAt: later(2),
      }),
    );
    expectError(
      await call('post', `/locations/managers/${mgr5A.id}/deactivate`, ownerA, {
        replacementUserId: null,
      }),
      409,
      'PENDING_ACTION_EXISTS',
    );
    const pending = (await pendingOf(p.id))[0]!;
    ok(await call('post', `/locations/actions/${pending.id}/cancel`, ownerA));

    const action = LocationAction.parse(
      ok(
        await call('post', `/locations/managers/${mgr5A.id}/deactivate`, adminA, {
          replacementUserId: null,
        }),
      ),
    );
    expect(action.newManager).toBeNull();
    const acting = await profile(p.id);
    expect(acting.manager?.userId).toBe(mgrA.id);
    expect(acting.managerIsActing).toBe(true);
    expect((await profile(main.id)).managerIsActing).toBe(false);
    const list = LocationList.parse(
      ok(await call('get', `/locations?managerUserId=${mgrA.id}&limit=100`, ownerA)),
    );
    expect(list.items.find((i) => i.id === p.id)?.managerIsActing).toBe(true);

    expectError(
      await call('post', `/locations/managers/${adminA.id}/deactivate`, adminA, {
        replacementUserId: null,
      }),
      409,
      'CANNOT_CHANGE_SELF',
    );
    expectError(
      await call('post', `/locations/managers/${admin2A.id}/deactivate`, adminA, {
        replacementUserId: null,
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/locations/managers/${mgr2A.id}/deactivate`, ownerA, {
        replacementUserId: goneA.id,
      }),
      400,
      'MANAGER_NOT_ELIGIBLE',
    );
  });
});

describe('the Super Administrator, roles and other firms', () => {
  it('lets the Owner and an Admin with SETTINGS MANAGE, and refuses an Admin without it (403)', async () => {
    const p = await create();
    const opts = async (who: Who) =>
      LocationOptions.parse(ok(await call('get', '/locations/options', who))).canManageSchedules;
    expect(await opts(ownerA)).toBe(true);
    expect(await opts(adminA)).toBe(true);
    expect(await opts(admin2A)).toBe(false);
    const full = LocationOptions.parse(ok(await call('get', '/locations/options', ownerA)));
    expect(full.members.map((m) => m.userId)).toContain(mgrA.id);
    expect(full.members.map((m) => m.userId)).not.toContain(goneA.id);
    expect(full.services.map((s) => s.id)).toEqual(expect.arrayContaining([ids.svc1, ids.svc2]));
    expect(full.services.map((s) => s.id)).not.toContain(ids.svcGone);
    expect(full.cities).toContain('Auburn');

    const scheduled = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/deactivate`, ownerA, { effectiveAt: later(4) })),
    );
    const actionId = scheduled.pendingAction!.id;
    expectError(await call('post', `/locations/${p.id}/deactivate`, admin2A, {}), 403, 'FORBIDDEN');
    expectError(
      await call('post', `/locations/managers/${mgr2A.id}/deactivate`, admin2A, {
        replacementUserId: null,
      }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('patch', `/locations/actions/${actionId}`, admin2A, { effectiveAt: later(6) }),
      403,
      'FORBIDDEN',
    );
    expectError(
      await call('post', `/locations/actions/${actionId}/cancel`, admin2A),
      403,
      'FORBIDDEN',
    );
    // The rest stays open to that Admin.
    ok(await call('get', `/locations/${p.id}`, admin2A));
    ok(await call('post', `/locations/${p.id}/activate`, admin2A));
  });

  it('refuses Staff everywhere (403), and firm B gets 404 on firm A’s ids', async () => {
    const p = await create();
    for (const [method, path] of [
      ['get', '/locations'],
      ['get', '/locations/options'],
      ['get', `/locations/${p.id}`],
      ['post', `/locations/${p.id}/activate`],
      ['get', '/locations/activity'],
    ] as const)
      expectError(await call(method, path, staffA), 403, 'FORBIDDEN');
    const scheduled = LocationProfile.parse(
      ok(await call('post', `/locations/${p.id}/deactivate`, ownerA, { effectiveAt: later(4) })),
    );
    const actionId = scheduled.pendingAction!.id;
    for (const [method, path, body] of [
      ['get', `/locations/${p.id}`, undefined],
      ['patch', `/locations/${p.id}`, editBody(p)],
      ['post', `/locations/${p.id}/primary`, undefined],
      ['post', `/locations/${p.id}/deactivate`, {}],
      ['put', `/locations/${p.id}/staff`, { staffUserIds: [] }],
      ['delete', `/locations/${p.id}/photo`, undefined],
      ['patch', `/locations/actions/${actionId}`, { effectiveAt: later(6) }],
      ['post', `/locations/actions/${actionId}/cancel`, undefined],
      ['post', `/locations/managers/${mgr2A.id}/deactivate`, { replacementUserId: null }],
      ['get', `/locations/activity?locationId=${p.id}`, undefined],
    ] as const)
      expectError(await call(method, path, ownerB, body, 'b'), 404, 'NOT_FOUND');
    const theirs = LocationList.parse(
      ok(await call('get', '/locations?limit=100', ownerB, undefined, 'b')),
    );
    expect(JSON.stringify(theirs)).not.toContain(p.id);
    const actions = LocationActionList.parse(
      ok(await call('get', '/locations/actions', ownerB, undefined, 'b')),
    );
    expect(actions.items).toEqual([]);
    expect((await actionRow(actionId)).status).toBe('PENDING');
  });
});

describe('the job', () => {
  it('runs due changes once: DONE, or FAILED when they can no longer run', async () => {
    const job = app.get(LocationActionsJob);
    const main = await create({ isMain: true, managerUserId: mgrA.id });
    const reassign = await create({ managerUserId: mgrA.id });
    const leaving = await create({ managerUserId: mgr4A.id });
    const plain = await create();

    const schedule = async (path: string, body: object) => {
      const res = await call('post', path, ownerA, body);
      return res.body as { pendingAction?: { id: string }; id?: string };
    };
    const r1 = (
      await schedule(`/locations/${reassign.id}/manager`, {
        managerUserId: mgr2A.id,
        effectiveAt: later(1),
      })
    ).pendingAction!.id;
    const r2 = (await schedule(`/locations/${plain.id}/deactivate`, { effectiveAt: later(1) }))
      .pendingAction!.id;
    // The main location is never deactivated, not even later.
    expectError(
      await call('post', `/locations/${main.id}/deactivate`, ownerA, { effectiveAt: later(1) }),
      409,
      'LOCATION_IS_PRIMARY',
    );
    const r4 = (
      await schedule(`/locations/managers/${mgr4A.id}/deactivate`, {
        replacementUserId: null,
        effectiveAt: later(1),
      })
    ).id!;
    // Not due yet: nothing runs.
    expect(await job.run({ businessIds: [firms.a] })).toMatchObject({ skipped: false, done: 0 });
    for (const id of [r1, r2, r4]) await makeDue(id);
    const first = await job.run({ businessIds: [firms.a] });
    expect(first).toMatchObject({ skipped: false, done: 3, failed: 0 });
    expect((await actionRow(r1)).status).toBe('DONE');
    expect((await profile(reassign.id)).manager?.userId).toBe(mgr2A.id);
    expect((await profile(plain.id)).status).toBe('INACTIVE');
    expect((await membershipOf(mgr4A.id)).status).toBe('DEACTIVATED');
    const acting = await profile(leaving.id);
    expect([acting.manager?.userId, acting.managerIsActing]).toEqual([mgrA.id, true]);
    // A second run finds nothing.
    expect(await job.run({ businessIds: [firms.a] })).toMatchObject({ done: 0, failed: 0 });
    expect((await auditOf(r1)).map((r) => r.action)).toEqual([
      'firm_office_action.scheduled',
      'firm_office_action.done',
    ]);
  });

  it('fails a reassignment whose new manager left, and a deactivation of what became the main location', async () => {
    const job = app.get(LocationActionsJob);
    const p = await create({ managerUserId: mgrA.id });
    const q = await create({ managerUserId: mgrA.id });
    const toLeave = person(`leaver-${randomUUID().slice(0, 4)}`);
    await asOwner({ kind: 'platform' }, (tx) =>
      tx.user.create({
        data: {
          id: toLeave.id,
          cognitoSub: toLeave.id,
          pool: 'STAFF',
          email: toLeave.email,
          name: 'Fake leaver',
        },
      }),
    );
    await inFirm('a', (tx) =>
      tx.membership.create({
        data: { businessId: firms.a, userId: toLeave.id, role: 'STAFF', status: 'ACTIVE' },
      }),
    );
    const reassign = LocationProfile.parse(
      ok(
        await call('post', `/locations/${p.id}/manager`, ownerA, {
          managerUserId: toLeave.id,
          effectiveAt: later(1),
        }),
      ),
    ).pendingAction!.id;
    const deactivate = LocationProfile.parse(
      ok(await call('post', `/locations/${q.id}/deactivate`, ownerA, { effectiveAt: later(1) })),
    ).pendingAction!.id;
    await inFirm('a', (tx) =>
      tx.membership.updateMany({ where: { userId: toLeave.id }, data: { status: 'DEACTIVATED' } }),
    );
    ok(await call('post', `/locations/${q.id}/primary`, ownerA));
    await makeDue(reassign);
    await makeDue(deactivate);
    expect(await job.run({ businessIds: [firms.a] })).toMatchObject({ failed: 2 });
    expect(await actionRow(reassign)).toMatchObject({
      status: 'FAILED',
      failureCode: 'NEW_MANAGER_INACTIVE',
    });
    expect(await actionRow(deactivate)).toMatchObject({
      status: 'FAILED',
      failureCode: 'LOCATION_IS_PRIMARY',
    });
    expect((await profile(p.id)).manager?.userId).toBe(mgrA.id);
    expect((await profile(q.id)).status).toBe('ACTIVE');
    // A finished action never changes.
    expectError(
      await call('post', `/locations/actions/${reassign}/cancel`, ownerA),
      409,
      'ACTION_FINISHED',
    );
    expect((await auditOf(reassign)).map((r) => r.action)).toContain('firm_office_action.failed');
  });
});

describe('the photo and the activity', () => {
  it('uploads, checks and removes the photo under the firm’s prefix', async () => {
    const p = await create();
    const ticket = UploadPutTicket.parse(
      ok(
        await call('post', `/locations/${p.id}/photo/uploads`, ownerA, {
          fileName: 'office.png',
          contentType: 'image/png',
          sizeBytes: PNG.length,
          sha256: sha256(PNG),
        }),
        201,
      ),
    );
    expect(ticket.url).toMatch(
      new RegExp(`^memory:tenant/${firms.a}/offices/[0-9a-f-]{36}\\.png$`),
    );
    storage.put(ticket, PNG);
    const withPhoto = LocationProfile.parse(
      ok(
        await call('post', `/locations/${p.id}/photo/uploads/confirm`, ownerA, {
          uploadToken: ticket.uploadToken,
        }),
      ),
    );
    expect(withPhoto.photoUrl).toMatch(/^memory:tenant\/.+\/offices\/.+\.png\?download$/);
    const key = ticket.url.slice('memory:'.length);
    // Another location may not take this ticket.
    const other = await create();
    expectError(
      await call('post', `/locations/${other.id}/photo/uploads/confirm`, ownerA, {
        uploadToken: ticket.uploadToken,
      }),
      410,
      'UPLOAD_EXPIRED',
    );
    // An SVG claimed as PNG is refused and deleted.
    const bad = UploadPutTicket.parse(
      ok(
        await call('post', `/locations/${p.id}/photo/uploads`, ownerA, {
          fileName: 'office.png',
          contentType: 'image/png',
          sizeBytes: SVG.length,
          sha256: sha256(SVG),
        }),
        201,
      ),
    );
    storage.put(bad, SVG);
    expectError(
      await call('post', `/locations/${p.id}/photo/uploads/confirm`, ownerA, {
        uploadToken: bad.uploadToken,
      }),
      400,
      'VALIDATION_FAILED',
    );
    expect(storage.objects.has(bad.url.slice('memory:'.length))).toBe(false);
    const removed = LocationProfile.parse(
      ok(await call('delete', `/locations/${p.id}/photo`, ownerA)),
    );
    expect(removed.photoUrl).toBeNull();
    expect(storage.objects.has(key)).toBe(false);
    expect((await auditOf(p.id)).map((r) => r.action)).toEqual(
      expect.arrayContaining(['firm_office.photo_set', 'firm_office.photo_removed']),
    );
  });

  it('shows the location’s recent activity, newest first, in the screen’s words', async () => {
    const p = await create();
    ok(await call('post', `/locations/${p.id}/manager`, ownerA, { managerUserId: mgr2A.id }));
    const activity = LocationActivity.parse(
      ok(await call('get', `/locations/activity?locationId=${p.id}&limit=10`, ownerA)),
    );
    const labels = activity.items.map((i) => i.label);
    // The change and its action row commit together (one time); the location was added before.
    expect(labels.slice(0, 2).sort()).toEqual(
      [`Location manager changed - ${p.name}`, `Manager change completed - ${p.name}`].sort(),
    );
    expect(labels.at(-1)).toBe(`Location added - ${p.name}`);
    expect(activity.items.map((i) => i.tone).at(-1)).toBe('success');
    const all = LocationActivity.parse(
      ok(await call('get', '/locations/activity?limit=3', ownerA)),
    );
    expect(all.items).toHaveLength(3);
    expectError(
      await call('get', `/locations/activity?locationId=${randomUUID()}`, ownerA),
      404,
      'NOT_FOUND',
    );
  });
});
