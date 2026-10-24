import type { AppointmentReminder, ReminderChannel, ReminderUnit } from '@firmivra/types';

/** One reminder on the type settings: when, and every channel it goes by (Octavia's A7). */
export interface ReminderRow {
  key: string;
  amount: number;
  unit: ReminderUnit;
  channels: ReminderChannel[];
}

export const CHANNELS: [ReminderChannel, string][] = [
  ['EMAIL', 'Email'],
  ['SMS', 'SMS'],
  ['PORTAL', 'Portal'],
];
export const UNITS: [ReminderUnit, string][] = [
  ['MINUTES', 'minutes before'],
  ['HOURS', 'hours before'],
  ['DAYS', 'days before'],
  ['WEEKS', 'weeks before'],
];
const UNIT_MINUTES: Record<ReminderUnit, number> = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 1_440,
  WEEKS: 10_080,
};
/** The API sends a reminder at most 30 days before, and keeps at most 10 (one per channel). */
const MAX_MINUTES = 30 * 1_440;
const MAX_ENTRIES = 10;

const minutesOf = (r: { amount: number; unit: ReminderUnit }) => r.amount * UNIT_MINUTES[r.unit];
let next = 0;
export const newRow = (amount = 1, unit: ReminderUnit = 'DAYS'): ReminderRow => ({
  key: `r${(next += 1)}`,
  amount,
  unit,
  channels: ['EMAIL'],
});

/** The API keeps one entry per channel and time: those at the same time are one row here. */
export function rowsFromReminders(list: readonly AppointmentReminder[]): ReminderRow[] {
  const rows = new Map<number, ReminderRow>();
  for (const r of list) {
    const at = minutesOf(r);
    const row = rows.get(at) ?? { ...newRow(r.amount, r.unit), channels: [] };
    if (!row.channels.includes(r.channel)) row.channels.push(r.channel);
    rows.set(at, row);
  }
  const order = CHANNELS.map(([c]) => c);
  return [...rows.entries()]
    .sort(([a], [b]) => b - a)
    .map(([, row]) => ({
      ...row,
      channels: [...row.channels].sort((a, b) => order.indexOf(a) - order.indexOf(b)),
    }));
}

/** What the API takes: one entry per channel of each row. */
export const remindersFromRows = (rows: readonly ReminderRow[]): AppointmentReminder[] =>
  rows.flatMap((row) =>
    row.channels.map((channel) => ({ channel, amount: row.amount, unit: row.unit })),
  );

/** Said before anything is sent: what the API would refuse, and rows it would merge. */
export function reminderRowsProblem(rows: readonly ReminderRow[]): string | undefined {
  for (const [i, row] of rows.entries()) {
    const n = i + 1;
    if (!Number.isInteger(row.amount) || row.amount < 0 || row.amount > 60)
      return `Enter 0 to 60 for reminder ${n}.`;
    if (minutesOf(row) > MAX_MINUTES) return `Reminder ${n} is more than 30 days before.`;
    if (!row.channels.length) return `Choose Email, SMS or Portal for reminder ${n}.`;
  }
  const seen = new Map<number, number>();
  for (const [i, row] of rows.entries()) {
    const earlier = seen.get(minutesOf(row));
    if (earlier !== undefined)
      return `Reminders ${earlier + 1} and ${i + 1} are at the same time. Tick both channels on one and remove the other.`;
    seen.set(minutesOf(row), i);
  }
  if (remindersFromRows(rows).length > MAX_ENTRIES)
    return 'At most 10 reminders in all; each channel ticked counts as one.';
  return undefined;
}
