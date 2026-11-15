import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  MyWaitlist,
  MyWaitlistEntry,
  WaitlistEntry,
  WaitlistEntryList,
  WaitlistErrorCode,
  WaitlistSettings,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { Notifier } from '../notifications/notifier.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { AppointmentNotices } from './appointment-notices.js';
import { DAY } from './calendar.js';
import { activeMember, type FirmActor, firmTimeZone, inFullWhere } from './calendar-data.js';
import { lockAppointment, lockForBooking, retryWhenBusy } from './calendar-locks.js';
import { errors, isSlotConflict, isUniqueViolation } from './errors.js';
import {
  type Candidate,
  conflictSpan,
  findConflicts,
  loadConflictData,
} from './scheduling-conflicts.js';
import {
  earliestOpening,
  type Hold,
  OFFER_LEAD_MS,
  MIN_GAIN_MS,
  offerExpiry,
  openingSpan,
  withHolds,
} from './waitlist-openings.js';
import type { SaveWaitlistSettingsBody, WaitlistListQuery } from './waitlist.input.js';

type ListQ = z.output<typeof WaitlistListQuery>;
type SettingsBody = z.output<typeof SaveWaitlistSettingsBody>;

/** Ended entries stay listed this long. */
const ENDED_LISTED_MS = 30 * DAY;
/** Entries offered per firm and job run; the rest waits for the next run. */
const OFFERS_PER_RUN = 50;
const LIVE = ['WAITING', 'OFFERED', 'REQUESTED'] as const;

const fail = (code: WaitlistErrorCode, message: string) => new ConflictException({ code, message });
const waitlistErrors = {
  off: () => fail('WAITLIST_OFF', 'The waitlist is not available.'),
  already: () => fail('ALREADY_WAITING', 'This appointment is already on the waitlist.'),
  closed: () =>
    fail('WAITLIST_ENTRY_CLOSED', 'This waitlist entry has changed. Refresh to see it.'),
  taken: () =>
    fail(
      'OFFER_TAKEN',
      'That earlier time was just taken. You stay on the waitlist for the next opening.',
    ),
};

const entrySelect = {
  id: true,
  appointmentId: true,
  clientId: true,
  status: true,
  offeredStartsAt: true,
  offeredEndsAt: true,
  offerExpiresAt: true,
  requestedAt: true,
  decidedAt: true,
  createdAt: true,
  appointment: {
    select: {
      id: true,
      clientId: true,
      staffUserId: true,
      roomId: true,
      startsAt: true,
      endsAt: true,
      status: true,
      bufferBeforeMinutes: true,
      bufferAfterMinutes: true,
      attendees: { select: { clientId: true } },
      type: { select: { name: true } },
      staff: { select: { user: { select: { name: true } } } },
      client: { select: { displayName: true } },
    },
  },
} satisfies Prisma.AppointmentWaitlistEntrySelect;
type EntryRow = Prisma.AppointmentWaitlistEntryGetPayload<{ select: typeof entrySelect }>;

/** The offer's fields cleared: an entry back to WAITING (the database's shape rule). */
const NO_OFFER = {
  status: 'WAITING' as const,
  offeredStartsAt: null,
  offeredEndsAt: null,
  offeredAt: null,
  offerExpiresAt: null,
  requestedAt: null,
};

function offerOf(row: EntryRow) {
  return row.offeredStartsAt && row.offeredEndsAt && row.offerExpiresAt
    ? {
        startsAt: row.offeredStartsAt.toISOString(),
        endsAt: row.offeredEndsAt.toISOString(),
        expiresAt: row.offerExpiresAt.toISOString(),
      }
    : null;
}

function toEntry(row: EntryRow): WaitlistEntry {
  const a = row.appointment;
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    client: { id: row.clientId, name: a.client.displayName },
    staffName: a.staff.user.name,
    typeName: a.type?.name ?? null,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: row.status,
    offer: offerOf(row),
    requestedAt: row.requestedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What the client sees of their entry: never another client, staff notes or ids beyond it. */
function toMine(row: EntryRow): MyWaitlistEntry {
  return {
    id: row.id,
    appointmentId: row.appointmentId,
    status: row.status,
    offer: offerOf(row),
    createdAt: row.createdAt.toISOString(),
  };
}

const peopleOf = (a: EntryRow['appointment']) => a.attendees.map((x) => x.clientId);

/** One job run's work in a firm. */
export interface WaitlistRun {
  expired: number;
  closed: number;
  offered: number;
}

/**
 * Appointments A3 (R55): the waitlist for an earlier time (contract in
 * packages/types/src/appointments/waitlist.ts). A client waits for one of their own scheduled
 * appointments; the job (WaitlistJob) offers an earlier opening to one entry at a time, held for it
 * alone, by Portal and Email (the outbox) to clients whose portal access is active. Taking the
 * offer moves the appointment at once (AUTO_CONFIRM) or asks staff (STAFF_APPROVAL); either way
 * the time is checked again first, and a time taken meanwhile is 409 OFFER_TAKEN with the entry
 * back to WAITING. The appointment's own time stands until the move. Audit rows hold ids only.
 */
@Injectable()
export class AppointmentWaitlistService {
  private readonly logger = new Logger('AppointmentWaitlist');

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
    private readonly notices: AppointmentNotices,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async settingsIn(tx: TxClient, businessId: string): Promise<WaitlistSettings> {
    const s = await tx.appointmentSettings.findUnique({
      where: { businessId },
      select: { waitlistEnabled: true, waitlistMode: true },
    });
    return { enabled: s?.waitlistEnabled ?? false, mode: s?.waitlistMode ?? 'STAFF_APPROVAL' };
  }

  // ---------- Settings ----------

  settings(businessId: string): Promise<WaitlistSettings> {
    return this.inFirm(businessId, (tx) => this.settingsIn(tx, businessId));
  }

  async saveSettings(businessId: string, body: SettingsBody): Promise<WaitlistSettings> {
    const saved = await this.inFirm(businessId, async (tx) => {
      const data = { waitlistEnabled: body.enabled, waitlistMode: body.mode };
      await tx.appointmentSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
        select: { businessId: true },
      });
      return this.settingsIn(tx, businessId);
    });
    await this.audit.log(
      'appointment_waitlist.settings_updated',
      { type: 'appointment_settings' },
      { enabled: saved.enabled, mode: saved.mode },
    );
    return saved;
  }

  // ---------- Firm ----------

  /** The firm's entries; Staff only those of appointments they see in full. */
  async list(businessId: string, actor: FirmActor, q: ListQ): Promise<WaitlistEntryList> {
    const out = await this.inFirm(businessId, async (tx) => {
      const settings = await this.settingsIn(tx, businessId);
      const rows = await tx.appointmentWaitlistEntry.findMany({
        where: {
          businessId,
          appointment: inFullWhere(actor),
          ...(q.show === 'live'
            ? { status: { in: [...LIVE] } }
            : {
                OR: [
                  { status: { in: [...LIVE] } },
                  { updatedAt: { gte: new Date(Date.now() - ENDED_LISTED_MS) } },
                ],
              }),
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 500,
        select: entrySelect,
      });
      return { ...settings, items: rows.map(toEntry) };
    });
    await this.audit.log(
      'appointment_waitlist.viewed',
      { type: 'appointment_waitlist' },
      { show: q.show, count: out.items.length },
    );
    return out;
  }

  /** STAFF_APPROVAL: staff move the appointment to the requested time, checked again. */
  async approve(businessId: string, actor: FirmActor, id: string): Promise<WaitlistEntry> {
    const row = await this.move(businessId, id, { kind: 'STAFF', actor });
    await this.notices.send('appointment.changed', businessId, row.appointmentId);
    return toEntry(row);
  }

  /** STAFF_APPROVAL: staff turn the request down; the original time stands. */
  async reject(businessId: string, actor: FirmActor, id: string): Promise<WaitlistEntry> {
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.firmEntry(tx, businessId, actor, id);
      await lockAppointment(tx, businessId, current.appointmentId);
      const done = await tx.appointmentWaitlistEntry.updateMany({
        where: { businessId, id, status: 'REQUESTED' },
        data: { status: 'REJECTED', decidedAt: new Date(), decidedByUserId: actor.userId },
      });
      if (!done.count) throw waitlistErrors.closed();
      await this.audit.logIn(
        tx,
        'appointment.waitlist_rejected',
        { type: 'appointment_waitlist_entry', id },
        { appointmentId: current.appointmentId, clientId: current.clientId },
      );
      return this.entryIn(tx, businessId, id);
    });
    return toEntry(row);
  }

  private async firmEntry(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<EntryRow> {
    const row = await tx.appointmentWaitlistEntry.findFirst({
      where: { businessId, id, appointment: inFullWhere(actor) },
      select: entrySelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  private async entryIn(tx: TxClient, businessId: string, id: string): Promise<EntryRow> {
    return tx.appointmentWaitlistEntry.findFirstOrThrow({
      where: { businessId, id },
      select: entrySelect,
    });
  }

  // ---------- Portal ----------

  /** The signed-in login's client at this firm; none (404) for a login without one. */
  private async clientOf(tx: TxClient, businessId: string, clientAccountId: string) {
    const account = await tx.clientAccount.findFirst({
      where: { businessId, id: clientAccountId },
      select: { clientId: true },
    });
    if (!account?.clientId) throw errors.notFound();
    return account.clientId;
  }

  /** One of the client's own entries; anything else is 404. */
  private async mineIn(
    tx: TxClient,
    businessId: string,
    clientAccountId: string,
    id: string,
  ): Promise<EntryRow> {
    const clientId = await this.clientOf(tx, businessId, clientAccountId);
    const row = await tx.appointmentWaitlistEntry.findFirst({
      where: { businessId, id, clientId },
      select: entrySelect,
    });
    if (!row) throw errors.notFound();
    return row;
  }

  async mine(businessId: string, clientAccountId: string): Promise<MyWaitlist> {
    const out = await this.inFirm(businessId, async (tx) => {
      const account = await tx.clientAccount.findFirst({
        where: { businessId, id: clientAccountId },
        select: { clientId: true },
      });
      const settings = await this.settingsIn(tx, businessId);
      if (!account?.clientId) return { ...settings, items: [], clientId: null };
      const rows = await tx.appointmentWaitlistEntry.findMany({
        where: {
          businessId,
          clientId: account.clientId,
          OR: [
            { status: { in: [...LIVE] } },
            { updatedAt: { gte: new Date(Date.now() - ENDED_LISTED_MS) } },
          ],
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: entrySelect,
      });
      return { ...settings, items: rows.map(toMine), clientId: account.clientId };
    });
    if (out.clientId) {
      await this.audit.log(
        'portal.waitlist_viewed',
        { type: 'client', id: out.clientId },
        { count: out.items.length },
      );
    }
    return { enabled: out.enabled, mode: out.mode, items: out.items };
  }

  /** Waits for an earlier time for one of the client's own scheduled, upcoming appointments. */
  async join(
    businessId: string,
    clientAccountId: string,
    appointmentId: string,
  ): Promise<MyWaitlistEntry> {
    try {
      const row = await this.inFirm(businessId, async (tx) => {
        const clientId = await this.clientOf(tx, businessId, clientAccountId);
        const appointment = await tx.appointment.findFirst({
          where: { businessId, id: appointmentId, clientId },
          select: { id: true, status: true, startsAt: true },
        });
        if (!appointment) throw errors.notFound();
        if (!(await this.settingsIn(tx, businessId)).enabled) throw waitlistErrors.off();
        if (appointment.status !== 'SCHEDULED' || appointment.startsAt.getTime() <= Date.now()) {
          throw errors.closed();
        }
        const made = await tx.appointmentWaitlistEntry.create({
          data: { businessId, appointmentId: appointment.id, clientId },
          select: { id: true },
        });
        await this.audit.logIn(
          tx,
          'appointment.waitlist_joined',
          { type: 'appointment_waitlist_entry', id: made.id },
          { appointmentId: appointment.id, clientId },
        );
        return this.entryIn(tx, businessId, made.id);
      });
      return toMine(row);
    } catch (e) {
      if (isUniqueViolation(e)) throw waitlistErrors.already();
      throw e;
    }
  }

  /** Leaves the waitlist: from WAITING, or turning an open offer down. */
  async leave(businessId: string, clientAccountId: string, id: string): Promise<MyWaitlistEntry> {
    return this.clientStep(businessId, clientAccountId, id, (row) =>
      row.status === 'WAITING'
        ? { from: 'WAITING', to: 'LEFT', action: 'appointment.waitlist_left' }
        : row.status === 'OFFERED'
          ? { from: 'OFFERED', to: 'DECLINED', action: 'appointment.waitlist_declined' }
          : null,
    );
  }

  /** Turns an open offer down; the entry ends and the time goes to the next one. */
  async decline(businessId: string, clientAccountId: string, id: string): Promise<MyWaitlistEntry> {
    return this.clientStep(businessId, clientAccountId, id, (row) =>
      row.status === 'OFFERED'
        ? { from: 'OFFERED', to: 'DECLINED', action: 'appointment.waitlist_declined' }
        : null,
    );
  }

  private async clientStep(
    businessId: string,
    clientAccountId: string,
    id: string,
    step: (
      row: EntryRow,
    ) => { from: 'WAITING' | 'OFFERED'; to: 'LEFT' | 'DECLINED'; action: string } | null,
  ): Promise<MyWaitlistEntry> {
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.mineIn(tx, businessId, clientAccountId, id);
      const s = step(current);
      if (!s) throw waitlistErrors.closed();
      const done = await tx.appointmentWaitlistEntry.updateMany({
        where: { businessId, id, status: s.from },
        data: { status: s.to },
      });
      if (!done.count) throw waitlistErrors.closed();
      await this.audit.logIn(
        tx,
        s.action,
        { type: 'appointment_waitlist_entry', id },
        { appointmentId: current.appointmentId, clientId: current.clientId },
      );
      return this.entryIn(tx, businessId, id);
    });
    return toMine(row);
  }

  /**
   * Takes the open offer. AUTO_CONFIRM: the appointment moves at once (checked again; 409
   * OFFER_TAKEN and back to WAITING when the time went meanwhile). STAFF_APPROVAL: REQUESTED, and
   * the offer stays held for the entry until staff decide.
   */
  async accept(businessId: string, clientAccountId: string, id: string): Promise<MyWaitlistEntry> {
    const { mode, appointmentId } = await this.inFirm(businessId, async (tx) => {
      const current = await this.mineIn(tx, businessId, clientAccountId, id);
      const open =
        current.status === 'OFFERED' &&
        current.offerExpiresAt !== null &&
        current.offerExpiresAt.getTime() > Date.now();
      if (!open) throw waitlistErrors.closed();
      return {
        mode: (await this.settingsIn(tx, businessId)).mode,
        appointmentId: current.appointmentId,
      };
    });
    if (mode === 'AUTO_CONFIRM') {
      const row = await this.move(businessId, id, { kind: 'CLIENT', clientAccountId });
      await this.notices.send('appointment.changed', businessId, appointmentId, {
        clientAccountId,
      });
      return toMine(row);
    }
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.mineIn(tx, businessId, clientAccountId, id);
      const done = await tx.appointmentWaitlistEntry.updateMany({
        where: { businessId, id, status: 'OFFERED', offerExpiresAt: { gt: new Date() } },
        data: { status: 'REQUESTED', requestedAt: new Date() },
      });
      if (!done.count) throw waitlistErrors.closed();
      await this.audit.logIn(
        tx,
        'appointment.waitlist_requested',
        { type: 'appointment_waitlist_entry', id },
        { appointmentId: current.appointmentId, clientId: current.clientId },
      );
      return this.entryIn(tx, businessId, id);
    });
    return toMine(row);
  }

  // ---------- The move ----------

  /**
   * Moves the entry's appointment to its offered time after checking it again, under the
   * booking locks: the staff member, the client and each attendee, the room, blocked time and
   * every other live offer. MOVED when it is free; when it is not (or the database refuses it),
   * the entry is back to WAITING and the caller gets 409 OFFER_TAKEN.
   */
  private async move(
    businessId: string,
    id: string,
    by: { kind: 'CLIENT'; clientAccountId: string } | { kind: 'STAFF'; actor: FirmActor },
  ): Promise<EntryRow> {
    let outcome: { moved: true; row: EntryRow } | { moved: false };
    try {
      outcome = await retryWhenBusy(() =>
        this.inFirm(businessId, async (tx) => {
          const first =
            by.kind === 'CLIENT'
              ? await this.mineIn(tx, businessId, by.clientAccountId, id)
              : await this.firmEntry(tx, businessId, by.actor, id);
          await lockAppointment(tx, businessId, first.appointmentId);
          const e = await this.entryIn(tx, businessId, id);
          const wanted = by.kind === 'CLIENT' ? 'OFFERED' : 'REQUESTED';
          const a = e.appointment;
          if (
            e.status !== wanted ||
            !e.offeredStartsAt ||
            !e.offeredEndsAt ||
            (by.kind === 'CLIENT' && (e.offerExpiresAt?.getTime() ?? 0) <= Date.now())
          ) {
            throw waitlistErrors.closed();
          }
          const slot = { start: e.offeredStartsAt.getTime(), end: e.offeredEndsAt.getTime() };
          if (a.status !== 'SCHEDULED' || slot.start <= Date.now()) {
            await this.backToWaiting(tx, businessId, e);
            return { moved: false } as const;
          }
          const attendees = peopleOf(a);
          await lockForBooking(tx, businessId, a.staffUserId, a.clientId, attendees);
          if (!(await this.stillFree(tx, businessId, e, slot))) {
            await this.backToWaiting(tx, businessId, e);
            return { moved: false } as const;
          }
          const before = { startsAt: a.startsAt, endsAt: a.endsAt, staffUserId: a.staffUserId };
          const updated = await tx.appointment.update({
            where: { id: a.id },
            data: { startsAt: new Date(slot.start), endsAt: new Date(slot.end) },
            select: { id: true, clientId: true, startsAt: true, endsAt: true, staffUserId: true },
          });
          await this.history.record(tx, 'RESCHEDULED', updated, {
            by: by.kind,
            from: before,
            to: updated,
          });
          const now = new Date();
          await tx.appointmentWaitlistEntry.update({
            where: { id: e.id },
            data: {
              status: 'MOVED',
              requestedAt: e.requestedAt ?? now,
              decidedAt: now,
              decidedByUserId: by.kind === 'STAFF' ? by.actor.userId : null,
            },
            select: { id: true },
          });
          await this.audit.logIn(
            tx,
            'appointment.waitlist_moved',
            { type: 'appointment_waitlist_entry', id: e.id },
            { appointmentId: a.id, clientId: e.clientId, by: by.kind },
          );
          return { moved: true, row: await this.entryIn(tx, businessId, e.id) } as const;
        }),
      );
    } catch (e) {
      if (!isSlotConflict(e)) throw e;
      // The database refused the time (taken by a change outside the locks): back to waiting.
      await this.inFirm(businessId, async (tx) => {
        const row = await tx.appointmentWaitlistEntry.findFirst({
          where: { businessId, id },
          select: entrySelect,
        });
        if (row && (row.status === 'OFFERED' || row.status === 'REQUESTED')) {
          await this.backToWaiting(tx, businessId, row);
        }
      });
      outcome = { moved: false };
    }
    if (!outcome.moved) throw waitlistErrors.taken();
    return outcome.row;
  }

  private async backToWaiting(tx: TxClient, businessId: string, e: EntryRow): Promise<void> {
    await tx.appointmentWaitlistEntry.update({
      where: { id: e.id },
      data: NO_OFFER,
      select: { id: true },
    });
    await this.audit.logIn(
      tx,
      'appointment.waitlist_offer_taken',
      { type: 'appointment_waitlist_entry', id: e.id },
      { appointmentId: e.appointmentId, clientId: e.clientId },
    );
  }

  /** Whether the offered slot is still free of every conflict (and every other live offer). */
  private async stillFree(
    tx: TxClient,
    businessId: string,
    e: EntryRow,
    slot: { start: number; end: number },
  ): Promise<boolean> {
    const a = e.appointment;
    let staff;
    try {
      staff = await activeMember(tx, businessId, a.staffUserId);
    } catch {
      return false;
    }
    const attendees = peopleOf(a);
    const candidate: Candidate = {
      staffUserIds: [a.staffUserId],
      occurrences: [slot],
      allDay: false,
      clientId: a.clientId,
      attendeeClientIds: attendees,
      roomId: a.roomId,
      bufferBeforeMinutes: a.bufferBeforeMinutes,
      bufferAfterMinutes: a.bufferAfterMinutes,
      exceptId: a.id,
    };
    const data = await loadConflictData(
      tx,
      businessId,
      await firmTimeZone(tx, businessId),
      [staff],
      conflictSpan(candidate),
      a.clientId,
      a.roomId,
      attendees,
    );
    const holds = await this.holds(tx, businessId, e.id);
    return findConflicts(withHolds(data, holds), candidate).length === 0;
  }

  /** Every other live offer (offered or requested) of the firm, held as if booked. */
  private async holds(tx: TxClient, businessId: string, exceptEntryId?: string): Promise<Hold[]> {
    const rows = await tx.appointmentWaitlistEntry.findMany({
      where: {
        businessId,
        status: { in: ['OFFERED', 'REQUESTED'] },
        ...(exceptEntryId ? { id: { not: exceptEntryId } } : {}),
        appointment: { status: 'SCHEDULED' },
      },
      select: {
        id: true,
        offeredStartsAt: true,
        offeredEndsAt: true,
        appointment: {
          select: {
            staffUserId: true,
            clientId: true,
            roomId: true,
            bufferBeforeMinutes: true,
            bufferAfterMinutes: true,
            attendees: { select: { clientId: true } },
          },
        },
      },
    });
    return rows.flatMap((r) =>
      r.offeredStartsAt && r.offeredEndsAt
        ? [
            {
              entryId: r.id,
              staffUserId: r.appointment.staffUserId,
              clientId: r.appointment.clientId,
              attendeeClientIds: r.appointment.attendees.map((x) => x.clientId),
              roomId: r.appointment.roomId,
              start: r.offeredStartsAt.getTime(),
              end: r.offeredEndsAt.getTime(),
              bufferBeforeMinutes: r.appointment.bufferBeforeMinutes,
              bufferAfterMinutes: r.appointment.bufferAfterMinutes,
            },
          ]
        : [],
    );
  }

  // ---------- The job's work in one firm ----------

  /**
   * One firm's run (WaitlistJob): ends what can no longer stand, then offers openings.
   * - an offer past its time EXPIRED; a request whose time has come back to WAITING;
   * - entries of an appointment no longer scheduled or already started end (LEFT, EXPIRED or
   *   REJECTED, by where they were);
   * - with the waitlist on, each WAITING entry (oldest first) of a client whose portal access is
   *   active (a PRIMARY ACTIVE login, no portal lock, not archived) gets the earliest opening
   *   that no other live offer holds, then a bell item and an email through the outbox.
   */
  async runFirm(businessId: string, now: Date, deadline: number): Promise<WaitlistRun> {
    const run: WaitlistRun = { expired: 0, closed: 0, offered: 0 };
    await this.inFirm(businessId, async (tx) => {
      const expired = await tx.appointmentWaitlistEntry.updateMany({
        where: { businessId, status: 'OFFERED', offerExpiresAt: { lte: now } },
        data: { status: 'EXPIRED' },
      });
      run.expired += expired.count;
      const lapsed = await tx.appointmentWaitlistEntry.findMany({
        where: { businessId, status: 'REQUESTED', offeredStartsAt: { lte: now } },
        select: { id: true },
      });
      for (const { id } of lapsed) {
        await tx.appointmentWaitlistEntry.update({ where: { id }, data: NO_OFFER });
      }
      const over = {
        businessId,
        OR: [
          { appointment: { status: { not: 'SCHEDULED' as const } } },
          { appointment: { startsAt: { lte: now } } },
        ],
      };
      const ended = await Promise.all([
        tx.appointmentWaitlistEntry.updateMany({
          where: { ...over, status: 'WAITING' },
          data: { status: 'LEFT' },
        }),
        tx.appointmentWaitlistEntry.updateMany({
          where: { ...over, status: 'OFFERED' },
          data: { status: 'EXPIRED' },
        }),
        tx.appointmentWaitlistEntry.updateMany({
          where: { ...over, status: 'REQUESTED' },
          data: { status: 'REJECTED', decidedAt: now },
        }),
      ]);
      run.closed += ended.reduce((sum, r) => sum + r.count, 0);
    });

    const offers: string[] = [];
    await this.inFirm(businessId, async (tx) => {
      if (!(await this.settingsIn(tx, businessId)).enabled) return;
      const notBefore = now.getTime() + OFFER_LEAD_MS;
      const waiting = await tx.appointmentWaitlistEntry.findMany({
        where: {
          businessId,
          status: 'WAITING',
          appointment: {
            status: 'SCHEDULED',
            startsAt: { gt: new Date(notBefore + MIN_GAIN_MS) },
          },
          client: {
            archivedAt: null,
            portalLock: { is: null },
            accounts: { some: { portalRole: 'PRIMARY', status: 'ACTIVE' } },
          },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: OFFERS_PER_RUN,
        select: entrySelect,
      });
      if (waiting.length === 0) return;
      const timeZone = await firmTimeZone(tx, businessId);
      const holds = await this.holds(tx, businessId);
      for (const e of waiting) {
        if (Date.now() > deadline) break;
        const a = e.appointment;
        let staff;
        try {
          staff = await activeMember(tx, businessId, a.staffUserId);
        } catch {
          continue;
        }
        const attendees = peopleOf(a);
        const current = { start: a.startsAt.getTime(), end: a.endsAt.getTime() };
        const candidate: Candidate = {
          staffUserIds: [a.staffUserId],
          occurrences: [current],
          allDay: false,
          clientId: a.clientId,
          attendeeClientIds: attendees,
          roomId: a.roomId,
          bufferBeforeMinutes: a.bufferBeforeMinutes,
          bufferAfterMinutes: a.bufferAfterMinutes,
          exceptId: a.id,
        };
        const data = await loadConflictData(
          tx,
          businessId,
          timeZone,
          [staff],
          openingSpan(current, notBefore),
          a.clientId,
          a.roomId,
          attendees,
        );
        const slot = earliestOpening(withHolds(data, holds), candidate, current, notBefore);
        if (!slot) continue;
        const done = await tx.appointmentWaitlistEntry.updateMany({
          where: { businessId, id: e.id, status: 'WAITING' },
          data: {
            status: 'OFFERED',
            offeredStartsAt: new Date(slot.start),
            offeredEndsAt: new Date(slot.end),
            offeredAt: now,
            offerExpiresAt: new Date(offerExpiry(now.getTime(), slot)),
          },
        });
        if (!done.count) continue;
        await this.audit.logIn(
          tx,
          'appointment.waitlist_offered',
          { type: 'appointment_waitlist_entry', id: e.id },
          {
            appointmentId: a.id,
            clientId: e.clientId,
            startsAt: new Date(slot.start).toISOString(),
          },
          // A job's row: no request, so the firm is named here.
          { businessId },
        );
        // The time is held for this entry from now on: never offered to another in this run.
        holds.push({
          entryId: e.id,
          staffUserId: a.staffUserId,
          clientId: a.clientId,
          attendeeClientIds: attendees,
          roomId: a.roomId,
          start: slot.start,
          end: slot.end,
          bufferBeforeMinutes: a.bufferBeforeMinutes,
          bufferAfterMinutes: a.bufferAfterMinutes,
        });
        offers.push(`${e.id}:${a.id}:${slot.start}`);
      }
    });
    // After the commit: the bell item and the email (the outbox retries a failed copy).
    for (const key of offers) {
      const [entryId, appointmentId, start] = key.split(':');
      if (!entryId || !appointmentId) continue;
      const result = await this.notifier.notify({
        businessId,
        event: 'appointment.waitlist-offer',
        recordId: appointmentId,
        eventKey: `appointment.waitlist-offer:${entryId}:${start}`,
      });
      if (result.failed) this.logger.warn(`waitlist offer ${entryId}: notice not written`);
      run.offered += 1;
    }
    return run;
  }

  /** The job's firms: every ACTIVE one (a firm whose waitlist is off still ends lapsed entries). */
  async activeFirms(businessIds?: string[]): Promise<string[]> {
    const rows = await this.database.forPlatform().business.findMany({
      where: {
        status: 'ACTIVE',
        ...(businessIds ? { id: { in: businessIds } } : {}),
      },
      select: { id: true },
      orderBy: { id: 'asc' },
    });
    return rows.map((r) => r.id);
  }
}
