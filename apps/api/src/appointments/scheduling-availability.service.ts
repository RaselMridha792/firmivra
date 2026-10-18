import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import type {
  AvailabilityBlock,
  AvailabilityRules,
  ConflictResult,
  MemberRef,
  StaffDay,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  addDays,
  DAY,
  type Interval,
  timeOfDayFromDb,
  timeOfDayToDb,
  zonedDate,
  zonedInstant,
} from './calendar.js';
import { activeMember, type FirmActor, firmTimeZone, inFullWhere } from './calendar-data.js';
import { lockForBlock, retryWhenBusy } from './calendar-locks.js';
import {
  type Candidate,
  conflictSpan,
  hoursOn,
  loadConflictData,
  toResult,
} from './scheduling-conflicts.js';
import { errors } from './errors.js';
import { expandRecurrence } from './scheduling-recurrence.js';
import type { ConflictsBody, DayQuery, RulesBody } from './scheduling.input.js';

type DayQ = z.output<typeof DayQuery>;
type ConflictsReq = z.output<typeof ConflictsBody>;
type RulesReq = z.output<typeof RulesBody>;

const iso = (ms: number) => new Date(ms).toISOString();
/**
 * The Staff Availability panel, the conflict check and Edit My Availability (contract in
 * packages/types/src/appointments/scheduling.ts). Everyone at the firm may look at a member's day
 * (times and names; an appointment's type only for the ones they see in full). A member edits
 * their own rules; Owner and Admin anyone's (403 otherwise). Audit rows hold ids, dates and counts.
 */
@Injectable()
export class SchedulingAvailabilityService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Conflict check ----------

  async conflicts(
    businessId: string,
    actor: FirmActor,
    body: ConflictsReq,
  ): Promise<ConflictResult> {
    const result = await this.inFirm(businessId, async (tx) => {
      const timeZone = await firmTimeZone(tx, businessId);
      const members: MemberRef[] = [];
      for (const userId of body.staffUserIds)
        members.push(await activeMember(tx, businessId, userId));
      const clientId = await this.clientOf(tx, businessId, actor, body.contact);
      if (body.excludeAppointmentId) {
        // Staff may exclude only an appointment they see in full (else 404), as R12's slots.
        const mine = await tx.appointment.findFirst({
          where: { AND: [{ businessId, id: body.excludeAppointmentId }, inFullWhere(actor)] },
          select: { id: true },
        });
        if (!mine) throw errors.notFound();
      }
      const first = { start: Date.parse(body.startsAt), end: Date.parse(body.endsAt) };
      const expansion = expandRecurrence(timeZone, first, body.recurrence);
      if (!expansion.ok) throw errors.unsupported(expansion.message);
      const candidate: Candidate = {
        staffUserIds: members.map((m) => m.userId),
        occurrences: expansion.occurrences,
        allDay: false,
        clientId,
        roomId: body.roomId ?? null,
        bufferBeforeMinutes: 0,
        bufferAfterMinutes: 0,
        exceptId: body.excludeAppointmentId,
      };
      const data = await loadConflictData(
        tx,
        businessId,
        timeZone,
        members,
        conflictSpan(candidate),
        clientId,
        candidate.roomId,
      );
      return toResult(data, candidate, actor).result;
    });
    await this.audit.log(
      'appointment.conflicts_checked',
      { type: 'appointment' },
      { ok: result.ok, conflicts: result.conflicts.length },
    );
    return result;
  }

  /** The client behind the contact, for the double-booking check; leads and new contacts have none. */
  private async clientOf(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    contact: ConflictsReq['contact'],
  ): Promise<string | null> {
    if (contact?.kind !== 'CLIENT') return null;
    const client = await tx.client.findFirst({
      where: {
        businessId,
        id: contact.id,
        ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
      },
      select: { id: true },
    });
    if (!client) throw errors.notFound();
    return client.id;
  }

  // ---------- Staff Availability panel ----------

  async day(businessId: string, actor: FirmActor, q: DayQ): Promise<StaffDay> {
    const day = await this.inFirm(businessId, async (tx) => {
      const timeZone = await firmTimeZone(tx, businessId);
      const staff = await activeMember(tx, businessId, q.staffUserId);
      const span: Interval = {
        start: zonedInstant(timeZone, q.date, 0),
        end: zonedInstant(timeZone, addDays(q.date, 1), 0),
      };
      const data = await loadConflictData(tx, businessId, timeZone, [staff], span, null, null);
      const member = data.staff.get(staff.userId.toLowerCase());
      const ranges = member ? hoursOn(member, q.date) : [];

      // Which of the day's appointments this member sees in full (for their type as the label).
      const visible = await tx.appointment.findMany({
        where: {
          AND: [
            {
              businessId,
              staffUserId: staff.userId,
              status: { not: 'CANCELLED' },
              startsAt: { lt: new Date(span.end) },
              endsAt: { gt: new Date(span.start) },
            },
            inFullWhere(actor),
          ],
        },
        select: { id: true, type: { select: { name: true } } },
      });
      const labels = new Map(visible.map((a) => [a.id, a.type?.name ?? 'Appointment']));
      const blocks = this.blocksOf(data, staff, timeZone, q.date, span, ranges, labels);
      let conflict: ConflictResult | null = null;
      if (q.startsAt && q.endsAt) {
        const candidate: Candidate = {
          staffUserIds: [staff.userId],
          occurrences: [{ start: Date.parse(q.startsAt), end: Date.parse(q.endsAt) }],
          allDay: false,
          clientId: null,
          roomId: null,
          bufferBeforeMinutes: 0,
          bufferAfterMinutes: 0,
          exceptId: q.excludeAppointmentId,
        };
        const wide = await loadConflictData(
          tx,
          businessId,
          timeZone,
          [staff],
          conflictSpan(candidate),
          null,
          null,
        );
        conflict = toResult(wide, candidate, actor).result;
      }
      return { staff, date: q.date, timezone: timeZone, blocks, conflict } satisfies StaffDay;
    });
    await this.audit.log(
      'availability.day_viewed',
      { type: 'working_hours', id: q.staffUserId },
      { date: q.date, blocks: day.blocks.length },
    );
    return day;
  }

  /** The day as consecutive-or-overlapping blocks, sorted by start. */
  private blocksOf(
    data: Awaited<ReturnType<typeof loadConflictData>>,
    staff: MemberRef,
    timeZone: string,
    date: string,
    span: Interval,
    ranges: [number, number][],
    labels: ReadonlyMap<string, string>,
  ): AvailabilityBlock[] {
    const out: AvailabilityBlock[] = [];
    const push = (
      start: number,
      end: number,
      kind: AvailabilityBlock['kind'],
      label: string | null,
    ) => {
      const s = Math.max(start, span.start);
      const e = Math.min(end, span.end);
      if (e > s) out.push({ startsAt: iso(s), endsAt: iso(e), kind, label });
    };
    const busy: Interval[] = [];
    for (const a of data.appointments) {
      if (a.staffUserId !== staff.userId) continue;
      push(a.start, a.end, 'APPOINTMENT', labels.get(a.id) ?? null);
      busy.push(a);
      if (a.bufferBeforeMinutes > 0) {
        push(a.start - a.bufferBeforeMinutes * 60_000, a.start, 'BUFFER', null);
        busy.push({ start: a.start - a.bufferBeforeMinutes * 60_000, end: a.start });
      }
      if (a.bufferAfterMinutes > 0) {
        push(a.end, a.end + a.bufferAfterMinutes * 60_000, 'BUFFER', null);
        busy.push({ start: a.end, end: a.end + a.bufferAfterMinutes * 60_000 });
      }
    }
    for (const b of data.blocks) {
      if (b.userId !== null && b.userId !== staff.userId) continue;
      push(
        b.start,
        b.end,
        b.kind === 'TIME_OFF' ? 'TIME_OFF' : 'BLOCKED',
        b.kind === 'TIME_OFF' ? 'Time off' : 'Blocked',
      );
      busy.push(b);
    }
    // Hours outside the working ranges, and the working ranges minus everything above.
    let cursor = span.start;
    for (const [from, to] of ranges) {
      const start = zonedInstant(timeZone, date, from);
      const end = zonedInstant(timeZone, date, to);
      push(cursor, start, 'OUTSIDE_HOURS', null);
      for (const free of subtract({ start, end }, busy))
        push(free.start, free.end, 'AVAILABLE', null);
      cursor = Math.max(cursor, end);
    }
    push(cursor, span.end, 'OUTSIDE_HOURS', null);
    return out.sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.kind.localeCompare(b.kind));
  }

  // ---------- Edit My Availability ----------

  /** Owner and Admin read and change anyone's rules; a member their own (403 otherwise). */
  private mayEdit(actor: FirmActor, userId: string): void {
    if (actor.role === 'STAFF' && actor.userId.toLowerCase() !== userId.toLowerCase()) {
      throw errors.forbidden();
    }
  }

  async rules(businessId: string, actor: FirmActor, userId: string): Promise<AvailabilityRules> {
    this.mayEdit(actor, userId);
    return this.inFirm(businessId, async (tx) => {
      await activeMember(tx, businessId, userId);
      return this.rulesIn(tx, businessId, userId);
    });
  }

  async setRules(
    businessId: string,
    actor: FirmActor,
    userId: string,
    body: RulesReq,
  ): Promise<AvailabilityRules> {
    this.mayEdit(actor, userId);
    const changed: string[] = [];
    const result = await retryWhenBusy(() =>
      this.inFirm(businessId, async (tx) => {
        changed.length = 0;
        await activeMember(tx, businessId, userId);
        const timeZone = await firmTimeZone(tx, businessId);
        const current = await this.rulesIn(tx, businessId, userId);
        this.refuseFirmWide(body, current);
        if (body.dateOverrides !== undefined) {
          await this.replaceOverrides(tx, businessId, actor, userId, body.dateOverrides);
          changed.push('dateOverrides');
        }
        if (body.timeOff !== undefined) {
          await this.replaceTimeOff(tx, businessId, actor, userId, timeZone, body.timeOff);
          changed.push('timeOff');
        }
        return this.rulesIn(tx, businessId, userId);
      }),
    );
    await this.audit.log(
      'availability_rules.set',
      { type: 'working_hours', id: userId },
      {
        fields: changed.sort(),
        dateOverrides: result.dateOverrides.length,
        timeOff: result.timeOff.length,
      },
    );
    return result;
  }

  /**
   * Buffers, notice, window, busy calendars and the effective date are firm-wide or need
   * integrations and have no per-member column yet: the form may send what it was shown, but a
   * different value cannot be kept and is refused (400), never dropped silently.
   */
  private refuseFirmWide(body: RulesReq, current: AvailabilityRules): void {
    const same =
      (body.bufferBeforeMinutes ?? current.bufferBeforeMinutes) === current.bufferBeforeMinutes &&
      (body.bufferAfterMinutes ?? current.bufferAfterMinutes) === current.bufferAfterMinutes &&
      (body.minNoticeHours ?? current.minNoticeHours) === current.minNoticeHours &&
      (body.maxWindowDays ?? current.maxWindowDays) === current.maxWindowDays &&
      (body.busyCalendarIds ?? []).length === 0 &&
      (body.effectiveFrom ?? null) === null;
    if (!same) {
      throw errors.unsupported(
        'Buffers, notice, booking window, busy calendars and the effective date cannot be saved per person yet.',
      );
    }
  }

  private async rulesIn(
    tx: TxClient,
    businessId: string,
    userId: string,
  ): Promise<AvailabilityRules> {
    const timeZone = await firmTimeZone(tx, businessId);
    const today = zonedDate(timeZone, Date.now());
    const overrides = await tx.availabilityOverride.findMany({
      where: { businessId, userId, date: { gte: new Date(`${today}T00:00:00Z`) } },
      orderBy: [{ date: 'asc' }, { startsAt: 'asc' }],
      select: { date: true, startsAt: true, endsAt: true, updatedAt: true },
    });
    const byDate = new Map<string, { startsAt: string; endsAt: string }[]>();
    for (const o of overrides) {
      const key = o.date.toISOString().slice(0, 10);
      const ranges = byDate.get(key) ?? [];
      if (o.startsAt && o.endsAt) {
        ranges.push({ startsAt: timeOfDayFromDb(o.startsAt), endsAt: timeOfDayFromDb(o.endsAt) });
      }
      byDate.set(key, ranges);
    }
    const off = await tx.blockedTime.findMany({
      where: { businessId, userId, kind: 'TIME_OFF', endsAt: { gt: new Date() } },
      orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
      select: { id: true, startsAt: true, endsAt: true, reason: true, updatedAt: true },
    });
    const settings = await tx.appointmentSettings.findUnique({ where: { businessId } });
    const latest = [...overrides.map((o) => o.updatedAt), ...off.map((b) => b.updatedAt)].sort(
      (a, b) => b.getTime() - a.getTime(),
    )[0];
    return {
      userId,
      dateOverrides: [...byDate].map(([date, ranges]) => ({ date, ranges })),
      timeOff: off.map((b) => ({
        id: b.id,
        from: zonedDate(timeZone, b.startsAt.getTime()),
        // Inclusive: the block ends at the start of the day after the last day.
        to: zonedDate(timeZone, b.endsAt.getTime() - 1),
        reason: b.reason,
      })),
      bufferBeforeMinutes: settings?.defaultBufferMinutes ?? 0,
      bufferAfterMinutes: settings?.defaultBufferMinutes ?? 0,
      minNoticeHours: Math.ceil((settings?.bookingMinNoticeMinutes ?? 0) / 60),
      // No limit is kept as no value; the form's longest window stands for it.
      maxWindowDays: settings?.bookingMaxAdvanceDays ?? 730,
      busyCalendarIds: [],
      effectiveFrom: null,
      updatedAt: latest ? latest.toISOString() : null,
    };
  }

  /** Replaces the member's one-day changes; a date with no ranges is a day off. */
  private async replaceOverrides(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    userId: string,
    overrides: NonNullable<RulesReq['dateOverrides']>,
  ): Promise<void> {
    const dates = new Set<string>();
    for (const o of overrides) {
      if (dates.has(o.date)) throw errors.unsupported('Each date can be listed once');
      dates.add(o.date);
      this.requireRanges(o.ranges);
    }
    await tx.availabilityOverride.deleteMany({ where: { businessId, userId } });
    const rows = overrides.flatMap(
      (o): { date: string; startsAt: Date | null; endsAt: Date | null }[] =>
        o.ranges.length === 0
          ? [{ date: o.date, startsAt: null, endsAt: null }]
          : o.ranges.map((r) => ({
              date: o.date,
              startsAt: timeOfDayToDb(r.startsAt),
              endsAt: timeOfDayToDb(r.endsAt),
            })),
    );
    if (rows.length > 0) {
      await tx.availabilityOverride.createMany({
        data: rows.map((r) => ({
          businessId,
          userId,
          date: new Date(`${r.date}T00:00:00Z`),
          startsAt: r.startsAt,
          endsAt: r.endsAt,
          createdByUserId: actor.userId,
        })),
      });
    }
  }

  /** Ranges of one day: each starts before it ends, in order, none overlapping. */
  private requireRanges(ranges: readonly { startsAt: string; endsAt: string }[]): void {
    const sorted = ranges
      .map((r) => [r.startsAt, r.endsAt] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));
    sorted.forEach(([from, to], i) => {
      if (from >= to) throw errors.unsupported('A range must end after it starts');
      const next = sorted[i + 1];
      if (next && next[0] < to) throw errors.unsupported('Ranges of one day cannot overlap');
    });
  }

  /**
   * Replaces the member's time off that has not ended. A period may not cover a scheduled
   * appointment (409 BLOCKS_APPOINTMENT), as blocked time does.
   */
  private async replaceTimeOff(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    userId: string,
    timeZone: string,
    periods: NonNullable<RulesReq['timeOff']>,
  ): Promise<void> {
    await lockForBlock(tx, businessId, userId);
    await tx.blockedTime.deleteMany({
      where: { businessId, userId, kind: 'TIME_OFF', endsAt: { gt: new Date() } },
    });
    for (const p of periods) {
      if (p.to < p.from) throw errors.unsupported('Time off must end on or after its first day');
      const startsAt = new Date(zonedInstant(timeZone, p.from, 0));
      const endsAt = new Date(zonedInstant(timeZone, addDays(p.to, 1), 0));
      if (endsAt.getTime() - startsAt.getTime() > 366 * DAY) {
        throw errors.unsupported('Time off is at most a year');
      }
      if (endsAt.getTime() <= Date.now())
        throw errors.unsupported('Time off must not be in the past');
      const covered = await tx.appointment.findFirst({
        where: {
          businessId,
          status: 'SCHEDULED',
          staffUserId: userId,
          startsAt: { lt: endsAt },
          endsAt: { gt: startsAt },
        },
        select: { id: true },
      });
      if (covered) throw errors.blocksAppointment();
      await tx.blockedTime.create({
        data: {
          businessId,
          userId,
          startsAt,
          endsAt,
          kind: 'TIME_OFF',
          reason: p.reason ?? null,
          createdByUserId: actor.userId,
        },
      });
    }
  }
}

/** `range` minus the `taken` intervals: the free pieces, in order. */
export function subtract(range: Interval, taken: readonly Interval[]): Interval[] {
  const sorted = [...taken].sort((a, b) => a.start - b.start);
  const free: Interval[] = [];
  let at = range.start;
  for (const t of sorted) {
    if (t.end <= at) continue;
    if (t.start >= range.end) break;
    if (t.start > at) free.push({ start: at, end: t.start });
    at = Math.max(at, t.end);
  }
  if (at < range.end) free.push({ start: at, end: range.end });
  return free;
}
