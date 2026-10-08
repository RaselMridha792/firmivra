import type { Prisma, TxClient } from '@firmivra/db';
import type { Appointment, BusyAppointment, MemberRef } from '@firmivra/types';
import {
  addDays,
  type Interval,
  timeOfDayFromDb,
  usableTimeZone,
  type WorkingRange,
  zonedInstant,
} from './calendar.js';
import { errors } from './errors.js';

// Database reads shared by the appointment services (locks are in calendar-locks.ts). Every
// function takes the transaction of the firm's business scope (row-level security: this firm
// only) and still names businessId in its filters, as R10 does.

/** Who acts on a firm route: the member and their role (from TenantGuard). */
export interface FirmActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

/** The firm's time zone (business_settings.timezone; the column's default without a row). */
export async function firmTimeZone(tx: TxClient, businessId: string): Promise<string> {
  const settings = await tx.businessSettings.findUnique({
    where: { businessId },
    select: { timezone: true },
  });
  return usableTimeZone(settings?.timezone);
}

const memberSelect = {
  userId: true,
  user: { select: { name: true } },
} satisfies Prisma.MembershipSelect;

const memberRef = (m: { userId: string; user: { name: string } }): MemberRef => ({
  userId: m.userId,
  name: m.user.name,
});

/** The firm's active members, by name. */
export async function activeMembers(tx: TxClient, businessId: string): Promise<MemberRef[]> {
  const rows = await tx.membership.findMany({
    where: { businessId, status: 'ACTIVE' },
    select: memberSelect,
  });
  return rows
    .map(memberRef)
    .sort((a, b) => a.name.localeCompare(b.name) || a.userId.localeCompare(b.userId));
}

/** An active member of this firm, else 404 (another firm's, a former member, or no one). */
export async function activeMember(
  tx: TxClient,
  businessId: string,
  userId: string,
): Promise<MemberRef> {
  const row = await tx.membership.findFirst({
    where: { businessId, userId, status: 'ACTIVE' },
    select: memberSelect,
  });
  if (!row) throw errors.notFound();
  return memberRef(row);
}

/** Names of this firm's members (any status: a former member keeps their name). */
export async function memberNames(
  tx: TxClient,
  businessId: string,
  userIds: readonly string[],
): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const rows = await tx.membership.findMany({
    where: { businessId, userId: { in: [...new Set(userIds)] } },
    select: memberSelect,
  });
  return new Map(rows.map((m) => [m.userId, m.user.name]));
}

export const appointmentSelect = {
  id: true,
  clientId: true,
  staffUserId: true,
  typeId: true,
  engagementId: true,
  startsAt: true,
  endsAt: true,
  status: true,
  locationKind: true,
  locationDetails: true,
  bookedByClient: true,
  rescheduleCount: true,
  cancelledAt: true,
  cancelReason: true,
  createdAt: true,
  client: { select: { displayName: true, assignedUserId: true } },
  staff: { select: memberSelect },
  type: { select: { id: true, name: true } },
} satisfies Prisma.AppointmentSelect;

export type AppointmentRow = Prisma.AppointmentGetPayload<{ select: typeof appointmentSelect }>;

export function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    client: { id: row.clientId, displayName: row.client.displayName },
    staff: memberRef(row.staff),
    type: row.type ? { id: row.type.id, name: row.type.name } : null,
    engagementId: row.engagementId,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
    locationKind: row.locationKind,
    locationDetails: row.locationDetails,
    bookedByClient: row.bookedByClient,
    rescheduleCount: row.rescheduleCount,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdAt: row.createdAt.toISOString(),
  };
}

/** What Staff see of an appointment that is not theirs or their client's. */
export function toBusy(row: AppointmentRow): BusyAppointment {
  return {
    restricted: true,
    id: row.id,
    staff: memberRef(row.staff),
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    status: row.status,
  };
}

/**
 * The calendar rule (#63, R12 Decisions): Owner and Admin see every appointment in full; Staff
 * the ones they are the staff member of, or whose client is assigned to them.
 */
export function seesInFull(actor: FirmActor, row: AppointmentRow): boolean {
  return (
    actor.role !== 'STAFF' ||
    row.staffUserId === actor.userId ||
    row.client.assignedUserId === actor.userId
  );
}

/** The same rule as a filter, for the routes that read or change one appointment. */
export function inFullWhere(actor: FirmActor): Prisma.AppointmentWhereInput {
  return actor.role === 'STAFF'
    ? { OR: [{ staffUserId: actor.userId }, { client: { assignedUserId: actor.userId } }] }
    : {};
}

/** Every member's regular week, by user id; ranges by weekday and start. */
export async function workingHours(
  tx: TxClient,
  businessId: string,
  userIds: readonly string[],
): Promise<Map<string, WorkingRange[]>> {
  const rows = await tx.workingHours.findMany({
    where: { businessId, userId: { in: [...userIds] } },
    orderBy: [{ weekday: 'asc' }, { startsAt: 'asc' }],
    select: { userId: true, weekday: true, startsAt: true, endsAt: true },
  });
  const hours = new Map<string, WorkingRange[]>(userIds.map((id) => [id, []]));
  for (const r of rows) {
    hours.get(r.userId)?.push({
      weekday: r.weekday,
      startsAt: timeOfDayFromDb(r.startsAt),
      endsAt: timeOfDayFromDb(r.endsAt),
    });
  }
  return hours;
}

/** What makes the firm's members busy in a span of time. */
export interface BusyTimes {
  /** Live appointments: every status but CANCELLED, as the exclusion constraints count them. */
  appointments: { id: string; staffUserId: string; clientId: string; start: number; end: number }[];
  /** Blocked time; userId null blocks the whole firm. */
  blocks: { userId: string | null; start: number; end: number }[];
}

export async function busyTimes(
  tx: TxClient,
  businessId: string,
  span: Interval,
): Promise<BusyTimes> {
  const touching = { startsAt: { lt: new Date(span.end) }, endsAt: { gt: new Date(span.start) } };
  // One after the other: a transaction runs its queries on one connection.
  const appointments = await tx.appointment.findMany({
    where: { businessId, status: { not: 'CANCELLED' }, ...touching },
    select: { id: true, staffUserId: true, clientId: true, startsAt: true, endsAt: true },
  });
  const blocks = await tx.blockedTime.findMany({
    where: { businessId, ...touching },
    select: { userId: true, startsAt: true, endsAt: true },
  });
  return {
    appointments: appointments.map((a) => ({
      id: a.id,
      staffUserId: a.staffUserId,
      clientId: a.clientId,
      start: a.startsAt.getTime(),
      end: a.endsAt.getTime(),
    })),
    blocks: blocks.map((b) => ({
      userId: b.userId,
      start: b.startsAt.getTime(),
      end: b.endsAt.getTime(),
    })),
  };
}

/** One member's busy times: their live appointments (but `exceptId`) and their or the firm's blocks. */
export function memberBusy(busy: BusyTimes, userId: string, exceptId?: string): Interval[] {
  return [
    ...busy.appointments.filter((a) => a.staffUserId === userId && a.id !== exceptId),
    ...busy.blocks.filter((b) => b.userId === null || b.userId === userId),
  ];
}

/** One client's live appointments (but `exceptId`): a client is in one meeting at a time. */
export function clientBusy(busy: BusyTimes, clientId: string, exceptId?: string): Interval[] {
  return busy.appointments.filter((a) => a.clientId === clientId && a.id !== exceptId);
}

/** From the firm-local start of `from` to the end of `to` (both YYYY-MM-DD, included). */
export function dateSpan(timeZone: string, from: string, to: string): Interval {
  return { start: zonedInstant(timeZone, from, 0), end: zonedInstant(timeZone, addDays(to, 1), 0) };
}
