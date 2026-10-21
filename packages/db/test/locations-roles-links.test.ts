// R1 (Oct 21): the database rules of r1_locations_roles_links. Settings > Locations (contact
// formats, the address duplicate check, hours without overlaps, scheduled actions that run once),
// appointment types' meeting methods, custom roles and Business Consultant, 100 MB documents, and
// secure document links with one-time codes. Runs as the app role in firm A's scope.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const users = Array.from({ length: 4 }, () => randomUUID());
const [ownerId, staffId, consultantId, otherId] = users as [string, string, string, string];
const ids = { firmA: '', firmB: '', client: '', service: '', document: '' };
const firm = () => db.forBusiness(ids.firmA);
const HOUR = 3_600_000;
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of users) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@r1l.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `r1la-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `r1lb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const businessId = ids.firmA;
    for (const [userId, role] of [
      [ownerId, 'OWNER'],
      [staffId, 'STAFF'],
      [consultantId, 'BUSINESS_CONSULTANT'],
    ] as const) {
      await tx.membership.create({ data: { businessId, userId, role, status: 'ACTIVE' } });
    }
    const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
    ids.client = client.id;
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Tax' },
    });
    ids.service = service.id;
    const engagement = await tx.engagement.create({
      data: { businessId, clientId: client.id, serviceId: service.id, title: '2025' },
    });
    ids.document = (
      await tx.document.create({
        data: {
          businessId,
          clientId: client.id,
          engagementId: engagement.id,
          direction: 'FIRM_TO_CLIENT',
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 104_857_600,
          sha256: 'a'.repeat(64),
          s3Key: `tenant/${businessId}/documents/${randomUUID()}`,
        },
      })
    ).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, (tx) =>
    tx.membership.create({
      data: { businessId: ids.firmB, userId: otherId, role: 'OWNER', status: 'ACTIVE' },
    }),
  );
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

const office = (name: string, extra: object = {}) =>
  firm().firmOffice.create({ data: { businessId: ids.firmA, name, ...extra } });

describe('Locations', () => {
  it('keeps one live location per address, however it is written', async () => {
    const first = await office('Uptown', {
      addressLine1: '12 Main St.',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201-1234',
      phone: '+12145550100',
      email: 'uptown@lvp.test',
      managerUserId: staffId,
      timeZone: 'America/Chicago',
    });
    expect(first.addressKey).toBe('12 main st dallas tx|75201');
    await expect(
      office('Uptown again', {
        addressLine1: '12  MAIN st',
        city: 'dallas',
        state: 'tx',
        postalCode: '75201',
      }),
    ).rejects.toThrow(/Unique constraint/);
    // Another suite in the same building is a different location.
    await office('Uptown Suite 2', {
      addressLine1: '12 Main St.',
      addressLine2: 'Suite 200',
      city: 'Dallas',
      state: 'TX',
      postalCode: '75201',
    });
    // Virtual locations have no address and never block each other.
    await office('Online', { kind: 'VIRTUAL' });
    await office('Online 2', { kind: 'VIRTUAL' });
    await expect(
      office('Online 3', { kind: 'VIRTUAL', addressLine1: '1 Cloud Way' }),
    ).rejects.toThrow(/firm_offices_virtual_no_address/);
  });

  it('checks contact formats, the time zone, and keeps the main location active', async () => {
    await expect(office('Bad phone', { phone: '214-555-0100' })).rejects.toThrow(
      /firm_offices_contact/,
    );
    await expect(office('Bad email', { email: 'Office@LVP.test' })).rejects.toThrow(
      /firm_offices_contact/,
    );
    await expect(office('Bad zone', { timeZone: 'Mars/Olympus' })).rejects.toThrow(
      /firm_offices_contact/,
    );
    await expect(office('Main but off', { isMain: true, status: 'INACTIVE' })).rejects.toThrow(
      /firm_offices_main_active/,
    );
    const branch = await office('Branch');
    const off = await firm().firmOffice.update({
      where: { id: branch.id },
      data: { status: 'INACTIVE' },
    });
    const back = await firm().firmOffice.update({
      where: { id: off.id },
      data: { status: 'ACTIVE' },
    });
    expect(back.status).toBe('ACTIVE');
  });

  it('offers existing services and keeps a day free of overlapping hours', async () => {
    const o = await office('Hours');
    await firm().firmOfficeService.create({
      data: { businessId: ids.firmA, officeId: o.id, serviceId: ids.service },
    });
    const hours = (weekday: number, opens: string, closes: string) =>
      firm().firmOfficeHours.create({
        data: {
          businessId: ids.firmA,
          officeId: o.id,
          weekday,
          opensAt: time(opens),
          closesAt: time(closes),
        },
      });
    await hours(1, '09:00', '12:00');
    await hours(1, '12:00', '17:00'); // touching is fine
    await expect(hours(1, '16:00', '18:00')).rejects.toThrow(
      /firm_office_hours_no_overlap|exclusion/,
    );
    await expect(hours(2, '17:00', '09:00')).rejects.toThrow(/firm_office_hours_range/);
    await expect(hours(7, '09:00', '17:00')).rejects.toThrow(/firm_office_hours_weekday/);
    await hours(2, '16:00', '18:00'); // another day
  });

  it('runs a scheduled action once, when due; until then it may move or be cancelled', async () => {
    const o = await office('Scheduled');
    const due = new Date(Date.now() + 2 * HOUR);
    const action = await firm().firmOfficeAction.create({
      data: {
        businessId: ids.firmA,
        kind: 'DEACTIVATE_LOCATION',
        officeId: o.id,
        effectiveAt: due,
        createdByUserId: ownerId,
      },
    });
    expect(action.originalEffectiveAt?.getTime()).toBe(due.getTime());
    await expect(
      firm().firmOfficeAction.create({
        data: {
          businessId: ids.firmA,
          kind: 'REASSIGN_MANAGER',
          officeId: o.id,
          newManagerUserId: staffId,
          effectiveAt: due,
          createdByUserId: ownerId,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    await expect(
      firm().firmOfficeAction.update({ where: { id: action.id }, data: { status: 'DONE' } }),
    ).rejects.toThrow(/runs only once it is due/);
    const later = new Date(Date.now() + 4 * HOUR);
    const moved = await firm().firmOfficeAction.update({
      where: { id: action.id },
      data: { effectiveAt: later, updatedByUserId: staffId },
    });
    expect([moved.effectiveAt.getTime(), moved.originalEffectiveAt?.getTime()]).toEqual([
      later.getTime(),
      due.getTime(),
    ]);
    const cancelled = await firm().firmOfficeAction.update({
      where: { id: action.id },
      data: { status: 'CANCELLED' },
    });
    expect(cancelled.finishedAt).not.toBeNull();
    await expect(
      firm().firmOfficeAction.update({ where: { id: action.id }, data: { status: 'PENDING' } }),
    ).rejects.toThrow(/a finished action never changes/);
    await expect(
      firm().firmOfficeAction.create({
        data: {
          businessId: ids.firmA,
          kind: 'REASSIGN_MANAGER',
          officeId: o.id,
          effectiveAt: due,
          createdByUserId: ownerId,
        },
      }),
    ).rejects.toThrow(/firm_office_actions_shape/);
    // A past action can run; one manager deactivation pending per manager.
    const now = await firm().firmOfficeAction.create({
      data: {
        businessId: ids.firmA,
        kind: 'DEACTIVATE_MANAGER',
        managerUserId: staffId,
        effectiveAt: new Date(Date.now() - 1000),
        createdByUserId: ownerId,
      },
    });
    await expect(
      firm().firmOfficeAction.create({
        data: {
          businessId: ids.firmA,
          kind: 'DEACTIVATE_MANAGER',
          managerUserId: staffId,
          effectiveAt: due,
          createdByUserId: ownerId,
        },
      }),
    ).rejects.toThrow(/Unique constraint/);
    const done = await firm().firmOfficeAction.update({
      where: { id: now.id },
      data: { status: 'DONE' },
    });
    expect(done.finishedAt).not.toBeNull();
  });
});

describe('appointment types: meeting methods', () => {
  it('fills the methods from the location kind and keeps the two in step', async () => {
    const type = await firm().appointmentType.create({
      data: {
        businessId: ids.firmA,
        name: `Call ${run}`,
        durationMinutes: 30,
        locationKind: 'PHONE',
      },
    });
    expect(type.meetingMethods).toEqual(['PHONE']);
    const both = await firm().appointmentType.update({
      where: { id: type.id },
      data: { meetingMethods: ['VIDEO', 'PHONE'] },
    });
    expect(both.locationKind).toBe('VIDEO');
    const phoneFirst = await firm().appointmentType.update({
      where: { id: type.id },
      data: { locationKind: 'PHONE' },
    });
    expect(phoneFirst.meetingMethods).toEqual(['PHONE', 'VIDEO']);
    await expect(
      firm().appointmentType.update({
        where: { id: type.id },
        data: { meetingMethods: ['PHONE', 'PHONE'] },
      }),
    ).rejects.toThrow(/appointment_types_meeting_methods/);
    await expect(
      firm().appointmentType.update({ where: { id: type.id }, data: { meetingMethods: [] } }),
    ).rejects.toThrow(/appointment_types_meeting_methods/);
  });
});

describe('custom roles and Business Consultant', () => {
  it('starts from a built-in role (never Owner), unique by name, and members match it', async () => {
    const role = (name: string, basedOn: 'STAFF' | 'TAX_PREPARER' | 'OWNER') =>
      firm().customRole.create({ data: { businessId: ids.firmA, name, basedOn } });
    const advisor = await role('Senior Advisor', 'STAFF');
    await firm().customRolePermission.create({
      data: {
        businessId: ids.firmA,
        customRoleId: advisor.id,
        module: 'CLIENTS',
        capability: 'VIEW',
        granted: true,
      },
    });
    await expect(role(' senior advisor', 'STAFF')).rejects.toThrow(/Unique constraint/);
    await expect(role('Boss', 'OWNER')).rejects.toThrow(/custom_roles_values/);
    const preparer = await role('Preparer Plus', 'TAX_PREPARER');
    await expect(
      firm().customRole.update({ where: { id: advisor.id }, data: { basedOn: 'TAX_PREPARER' } }),
    ).rejects.toThrow(/never change/);

    const staff = await firm().membership.findFirstOrThrow({ where: { userId: staffId } });
    await firm().membership.update({ where: { id: staff.id }, data: { customRoleId: advisor.id } });
    await expect(
      firm().membership.update({ where: { id: staff.id }, data: { customRoleId: preparer.id } }),
    ).rejects.toThrow(/has the role it is based on/);
    await firm().customRole.update({
      where: { id: preparer.id },
      data: { archivedAt: new Date() },
    });
    const consultant = await firm().membership.findFirstOrThrow({
      where: { userId: consultantId },
    });
    expect(consultant.role).toBe('BUSINESS_CONSULTANT');
  });
});

describe('documents: 100 MB and secure links', () => {
  it('takes 100 MB files and document settings up to 100 MB, not more', async () => {
    await firm().documentSettings.create({
      data: { businessId: ids.firmA, uploadMaxBytes: 104_857_600 },
    });
    const settings = await firm().documentSettings.findUniqueOrThrow({
      where: { businessId: ids.firmA },
    });
    expect([settings.clientLinkCodeRequired, settings.internalLinkCodeRequired]).toEqual([
      true,
      true,
    ]);
    await expect(
      firm().documentSettings.update({
        where: { businessId: ids.firmA },
        data: { uploadMaxBytes: 104_857_601 },
      }),
    ).rejects.toThrow(/document_settings_ranges/);
  });

  const link = (extra: object = {}) =>
    firm().documentLink.create({
      data: {
        businessId: ids.firmA,
        documentId: ids.document,
        kind: 'CLIENT',
        clientId: ids.client,
        recipientEmail: 'pat@client.test',
        recipientPhone: '+12145550199',
        sentVia: 'EMAIL',
        codeRequired: true,
        tokenHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
        expiresAt: new Date(Date.now() + 30 * HOUR),
        createdByUserId: ownerId,
        ...extra,
      },
    });

  it('caps the expiry, needs both addresses for a code, and never changes who or what', async () => {
    const client = await link();
    expect(client.expiresAt.getTime() - client.createdAt.getTime()).toBeLessThanOrEqual(24 * HOUR);
    const internal = await link({
      kind: 'INTERNAL',
      clientId: null,
      recipientUserId: staffId,
      expiresAt: new Date(Date.now() + 72 * HOUR),
    });
    expect(internal.expiresAt.getTime() - internal.createdAt.getTime()).toBeLessThanOrEqual(
      48 * HOUR,
    );
    await expect(link({ recipientPhone: null })).rejects.toThrow(/document_links_values/);
    // Without a code, the address it went to is enough.
    await link({ recipientPhone: null, codeRequired: false });
    await expect(
      firm().documentLink.update({
        where: { id: client.id },
        data: { tokenHash: 'b'.repeat(64) },
      }),
    ).rejects.toThrow(/never changes who, what or how long/);
  });

  it('counts wrong codes one at a time and resets them only as a lockout starts', async () => {
    const l = await link();
    const bump = (failedAttempts: number, lockedUntil?: Date) =>
      firm().documentLink.update({
        where: { id: l.id },
        data: { failedAttempts, ...(lockedUntil ? { lockedUntil } : {}) },
      });
    await bump(1);
    await expect(bump(3)).rejects.toThrow(/one at a time/);
    const locked = await bump(0, new Date(Date.now() + 2 * HOUR));
    expect(locked.lockedUntil!.getTime()).toBeLessThanOrEqual(Date.now() + 15 * 60_000 + 5_000);
  });

  it('sends codes over the other channel; only the newest is used, once', async () => {
    const l = await link();
    const code = (channel: 'EMAIL' | 'PHONE') =>
      firm().documentLinkCode.create({
        data: {
          businessId: ids.firmA,
          linkId: l.id,
          channel,
          codeHash: randomUUID().replaceAll('-', '').padEnd(64, '0'),
          expiresAt: new Date(Date.now() + HOUR),
        },
      });
    await expect(code('EMAIL')).rejects.toThrow(/over the other channel/);
    const first = await code('PHONE');
    expect(first.expiresAt.getTime() - first.createdAt.getTime()).toBeLessThanOrEqual(10 * 60_000);
    const second = await code('PHONE');
    const use = (id: string) =>
      firm().documentLinkCode.update({ where: { id }, data: { consumedAt: new Date() } });
    await expect(use(first.id)).rejects.toThrow(/only the newest code/);
    expect((await use(second.id)).consumedAt).not.toBeNull();
    await expect(use(second.id)).rejects.toThrow(/used once/);
  });

  it("keeps each firm's locations, roles and links to itself", async () => {
    const b = db.forBusiness(ids.firmB);
    expect(await b.firmOffice.findMany()).toEqual([]);
    expect(await b.firmOfficeAction.findMany()).toEqual([]);
    expect(await b.customRole.findMany()).toEqual([]);
    expect(await b.documentLink.findMany()).toEqual([]);
    expect(await b.documentLinkCode.findMany()).toEqual([]);
  });
});
