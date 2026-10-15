// Tasks module, part 4 (R38): recurring series and their occurrences. Isolation
// between firms, the end rules, and idempotent generation. Runs as the app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const day = (d: string) => new Date(d);
const series = (data: Record<string, unknown> = {}) =>
  A().taskSeries.create({
    data: {
      businessId: f.firmA,
      clientId: f.clientA,
      title: 'Quarterly review (fake)',
      unit: 'MONTH',
      interval: 3,
      startOn: day('2026-10-15'),
      ...data,
    },
  });
const occurrence = (seriesId: string, scheduledOn: string, data: Record<string, unknown> = {}) =>
  A().taskOccurrence.create({
    data: {
      businessId: f.firmA,
      seriesId,
      scheduledOn: day(scheduledOn),
      dueOn: day(scheduledOn),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r38ts');
});

describe('isolation', () => {
  it('another firm sees no series or occurrence', async () => {
    const s = await series();
    await occurrence(s.id, '2026-10-15');
    const B = db.forBusiness(f.firmB);
    expect(await B.taskSeries.findMany()).toEqual([]);
    expect(await B.taskOccurrence.findMany()).toEqual([]);
    expect(
      await failure(
        B.taskSeries.create({
          data: {
            businessId: f.firmA,
            clientId: f.clientA,
            title: 'x',
            unit: 'DAY',
            startOn: day('2026-10-15'),
          },
        }),
      ),
    ).toMatch(/row-level security|violates/i);
  });

  it("a series cannot point at another firm's client or assignee, or list a foreign extra assignee", async () => {
    expect(await failure(series({ clientId: f.clientB }))).toMatch(/foreign key/i);
    expect(
      await failure(series({ assignmentRule: 'SPECIFIC_USER', assignedUserId: f.memberB })),
    ).toMatch(/foreign key/i);
    expect(await failure(series({ extraAssigneeIds: [f.memberB] }))).toMatch(/must be a member/);
    await expect(series({ extraAssigneeIds: [f.memberA, f.member2A] })).resolves.toBeTruthy();
  });
});

describe('series', () => {
  it('ends never, after N tasks, or on a date, and never before it starts', async () => {
    await expect(series({ endMode: 'AFTER_COUNT', endAfterCount: 8 })).resolves.toBeTruthy();
    await expect(series({ endMode: 'ON_DATE', endOn: day('2027-10-15') })).resolves.toBeTruthy();
    for (const data of [
      { endMode: 'AFTER_COUNT' },
      { endMode: 'AFTER_COUNT', endAfterCount: 0 },
      { endMode: 'ON_DATE', endOn: day('2026-01-01') },
      { endMode: 'NEVER', endAfterCount: 3 },
      { endMode: 'ON_DATE', endOn: day('2027-10-15'), endAfterCount: 3 },
    ]) {
      expect(await failure(series(data))).toMatch(/check constraint/i);
    }
  });

  it('checks the interval, lead time, pause and client notice rules', async () => {
    for (const data of [
      { interval: 0 },
      { leadDays: 91 },
      { status: 'PAUSED' },
      { status: 'ENDED' },
      { notifyClient: true }, // only for client-visible tasks
      { assignmentRule: 'SPECIFIC_USER' },
      { pattern: [] },
    ]) {
      expect(await failure(series(data))).toMatch(/check constraint/i);
    }
    await expect(series({ status: 'PAUSED', pausedAt: new Date() })).resolves.toBeTruthy();
    await expect(series({ clientVisible: true, notifyClient: true })).resolves.toBeTruthy();
  });

  it('keeps its client and start date', async () => {
    const s = await series();
    const other = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    );
    for (const data of [{ clientId: other.id }, { startOn: day('2026-11-15') }]) {
      expect(await failure(A().taskSeries.update({ where: { id: s.id }, data }))).toMatch(
        /cannot change/,
      );
    }
    await expect(
      A().taskSeries.update({ where: { id: s.id }, data: { title: 'Renamed', unit: 'YEAR' } }),
    ).resolves.toMatchObject({ title: 'Renamed' });
  });
});

describe('occurrences', () => {
  it('make at most one row (so one task) per date: a retry finds the row', async () => {
    const s = await series();
    await occurrence(s.id, '2026-10-15');
    expect(await failure(occurrence(s.id, '2026-10-15'))).toMatch(/unique/i);
    await expect(occurrence(s.id, '2027-01-15')).resolves.toMatchObject({ state: 'SCHEDULED' });
  });

  it('a GENERATED row has its task and time, a SKIPPED one a reason, and a task serves one date', async () => {
    const s = await series();
    const task = await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Made (fake)' },
    });
    const made = { state: 'GENERATED' as const, generatedAt: new Date() };
    expect(await failure(occurrence(s.id, '2026-10-15', made))).toMatch(/check constraint/i);
    expect(await failure(occurrence(s.id, '2026-10-15', { taskId: task.id }))).toMatch(
      /check constraint/i,
    );
    await expect(
      occurrence(s.id, '2026-10-15', { ...made, taskId: task.id }),
    ).resolves.toBeTruthy();
    expect(await failure(occurrence(s.id, '2027-01-15', { ...made, taskId: task.id }))).toMatch(
      /unique/i,
    );
    expect(await failure(occurrence(s.id, '2027-04-15', { skipReason: 'Holiday' }))).toMatch(
      /check constraint/i,
    );
    await expect(
      occurrence(s.id, '2027-07-15', { state: 'SKIPPED', skipReason: 'Client away' }),
    ).resolves.toBeTruthy();
  });

  it("the task must be the series' client's, and a made task and the date never change", async () => {
    const s = await series();
    const other = await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
      tx.client.create({ data: { businessId: f.firmA, displayName: 'Other (fake)' } }),
    );
    const foreign = await A().task.create({
      data: { businessId: f.firmA, clientId: other.id, title: 'Other (fake)' },
    });
    const made = { state: 'GENERATED' as const, generatedAt: new Date() };
    expect(await failure(occurrence(s.id, '2026-10-15', { ...made, taskId: foreign.id }))).toMatch(
      /series' client/,
    );
    const own = await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Own (fake)' },
    });
    const o = await occurrence(s.id, '2026-10-15', { ...made, taskId: own.id });
    const upd = (data: Record<string, unknown>) =>
      A().taskOccurrence.update({ where: { id: o.id }, data });
    expect(await failure(upd({ scheduledOn: day('2026-10-16') }))).toMatch(/never change/);
    expect(await failure(upd({ taskId: foreign.id }))).toMatch(/never change/);
    // A failed attempt is recorded on a scheduled date, safely.
    const retry = await occurrence(s.id, '2027-01-15');
    await expect(
      A().taskOccurrence.update({
        where: { id: retry.id },
        data: { state: 'FAILED', failureCode: 'CLIENT_INACTIVE', attempts: 1 },
      }),
    ).resolves.toMatchObject({ attempts: 1 });
  });
});
