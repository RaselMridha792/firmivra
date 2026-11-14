// Tax Planning Review 2, approved addition "Project Deadlines" (R56; the lead's approval under
// Rasel's db delegation, Nov 14; migration r56_project_deadlines): a staff member's own deadline
// with its service, an optional client and several reminders, private by default or shared with
// chosen coworkers, apart from the Tax Calendar. Who sees which is the API's rule; here the
// tables keep each firm's rows to itself and the shapes whole. Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let serviceA = '';
let serviceB = '';
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const DUE = new Date(Date.UTC(2033, 3, 15, 21, 0));

const deadline = (data: Record<string, unknown> = {}) =>
  A().projectDeadline.create({
    data: {
      businessId: f.firmA,
      name: `Fake planning review ${randomUUID().slice(0, 8)}`,
      dueAt: DUE,
      serviceId: serviceA,
      ownerUserId: f.memberA,
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r56pd');
  const service = (businessId: string) =>
    db.forBusiness(businessId).service.create({
      data: { businessId, kind: 'TAX_PLANNING', name: `Fake planning ${randomUUID().slice(0, 8)}` },
    });
  serviceA = (await service(f.firmA)).id;
  serviceB = (await service(f.firmB)).id;
});

describe('project deadlines', () => {
  it('belong to Tax Planning and are private unless shared; a client is optional', async () => {
    const d = await deadline({ description: 'Fake: review the estimated payments' });
    expect(d).toMatchObject({
      area: 'TAX_PLANNING',
      visibility: 'PRIVATE',
      clientId: null,
      completedAt: null,
    });
    const withClient = await deadline({ clientId: f.clientA, visibility: 'SHARED' });
    expect(withClient).toMatchObject({ clientId: f.clientA, visibility: 'SHARED' });
  });

  it('keep a name with words, a description of at most 4,000 characters, and completion whole', async () => {
    for (const name of ['   ', 'x'.repeat(201)]) {
      expect(await failure(deadline({ name }))).toMatch(/project_deadlines_name/);
    }
    for (const description of ['  ', 'x'.repeat(4001)]) {
      expect(await failure(deadline({ description }))).toMatch(/project_deadlines_description/);
    }
    expect(await failure(deadline({ completedAt: new Date() }))).toMatch(
      /project_deadlines_completed_together/,
    );
    expect(await failure(deadline({ completedByUserId: f.memberA }))).toMatch(
      /project_deadlines_completed_together/,
    );
    const done = await deadline({ completedAt: new Date(), completedByUserId: f.member2A });
    expect(done.completedByUserId).toBe(f.member2A);
  });

  it('take several reminders, each once, from the due time up to a year before', async () => {
    const d = await deadline();
    await A().projectDeadlineReminder.createMany({
      data: [
        { businessId: f.firmA, deadlineId: d.id, minutesBefore: 0, unit: 'MINUTES' },
        {
          businessId: f.firmA,
          deadlineId: d.id,
          minutesBefore: 120,
          unit: 'HOURS',
          channels: ['EMAIL'],
        },
        {
          businessId: f.firmA,
          deadlineId: d.id,
          minutesBefore: 10_080,
          unit: 'DAYS',
          inApp: false,
          channels: ['EMAIL'],
        },
      ],
    });
    const reminders = await A().projectDeadlineReminder.findMany({
      where: { deadlineId: d.id },
      orderBy: { minutesBefore: 'asc' },
    });
    expect(reminders.map((r) => [r.minutesBefore, r.inApp, r.channels, r.sentAt])).toEqual([
      [0, true, [], null],
      [120, true, ['EMAIL'], null],
      [10_080, false, ['EMAIL'], null],
    ]);
    const reminder = (minutesBefore: number) =>
      A().projectDeadlineReminder.create({
        data: { businessId: f.firmA, deadlineId: d.id, minutesBefore, unit: 'MINUTES' },
      });
    expect(await failure(reminder(120))).toMatch(/Unique constraint|unique/i);
    for (const minutes of [-1, 525_601]) {
      expect(await failure(reminder(minutes))).toMatch(/project_deadline_reminders_minutes/);
    }
  });

  it('are shared with coworkers of the same firm, once each, and shares and reminders go with them', async () => {
    const d = await deadline({ visibility: 'SHARED' });
    await A().projectDeadlineShare.create({
      data: { businessId: f.firmA, deadlineId: d.id, userId: f.member2A },
    });
    expect(
      await failure(
        A().projectDeadlineShare.create({
          data: { businessId: f.firmA, deadlineId: d.id, userId: f.member2A },
        }),
      ),
    ).toMatch(/Unique constraint|unique/i);
    // Firm B's member is no coworker here.
    expect(
      await failure(
        A().projectDeadlineShare.create({
          data: { businessId: f.firmA, deadlineId: d.id, userId: f.memberB },
        }),
      ),
    ).toMatch(/Foreign key|foreign key/i);
    await A().projectDeadlineReminder.create({
      data: { businessId: f.firmA, deadlineId: d.id, minutesBefore: 60, unit: 'HOURS' },
    });
    await A().projectDeadline.delete({ where: { id: d.id } });
    expect(await A().projectDeadlineShare.count({ where: { deadlineId: d.id } })).toBe(0);
    expect(await A().projectDeadlineReminder.count({ where: { deadlineId: d.id } })).toBe(0);
  });

  it("stay with their owner when the owner is deactivated; a member can't be removed under them", async () => {
    const d = await deadline({ ownerUserId: f.member2A });
    await A().membership.updateMany({
      where: { userId: f.member2A },
      data: { status: 'DEACTIVATED' },
    });
    expect(await A().projectDeadline.findUnique({ where: { id: d.id } })).toMatchObject({
      ownerUserId: f.member2A,
    });
    expect(
      await failure(
        runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
          tx.membership.deleteMany({ where: { userId: f.member2A } }),
        ),
      ),
    ).toMatch(/Foreign key|foreign key/i);
  });

  it("are each firm's own: another firm reads none, writes none, and can't name this firm's service, client or member", async () => {
    const d = await deadline();
    expect(await B().projectDeadline.findMany({ where: { id: d.id } })).toEqual([]);
    expect(
      await B().projectDeadline.updateMany({ where: { id: d.id }, data: { name: 'x' } }),
    ).toEqual({
      count: 0,
    });
    // Firm A's row can't be written from firm B's scope.
    expect(
      await failure(
        B().projectDeadline.create({
          data: {
            businessId: f.firmA,
            name: 'Fake',
            dueAt: DUE,
            serviceId: serviceA,
            ownerUserId: f.memberA,
          },
        }),
      ),
    ).toMatch(/row-level security/);
    for (const data of [
      { serviceId: serviceB },
      { clientId: f.clientB },
      { ownerUserId: f.memberB },
    ]) {
      expect(await failure(deadline(data))).toMatch(/Foreign key|foreign key/i);
    }
  });
});
