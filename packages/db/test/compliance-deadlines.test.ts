// Compliance & Deadlines, part 1 (R38): deadlines, their reminders, documents and links, and the
// task links. Isolation between firms and the rules of migration r38_compliance_deadlines.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
let otherClientA: string;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
const deadline = (data: Record<string, unknown> = {}, clientId = () => f.clientA) =>
  A().complianceDeadline.create({
    data: {
      businessId: f.firmA,
      clientId: clientId(),
      name: 'Q3 Estimated Tax (fake)',
      type: 'ESTIMATED_TAX',
      dueOn: day('2026-10-15'),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38cd');
  otherClientA = (
    await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    )
  ).id;
});

describe('isolation', () => {
  it('another firm sees no deadline or reminder', async () => {
    const d1 = await deadline();
    await A().complianceDeadlineReminder.create({
      data: { businessId: f.firmA, deadlineId: d1.id, daysBefore: 7 },
    });
    const B = db.forBusiness(f.firmB);
    expect(await B.complianceDeadline.findMany()).toEqual([]);
    expect(await B.complianceDeadlineReminder.findMany()).toEqual([]);
    expect(
      await failure(
        B.complianceDeadline.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            name: 'x',
            type: 'OTHER',
            dueOn: day('2026-10-15'),
          },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("refuses another firm's client or assignee", async () => {
    expect(await failure(deadline({}, () => f.clientB))).toMatch(/foreign key/i);
    expect(await failure(deadline({ assignedUserId: f.memberB }))).toMatch(/foreign key/i);
  });
});

describe('dates and statuses', () => {
  it('an override has a reason, and only an override', async () => {
    await expect(deadline({ statutoryDueOn: day('2026-10-15') })).resolves.toMatchObject({
      dueOverridden: false,
    });
    for (const data of [
      { dueOverridden: true },
      { dueOverridden: true, dueOverrideReason: ' ' },
      { dueOverrideReason: 'Client asked' },
    ]) {
      expect(await failure(deadline(data))).toMatch(/check constraint/i);
    }
    await expect(
      deadline({
        statutoryDueOn: day('2026-10-15'),
        dueOn: day('2026-10-20'),
        dueOverridden: true,
        dueOverrideReason: 'Disaster relief',
      }),
    ).resolves.toMatchObject({ statutoryDueOn: day('2026-10-15') });
  });

  it('an extension has both dates and never shortens; the payment date stays apart', async () => {
    for (const data of [
      { extensionFiledOn: day('2026-03-01') },
      { extendedDueOn: day('2026-12-01') },
      { extensionFiledOn: day('2026-03-01'), extendedDueOn: day('2026-10-01') },
    ]) {
      expect(await failure(deadline(data))).toMatch(/check constraint/i);
    }
    await expect(
      deadline({
        extensionFiledOn: day('2026-03-01'),
        extendedDueOn: day('2026-10-15'),
        paymentDueOn: day('2026-04-15'),
      }),
    ).resolves.toMatchObject({ paymentDueOn: day('2026-04-15') });
  });

  it('completed has its time, and not applicable has its reason', async () => {
    expect(await failure(deadline({ status: 'COMPLETED' }))).toMatch(/check constraint/i);
    expect(await failure(deadline({ completedAt: new Date() }))).toMatch(/check constraint/i);
    expect(await failure(deadline({ status: 'NOT_APPLICABLE' }))).toMatch(/check constraint/i);
    await expect(
      deadline({
        status: 'COMPLETED',
        completedAt: new Date(),
        filedOn: day('2026-10-14'),
        confirmationNumber: 'FAKE-123',
      }),
    ).resolves.toBeTruthy();
    await expect(
      deadline({ status: 'NOT_APPLICABLE', notApplicableReason: 'Exempt entity' }),
    ).resolves.toBeTruthy();
  });

  it('checks the name, state code, tax year and task template', async () => {
    for (const data of [
      { name: ' ' },
      { state: 'Georgia' },
      { state: 'ga' },
      { taxYear: 1999 },
      { createTask: false, taskTemplateId: randomUUID() },
    ]) {
      expect(await failure(deadline(data))).toMatch(/check constraint|foreign key/i);
    }
    await expect(
      deadline({ state: 'GA', jurisdiction: 'STATE', agency: 'GA DOR' }),
    ).resolves.toBeTruthy();
  });

  it('keeps its client', async () => {
    const d = await deadline();
    expect(
      await failure(
        A().complianceDeadline.update({ where: { id: d.id }, data: { clientId: otherClientA } }),
      ),
    ).toMatch(/cannot change client/);
  });
});

describe('reminders', () => {
  it('are 0 to 365 days before, with a channel, one per day count', async () => {
    const d = await deadline();
    const add = (data: Record<string, unknown>) =>
      A().complianceDeadlineReminder.create({
        data: { businessId: f.firmA, deadlineId: d.id, daysBefore: 14, ...data },
      });
    for (const data of [{ daysBefore: -1 }, { daysBefore: 366 }, { inApp: false }]) {
      expect(await failure(add(data))).toMatch(/check constraint/i);
    }
    await add({ channels: ['EMAIL', 'SMS'] });
    expect(await failure(add({}))).toMatch(/unique/i);
  });
});

describe('tasks of a deadline', () => {
  it("are the deadline's client's, and one per deadline and template", async () => {
    const d = await deadline();
    const template = await A().taskTemplate.create({
      data: { businessId: f.firmA, name: `Estimated tax ${randomUUID()}` },
    });
    const task = (clientId: string, data: Record<string, unknown> = {}) =>
      A().task.create({
        data: { businessId: f.firmA, clientId, title: 'Prepare (fake)', deadlineId: d.id, ...data },
      });
    expect(await failure(task(otherClientA))).toMatch(/deadline's client/);
    await expect(task(f.clientA)).resolves.toBeTruthy();
    await expect(task(f.clientA)).resolves.toBeTruthy(); // manual tasks: any number
    await task(f.clientA, { templateId: template.id });
    expect(await failure(task(f.clientA, { templateId: template.id }))).toMatch(/unique/i);
  });

  it("cannot use another firm's deadline", async () => {
    const dB = await db.forBusiness(f.firmB).complianceDeadline.create({
      data: {
        businessId: f.firmB,
        clientId: f.clientB,
        name: 'B (fake)',
        type: 'OTHER',
        dueOn: day('2026-10-15'),
      },
    });
    expect(
      await failure(
        A().task.create({
          data: { businessId: f.firmA, clientId: f.clientA, title: 'x', deadlineId: dB.id },
        }),
      ),
    ).toMatch(/foreign key|deadline's client/i);
  });
});
