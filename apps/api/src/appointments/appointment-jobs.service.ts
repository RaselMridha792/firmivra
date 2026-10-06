import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import { Prisma, type Database, type TxClient } from '@firmivra/db';
import { z } from 'zod';
import { DATABASE } from '../database/database.module.js';
import { AuditService } from '../audit/audit.service.js';
import { requestContext } from '../common/request-context.js';
import { requireTables } from '../firm-common/schema.js';
import { SqlRecords, camelRecord } from '../firm-common/sql-records.js';
import { AppointmentNotifier, type AppointmentNotice } from './appointment.ports.js';
import type { AppointmentRow } from './appointments.service.js';
type Job = {
  id: string;
  appointmentId: string;
  appointmentVersion: number;
  recipientUserId: string;
  kind: AppointmentNotice['kind'];
  eventKey: string;
  status: string;
  leaseToken: string | null;
  attempts: number;
};
@Injectable()
export class AppointmentJobs {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly notifier: AppointmentNotifier,
    private readonly audit: AuditService,
  ) {}
  async schedule(
    tx: TxClient,
    records: SqlRecords,
    row: AppointmentRow,
    kind: Exclude<AppointmentNotice['kind'], 'REMINDER'>,
  ) {
    await tx.$executeRaw`UPDATE appointment_reminders SET status='CANCELLED',lease_token=NULL,lease_until=NULL WHERE business_id=${records.businessId}::uuid AND appointment_id=${row.id}::uuid AND status IN ('PENDING','PROCESSING')`;
    const provider = await tx.membership.findFirst({
      where: { businessId: records.businessId, id: row.providerMembershipId, status: 'ACTIVE' },
      select: { userId: true },
    });
    const clients = await tx.clientAccount.findMany({
      where: { businessId: records.businessId, clientId: row.clientId, status: 'ACTIVE' },
      select: { userId: true },
      take: 101,
    });
    if (clients.length > 100) throw new Error('Too many notification recipients');
    const recipients = [
      ...new Set([
        ...(provider ? [provider.userId] : []),
        ...clients.map((client) => client.userId),
      ]),
    ];
    const now = Date.now(),
      due: [AppointmentNotice['kind'], number][] = [[kind, now]];
    // Explicit beta defaults; Rasel/Fahad can replace these with firm reminder policy.
    if (row.status === 'BOOKED')
      for (const minutes of [1440, 60]) {
        const instant = new Date(row.startsAt).getTime() - minutes * 60_000;
        if (instant > now) due.push(['REMINDER', instant]);
      }
    for (const userId of recipients)
      for (const [jobKind, instant] of due)
        await records.insert('appointment_reminders', {
          appointmentId: row.id,
          appointmentVersion: row.version,
          recipientUserId: userId,
          kind: jobKind,
          eventKey: `appointment:${row.id}:${row.version}:${userId}:${jobKind}:${instant}`,
          dueAt: new Date(instant).toISOString(),
          nextAttemptAt: new Date(instant).toISOString(),
          status: 'PENDING',
        });
  }
  /** Internal worker entry point. Scheduler supplies trusted firm ids; no platform tenant-data scans. */
  async runDue(businessId: string, limit = 20) {
    z.uuid().parse(businessId);
    z.number().int().min(1).max(100).parse(limit);
    const jobs = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await requireTables(tx, ['appointment_reminders', 'appointments']);
      const settings = await tx.businessSettings.findUnique({
        where: { businessId },
        select: { enabledModules: true },
      });
      const firm = await tx.business.findUnique({
        where: { id: businessId },
        select: { status: true },
      });
      if (firm?.status !== 'ACTIVE' || !settings?.enabledModules.includes('appointments'))
        return [];
      const rows = await tx.$queryRaw<{ row: Record<string, unknown> }[]>(
        Prisma.sql`SELECT to_jsonb(j) AS row FROM appointment_reminders j WHERE business_id=${businessId}::uuid AND due_at<=now() AND next_attempt_at<=now() AND (status='PENDING' OR (status='PROCESSING' AND lease_until<now())) ORDER BY due_at,id LIMIT ${limit} FOR UPDATE SKIP LOCKED`,
      );
      const records = new SqlRecords(tx, businessId),
        claimed: Job[] = [];
      for (const item of rows) {
        const job = camelRecord<Job>(item.row);
        claimed.push(
          await records.patch<Job>('appointment_reminders', job.id, {
            status: 'PROCESSING',
            leaseToken: randomUUID(),
            leaseUntil: new Date(Date.now() + 300_000).toISOString(),
            attempts: job.attempts + 1,
          }),
        );
      }
      return claimed;
    });
    let queued = 0;
    for (const job of jobs) {
      try {
        const outcome = await this.db.withScope({ kind: 'business', businessId }, async (tx) => {
          await tx.$queryRaw`SELECT id FROM businesses WHERE id=${businessId}::uuid FOR UPDATE`;
          const rows = await tx.$queryRaw<
            { row: Record<string, unknown> }[]
          >`SELECT to_jsonb(j) AS row FROM appointment_reminders j WHERE business_id=${businessId}::uuid AND id=${job.id}::uuid FOR UPDATE`;
          const current = rows[0] ? camelRecord<Job>(rows[0].row) : null;
          if (!current || current.status !== 'PROCESSING' || current.leaseToken !== job.leaseToken)
            return false;
          const records = new SqlRecords(tx, businessId),
            appointment = await records.one<AppointmentRow>('appointments', job.appointmentId);
          const member = await tx.membership.findFirst({
            where: {
              businessId,
              id: appointment.providerMembershipId,
              userId: job.recipientUserId,
              status: 'ACTIVE',
            },
            select: { id: true },
          });
          const client = member
            ? null
            : await tx.clientAccount.findFirst({
                where: {
                  businessId,
                  clientId: appointment.clientId,
                  userId: job.recipientUserId,
                  status: 'ACTIVE',
                },
                select: { id: true },
              });
          const canonical = await tx.client.findFirst({
            where: { businessId, id: appointment.clientId, archivedAt: null },
            select: { id: true },
          });
          const settings = await tx.businessSettings.findUnique({
            where: { businessId },
            select: { enabledModules: true },
          });
          const business = await tx.business.findUnique({
            where: { id: businessId },
            select: { status: true },
          });
          const stale =
            appointment.version !== job.appointmentVersion ||
            (job.kind === 'CANCELLED'
              ? appointment.status !== 'CANCELLED'
              : appointment.status !== 'BOOKED') ||
            !canonical ||
            (!member && !client) ||
            business?.status !== 'ACTIVE' ||
            !settings?.enabledModules.includes('appointments') ||
            (job.kind === 'REMINDER' && new Date(appointment.startsAt).getTime() <= Date.now());
          if (stale) {
            await records.patch('appointment_reminders', job.id, {
              status: 'CANCELLED',
              leaseToken: null,
              leaseUntil: null,
            });
            return false;
          }
          await this.notifier.enqueue({
            businessId,
            appointmentId: job.appointmentId,
            appointmentVersion: job.appointmentVersion,
            recipientUserId: job.recipientUserId,
            eventKey: job.eventKey,
            kind: job.kind,
            template: 'appointment-update',
          });
          await records.patch('appointment_reminders', job.id, {
            status: 'QUEUED',
            leaseToken: null,
            leaseUntil: null,
            lastErrorCode: null,
          });
          return true;
        });
        if (outcome) {
          queued++;
          await requestContext.run(
            { requestId: randomUUID(), tenant: { businessId, kind: 'staff', role: 'STAFF' } },
            () =>
              this.audit.log(
                'appointment.notice_queued',
                { type: 'appointment', id: job.appointmentId },
                { kind: job.kind, version: job.appointmentVersion },
              ),
          );
        }
      } catch {
        // Never store exception messages: providers may include addresses, secrets or request payloads.
        await this.db.withScope(
          { kind: 'business', businessId },
          (tx) =>
            tx.$executeRaw`UPDATE appointment_reminders SET status='PENDING',lease_token=NULL,lease_until=NULL,last_error_code='DELIVERY_UNAVAILABLE',next_attempt_at=${new Date(Date.now() + Math.min(60, 2 ** Math.min(job.attempts, 6)) * 60_000)} WHERE business_id=${businessId}::uuid AND id=${job.id}::uuid AND lease_token=${job.leaseToken}::uuid AND status='PROCESSING'`,
        );
      }
    }
    return { claimed: jobs.length, queued };
  }
}
