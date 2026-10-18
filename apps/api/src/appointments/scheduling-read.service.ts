import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AgendaPage,
  AgendaQuery,
  AppointmentContact,
  AppointmentRecord,
  AppointmentsSummary,
  AppointmentsSummaryQuery,
  ContactSearchQuery,
  SchedulingOptions,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { AppointmentHistory } from './appointment-history.service.js';
import { DAY, zonedDate, zonedInstant } from './calendar.js';
import { activeMembers, type FirmActor, firmTimeZone, inFullWhere } from './calendar-data.js';
import { errors } from './errors.js';
import { findSchedulingRow, schedulingSelect, toEntry, toRecord } from './scheduling-data.js';
import {
  colorHex,
  decodeCursor,
  displayStatusWhere,
  encodeCursor,
  monthOf,
  monthSpan,
} from './scheduling-map.js';

type SummaryQ = z.output<typeof AppointmentsSummaryQuery>;
type AgendaQ = z.output<typeof AgendaQuery>;
type ContactQ = z.output<typeof ContactSearchQuery>;

/** Providers of a connected video integration, as the Integrations catalog names them. */
const VIDEO_PROVIDERS = {
  zoom: 'ZOOM',
  microsoft_teams: 'TEAMS',
  teams: 'TEAMS',
  google_meet: 'GOOGLE_MEET',
} as const;

/** "CL-10001" or "10001": the client number a contact search can also find. */
const CLIENT_NUMBER = /^(?:cl-?)?(\d{1,9})$/i;

/**
 * The Appointments workspace's reads (contract in packages/types/src/appointments/scheduling.ts):
 * the overview's KPIs, the calendar / list / today agenda, the form's options, the contact search
 * and one appointment's record. R12's visibility rule holds everywhere: Owner and Admin see
 * every appointment; Staff see their own and their assigned clients' in full and the rest as
 * Busy, and get 404 for anything else about those. Every read is audited with counts and ids
 * only, never the search text.
 */
@Injectable()
export class SchedulingReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly history: AppointmentHistory,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async summary(businessId: string, actor: FirmActor, q: SummaryQ): Promise<AppointmentsSummary> {
    const result = await this.inFirm(businessId, async (tx) => {
      const timeZone = await firmTimeZone(tx, businessId);
      const month = q.month ?? monthOf(zonedDate(timeZone, Date.now()));
      const span = monthSpan(month);
      const between = (from: string, to: string): Prisma.AppointmentWhereInput => ({
        startsAt: {
          gte: new Date(zonedInstant(timeZone, from, 0)),
          lt: new Date(zonedInstant(timeZone, to, 0)),
        },
      });
      const visible = inFullWhere(actor);
      const count = (when: Prisma.AppointmentWhereInput, period: 'this' | 'last') =>
        tx.appointment.count({
          where: {
            AND: [
              { businessId },
              visible,
              period === 'this'
                ? between(span.first, span.next)
                : between(span.previous, span.first),
              when,
            ],
          },
        });
      const pair = async (when: Prisma.AppointmentWhereInput) => {
        // One after the other: a transaction runs its queries on one connection.
        const value = await count(when, 'this');
        const previous = await count(when, 'last');
        return { value, previous };
      };
      const now = new Date();
      const upcoming = await tx.appointment.count({
        where: {
          AND: [
            { businessId },
            visible,
            {
              status: 'SCHEDULED',
              startsAt: { gte: now, lt: new Date(now.getTime() + 7 * DAY) },
            },
          ],
        },
      });
      const total = await pair({});
      const completed = await pair({ status: 'COMPLETED' });
      const noShows = await pair({ status: 'NO_SHOW' });
      const canceled = await pair({ status: 'CANCELLED' });
      return { month, total, upcoming, completed, noShows, canceled } satisfies AppointmentsSummary;
    });
    await this.audit.log(
      'appointments.summary_viewed',
      { type: 'appointment' },
      {
        month: result.month,
      },
    );
    return result;
  }

  async agenda(businessId: string, actor: FirmActor, q: AgendaQ): Promise<AgendaPage> {
    const cursor = q.cursor ? decodeCursor(q.cursor) : null;
    if (q.cursor && !cursor) {
      throw new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'Use the cursor as sent',
      });
    }
    const page = await this.inFirm(businessId, async (tx) => {
      if (q.clientId && actor.role === 'STAFF') {
        // So a Busy entry can never be traced to a client.
        const assigned = await tx.client.findFirst({
          where: { businessId, id: q.clientId, assignedUserId: actor.userId },
          select: { id: true },
        });
        if (!assigned) throw errors.notFound();
      }
      const search = q.search?.trim();
      const term = search ? { contains: search, mode: 'insensitive' as const } : null;
      const and: Prisma.AppointmentWhereInput[] = [
        { businessId },
        { startsAt: { lt: new Date(q.to) }, endsAt: { gt: new Date(q.from) } },
      ];
      if (q.staffUserId) and.push({ staffUserId: q.staffUserId });
      if (q.clientId) and.push({ clientId: q.clientId });
      if (q.status) and.push(displayStatusWhere(q.status));
      if (term) {
        // Staff search only what they see in full: a match on a name must not reveal who is
        // behind a Busy entry.
        and.push(inFullWhere(actor));
        and.push({
          OR: [
            { client: { displayName: term } },
            { client: { email: term } },
            { client: { phone: term } },
            { client: { profile: { businessName: term } } },
            { service: { name: term } },
            { type: { name: term } },
            { staff: { user: { name: term } } },
          ],
        });
      }
      if (cursor) {
        const at = new Date(cursor.startsAt);
        and.push({ OR: [{ startsAt: { gt: at } }, { startsAt: at, id: { gt: cursor.id } }] });
      }
      const rows = await tx.appointment.findMany({
        where: { AND: and },
        orderBy: [{ startsAt: 'asc' }, { id: 'asc' }],
        take: q.limit + 1,
        select: schedulingSelect,
      });
      return { rows, timeZone: await firmTimeZone(tx, businessId) };
    });
    const more = page.rows.length > q.limit;
    const rows = more ? page.rows.slice(0, q.limit) : page.rows;
    const last = rows.at(-1);
    const items = rows.map((row) => toEntry(actor, row));
    await this.audit.log(
      'appointments.listed',
      { type: 'appointment' },
      { count: items.length, busy: items.filter((i) => i.restricted).length, view: 'agenda' },
    );
    return {
      timezone: page.timeZone,
      items,
      nextCursor:
        more && last ? encodeCursor({ startsAt: last.startsAt.toISOString(), id: last.id }) : null,
    };
  }

  async options(businessId: string): Promise<SchedulingOptions> {
    return this.inFirm(businessId, async (tx) => {
      const types = await tx.appointmentType.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, durationMinutes: true, color: true, serviceId: true },
      });
      const services = await tx.service.findMany({
        where: { businessId, archivedAt: null, status: 'ACTIVE' },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      });
      const offices = await tx.firmOffice.findMany({
        where: { businessId, archivedAt: null },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true },
      });
      const rooms = await tx.firmRoom.findMany({
        where: { businessId, archivedAt: null, office: { archivedAt: null } },
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        select: { id: true, name: true, officeId: true },
      });
      const messages = await tx.messageSettings.findUnique({
        where: { businessId },
        select: { smsEnabled: true, portalEnabled: true },
      });
      const video = await tx.integrationConnection.findFirst({
        where: {
          businessId,
          provider: { in: Object.keys(VIDEO_PROVIDERS) },
          status: 'CONNECTED',
          disconnectedAt: null,
        },
        orderBy: { connectedAt: 'asc' },
        select: { provider: true },
      });
      return {
        timezone: await firmTimeZone(tx, businessId),
        types: types.map((t) => ({
          id: t.id,
          name: t.name,
          durationMinutes: t.durationMinutes,
          color: colorHex(t.color),
          serviceId: t.serviceId,
        })),
        services,
        staff: await activeMembers(tx, businessId),
        offices,
        rooms,
        // No row means the column defaults (SMS off, portal on).
        smsEnabled: messages?.smsEnabled ?? false,
        portalEnabled: messages?.portalEnabled ?? true,
        videoProvider: video
          ? VIDEO_PROVIDERS[video.provider as keyof typeof VIDEO_PROVIDERS]
          : null,
      };
    });
  }

  /** Clients the member may see (Staff: their assigned clients), by name, email, phone or number. */
  async contacts(
    businessId: string,
    actor: FirmActor,
    q: ContactQ,
  ): Promise<{ items: AppointmentContact[] }> {
    const items = await this.inFirm(businessId, async (tx) => {
      const search = q.search.trim();
      if (!search) return [];
      const term = { contains: search, mode: 'insensitive' as const };
      const number = CLIENT_NUMBER.exec(search);
      const rows = await tx.client.findMany({
        where: {
          businessId,
          archivedAt: null,
          ...(actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {}),
          OR: [
            { displayName: term },
            { email: term },
            { phone: term },
            { profile: { businessName: term } },
            ...(number?.[1] ? [{ clientNumber: Number(number[1]) }] : []),
          ],
        },
        orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
        take: q.limit,
        select: {
          id: true,
          displayName: true,
          email: true,
          phone: true,
          accountType: true,
          profile: { select: { businessName: true } },
        },
      });
      return rows.map((c): AppointmentContact => ({
        kind: 'CLIENT',
        id: c.id,
        name: c.displayName,
        businessName:
          c.profile?.businessName ?? (c.accountType === 'BUSINESS' ? c.displayName : null),
        email: c.email,
        phone: c.phone,
        clientType: c.accountType,
      }));
    });
    await this.audit.log(
      'appointment_contacts.searched',
      { type: 'client' },
      {
        count: items.length,
      },
    );
    return { items };
  }

  async record(businessId: string, actor: FirmActor, id: string): Promise<AppointmentRecord> {
    const record = await this.inFirm(businessId, async (tx) => {
      const row = await findSchedulingRow(tx, businessId, actor, id);
      if (!row) throw errors.notFound();
      return toRecord(
        row,
        await firmTimeZone(tx, businessId),
        await this.history.events(tx, businessId, row),
      );
    });
    await this.audit.log('appointment.viewed', { type: 'appointment', id });
    return record;
  }
}
