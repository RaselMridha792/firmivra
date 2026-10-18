import type {
  AppointmentDisplayStatus,
  AppointmentReminder,
  MeetingMethod,
  ReminderChannel,
  ReminderUnit,
} from '@firmivra/types';
import type { Prisma } from '@firmivra/db';
import { MINUTE } from './calendar.js';

// Pure mappings between the screens' contract (packages/types/src/appointments/scheduling.ts)
// and what the database keeps. No database here, so the unit tests cover them directly
// (test/unit/scheduling.test.ts).

// ---------- Colour ----------

/** The database keeps a token name; the screens speak `#rrggbb`. One palette, both ways. */
export const CALENDAR_COLORS = {
  BLUE: '#2563eb',
  GREEN: '#16a34a',
  AMBER: '#d97706',
  RED: '#e11d48',
  PURPLE: '#7c3aed',
  GRAY: '#6b7280',
} as const;
export type CalendarColorName = keyof typeof CALENDAR_COLORS;

export const colorHex = (color: CalendarColorName | null | undefined): string | null =>
  color ? CALENDAR_COLORS[color] : null;

/** The token of a palette colour (any letter case), else undefined: other colours are refused. */
export function colorFromHex(hex: string): CalendarColorName | undefined {
  const wanted = hex.toLowerCase();
  return (Object.keys(CALENDAR_COLORS) as CalendarColorName[]).find(
    (name) => CALENDAR_COLORS[name] === wanted,
  );
}

// ---------- Status ----------

interface StatusFields {
  status: 'SCHEDULED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
  rescheduleCount: number;
  confirmedAt: Date | null;
}

/**
 * What the screens show as status: the database's four, plus Pending / Confirmed (confirmed_at)
 * and Rescheduled (a SCHEDULED one that moved). DRAFT has no table yet, so it is never shown.
 */
export function displayStatus(row: StatusFields): AppointmentDisplayStatus {
  switch (row.status) {
    case 'CANCELLED':
      return 'CANCELED';
    case 'COMPLETED':
      return 'COMPLETED';
    case 'NO_SHOW':
      return 'NO_SHOW';
    case 'SCHEDULED':
      if (row.rescheduleCount > 0) return 'RESCHEDULED';
      return row.confirmedAt ? 'CONFIRMED' : 'PENDING';
  }
}

/** The same mapping as a filter. DRAFT matches nothing (no drafts among the appointments). */
export function displayStatusWhere(status: AppointmentDisplayStatus): Prisma.AppointmentWhereInput {
  switch (status) {
    case 'CANCELED':
      return { status: 'CANCELLED' };
    case 'COMPLETED':
      return { status: 'COMPLETED' };
    case 'NO_SHOW':
      return { status: 'NO_SHOW' };
    case 'RESCHEDULED':
      return { status: 'SCHEDULED', rescheduleCount: { gt: 0 } };
    case 'CONFIRMED':
      return { status: 'SCHEDULED', rescheduleCount: 0, confirmedAt: { not: null } };
    case 'PENDING':
      return { status: 'SCHEDULED', rescheduleCount: 0, confirmedAt: null };
    case 'DRAFT':
      return { id: { in: [] } };
  }
}

// ---------- Meeting method ----------

export const methodOf = (kind: 'IN_PERSON' | 'PHONE' | 'VIDEO'): MeetingMethod => kind;

/** The database's location kind for a method; OTHER has none yet (needs a schema change). */
export function locationKindOf(method: MeetingMethod): 'IN_PERSON' | 'PHONE' | 'VIDEO' | null {
  return method === 'OTHER' ? null : method;
}

// ---------- Reminders ----------

const UNIT_MINUTES: Record<ReminderUnit, number> = {
  MINUTES: 1,
  HOURS: 60,
  DAYS: 24 * 60,
  WEEKS: 7 * 24 * 60,
};
/** appointment_reminders.offset_minutes: 0 to 30 days. */
export const MAX_REMINDER_OFFSET = 43_200;

/** "1 day before" as minutes before the start; null when it is more than 30 days. */
export function reminderOffset(r: Pick<AppointmentReminder, 'amount' | 'unit'>): number | null {
  const minutes = r.amount * UNIT_MINUTES[r.unit];
  return minutes <= MAX_REMINDER_OFFSET ? minutes : null;
}

/** Minutes back to the screens' amount and unit: the biggest unit that divides evenly. */
export function reminderFromOffset(
  channel: ReminderChannel,
  offsetMinutes: number,
): AppointmentReminder {
  const units: ReminderUnit[] = ['WEEKS', 'DAYS', 'HOURS', 'MINUTES'];
  for (const unit of units) {
    const size = UNIT_MINUTES[unit];
    const amount = offsetMinutes / size;
    if (Number.isInteger(amount) && amount <= 60) return { channel, amount, unit };
  }
  // Not a whole number of any unit within 60 (only odd values written elsewhere): minutes, capped.
  return { channel, amount: Math.min(60, offsetMinutes), unit: 'MINUTES' };
}

// ---------- Paging and versions ----------

export interface AgendaCursor {
  startsAt: string;
  id: string;
}

export const encodeCursor = (c: AgendaCursor): string =>
  Buffer.from(`${c.startsAt}|${c.id}`).toString('base64url');

/** A cursor this API made, else null (the caller answers 400). */
export function decodeCursor(cursor: string): AgendaCursor | null {
  const decoded = Buffer.from(cursor, 'base64url').toString('utf8');
  const [startsAt, id, ...rest] = decoded.split('|');
  if (!startsAt || !id || rest.length > 0) return null;
  if (Number.isNaN(Date.parse(startsAt))) return null;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  return { startsAt: new Date(startsAt).toISOString(), id: id.toLowerCase() };
}

/** The record's version: the instant of its last change, so a stale edit is caught. */
export const versionOf = (updatedAt: Date): string => updatedAt.toISOString();

// ---------- Months ----------

/** "2026-10" to its first day and the month after, as YYYY-MM-DD dates. */
export function monthSpan(month: string): { first: string; next: string; previous: string } {
  const [y = 1970, m = 1] = month.split('-').map(Number);
  const date = (year: number, mon: number) =>
    `${String(year).padStart(4, '0')}-${String(mon).padStart(2, '0')}-01`;
  return {
    first: date(y, m),
    next: m === 12 ? date(y + 1, 1) : date(y, m + 1),
    previous: m === 1 ? date(y - 1, 12) : date(y, m - 1),
  };
}

export const monthOf = (date: string): string => date.slice(0, 7);

/** Whole minutes between two instants. */
export const minutesBetween = (a: Date, b: Date): number =>
  Math.round((b.getTime() - a.getTime()) / MINUTE);
