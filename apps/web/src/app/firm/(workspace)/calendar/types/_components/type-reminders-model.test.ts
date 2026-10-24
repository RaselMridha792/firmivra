import { describe, expect, it } from 'vitest';
import {
  reminderRowsProblem,
  remindersFromRows,
  rowsFromReminders,
  type ReminderRow,
} from './type-reminders-model';

// Octavia's A7: several reminders per appointment type, each with Email, SMS and Portal.
const row = (amount: number, unit: ReminderRow['unit'], ...channels: ReminderRow['channels']) => ({
  key: `${amount}${unit}`,
  amount,
  unit,
  channels,
});

describe('appointment type reminders', () => {
  it('groups the API entries by time, earliest first, and flattens them back', () => {
    const rows = rowsFromReminders([
      { channel: 'SMS', amount: 2, unit: 'HOURS' },
      { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
      { channel: 'PORTAL', amount: 1, unit: 'DAYS' },
      { channel: 'EMAIL', amount: 2, unit: 'HOURS' },
    ]);
    expect(rows.map((r) => [r.amount, r.unit, r.channels])).toEqual([
      [1, 'DAYS', ['EMAIL', 'PORTAL']],
      [2, 'HOURS', ['EMAIL', 'SMS']],
    ]);
    expect(remindersFromRows(rows)).toEqual([
      { channel: 'EMAIL', amount: 1, unit: 'DAYS' },
      { channel: 'PORTAL', amount: 1, unit: 'DAYS' },
      { channel: 'EMAIL', amount: 2, unit: 'HOURS' },
      { channel: 'SMS', amount: 2, unit: 'HOURS' },
    ]);
  });

  it('treats 24 hours and 1 day as the same time', () => {
    expect(
      rowsFromReminders([
        { channel: 'EMAIL', amount: 24, unit: 'HOURS' },
        { channel: 'SMS', amount: 1, unit: 'DAYS' },
      ]),
    ).toHaveLength(1);
    expect(reminderRowsProblem([row(24, 'HOURS', 'EMAIL'), row(1, 'DAYS', 'SMS')])).toBe(
      'Reminders 1 and 2 are at the same time. Tick both channels on one and remove the other.',
    );
  });

  it('refuses what the API would before sending', () => {
    expect(reminderRowsProblem([row(1, 'DAYS')])).toBe(
      'Choose Email, SMS or Portal for reminder 1.',
    );
    expect(reminderRowsProblem([row(61, 'MINUTES', 'EMAIL')])).toBe(
      'Enter 0 to 60 for reminder 1.',
    );
    expect(reminderRowsProblem([row(5, 'WEEKS', 'EMAIL')])).toBe(
      'Reminder 1 is more than 30 days before.',
    );
    const many = [1, 2, 3, 4].map((n) => row(n, 'DAYS', 'EMAIL', 'SMS', 'PORTAL'));
    expect(reminderRowsProblem(many)).toBe(
      'At most 10 reminders in all; each channel ticked counts as one.',
    );
    expect(reminderRowsProblem([row(1, 'DAYS', 'EMAIL'), row(2, 'HOURS', 'SMS')])).toBeUndefined();
    expect(reminderRowsProblem([])).toBeUndefined();
  });
});
