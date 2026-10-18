import type { Prisma, TxClient } from '@firmivra/db';
import type {
  AgendaItem,
  AppointmentContact,
  AppointmentRecord,
  BusyAgendaItem,
  MemberRef,
} from '@firmivra/types';
import { appointmentSelect, type FirmActor, seesInFull } from './calendar-data.js';
import {
  colorHex,
  displayStatus,
  methodOf,
  reminderFromOffset,
  versionOf,
} from './scheduling-map.js';

// The rows and shapes of the scheduling screens (contract in
// packages/types/src/appointments/scheduling.ts). They read the same appointment records as R12's
// calendar: appointmentSelect plus what the screens add.

export const schedulingSelect = {
  ...appointmentSelect,
  serviceId: true,
  timeZone: true,
  allDay: true,
  color: true,
  internalNotes: true,
  clientInstructions: true,
  confirmedAt: true,
  rescheduledAt: true,
  officeId: true,
  roomId: true,
  seriesId: true,
  updatedAt: true,
  bufferBeforeMinutes: true,
  bufferAfterMinutes: true,
  client: {
    select: {
      displayName: true,
      assignedUserId: true,
      email: true,
      phone: true,
      accountType: true,
    },
  },
  type: { select: { id: true, name: true, color: true } },
  service: { select: { id: true, name: true } },
  office: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
  reminders: {
    select: { channel: true, offsetMinutes: true },
    orderBy: [{ offsetMinutes: 'desc' }, { channel: 'asc' }],
  },
  series: {
    select: {
      frequency: true,
      intervalCount: true,
      byWeekdays: true,
      untilDate: true,
      occurrenceCount: true,
    },
  },
} satisfies Prisma.AppointmentSelect;

export type SchedulingRow = Prisma.AppointmentGetPayload<{ select: typeof schedulingSelect }>;

const memberRef = (m: { userId: string; user: { name: string } }): MemberRef => ({
  userId: m.userId,
  name: m.user.name,
});

export function contactOf(row: SchedulingRow): AppointmentContact {
  const business = row.client.accountType === 'BUSINESS';
  return {
    kind: 'CLIENT',
    id: row.clientId,
    name: row.client.displayName,
    businessName: business ? row.client.displayName : null,
    email: row.client.email,
    phone: row.client.phone,
    clientType: row.client.accountType,
  };
}

/** The appointment's colour, else its type's; null falls back to the status colour. */
const colorOf = (row: SchedulingRow): string | null =>
  colorHex(row.color) ?? colorHex(row.type?.color);

/** A video link is shown only for a VIDEO appointment with details that are a web address. */
function videoUrlOf(row: SchedulingRow): string | null {
  if (row.locationKind !== 'VIDEO' || !row.locationDetails) return null;
  return /^https:\/\//i.test(row.locationDetails) ? row.locationDetails : null;
}

export function toAgendaItem(row: SchedulingRow): AgendaItem {
  return {
    restricted: false,
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    allDay: row.allDay,
    contact: contactOf(row),
    service: row.service ? { id: row.service.id, name: row.service.name } : null,
    type: row.type ? { id: row.type.id, name: row.type.name } : null,
    status: displayStatus(row),
    staff: [memberRef(row.staff)],
    method: methodOf(row.locationKind),
    place: {
      office: row.office ? { id: row.office.id, name: row.office.name } : null,
      room: row.room ? { id: row.room.id, name: row.room.name } : null,
      // The address or phone number; a video address is `videoUrl`'s.
      details: videoUrlOf(row) ? null : row.locationDetails,
    },
    videoUrl: videoUrlOf(row),
    color: colorOf(row),
    // An appointment always has a client for now (internal meetings need a schema change).
    internal: false,
  };
}

export function toBusyItem(row: SchedulingRow): BusyAgendaItem {
  return {
    restricted: true,
    id: row.id,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt.toISOString(),
    staff: [memberRef(row.staff)],
    status: displayStatus(row),
  };
}

/** In full for Owner, Admin and the staff member or the assigned member; Busy otherwise. */
export const toEntry = (actor: FirmActor, row: SchedulingRow): AgendaItem | BusyAgendaItem =>
  seesInFull(actor, row) ? toAgendaItem(row) : toBusyItem(row);

/**
 * The detail record. What the database does not keep yet is empty, not invented: related items
 * (no link columns), delivery history (no notices table) and a recurrence that cannot be read
 * back from a series with a rule the screens do not know.
 */
export function toRecord(
  row: SchedulingRow,
  timezone: string,
  history: AppointmentRecord['history'],
): AppointmentRecord {
  const series = row.series;
  return {
    ...toAgendaItem(row),
    timezone: row.timeZone ?? timezone,
    internalNotes: row.internalNotes,
    clientInstructions: row.clientInstructions,
    related: {
      taxReturn: null,
      bookkeepingEngagement: null,
      invoice: null,
      task: null,
      intakeForm: null,
      documentRequest: null,
    },
    reminders: row.reminders.map((r) => reminderFromOffset(r.channel, r.offsetMinutes)),
    recurrence: series
      ? {
          frequency: series.frequency,
          interval: series.intervalCount,
          ...(series.byWeekdays.length > 0 ? { weekdays: series.byWeekdays } : {}),
          ...(series.untilDate ? { until: series.untilDate.toISOString().slice(0, 10) } : {}),
          ...(series.occurrenceCount ? { count: series.occurrenceCount } : {}),
        }
      : null,
    seriesId: row.seriesId,
    history,
    notices: [],
    createdAt: row.createdAt.toISOString(),
    version: versionOf(row.updatedAt),
  };
}

/** One appointment the member sees in full (else 404), for the record and the actions. */
export async function findSchedulingRow(
  tx: TxClient,
  businessId: string,
  actor: FirmActor,
  id: string,
): Promise<SchedulingRow | null> {
  return tx.appointment.findFirst({
    where: {
      businessId,
      id,
      ...(actor.role === 'STAFF'
        ? { OR: [{ staffUserId: actor.userId }, { client: { assignedUserId: actor.userId } }] }
        : {}),
    },
    select: schedulingSelect,
  });
}
