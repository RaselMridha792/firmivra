// Custom task reminders (R1, Oct 24; Octavia's Tasks review A3): the rules of task-common.ts. A
// rule is a days rule or Custom (minutes, hours or days before the due date and time). Custom
// needs a due time; two rules never fire at one moment; a template's rules that do not fit a new
// task are left out; a task's rules read in the order they fire; a reminder index's refusal is
// the reminders' 400.
import { BadRequestException, ConflictException, type HttpException } from '@nestjs/common';
import { ReminderRule } from '@firmivra/types';
import { describe, expect, it } from 'vitest';
import {
  checkReminders,
  fitReminders,
  inFiringOrder,
  type Reminder,
  reminderFrom,
  reminderFromRow,
  reminderOut,
  remindersFromJson,
  remindersJson,
} from '../../src/tasks/task-common.js';
import { TaskWriteService } from '../../src/tasks/task-write.service.js';

/** A rule as a request sends it, parsed by the contract. */
const rule = (body: object): Reminder => reminderFrom(ReminderRule.parse(body));
const days = (daysBefore: number, timeOfDay: string | null = null) =>
  rule({ daysBefore, timeOfDay });
const custom = (amount: number, unit: 'MINUTES' | 'HOURS' | 'DAYS') => rule({ amount, unit });
/** The message of the 400 INVALID_REMINDER `fn` throws, or '' when it passes. */
function refusal(fn: () => void): string {
  try {
    fn();
    return '';
  } catch (error) {
    expect(error).toBeInstanceOf(BadRequestException);
    const body = (error as BadRequestException).getResponse() as { code: string; message: string };
    expect(body.code).toBe('INVALID_REMINDER');
    return body.message;
  }
}

describe('a rule from a request, a row or JSON', () => {
  it('keeps a days rule as it was and a Custom one as minutes with its whole days', () => {
    expect(days(2, '09:00')).toEqual({
      daysBefore: 2,
      timeOfDay: '09:00',
      minutesBefore: null,
      unit: null,
      inApp: true,
      channels: [],
    });
    expect(custom(36, 'HOURS')).toMatchObject({
      daysBefore: 1,
      minutesBefore: 2_160,
      unit: 'HOURS',
    });
    expect(custom(90, 'MINUTES')).toMatchObject({ daysBefore: 0, minutesBefore: 90 });
    expect(custom(365, 'DAYS')).toMatchObject({ daysBefore: 365, minutesBefore: 525_600 });
    // A rule read back (its whole days beside the amount) is the same rule.
    expect(rule({ daysBefore: 1, amount: 36, unit: 'HOURS' })).toEqual(custom(36, 'HOURS'));
  });

  it('reads it back in the unit it was typed in', () => {
    expect(reminderOut(custom(36, 'HOURS'), null)).toEqual({
      id: null,
      daysBefore: 1,
      timeOfDay: null,
      amount: 36,
      unit: 'HOURS',
      inApp: true,
      channels: [],
    });
    expect(reminderOut(days(0, '08:15'), 'x')).toMatchObject({ amount: null, unit: null });
    const row = {
      daysBefore: 2,
      timeOfDay: null,
      minutesBefore: 2_880,
      unit: 'DAYS' as const,
      inApp: false,
      channels: ['SMS' as const],
    };
    expect(reminderFromRow(row)).toEqual(
      rule({ amount: 2, unit: 'DAYS', inApp: false, channels: ['SMS'] }),
    );
  });

  it("round-trips a template's JSON, and reads older or broken items as days rules", () => {
    const rules = [custom(2, 'HOURS'), days(1, '14:30'), custom(1, 'DAYS')];
    const json = remindersJson(rules);
    // A days rule keeps the keys it always had.
    expect(json[1]).toEqual({ daysBefore: 1, timeOfDay: '14:30', inApp: true, channels: [] });
    expect(remindersFromJson(JSON.parse(JSON.stringify(json)))).toEqual(rules);
    expect(remindersFromJson([{ daysBefore: 3, inApp: true, channels: ['EMAIL'] }])).toEqual([
      { ...days(3), channels: ['EMAIL'] },
    ]);
    for (const broken of [
      { daysBefore: 0, minutesBefore: 90, unit: 'HOURS' },
      { daysBefore: 0, minutesBefore: 30, unit: 'WEEKS' },
      { daysBefore: 0, minutesBefore: 600_000, unit: 'MINUTES' },
      { daysBefore: 0, unit: 'MINUTES' },
    ]) {
      expect(remindersFromJson([broken])).toEqual([days(0)]);
    }
    expect(remindersFromJson(null)).toEqual([]);
    expect(remindersFromJson({})).toEqual([]);
  });
});

describe('checkReminders', () => {
  it('a live task: Custom needs a due time, and none fires after it', () => {
    expect(refusal(() => checkReminders([custom(1, 'HOURS')], null, true))).toBe(
      'A reminder in minutes or hours needs a due time',
    );
    expect(refusal(() => checkReminders([days(0, '10:00')], '09:00', true))).toBe(
      'A reminder cannot be after the due time',
    );
    expect(
      refusal(() => checkReminders([days(0, '09:00'), custom(1, 'HOURS')], '09:00', true)),
    ).toBe('');
    // A day before at a later clock time is still before.
    expect(refusal(() => checkReminders([days(1, '23:00')], '01:00', true))).toBe('');
  });

  it('a live task: two rules never fire at one moment', () => {
    const same = 'Two reminders fire at the same time';
    expect(
      refusal(() => checkReminders([custom(60, 'MINUTES'), custom(1, 'HOURS')], '09:00', true)),
    ).toBe(same);
    expect(
      refusal(() => checkReminders([custom(1, 'DAYS'), custom(24, 'HOURS')], '09:00', true)),
    ).toBe(same);
    expect(
      refusal(() => checkReminders([days(1, '14:30'), custom(1, 'DAYS')], '14:30', true)),
    ).toBe(same);
    expect(
      refusal(() => checkReminders([days(1, '14:30'), custom(1, 'DAYS')], '16:00', true)),
    ).toBe('');
    // A day rule with the firm's default time is its own moment.
    expect(
      refusal(() =>
        checkReminders([days(1), custom(1, 'DAYS'), days(0), custom(2, 'HOURS')], '09:00', true),
      ),
    ).toBe('');
    expect(refusal(() => checkReminders([days(2), days(2)], null, true))).toBe(
      'Each reminder can be added once',
    );
  });

  it('a draft or a template: only what is kept once', () => {
    expect(refusal(() => checkReminders([custom(1, 'HOURS'), days(0, '23:00')], null, false))).toBe(
      '',
    );
    expect(
      refusal(() => checkReminders([days(1, '14:30'), custom(1, 'DAYS')], '14:30', false)),
    ).toBe('');
    expect(
      refusal(() => checkReminders([custom(60, 'MINUTES'), custom(1, 'HOURS')], null, false)),
    ).toBe('Two reminders fire at the same time');
    expect(refusal(() => checkReminders([days(1), days(1)], null, false))).toBe(
      'Each reminder can be added once',
    );
  });
});

describe('fitReminders', () => {
  const tpl = [custom(2, 'HOURS'), days(1, '14:30'), custom(1, 'DAYS'), days(0, '18:00')];

  it('leaves out Custom ones without a due time', () => {
    expect(fitReminders(tpl, null)).toEqual([days(1, '14:30'), days(0, '18:00')]);
  });

  it('leaves out one after the due time and the later of two at one moment, in order', () => {
    expect(fitReminders(tpl, '14:30')).toEqual([custom(2, 'HOURS'), days(1, '14:30')]);
    expect(fitReminders(tpl, '19:00')).toEqual(tpl);
    expect(fitReminders([custom(1, 'DAYS'), days(1, '19:00')], '19:00')).toEqual([
      custom(1, 'DAYS'),
    ]);
  });
});

describe('inFiringOrder', () => {
  const order = (rules: Reminder[], dueTime: string | null) =>
    inFiringOrder(
      rules.map((r) => ({ rule: r })),
      dueTime,
    )
      .map(({ rule: r }) => reminderOut(r, null))
      .map((r) => (r.unit ? `${r.amount} ${r.unit}` : `${r.daysBefore}d@${r.timeOfDay ?? '-'}`));

  it('puts the earliest first, Custom among the days rules', () => {
    const rules = [
      custom(30, 'MINUTES'),
      custom(2, 'HOURS'),
      days(1, '09:00'),
      custom(3, 'DAYS'),
      custom(36, 'HOURS'),
      days(0),
    ];
    expect(order(rules, '14:30')).toEqual([
      '3 DAYS',
      '36 HOURS',
      '1d@09:00',
      '2 HOURS',
      '30 MINUTES',
      '0d@-',
    ]);
  });

  it('keeps the old order for days rules on an all-day task', () => {
    expect(order([days(0), days(1), days(1, '17:00'), days(7), days(1, '08:00')], null)).toEqual([
      '7d@-',
      '1d@08:00',
      '1d@17:00',
      '1d@-',
      '0d@-',
    ]);
  });
});

// Decision A.7: a task_reminders index refusing a save (only a backstop: the rules are checked
// first) is the reminders' 400, never the 409 of an open name change.
describe("a unique index's refusal on save", () => {
  const service = new TaskWriteService({} as never, {} as never, {} as never);
  /** What mapErrors throws for `error`. */
  const mapped = (error: unknown) => {
    try {
      service.mapErrors({})(error);
    } catch (out) {
      return out;
    }
    throw new Error('mapErrors returned');
  };
  /** A P2002 as Prisma's pg adapter reports it: the index in `constraint`, or only in the message. */
  const unique = (cause: object) => ({ code: 'P2002', meta: { driverAdapterError: { cause } } });
  const body = (error: unknown) => (error as HttpException).getResponse();

  it('is 400 INVALID_REMINDER on a reminder index', () => {
    for (const cause of [
      { constraint: { index: 'task_reminders_one_custom_rule' } },
      { constraint: { index: 'task_reminders_one_days_rule' } },
      {
        originalMessage:
          'duplicate key value violates unique constraint "task_reminders_one_days_rule"',
      },
    ]) {
      const out = mapped(unique(cause));
      expect(out, JSON.stringify(cause)).toBeInstanceOf(BadRequestException);
      expect(body(out)).toEqual({
        code: 'INVALID_REMINDER',
        message: 'Each reminder can be added once',
      });
    }
  });

  it('is still 409 NAME_CHANGE_PENDING on the open name change index, or one not named', () => {
    for (const cause of [{ constraint: { index: 'tasks_one_open_name_change' } }, {}]) {
      const out = mapped(unique(cause));
      expect(out, JSON.stringify(cause)).toBeInstanceOf(ConflictException);
      expect(body(out)).toMatchObject({ code: 'NAME_CHANGE_PENDING' });
    }
  });
});
