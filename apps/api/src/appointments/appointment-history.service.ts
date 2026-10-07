import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import type { AppointmentAction, AppointmentEvent } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { type AppointmentRow, memberNames } from './calendar-data.js';
import {
  AUDIT_ACTIONS,
  HISTORY_AUDIT_ACTIONS,
  type HistoryMetadata,
  historyEvents,
  historyUserIds,
  placement,
} from './history.js';

type Placed = { startsAt: Date; endsAt: Date; staffUserId: string };

/** History rows are read from this long before the appointment's creation time. */
const HISTORY_CLOCK_SLACK_MS = 60_000;

/**
 * Writes and reads an appointment's history (R12 Decisions: no table of its own). Each change
 * is one audit row: the actor from the request, and in the metadata who acted (staff or the
 * client), the client's id and the times and staff member before and after. Never names, and
 * never the reason's text.
 */
@Injectable()
export class AppointmentHistory {
  constructor(private readonly audit: AuditService) {}

  async record(
    action: AppointmentAction,
    appointment: { id: string; clientId: string },
    change: { by: 'STAFF' | 'CLIENT'; from: Placed | null; to: Placed | null; reason?: unknown },
  ): Promise<void> {
    const metadata: HistoryMetadata = {
      by: change.by,
      clientId: appointment.clientId,
      from: change.from && placement(change.from),
      to: change.to && placement(change.to),
      ...(action === 'CANCELLED' ? { reasonGiven: typeof change.reason === 'string' } : {}),
    };
    await this.audit.log(
      AUDIT_ACTIONS[action],
      { type: 'appointment', id: appointment.id },
      metadata,
    );
  }

  /** The appointment's changes, oldest first, with the names of who acted and of staff. */
  async events(
    tx: TxClient,
    businessId: string,
    appointment: AppointmentRow,
  ): Promise<AppointmentEvent[]> {
    const rows = await tx.auditLog.findMany({
      where: {
        businessId,
        // audit_logs is indexed on (business_id, created_at) only; every history row is written
        // after the appointment's own insert, so this keeps the scan to the rows since then (a
        // minute earlier, in case another API task's clock is a little behind).
        createdAt: { gte: new Date(appointment.createdAt.getTime() - HISTORY_CLOCK_SLACK_MS) },
        entityType: 'appointment',
        entityId: appointment.id,
        action: { in: HISTORY_AUDIT_ACTIONS },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { action: true, createdAt: true, actorUserId: true, metadata: true },
    });
    const ids = historyUserIds(rows);
    // Row-level security shows only users linked to this firm (its members and client logins).
    const users =
      ids.actors.length === 0
        ? []
        : await tx.user.findMany({
            where: { id: { in: ids.actors } },
            select: { id: true, name: true },
          });
    return historyEvents(
      rows,
      {
        users: new Map(users.map((u) => [u.id, u.name])),
        members: await memberNames(tx, businessId, ids.staff),
        clientName: appointment.client.displayName,
      },
      appointment.cancelReason,
    );
  }
}
