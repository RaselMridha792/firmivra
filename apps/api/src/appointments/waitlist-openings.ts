import {
  addDays,
  DAY,
  GRID_MINUTES,
  HOUR,
  type Interval,
  MINUTE,
  zonedDate,
  zonedInstant,
} from './calendar.js';
import {
  type Candidate,
  type ConflictData,
  findConflicts,
  hoursOn,
  type LiveAppointment,
} from './scheduling-conflicts.js';

// R55, Appointments A3: where an earlier opening is, for one waitlist entry. Pure over the
// conflict check's data (`loadConflictData`), so the unit tests cover it (test/unit/waitlist.test.ts).

/** An offered time starts at least this long from now, so the client has time to take it. */
export const OFFER_LEAD_MS = 2 * HOUR;
/** An offer is at least this much earlier than the appointment's own time. */
export const MIN_GAIN_MS = HOUR;
/** Openings are looked for this many days ahead (and never after the appointment's own time). */
export const SEARCH_DAYS = 14;
/** How long an offer is held for one entry, at most (and always an hour before the time). */
export const OFFER_HOLD_MS = 12 * HOUR;

/**
 * Another entry's live offer (offered or requested) as if it were booked: its staff member, its
 * people and its room are held, so one time is never offered to two entries at once.
 */
export interface Hold {
  entryId: string;
  staffUserId: string;
  /** Null for a lead's own appointment (P4-1; the waitlist itself is for clients' appointments). */
  clientId: string | null;
  attendeeClientIds: readonly string[];
  roomId: string | null;
  start: number;
  end: number;
  bufferBeforeMinutes: number;
  bufferAfterMinutes: number;
}

/** The conflict data with the holds in it, as appointments the check never names. */
export function withHolds(data: ConflictData, holds: readonly Hold[]): ConflictData {
  const held: LiveAppointment[] = holds.map((h) => ({
    id: `hold:${h.entryId}`,
    staffUserId: h.staffUserId,
    clientId: h.clientId,
    attendeeClientIds: h.attendeeClientIds,
    roomId: h.roomId,
    start: h.start,
    end: h.end,
    bufferBeforeMinutes: h.bufferBeforeMinutes,
    bufferAfterMinutes: h.bufferAfterMinutes,
  }));
  return { ...data, appointments: [...data.appointments, ...held] };
}

/**
 * The earliest free start for the appointment `c` (one staff member, its own length) on the
 * 15-minute grid of that member's hours: from `notBefore` (now plus OFFER_LEAD_MS), within
 * SEARCH_DAYS, and at least MIN_GAIN_MS before the appointment's own `current` start. Free means no
 * conflict at all (staff, buffers, blocks and time off, the client and each attendee, the room,
 * and the holds). Null when there is none.
 */
export function earliestOpening(
  data: ConflictData,
  c: Candidate,
  current: Interval,
  notBefore: number,
): Interval | null {
  const staffId = c.staffUserIds[0];
  const staff = staffId ? data.staff.get(staffId.toLowerCase()) : undefined;
  if (!staff) return null;
  const length = current.end - current.start;
  const latest = current.start - MIN_GAIN_MS;
  const first = zonedDate(data.timeZone, notBefore);
  for (let d = 0; d <= SEARCH_DAYS; d++) {
    const date = addDays(first, d);
    if (zonedInstant(data.timeZone, date, 0) > latest) return null;
    const starts: number[] = [];
    for (const [from, to] of hoursOn(staff, date)) {
      for (let m = from; m + length / MINUTE <= to; m += GRID_MINUTES) {
        starts.push(zonedInstant(data.timeZone, date, m));
      }
    }
    for (const start of starts.sort((a, b) => a - b)) {
      if (start < notBefore) continue;
      if (start > latest) return null;
      const slot = { start, end: start + length };
      if (findConflicts(data, { ...c, occurrences: [slot], allDay: false }).length === 0) {
        return slot;
      }
    }
  }
  return null;
}

/** The span of data `earliestOpening` reads: from a day before `notBefore` to the appointment. */
export function openingSpan(current: Interval, notBefore: number): Interval {
  return {
    start: notBefore - DAY,
    end: Math.min(current.start, notBefore + (SEARCH_DAYS + 1) * DAY) + DAY,
  };
}

/** When an offer made `now` for `slot` ends: OFFER_HOLD_MS, and never later than an hour before. */
export const offerExpiry = (now: number, slot: Interval) =>
  Math.min(now + OFFER_HOLD_MS, slot.start - HOUR);
