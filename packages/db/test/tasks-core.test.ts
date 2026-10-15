// Tasks module, part 1 (R38): the new task fields, task types and additional assignees. A firm
// never sees another firm's rows, and the rules in migration r38_tasks_core hold. Runs as the
// app role under RLS.
import { inject, beforeAll, describe, expect, it } from 'vitest';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const task = (data: Record<string, unknown> = {}) =>
  A().task.create({
    data: { businessId: f.firmA, clientId: f.clientA, title: 'Prepare plan (fake)', ...data },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38tc');
});

describe('isolation', () => {
  it('task types and assignees are invisible to another firm', async () => {
    const type = await A().taskType.create({ data: { businessId: f.firmA, name: 'Advisory' } });
    const t = await task({ typeId: type.id });
    await A().taskAssignee.create({
      data: { businessId: f.firmA, taskId: t.id, userId: f.member2A },
    });
    expect(await B().taskType.findMany()).toEqual([]);
    expect(await B().taskAssignee.findMany()).toEqual([]);
    expect(await A().taskAssignee.count()).toBe(1);
    await expect(
      B().taskType.create({ data: { businessId: f.firmA, name: 'Sneaky' } }),
    ).rejects.toThrow();
  });

  it('a task cannot use another firm type, service or prerequisite', async () => {
    const typeB = await B().taskType.create({ data: { businessId: f.firmB, name: 'B only' } });
    expect(await failure(task({ typeId: typeB.id }))).toMatch(/foreign key/i);
    const taskB = await B().task.create({
      data: { businessId: f.firmB, clientId: f.clientB, title: 'B task (fake)' },
    });
    expect(await failure(task({ dependsOnTaskId: taskB.id }))).toMatch(/foreign key/i);
  });

  it('only a member of the same firm can be an additional assignee', async () => {
    const t = await task();
    const msg = await failure(
      A().taskAssignee.create({ data: { businessId: f.firmA, taskId: t.id, userId: f.memberB } }),
    );
    expect(msg).toMatch(/foreign key/i);
  });
});

describe('constraints', () => {
  it('task type names are unique per firm, not blank and short', async () => {
    await A().taskType.create({ data: { businessId: f.firmA, name: 'Unique' } });
    await B().taskType.create({ data: { businessId: f.firmB, name: 'Unique' } });
    expect(
      await failure(A().taskType.create({ data: { businessId: f.firmA, name: 'Unique' } })),
    ).toMatch(/unique/i);
    for (const name of [' ', 'x'.repeat(81)]) {
      expect(await failure(A().taskType.create({ data: { businessId: f.firmA, name } }))).toMatch(
        /check constraint/i,
      );
    }
  });

  it('keeps the due time, start date and text limits', async () => {
    const day = new Date('2026-10-15');
    const time = new Date('1970-01-01T17:00:00Z');
    expect(await failure(task({ dueOn: day, dueTime: time }))).toMatch(/check constraint/i); // all day
    expect(await failure(task({ allDay: false, dueTime: time }))).toMatch(/check constraint/i); // no date
    await expect(task({ dueOn: day, allDay: false, dueTime: time })).resolves.toMatchObject({
      allDay: false,
    });
    expect(await failure(task({ startOn: new Date('2026-10-16'), dueOn: day }))).toMatch(
      /check constraint/i,
    );
    expect(await failure(task({ internalNotes: 'x'.repeat(5001) }))).toMatch(/check constraint/i);
    expect(await failure(task({ details: 'x'.repeat(2001) }))).toMatch(/check constraint/i);
  });

  it('defaults: MEDIUM priority, hidden from the client, all day', async () => {
    await expect(task()).resolves.toMatchObject({
      priority: 'MEDIUM',
      clientVisible: false,
      allDay: true,
      status: 'OPEN',
    });
  });

  it('tracks progress apart from the lifecycle status', async () => {
    for (const progress of ['NOT_STARTED', 'IN_PROGRESS', 'WAITING', 'BLOCKED'] as const) {
      await expect(task({ progress })).resolves.toMatchObject({ progress, status: 'OPEN' });
    }
    await expect(task()).resolves.toMatchObject({ progress: 'PENDING' });
  });
});

describe('prerequisites', () => {
  it('refuses a task that is its own prerequisite, and any cycle', async () => {
    const t1 = await task();
    const t2 = await task({ dependsOnTaskId: t1.id });
    const t3 = await task({ dependsOnTaskId: t2.id });
    const set = (id: string, dependsOnTaskId: string) =>
      A().task.update({ where: { id }, data: { dependsOnTaskId } });
    expect(await failure(set(t1.id, t1.id))).toMatch(/depend on itself/);
    expect(await failure(set(t1.id, t2.id))).toMatch(/depend on itself/);
    expect(await failure(set(t1.id, t3.id))).toMatch(/depend on itself/);
    await expect(set(t3.id, t1.id)).resolves.toMatchObject({ dependsOnTaskId: t1.id });
  });

  it('a prerequisite task cannot be deleted while others wait on it', async () => {
    const pre = await task();
    await task({ dependsOnTaskId: pre.id });
    expect(await failure(A().task.delete({ where: { id: pre.id } }))).toMatch(/foreign key/i);
  });
});
