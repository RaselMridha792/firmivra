// Tasks module, part 3 (R38): task templates. Isolation between firms and the shape rules of
// migration r38_tasks_templates. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38tt');
});

describe('isolation', () => {
  it('another firm sees no template, and cannot use or change one', async () => {
    const t = await A().taskTemplate.create({ data: { businessId: f.firmA, name: 'Onboarding' } });
    const B = db.forBusiness(f.firmB);
    expect(await B.taskTemplate.findMany()).toEqual([]);
    expect(
      (await B.taskTemplate.updateMany({ where: { id: t.id }, data: { name: 'x' } })).count,
    ).toBe(0);
    expect(
      await failure(B.taskTemplate.create({ data: { businessId: f.firmA, name: 'Sneaky' } })),
    ).toMatch(/row-level security|violates/i);
  });

  it('refuses a type, service or assignee of another firm', async () => {
    const typeB = await db
      .forBusiness(f.firmB)
      .taskType.create({ data: { businessId: f.firmB, name: 'B' } });
    const make = (data: Record<string, unknown>) =>
      A().taskTemplate.create({
        data: { businessId: f.firmA, name: `n${Math.random()}`, ...data },
      });
    expect(await failure(make({ typeId: typeB.id }))).toMatch(/foreign key/i);
    expect(
      await failure(make({ assignmentRule: 'SPECIFIC_USER', assignedUserId: f.memberB })),
    ).toMatch(/foreign key/i);
  });
});

describe('templates', () => {
  it('have a unique name per firm and a checked shape', async () => {
    const make = (data: Record<string, unknown>) =>
      A().taskTemplate.create({ data: { businessId: f.firmA, name: 'T', ...data } });
    await make({ name: 'Unique' });
    expect(await failure(make({ name: 'Unique' }))).toMatch(/unique/i);
    for (const data of [
      { name: ' ' },
      { dueOffsetDays: -1 },
      { checklist: { not: 'an array' } },
      { reminders: new Array(11).fill({ daysBefore: 1 }) },
      { assignmentRule: 'SPECIFIC_USER' }, // needs a user
      { assignedUserId: f.memberA }, // a user needs the rule
    ]) {
      expect(await failure(make({ name: `n${Math.random()}`, ...data }))).toMatch(
        /check constraint/i,
      );
    }
    await expect(
      make({
        name: 'Ok',
        assignmentRule: 'SPECIFIC_USER',
        assignedUserId: f.memberA,
        recurrence: { unit: 'MONTH' },
      }),
    ).resolves.toBeTruthy();
  });
});
