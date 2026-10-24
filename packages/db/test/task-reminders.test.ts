// Custom task reminders (R1, Oct 24; migration r1_task_reminder_custom): minutes, hours or days
// before the due date and time beside the days rules, which stay as they were. The CHECK keeps a
// Custom rule whole (a length in its unit, no time, its whole days in days_before), the partial
// unique indexes keep each rule once, and a firm never reads or adds another firm's. Runs as the
// app role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { databaseErrorCode } from '../src/errors.js';
import { connect, createTwoFirms, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const nine = new Date('1970-01-01T09:00:00Z');

const newTask = async () =>
  (
    await A().task.create({
      data: { businessId: f.firmA, clientId: f.clientA, title: 'Reminders (fake)' },
      select: { id: true },
    })
  ).id;
/** A reminder row of firm A's task; Custom when `unit` is given. */
const add = (taskId: string, data: Record<string, unknown>) =>
  A().taskReminder.create({ data: { businessId: f.firmA, taskId, daysBefore: 0, ...data } });

/**
 * How the database answered: '' when the write went through, otherwise "<SQLSTATE> <message and
 * meta>", so a test can name both the code and the constraint or index.
 */
async function refusal(p: PromiseLike<unknown>): Promise<string> {
  try {
    await p;
    return '';
  } catch (error) {
    const code = databaseErrorCode(error) ?? String((error as { code?: unknown }).code);
    const meta = JSON.stringify((error as { meta?: unknown }).meta ?? {});
    return `${code} ${error instanceof Error ? error.message : String(error)} ${meta}`;
  }
}

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1trc');
});

describe('a days rule, or Custom', () => {
  it('keeps the days rules as they were, with or without a time', async () => {
    const t = await newTask();
    await expect(add(t, { daysBefore: 7 })).resolves.toMatchObject({
      daysBefore: 7,
      minutesBefore: null,
      unit: null,
    });
    await expect(add(t, { daysBefore: 1, timeOfDay: nine })).resolves.toMatchObject({
      unit: null,
    });
    // The old checks still hold for every rule.
    expect(await refusal(add(t, { daysBefore: 366 }))).toMatch(/^23514 .*task_reminders_shape/s);
  });

  it('takes a Custom rule in each unit, its whole days in days_before', async () => {
    const t = await newTask();
    for (const [minutesBefore, unit, daysBefore] of [
      [90, 'MINUTES', 0],
      [1_500, 'MINUTES', 1],
      [2_160, 'HOURS', 1],
      [2_880, 'DAYS', 2],
      [525_600, 'DAYS', 365],
    ] as const) {
      await expect(add(t, { minutesBefore, unit, daysBefore })).resolves.toMatchObject({
        minutesBefore,
        unit,
        daysBefore,
        timeOfDay: null,
      });
    }
  });

  it('refuses a Custom rule that is not whole (23514)', async () => {
    const t = await newTask();
    for (const data of [
      // a time on a Custom rule
      { minutesBefore: 60, unit: 'HOURS', timeOfDay: nine },
      // whole days that do not match
      { minutesBefore: 2_880, unit: 'DAYS', daysBefore: 1 },
      { minutesBefore: 1_500, unit: 'MINUTES', daysBefore: 0 },
      // 90 minutes typed as hours, 2 hours typed as days
      { minutesBefore: 90, unit: 'HOURS' },
      { minutesBefore: 120, unit: 'DAYS' },
      // a unit alone, a length alone
      { unit: 'MINUTES' },
      { minutesBefore: 30 },
      // zero, negative, over 525,600 (365 days)
      { minutesBefore: 0, unit: 'MINUTES' },
      { minutesBefore: -60, unit: 'HOURS' },
      { minutesBefore: 525_601, unit: 'MINUTES', daysBefore: 365 },
    ]) {
      expect(await refusal(add(t, data)), JSON.stringify(data)).toMatch(
        /^23514 .*task_reminders_custom/s,
      );
    }
    expect(await A().taskReminder.count({ where: { taskId: t } })).toBe(0);
  });
});

describe('each rule once', () => {
  it('refuses two equal days rules, also with no time (23505)', async () => {
    const t = await newTask();
    await add(t, { daysBefore: 1 });
    expect(await refusal(add(t, { daysBefore: 1 }))).toMatch(
      /^23505 .*task_reminders_one_days_rule/s,
    );
    await add(t, { daysBefore: 1, timeOfDay: nine });
    expect(await refusal(add(t, { daysBefore: 1, timeOfDay: nine }))).toMatch(/^23505 /);
    // Another task may have the same rules.
    await expect(add(await newTask(), { daysBefore: 1 })).resolves.toBeTruthy();
  });

  it('refuses two Custom rules of one length, whatever the unit (23505)', async () => {
    const t = await newTask();
    await add(t, { minutesBefore: 60, unit: 'MINUTES' });
    expect(await refusal(add(t, { minutesBefore: 60, unit: 'HOURS' }))).toMatch(
      /^23505 .*task_reminders_one_custom_rule/s,
    );
    await add(t, { minutesBefore: 1_440, unit: 'DAYS', daysBefore: 1 });
    expect(await refusal(add(t, { minutesBefore: 1_440, unit: 'HOURS', daysBefore: 1 }))).toMatch(
      /^23505 .*task_reminders_one_custom_rule/s,
    );
  });

  it('lets a days rule and a Custom rule of the same whole days live side by side', async () => {
    const t = await newTask();
    await add(t, { daysBefore: 0 });
    await add(t, { minutesBefore: 120, unit: 'HOURS' });
    await add(t, { daysBefore: 1 });
    await add(t, { minutesBefore: 1_440, unit: 'DAYS', daysBefore: 1 });
    await add(t, { minutesBefore: 1_500, unit: 'MINUTES', daysBefore: 1 });
    const rows = await A().taskReminder.findMany({
      where: { taskId: t },
      orderBy: [{ daysBefore: 'asc' }, { minutesBefore: { sort: 'asc', nulls: 'first' } }],
    });
    expect(rows.map((r) => [r.daysBefore, r.minutesBefore, r.unit])).toEqual([
      [0, null, null],
      [0, 120, 'HOURS'],
      [1, null, null],
      [1, 1_440, 'DAYS'],
      [1, 1_500, 'MINUTES'],
    ]);
  });
});

describe('isolation', () => {
  it("another firm never reads, changes or adds Custom rules on a firm's task", async () => {
    const t = await newTask();
    const rule = await add(t, { minutesBefore: 30, unit: 'MINUTES' });
    expect(await B().taskReminder.findMany({ where: { taskId: t } })).toEqual([]);
    expect(await B().taskReminder.findUnique({ where: { id: rule.id } })).toBeNull();
    const { count } = await B().taskReminder.updateMany({
      where: { id: rule.id },
      data: { minutesBefore: 45 },
    });
    expect(count).toBe(0);
    expect(
      await refusal(
        B().taskReminder.create({
          data: {
            businessId: f.firmA,
            taskId: t,
            daysBefore: 0,
            minutesBefore: 15,
            unit: 'MINUTES',
          },
        }),
      ),
    ).toMatch(/row-level security/i);
    // Firm B's own id with firm A's task: the task is not B's.
    expect(
      await refusal(
        B().taskReminder.create({
          data: {
            businessId: f.firmB,
            taskId: t,
            daysBefore: 0,
            minutesBefore: 15,
            unit: 'MINUTES',
          },
        }),
      ),
    ).toMatch(/foreign key/i);
    const kept = await A().taskReminder.findMany({ where: { taskId: t } });
    expect(kept.map((r) => [r.minutesBefore, r.unit])).toEqual([[30, 'MINUTES']]);
  });
});
