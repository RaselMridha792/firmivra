import type { TxClient } from '@firmivra/db';
import { databaseErrorCode } from '@firmivra/db';
import { conflict } from './leads.service.js';

// P4-1 (Leads Review Two 17 and 26): what a lead's conversion carries to the new client in its own
// transaction, besides notes, tasks, tags, forms and files: the lead's own appointments, and its
// history in summary on the client's Activity timeline.

/** 409 when one of the lead's appointments meets one the client already has at that time. */
export const appointmentClash = () =>
  conflict(
    'SLOT_TAKEN',
    "The client already has an appointment at the time of one of this lead's appointments. " +
      'Move or cancel one of them first.',
  );

/** Whether the database refused the move because the client is double booked (23P01). */
export const isClientClash = (error: unknown) => databaseErrorCode(error) === '23P01';

/**
 * The lead's own appointments (no client yet) take the client: every one of them, cancelled and
 * past ones too, so the client's calendar and Activity keep the whole story. The lead stays on
 * each (where it came from); the database allows exactly this one change of client (empty to the
 * client, at the lead's conversion). 409 when a live one meets another of the client's then (the
 * database refuses a client's double booking). The count moved.
 */
export async function carryLeadAppointments(
  tx: TxClient,
  businessId: string,
  leadId: string,
  clientId: string,
): Promise<number> {
  const [clash] = await tx.$queryRaw<{ id: string }[]>`
    SELECT a.id::text AS id FROM appointments a
    JOIN appointments b ON b.business_id = a.business_id AND b.client_id = ${clientId}::uuid
      AND b.status <> 'CANCELLED'
      AND tstzrange(b.starts_at, b.ends_at, '[)') && tstzrange(a.starts_at, a.ends_at, '[)')
    WHERE a.business_id = ${businessId}::uuid AND a.lead_id = ${leadId}::uuid
      AND a.client_id IS NULL AND a.status <> 'CANCELLED'
    LIMIT 1`;
  if (clash) throw appointmentClash();
  const moved = await tx.appointment.updateMany({
    where: { businessId, leadId, clientId: null },
    data: { clientId },
  });
  return moved.count;
}

/** Which of the lead's history goes to the client's timeline (the Convert form's choices). */
export interface TimelineCarry {
  appointments: boolean;
  communications: boolean;
  notes: boolean;
}

type Kind = 'APPOINTMENT_SCHEDULED' | 'MEETING' | 'CALL' | 'EMAIL_SENT' | 'SMS_SENT' | 'NOTE';

/**
 * Each lead activity worth showing, as the client's timeline shows it: its kind there, its title,
 * and whether its summary may go (a subject, a call's or meeting's summary, a type's name). A
 * text message's summary and a note's text are never copied: no message body goes.
 */
const SHOWN: Record<
  Kind,
  { kind: 'MEETING' | 'CALL' | 'EMAIL' | 'SMS' | 'NOTE'; title: string; summary: boolean }
> = {
  APPOINTMENT_SCHEDULED: {
    kind: 'MEETING',
    title: 'As a lead: appointment scheduled',
    summary: true,
  },
  MEETING: { kind: 'MEETING', title: 'As a lead: meeting', summary: true },
  CALL: { kind: 'CALL', title: 'As a lead: call', summary: true },
  EMAIL_SENT: { kind: 'EMAIL', title: 'As a lead: email sent', summary: true },
  SMS_SENT: { kind: 'SMS', title: 'As a lead: text message sent', summary: false },
  NOTE: { kind: 'NOTE', title: 'As a lead: note added', summary: false },
};

const GROUP: Record<Kind, keyof TimelineCarry> = {
  APPOINTMENT_SCHEDULED: 'appointments',
  MEETING: 'appointments',
  CALL: 'communications',
  EMAIL_SENT: 'communications',
  SMS_SENT: 'communications',
  NOTE: 'notes',
};

/** A summary the timeline keeps: one line, at most 500 characters, or none. */
function summaryOf(value: string | null): string | null {
  const line = value?.replace(/\s+/g, ' ').trim();
  return line ? Array.from(line).slice(0, 500).join('') : null;
}

/**
 * The lead's history in summary on the client's Activity timeline (client_timeline_entries,
 * insert-only): one entry per lead activity worth showing, at the time it happened and by whom,
 * with its title and a summary at most, never a message body. One entry per activity (the
 * database's unique source), so a retried conversion adds nothing. The counts written, by group.
 */
export async function carryLeadTimeline(
  tx: TxClient,
  businessId: string,
  leadId: string,
  clientId: string,
  carry: TimelineCarry,
): Promise<Record<keyof TimelineCarry, number>> {
  const kinds = (Object.keys(SHOWN) as Kind[]).filter((k) => carry[GROUP[k]]);
  const counts = { appointments: 0, communications: 0, notes: 0 };
  if (kinds.length === 0) return counts;
  const rows = await tx.leadActivity.findMany({
    where: { businessId, leadId, kind: { in: kinds } },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
    select: { id: true, kind: true, occurredAt: true, summary: true, actorUserId: true },
  });
  if (rows.length === 0) return counts;
  const written = await tx.clientTimelineEntry.createManyAndReturn({
    data: rows.map((r) => {
      const shown = SHOWN[r.kind as Kind];
      return {
        businessId,
        clientId,
        kind: shown.kind,
        sourceType: 'lead_activity',
        sourceId: r.id,
        title: shown.title,
        summary: shown.summary ? summaryOf(r.summary) : null,
        occurredAt: r.occurredAt,
        createdByUserId: r.actorUserId,
      };
    }),
    skipDuplicates: true,
    select: { sourceId: true },
  });
  const kindOf = new Map(rows.map((r) => [r.id, r.kind as Kind]));
  for (const w of written) {
    const kind = w.sourceId ? kindOf.get(w.sourceId) : undefined;
    if (kind) counts[GROUP[kind]] += 1;
  }
  return counts;
}
