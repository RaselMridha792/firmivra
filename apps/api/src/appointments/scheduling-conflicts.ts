import type { TxClient } from '@firmivra/db';
import type { ConflictKind, ConflictResult, MemberRef, SchedulingConflict } from '@firmivra/types';
import {
  addDays,
  dayRanges,
  DAY,
  GRID_MINUTES,
  type Interval,
  MINUTE,
  overlaps,
  timeOfDayFromDb,
  weekdayOf,
  type WorkingRange,
  zonedDate,
  zonedInstant,
} from './calendar.js';
import { type FirmActor, workingHours } from './calendar-data.js';

// The conflict check behind Schedule Appointment, Edit Existing and the Staff Availability
// panel. `findConflicts` is pure over the data `loadConflictData` reads, so the unit tests cover
// it directly (test/unit/scheduling.test.ts). The database stays the last line: it refuses double
// booking of a staff member, a client or a room and overlap with blocked time (409 SLOT_TAKEN),
// whatever this check says. So those are HARD conflicts, never overridden. The staff rule counts
// each appointment's buffers too (appointments_no_double_booking_staff), so a buffer clash is hard
// as well; only working hours (SOFT) may be overridden, by an Owner or Admin with a reason.

export const SOFT_KINDS: readonly ConflictKind[] = ['OUTSIDE_HOURS'];
const MAX_CONFLICTS = 20;
const MAX_ALTERNATIVES = 5;
/** Alternatives are looked for this many days ahead of the asked time. */
const SEARCH_DAYS = 7;

export interface DayHours {
  /** Minutes of the day; empty = a day off. */
  ranges: [number, number][];
}

export interface ConflictStaff {
  member: MemberRef;
  weekly: WorkingRange[];
  /** YYYY-MM-DD to that day's hours instead of the weekly ones. */
  overrides: Map<string, DayHours>;
}

export interface LiveAppointment {
  id: string;
  staffUserId: string;
  clientId: string;
  roomId: string | null;
  start: number;
  end: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

export interface ConflictBlock {
  userId: string | null;
  start: number;
  end: number;
  kind: 'BLOCKED' | 'TIME_OFF';
}

export interface ConflictData {
  timeZone: string;
  staff: Map<string, ConflictStaff>;
  appointments: LiveAppointment[];
  blocks: ConflictBlock[];
}

export interface Candidate {
  staffUserIds: readonly string[];
  occurrences: readonly Interval[];
  allDay: boolean;
  clientId: string | null;
  roomId: string | null;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
  exceptId?: string | undefined;
}

export interface Found extends SchedulingConflict {
  hard: boolean;
}

/** The hours a member works on `date`: the day's override, else the weekly ones. */
export function hoursOn(staff: ConflictStaff, date: string): [number, number][] {
  const override = staff.overrides.get(date);
  if (override) return override.ranges;
  return dayRanges(staff.weekly, weekdayOf(date));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Every conflict of one candidate; later occurrences of a series are RECURRING_OCCURRENCE. */
export function findConflicts(data: ConflictData, c: Candidate): Found[] {
  const found: Found[] = [];
  const except = c.exceptId?.toLowerCase();
  c.occurrences.forEach((slot, index) => {
    const push = (
      kind: ConflictKind,
      hard: boolean,
      staff: MemberRef | null,
      span: Interval,
      message: string,
    ) => {
      const repeat = index > 0;
      found.push({
        kind: repeat ? 'RECURRING_OCCURRENCE' : kind,
        hard,
        staff,
        startsAt: iso(span.start),
        endsAt: iso(span.end),
        message: repeat ? `Repeat on ${zonedDate(data.timeZone, slot.start)}: ${message}` : message,
      });
    };
    const expanded: Interval = {
      start: slot.start - c.bufferBeforeMinutes * MINUTE,
      end: slot.end + c.bufferAfterMinutes * MINUTE,
    };
    for (const userId of c.staffUserIds) {
      const staff = data.staff.get(userId.toLowerCase());
      if (!staff) continue;
      const who = staff.member.name;
      for (const a of data.appointments) {
        if (a.id === except || a.staffUserId !== staff.member.userId) continue;
        if (overlaps(slot, a)) {
          push(
            'STAFF_BOOKED',
            true,
            staff.member,
            a,
            `${who} already has an appointment at this time`,
          );
        } else if (
          overlaps(expanded, {
            start: a.start - a.bufferBeforeMinutes * MINUTE,
            end: a.end + a.bufferAfterMinutes * MINUTE,
          })
        ) {
          push('BUFFER', true, staff.member, a, `${who} needs time between appointments`);
        }
      }
      for (const b of data.blocks) {
        if ((b.userId !== null && b.userId !== staff.member.userId) || !overlaps(slot, b)) continue;
        if (b.kind === 'TIME_OFF') {
          push('TIME_OFF', true, staff.member, b, `${who} is off at this time`);
        } else {
          push(
            'BLOCKED_TIME',
            true,
            b.userId ? staff.member : null,
            b,
            b.userId ? `${who} has blocked this time` : 'The firm has blocked this time',
          );
        }
      }
      if (!c.allDay && !withinHours(data.timeZone, staff, slot)) {
        push('OUTSIDE_HOURS', false, staff.member, slot, `${who} does not work at this time`);
      }
    }
    for (const a of data.appointments) {
      if (a.id === except) continue;
      if (c.clientId && a.clientId === c.clientId && overlaps(slot, a)) {
        push(
          'CLIENT_DOUBLE_BOOKED',
          true,
          null,
          a,
          'This client already has an appointment at this time',
        );
      }
      if (c.roomId && a.roomId === c.roomId && overlaps(slot, a)) {
        push('ROOM', true, null, a, 'This room is already booked at this time');
      }
    }
  });
  return found.slice(0, MAX_CONFLICTS);
}

/** Whether the whole slot sits inside one range of the member's hours on its day. */
function withinHours(timeZone: string, staff: ConflictStaff, slot: Interval): boolean {
  const date = zonedDate(timeZone, slot.start);
  return hoursOn(staff, date).some(
    ([from, to]) =>
      slot.start >= zonedInstant(timeZone, date, from) &&
      slot.end <= zonedInstant(timeZone, date, to),
  );
}

/** Up to five other starts (same length, same staff and client) within a week, nearest first. */
export function findAlternatives(
  data: ConflictData,
  c: Candidate,
  notBefore: number,
): { startsAt: string; endsAt: string }[] {
  const first = c.occurrences[0];
  const firstStaff = c.staffUserIds[0] && data.staff.get(c.staffUserIds[0].toLowerCase());
  if (!first || !firstStaff) return [];
  const length = first.end - first.start;
  const out: { startsAt: string; endsAt: string }[] = [];
  const startDate = zonedDate(data.timeZone, first.start);
  for (let d = 0; d <= SEARCH_DAYS && out.length < MAX_ALTERNATIVES; d++) {
    const date = addDays(startDate, d);
    for (const [from, to] of hoursOn(firstStaff, date)) {
      for (
        let m = from;
        m + length / MINUTE <= to && out.length < MAX_ALTERNATIVES;
        m += GRID_MINUTES
      ) {
        const start = zonedInstant(data.timeZone, date, m);
        if (start <= notBefore || start === first.start) continue;
        const slot = { start, end: start + length };
        // Candidates on the asked day before the asked time are fine too: nearest by distance below.
        const hits = findConflicts(data, { ...c, occurrences: [slot], allDay: false });
        if (hits.length === 0) out.push({ startsAt: iso(slot.start), endsAt: iso(slot.end) });
      }
    }
  }
  return out
    .sort(
      (a, b) =>
        Math.abs(Date.parse(a.startsAt) - first.start) -
        Math.abs(Date.parse(b.startsAt) - first.start),
    )
    .slice(0, MAX_ALTERNATIVES);
}

/** The check's answer for the screens. Staff may not override; Owner and Admin only soft ones. */
export function toResult(
  data: ConflictData,
  c: Candidate,
  actor: FirmActor,
  now = Date.now(),
): { result: ConflictResult; found: Found[] } {
  const found = findConflicts(data, c);
  const hard = found.some((f) => f.hard);
  const result: ConflictResult = {
    ok: found.length === 0,
    conflicts: found.map(({ hard: _hard, ...conflict }) => conflict),
    alternatives: found.length === 0 ? [] : findAlternatives(data, c, now),
    canOverride: found.length > 0 && !hard && actor.role !== 'STAFF',
  };
  return { result, found };
}

/**
 * Reads what the check needs for `staffUserIds` over [from, to) (the buffers' reach included):
 * their weekly hours and date overrides, the live appointments, and blocked time.
 */
export async function loadConflictData(
  tx: TxClient,
  businessId: string,
  timeZone: string,
  members: readonly MemberRef[],
  span: Interval,
  clientId: string | null,
  roomId: string | null,
): Promise<ConflictData> {
  const userIds = members.map((m) => m.userId);
  const weekly = await workingHours(tx, businessId, userIds);
  const firstDate = zonedDate(timeZone, span.start);
  const lastDate = zonedDate(timeZone, span.end);
  const overrideRows = await tx.availabilityOverride.findMany({
    where: {
      businessId,
      userId: { in: userIds },
      date: { gte: new Date(`${firstDate}T00:00:00Z`), lte: new Date(`${lastDate}T00:00:00Z`) },
    },
    select: { userId: true, date: true, startsAt: true, endsAt: true },
  });
  const staff = new Map<string, ConflictStaff>();
  for (const member of members) {
    const overrides = new Map<string, DayHours>();
    for (const row of overrideRows.filter((r) => r.userId === member.userId)) {
      const date = row.date.toISOString().slice(0, 10);
      const day = overrides.get(date) ?? { ranges: [] };
      if (row.startsAt && row.endsAt) {
        const minutes = (t: Date) =>
          Number(timeOfDayFromDb(t).slice(0, 2)) * 60 + Number(timeOfDayFromDb(t).slice(3, 5));
        day.ranges.push([minutes(row.startsAt), minutes(row.endsAt)]);
      }
      overrides.set(date, day);
    }
    staff.set(member.userId.toLowerCase(), {
      member,
      weekly: weekly.get(member.userId) ?? [],
      overrides,
    });
  }
  const touching = { startsAt: { lt: new Date(span.end) }, endsAt: { gt: new Date(span.start) } };
  const people = [
    { staffUserId: { in: userIds } },
    ...(clientId ? [{ clientId }] : []),
    ...(roomId ? [{ roomId }] : []),
  ];
  // One after the other: a transaction runs its queries on one connection.
  const appointments = await tx.appointment.findMany({
    where: { businessId, status: { not: 'CANCELLED' }, ...touching, OR: people },
    select: {
      id: true,
      staffUserId: true,
      clientId: true,
      roomId: true,
      startsAt: true,
      endsAt: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
    },
  });
  const blocks = await tx.blockedTime.findMany({
    where: { businessId, ...touching, OR: [{ userId: null }, { userId: { in: userIds } }] },
    select: { userId: true, startsAt: true, endsAt: true, kind: true },
  });
  return {
    timeZone,
    staff,
    appointments: appointments.map((a) => ({
      id: a.id,
      staffUserId: a.staffUserId,
      clientId: a.clientId,
      roomId: a.roomId,
      start: a.startsAt.getTime(),
      end: a.endsAt.getTime(),
      bufferBeforeMinutes: a.bufferBeforeMinutes,
      bufferAfterMinutes: a.bufferAfterMinutes,
    })),
    blocks: blocks.map((b) => ({
      userId: b.userId,
      start: b.startsAt.getTime(),
      end: b.endsAt.getTime(),
      kind: b.kind,
    })),
  };
}

/** The span to read for a candidate: its occurrences, the buffers and a week for alternatives. */
export function conflictSpan(c: Candidate): Interval {
  const starts = c.occurrences.map((o) => o.start);
  const ends = c.occurrences.map((o) => o.end);
  return {
    start: Math.min(...starts) - c.bufferBeforeMinutes * MINUTE - DAY,
    end: Math.max(...ends) + c.bufferAfterMinutes * MINUTE + (SEARCH_DAYS + 1) * DAY,
  };
}
