// A client's local office and the portal's Contact Information switches (R1, Nov 7; migration
// r1_client_office_portal_contact, PRT-1 and PRT-3): the office chosen at registration and the
// assigned office are only ever an active, unarchived location of the same firm; a later
// deactivation keeps them; the firm's settings row defaults sensibly; and another firm never sees,
// sets or uses any of it. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const offices = { active: '', inactive: '', archived: '', otherFirm: '' };
let account = '';

const office = (firm: 'A' | 'B', data: Record<string, unknown> = {}) =>
  (firm === 'A' ? A() : B()).firmOffice.create({
    data: {
      businessId: firm === 'A' ? f.firmA : f.firmB,
      name: `Office ${randomUUID().slice(0, 6)}`,
      ...data,
    },
    select: { id: true },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1cop');
  offices.active = (await office('A')).id;
  offices.inactive = (await office('A', { status: 'INACTIVE' })).id;
  offices.archived = (await office('A', { archivedAt: new Date() })).id;
  offices.otherFirm = (await office('B')).id;
  const user = randomUUID();
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: user,
        cognitoSub: user,
        pool: 'CLIENT',
        email: `c-${user}@cop.test`,
        name: 'Client Login (fake)',
      },
    }),
  );
  account = await runInScope(
    owner,
    { kind: 'business', businessId: f.firmA },
    async (tx) =>
      (
        await tx.clientAccount.create({
          data: { businessId: f.firmA, userId: user, email: `c-${user}@cop.test` },
          select: { id: true },
        })
      ).id,
  );
});

describe("a client's office (PRT-1)", () => {
  it('takes an active location at registration, and the client record takes it as assigned', async () => {
    await expect(
      A().clientAccount.update({
        where: { id: account },
        data: { selectedOfficeId: offices.active },
        select: { selectedOfficeId: true },
      }),
    ).resolves.toEqual({ selectedOfficeId: offices.active });
    await expect(
      A().client.update({
        where: { id: f.clientA },
        data: { officeId: offices.active },
        select: { officeId: true },
      }),
    ).resolves.toEqual({ officeId: offices.active });
  });

  it('refuses an inactive or archived location (23514)', async () => {
    for (const officeId of [offices.inactive, offices.archived]) {
      expect(
        await failure(A().client.update({ where: { id: f.clientA }, data: { officeId } })),
      ).toMatch(/active location/);
      expect(
        await failure(
          A().clientAccount.update({
            where: { id: account },
            data: { selectedOfficeId: officeId },
          }),
        ),
      ).toMatch(/active location/);
    }
  });

  it('keeps the office when the location is deactivated later, and staff may reassign', async () => {
    const later = (await office('A')).id;
    await A().client.update({ where: { id: f.clientA }, data: { officeId: later } });
    await A().firmOffice.update({ where: { id: later }, data: { status: 'INACTIVE' } });
    // Another change to the client leaves the office alone.
    await expect(
      A().client.update({
        where: { id: f.clientA },
        data: { displayName: 'Client renamed (fake)' },
        select: { officeId: true },
      }),
    ).resolves.toEqual({ officeId: later });
    await expect(
      A().client.update({
        where: { id: f.clientA },
        data: { officeId: offices.active },
        select: { officeId: true },
      }),
    ).resolves.toEqual({ officeId: offices.active });
    await expect(
      A().client.update({
        where: { id: f.clientA },
        data: { officeId: null },
        select: { officeId: true },
      }),
    ).resolves.toEqual({ officeId: null });
  });
});

describe('Contact Information switches (PRT-3)', () => {
  it('has one row per firm with the defaults, and the firm changes them', async () => {
    await expect(
      A().clientPortalSettings.create({ data: { businessId: f.firmA } }),
    ).resolves.toMatchObject({
      showCorporateOffice: true,
      showLocalOffice: true,
      allowPhone: true,
      allowSms: false,
      allowEmail: true,
      allowSecureMessage: true,
      allowAppointmentLink: false,
    });
    expect(
      await failure(A().clientPortalSettings.create({ data: { businessId: f.firmA } })),
    ).toMatch(/unique/i);
    await expect(
      A().clientPortalSettings.update({
        where: { businessId: f.firmA },
        data: { showLocalOffice: false, allowSms: true },
      }),
    ).resolves.toMatchObject({ showLocalOffice: false, allowSms: true });
  });
});

describe('isolation', () => {
  it("never assigns or chooses another firm's location", async () => {
    expect(
      await failure(
        A().client.update({ where: { id: f.clientA }, data: { officeId: offices.otherFirm } }),
      ),
    ).toMatch(/active location|foreign key/i);
    expect(
      await failure(
        A().clientAccount.update({
          where: { id: account },
          data: { selectedOfficeId: offices.otherFirm },
        }),
      ),
    ).toMatch(/active location|foreign key/i);
  });

  it("another firm never sees or changes a firm's settings or its clients' offices", async () => {
    expect(await B().clientPortalSettings.findMany({ where: { businessId: f.firmA } })).toEqual([]);
    const { count } = await B().clientPortalSettings.updateMany({
      where: { businessId: f.firmA },
      data: { allowPhone: false },
    });
    expect(count).toBe(0);
    expect(
      await failure(B().clientPortalSettings.create({ data: { businessId: f.firmA } })),
    ).toMatch(/row-level security|policy/i);
    expect(await B().client.findMany({ where: { officeId: offices.active } })).toEqual([]);
  });
});
