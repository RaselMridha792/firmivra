import type { AppointmentAction, AppointmentEvent } from '@firmivra/types';
import { z } from 'zod';

// An appointment's history without a table of its own (R12 Decisions): each book, reschedule,
// cancel, complete and no-show writes one audit row, and the detail reads them back. The rows
// hold ids and times only: who acted is the row's actor, names are looked up when read, and a
// cancel's reason stays on the appointment row (it may be client data), never in the audit log.

/** The audit action of each kind of change. */
export const AUDIT_ACTIONS = {
  BOOKED: 'appointment.booked',
  RESCHEDULED: 'appointment.rescheduled',
  CANCELLED: 'appointment.cancelled',
  COMPLETED: 'appointment.completed',
  NO_SHOW: 'appointment.no_show',
} as const satisfies Record<AppointmentAction, string>;

const ACTION_OF = new Map<string, AppointmentAction>(
  Object.entries(AUDIT_ACTIONS).map(([action, audit]) => [audit, action as AppointmentAction]),
);
export const HISTORY_AUDIT_ACTIONS: string[] = Object.values(AUDIT_ACTIONS);

/** Where an appointment was before or after a change: times and the staff member's id. */
const Placement = z.object({
  startsAt: z.string(),
  endsAt: z.string(),
  staffUserId: z.string(),
});
export type Placement = z.infer<typeof Placement>;

/** What an appointment's audit row holds. */
export const HistoryMetadata = z.object({
  by: z.enum(['STAFF', 'CLIENT']),
  clientId: z.string(),
  from: Placement.nullable(),
  to: Placement.nullable(),
  /** Cancel only: whether a reason was given (its text stays on the appointment). */
  reasonGiven: z.boolean().optional(),
});
export type HistoryMetadata = z.infer<typeof HistoryMetadata>;

export const placement = (a: { startsAt: Date; endsAt: Date; staffUserId: string }): Placement => ({
  startsAt: a.startsAt.toISOString(),
  endsAt: a.endsAt.toISOString(),
  staffUserId: a.staffUserId,
});

export interface HistoryRow {
  action: string;
  createdAt: Date;
  actorUserId: string | null;
  metadata: unknown;
}

export interface HistoryNames {
  /** Who acted, by user id (staff and client logins of this firm). */
  users: ReadonlyMap<string, string>;
  /** Staff members by user id (a former member keeps their name). */
  members: ReadonlyMap<string, string>;
  /** Shown for a client whose login is gone. */
  clientName: string;
}

/** User ids the history needs names for: the actors and the staff members before and after. */
export function historyUserIds(rows: readonly HistoryRow[]): { actors: string[]; staff: string[] } {
  const actors = new Set<string>();
  const staff = new Set<string>();
  for (const row of rows) {
    if (row.actorUserId) actors.add(row.actorUserId);
    const meta = HistoryMetadata.safeParse(row.metadata);
    if (!meta.success) continue;
    for (const p of [meta.data.from, meta.data.to]) if (p) staff.add(p.staffUserId);
  }
  return { actors: [...actors], staff: [...staff] };
}

/**
 * The events, oldest first, from the appointment's audit rows. Rows of other actions and rows
 * whose metadata is not a history entry are skipped. `cancelReason` is the appointment's own
 * (cancelling is final, so there is one cancel event).
 */
export function historyEvents(
  rows: readonly HistoryRow[],
  names: HistoryNames,
  cancelReason: string | null,
): AppointmentEvent[] {
  const events: AppointmentEvent[] = [];
  const at = (p: Placement | null) =>
    p && {
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      staff: { userId: p.staffUserId, name: names.members.get(p.staffUserId) ?? 'Former member' },
    };
  for (const row of [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())) {
    const action = ACTION_OF.get(row.action);
    const meta = HistoryMetadata.safeParse(row.metadata);
    if (!action || !meta.success) continue;
    const actor = row.actorUserId ? names.users.get(row.actorUserId) : undefined;
    events.push({
      at: row.createdAt.toISOString(),
      action,
      by: {
        kind: meta.data.by,
        name: actor ?? (meta.data.by === 'CLIENT' ? names.clientName : 'Former member'),
      },
      from: at(meta.data.from),
      to: at(meta.data.to),
      reason: action === 'CANCELLED' ? cancelReason : null,
    });
  }
  return events;
}
