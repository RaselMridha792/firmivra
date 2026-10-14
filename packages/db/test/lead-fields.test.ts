// R37, Leads: the lead number, contact details, source, priority, owner, follow-up, archive,
// pipeline statuses, services and tags. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  inactiveStaff: randomUUID(),
  staffB: randomUUID(),
  service: '',
  service2: '',
  archivedService: '',
  serviceB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

const newLead = (data: Record<string, unknown> = {}) =>
  A().lead.create({
    data: {
      businessId: ids.firmA,
      serviceId: ids.service,
      firstName: 'Lena',
      lastName: 'Lead',
      email: `lead-${randomUUID()}@begin.test`,
      ...data,
    },
  });
const toStatus = (id: string, status: string, data: Record<string, unknown> = {}) =>
  A().lead.update({
    where: { id },
    data: { status: status as 'CONTACTED', submittedAt: new Date(), ...data },
  });
const newTag = (name = `Tag ${randomUUID().slice(0, 6)}`) =>
  A().tag.create({ data: { businessId: ids.firmA, name } });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.inactiveStaff, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@lf.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `lfa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `lfb-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const b = ids.firmA;
    await tx.membership.create({
      data: { businessId: b, userId: ids.staffA, role: 'OWNER', status: 'ACTIVE' },
    });
    await tx.membership.create({
      data: { businessId: b, userId: ids.inactiveStaff, role: 'STAFF', status: 'DEACTIVATED' },
    });
    const service = (
      kind: 'BOOKKEEPING' | 'PAYROLL' | 'ANNUAL_TAX',
      name: string,
      archived = false,
    ) =>
      tx.service.create({
        data: { businessId: b, kind, name, ...(archived ? { archivedAt: new Date() } : {}) },
      });
    ids.service = (await service('BOOKKEEPING', 'Bookkeeping')).id;
    ids.service2 = (await service('PAYROLL', 'Payroll')).id;
    ids.archivedService = (await service('ANNUAL_TAX', 'Old tax', true)).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmB }, async (tx) => {
    await tx.membership.create({
      data: { businessId: ids.firmB, userId: ids.staffB, role: 'OWNER', status: 'ACTIVE' },
    });
    ids.serviceB = (
      await tx.service.create({
        data: { businessId: ids.firmB, kind: 'BOOKKEEPING', name: 'Bookkeeping' },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows another firm's lead services or tags, and refuses to cross firms", async () => {
    const lead = await newLead();
    await A().leadService.create({
      data: { businessId: ids.firmA, leadId: lead.id, serviceId: ids.service2 },
    });
    const tag = await newTag();
    await A().leadTag.create({ data: { businessId: ids.firmA, leadId: lead.id, tagId: tag.id } });
    expect(await B().leadService.count({ where: { leadId: lead.id } })).toBe(0);
    expect(await B().leadTag.count({ where: { leadId: lead.id } })).toBe(0);
    expect((await B().leadTag.deleteMany({ where: { leadId: lead.id } })).count).toBe(0);
    await expect(
      B().leadService.create({
        data: { businessId: ids.firmB, leadId: lead.id, serviceId: ids.serviceB },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(
      A().leadService.create({
        data: { businessId: ids.firmA, leadId: lead.id, serviceId: ids.serviceB },
      }),
    ).rejects.toThrow(/foreign key/i);
    await expect(newLead({ assignedUserId: ids.staffB })).rejects.toThrow(
      /foreign key|active member/i,
    );
  });
});

describe('lead number', () => {
  it('is the firm’s next from 10001, in order, ignores a caller’s, and never changes', async () => {
    const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
      tx.business.create({ data: { slug: `lfn-${run}`, name: 'N' } }),
    );
    const make = () =>
      runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
        const service =
          (await tx.service.findFirst({ where: { businessId: firm.id } })) ??
          (await tx.service.create({
            data: { businessId: firm.id, kind: 'BOOKKEEPING', name: 'B' },
          }));
        return tx.lead.create({
          data: {
            businessId: firm.id,
            serviceId: service.id,
            firstName: 'A',
            lastName: 'B',
            email: `n-${randomUUID()}@begin.test`,
            number: 5,
          },
        });
      });
    expect((await make()).number).toBe(10001);
    expect((await make()).number).toBe(10002);
    const lead = await newLead();
    await expect(A().lead.update({ where: { id: lead.id }, data: { number: 1 } })).rejects.toThrow(
      /never changes/,
    );
    expect((await B().lead.count()).valueOf()).toBe(0);
  });
});

describe('details', () => {
  it('keeps text short on one line, contact methods different, source and priority named', async () => {
    for (const data of [
      { businessName: ' ' },
      { bestTimeToContact: 'x'.repeat(101) },
      { sourceDetail: 'a\nb' },
      { preferredContactMethods: ['EMAIL', 'EMAIL'] },
    ]) {
      await expect(newLead(data)).rejects.toThrow(/leads_(r37_text|preferred_contact)/);
    }
    const lead = await newLead({
      businessName: 'Acme Widgets LLC',
      city: 'Auburn',
      state: 'GA',
      preferredContactMethods: ['PHONE', 'EMAIL'],
      bestTimeToContact: 'Evenings (after 5 PM)',
      source: 'FACEBOOK_AD',
      sourceDetail: 'Back Taxes Campaign',
      priority: 'HOT',
      assignedUserId: ids.staffA,
    });
    expect(lead).toMatchObject({
      source: 'FACEBOOK_AD',
      priority: 'HOT',
      assignedUserId: ids.staffA,
    });
    expect((await newLead()).source).toBe('OTHER');
  });

  it('is assigned to an active member of the firm', async () => {
    await expect(newLead({ assignedUserId: ids.inactiveStaff })).rejects.toThrow(/active member/);
    const lead = await newLead();
    await expect(
      A().lead.update({ where: { id: lead.id }, data: { assignedUserId: ids.inactiveStaff } }),
    ).rejects.toThrow(/active member/);
  });
});

describe('follow-up, archive and the pipeline', () => {
  it('a follow-up has a type and a time, a note goes with one', async () => {
    await expect(newLead({ nextActionType: 'CALL' })).rejects.toThrow(/leads_next_action/);
    await expect(newLead({ nextActionAt: hours(5) })).rejects.toThrow(/leads_next_action/);
    await expect(newLead({ nextActionNote: 'Ask about 2022' })).rejects.toThrow(
      /leads_next_action/,
    );
    await expect(
      newLead({ nextActionType: 'CALL', nextActionAt: hours(5), nextActionNote: 'Ask about 2022' }),
    ).resolves.toMatchObject({ nextActionType: 'CALL' });
  });

  it('the new statuses work, and a closed lead has no follow-up', async () => {
    const lead = await newLead({ status: 'SUBMITTED', submittedAt: new Date() });
    for (const status of ['CONTACTED', 'IN_FOLLOW_UP', 'APPOINTMENT_SCHEDULED', 'QUALIFIED']) {
      await expect(toStatus(lead.id, status)).resolves.toMatchObject({ status });
    }
    await A().lead.update({
      where: { id: lead.id },
      data: { nextActionType: 'EMAIL', nextActionAt: hours(24) },
    });
    await expect(toStatus(lead.id, 'LOST')).rejects.toThrow(/closed lead has no follow-up/);
    await expect(
      toStatus(lead.id, 'LOST', { nextActionType: null, nextActionAt: null, nextActionNote: null }),
    ).resolves.toMatchObject({ status: 'LOST' });
    await expect(
      A().lead.update({
        where: { id: lead.id },
        data: { nextActionType: 'CALL', nextActionAt: hours(2) },
      }),
    ).rejects.toThrow(/closed lead has no follow-up/);
  });

  it('is archived with who did it, never deleted', async () => {
    await expect(newLead({ archivedAt: new Date() })).rejects.toThrow(/leads_archived/);
    const lead = await newLead({ archivedAt: new Date(), archivedByUserId: ids.staffA });
    expect(lead.archivedByUserId).toBe(ids.staffA);
    await expect(A().lead.delete({ where: { id: lead.id } })).rejects.toThrow(/permission denied/);
  });
});

describe('services and tags', () => {
  it('a lead is interested in several live services, each once', async () => {
    const lead = await newLead();
    const add = (serviceId: string) =>
      A().leadService.create({ data: { businessId: ids.firmA, leadId: lead.id, serviceId } });
    await add(ids.service);
    await add(ids.service2);
    await expect(add(ids.service2)).rejects.toThrow(/Unique/i);
    await expect(add(ids.archivedService)).rejects.toThrow(/archived service/);
    await expect(
      A().leadService.delete({
        where: { leadId_serviceId: { leadId: lead.id, serviceId: ids.service2 } },
      }),
    ).resolves.toBeTruthy();
  });

  it('a lead has the firm’s tags, once each, never an archived one', async () => {
    const lead = await newLead();
    const tag = await newTag();
    const apply = (tagId: string) =>
      A().leadTag.create({
        data: { businessId: ids.firmA, leadId: lead.id, tagId, addedByUserId: ids.staffA },
      });
    await apply(tag.id);
    await expect(apply(tag.id)).rejects.toThrow(/Unique/i);
    const old = await newTag();
    await A().tag.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
    await expect(apply(old.id)).rejects.toThrow(/archived tag cannot be applied/);
  });
});

describe('the lead timeline', () => {
  const log = (leadId: string, data: Record<string, unknown>) =>
    A().leadActivity.create({
      data: { businessId: ids.firmA, leadId, kind: 'CALL', actorUserId: ids.staffA, ...data },
    });
  const rows = (leadId: string) =>
    A().leadActivity.findMany({ where: { leadId }, orderBy: { createdAt: 'asc' } });

  it('the database writes the new lead, each status change and a new owner', async () => {
    const lead = await newLead({
      status: 'SUBMITTED',
      submittedAt: new Date(),
      updatedByUserId: ids.staffA,
    });
    await toStatus(lead.id, 'CONTACTED', { updatedByUserId: ids.staffA });
    await A().lead.update({ where: { id: lead.id }, data: { priority: 'COLD' } });
    await A().lead.update({ where: { id: lead.id }, data: { assignedUserId: ids.staffA } });
    const all = await rows(lead.id);
    expect(all.map((r) => r.kind)).toEqual(['CREATED', 'STATUS_CHANGED', 'ASSIGNED']);
    expect(all[1]).toMatchObject({ status: 'CONTACTED', actorUserId: ids.staffA });
    expect(all[0]!.actorUserId).toBe(ids.staffA);
  });

  it('the API logs calls and notes; a note has text, only a status change has a status', async () => {
    const lead = await newLead();
    await expect(log(lead.id, { kind: 'NOTE' })).rejects.toThrow(/lead_activities_text/);
    await expect(log(lead.id, { status: 'CONTACTED' })).rejects.toThrow(/lead_activities_text/);
    await expect(log(lead.id, { kind: 'STATUS_CHANGED' })).rejects.toThrow(/lead_activities_text/);
    await expect(log(lead.id, { summary: 'x'.repeat(201) })).rejects.toThrow(
      /lead_activities_text/,
    );
    await expect(log(lead.id, { kind: 'NOTE', body: 'Wants evenings' })).resolves.toBeTruthy();
    await expect(
      log(lead.id, { occurredAt: new Date(Date.now() - 86_400_000) }),
    ).resolves.toBeTruthy();
    await expect(log(lead.id, { occurredAt: hours(2) })).rejects.toThrow(/in the future/);
  });

  it('is append-only and private to the firm', async () => {
    const lead = await newLead();
    const entry = await log(lead.id, { kind: 'MEETING', summary: 'Intro meeting' });
    expect(await B().leadActivity.findUnique({ where: { id: entry.id } })).toBeNull();
    await expect(
      B().leadActivity.create({ data: { businessId: ids.firmB, leadId: lead.id, kind: 'CALL' } }),
    ).rejects.toThrow(/foreign key/i);
    await expect(log(lead.id, { actorUserId: ids.staffB })).rejects.toThrow(/foreign key/i);
    await expect(
      A().leadActivity.update({ where: { id: entry.id }, data: { summary: 'x' } }),
    ).rejects.toThrow(/permission denied/);
    await expect(A().leadActivity.delete({ where: { id: entry.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});
