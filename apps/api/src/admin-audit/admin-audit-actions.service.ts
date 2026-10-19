import { BadRequestException, Injectable } from '@nestjs/common';
import { databaseErrorCode, type TxClient } from '@firmivra/db';
import type {
  AdminAssignAlertRequest,
  AdminAuditNote,
  AdminAuditNoteRequest,
  AdminAuditRespondRequest,
  AdminAuditRespondResult,
  AdminCloseAlertRequest,
  AdminSecurityAlert,
  AdminSecurityAlertPage,
  AdminSecurityAlertQuery,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { notFound } from '../workspaces/common.js';
import {
  AdminAuditService,
  alertSelect,
  type AlertRow,
  eventSelect,
} from './admin-audit.service.js';
import { conflict, writeAdminEvent } from './admin-audit.common.js';
import { actionLabel, classify } from './classify.js';

type Out<S extends z.ZodType> = z.output<S>;

const alertState = (message = 'This alert is closed and never changes') =>
  conflict('ALERT_STATE', message);
const noteState = (message: string) => conflict('NOTE_STATE', message);

/** The database refused an alert move (its trigger) as 409 ALERT_STATE, never a 500. */
const isCheck = (e: unknown) =>
  databaseErrorCode(e) === '23514' ||
  /security alerts?:/i.test(String((e as Error)?.message ?? ''));

/**
 * What a Super Admin does about an event (R55): response actions, investigation notes and
 * security alerts. Each writes its own audit row naming the event; the event itself never changes.
 * Notes are additive (an edit supersedes, a retraction stamps); a closed alert never changes.
 */
@Injectable()
export class AdminAuditActionsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly events: AdminAuditService,
  ) {}

  // ---------- Response actions ----------

  async respond(
    id: string,
    body: Out<typeof AdminAuditRespondRequest>,
  ): Promise<AdminAuditRespondResult> {
    const adminUserId = this.admin.adminUserId;
    const made = await this.admin.transaction(async (tx) => {
      const row = await this.events.find(tx, id);
      const firmId = row.businessId ?? row.subjectBusinessId;
      const label = actionLabel(row.action);
      if (body.action === 'MARK_REVIEWED') {
        // One review per event: a repeat answers the first.
        const done = await tx.auditLog.findFirst({
          where: { parentEventId: id, action: 'audit.event_reviewed' },
          select: { id: true },
        });
        const review =
          done ??
          (await writeAdminEvent(tx, adminUserId, {
            action: 'audit.event_reviewed',
            entityType: 'audit_log',
            entityId: id,
            category: 'SYSTEM',
            severity: 'INFO',
            parentEventId: id,
            subjectBusinessId: firmId,
            targetLabel: label,
            metadata: { reasonGiven: !!body.reason },
          }));
        return { eventId: review.id, alertId: null };
      }
      if (body.action === 'SEND_ALERT') {
        const c = classify(row);
        const alert = await tx.securityAlert
          .create({
            data: {
              auditLogId: id,
              businessId: firmId,
              ruleId: 'manual.super_admin',
              severity: c.severity === 'INFO' || c.severity === 'LOW' ? 'MEDIUM' : c.severity,
              title: `Review: ${label}`.slice(0, 200),
              summary: body.reason?.slice(0, 2000) ?? null,
              riskScore: row.riskScore,
              eventKey: `manual:${id}`,
            },
            select: { id: true },
          })
          .catch((e: unknown) => {
            if ((e as { code?: string }).code === 'P2002')
              throw conflict('ACTION_UNAVAILABLE', 'An alert exists for this event');
            throw e;
          });
        const written = await writeAdminEvent(tx, adminUserId, {
          action: 'security_alert.created',
          entityType: 'security_alert',
          entityId: alert.id,
          category: 'SECURITY',
          severity: 'MEDIUM',
          parentEventId: id,
          subjectBusinessId: firmId,
          targetLabel: label,
          metadata: { alertId: alert.id, ruleId: 'manual.super_admin' },
        });
        return { eventId: written.id, alertId: alert.id };
      }
      throw conflict(
        'ACTION_UNAVAILABLE',
        body.action === 'DISABLE_INTEGRATION'
          ? 'Integrations are disabled from the Integrations module'
          : 'Firm accounts are changed from the firm (Staff Management) until the console has a path into them',
      );
    });
    return this.admin.transaction(async (tx) => {
      const [event] = await this.events.views(tx, [
        await tx.auditLog.findUniqueOrThrow({ where: { id: made.eventId }, select: eventSelect }),
      ]);
      let alert: AdminSecurityAlert | null = null;
      if (made.alertId) {
        const row = await tx.securityAlert.findUniqueOrThrow({
          where: { id: made.alertId },
          select: alertSelect,
        });
        alert = await this.alertOut(tx, row);
      }
      return { event: event!, alert };
    });
  }

  // ---------- Notes ----------

  private async noteOut(tx: TxClient, noteId: string): Promise<AdminAuditNote> {
    const n = await tx.auditInvestigationNote.findUniqueOrThrow({ where: { id: noteId } });
    const names = await this.events.adminNames([n.authorUserId]);
    return {
      id: n.id,
      author: { id: n.authorUserId, name: names.get(n.authorUserId) ?? 'Super Admin' },
      text: n.body,
      at: n.createdAt.toISOString(),
      supersedesId: n.supersedesNoteId,
      retractedAt: n.retractedAt?.toISOString() ?? null,
      isYours: n.authorUserId === this.admin.adminUserId,
    };
  }

  addNote(id: string, body: Out<typeof AdminAuditNoteRequest>): Promise<AdminAuditNote> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const row = await this.events.find(tx, id);
      const note = await tx.auditInvestigationNote.create({
        data: { auditLogId: id, authorUserId: adminUserId, body: body.text },
        select: { id: true },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'audit_note.created',
        entityType: 'audit_investigation_note',
        entityId: note.id,
        category: 'SYSTEM',
        severity: 'INFO',
        parentEventId: id,
        subjectBusinessId: row.businessId ?? row.subjectBusinessId,
        metadata: { length: body.text.length },
      });
      return this.noteOut(tx, note.id);
    });
  }

  /** A correction: a new note by the same author that supersedes theirs. */
  editNote(noteId: string, body: Out<typeof AdminAuditNoteRequest>): Promise<AdminAuditNote> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const old = await tx.auditInvestigationNote.findUnique({
        where: { id: noteId },
        include: { supersededBy: { select: { id: true } } },
      });
      if (!old) throw notFound();
      if (old.authorUserId !== adminUserId) throw noteState('Only its author corrects a note');
      if (old.retractedAt) throw noteState('This note was retracted');
      if (old.supersededBy)
        throw noteState('This note was corrected already: correct the newer one');
      const note = await tx.auditInvestigationNote.create({
        data: {
          auditLogId: old.auditLogId,
          authorUserId: adminUserId,
          body: body.text,
          supersedesNoteId: noteId,
        },
        select: { id: true },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'audit_note.edited',
        entityType: 'audit_investigation_note',
        entityId: note.id,
        category: 'SYSTEM',
        severity: 'INFO',
        parentEventId: old.auditLogId,
        metadata: { supersedesNoteId: noteId, length: body.text.length },
      });
      return this.noteOut(tx, note.id);
    });
  }

  retractNote(noteId: string): Promise<AdminAuditNote> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const old = await tx.auditInvestigationNote.findUnique({ where: { id: noteId } });
      if (!old) throw notFound();
      if (old.authorUserId !== adminUserId) throw noteState('Only its author retracts a note');
      if (old.retractedAt) throw noteState('This note was retracted already');
      await tx.auditInvestigationNote.update({
        where: { id: noteId },
        data: { retractedAt: new Date() },
      });
      await writeAdminEvent(tx, adminUserId, {
        action: 'audit_note.retracted',
        entityType: 'audit_investigation_note',
        entityId: noteId,
        category: 'SYSTEM',
        severity: 'INFO',
        parentEventId: old.auditLogId,
      });
      return this.noteOut(tx, noteId);
    });
  }

  // ---------- Alerts ----------

  private async alertOut(tx: TxClient, a: AlertRow): Promise<AdminSecurityAlert> {
    const firm = a.businessId
      ? await tx.business.findUnique({
          where: { id: a.businessId },
          select: { id: true, name: true },
        })
      : null;
    const names = await this.events.adminNames([a.assignedToUserId]);
    return this.events.alertView(
      a,
      firm ? { id: firm.id, name: firm.name } : { id: null, name: 'Firmivra' },
      names,
    );
  }

  async alerts(q: Out<typeof AdminSecurityAlertQuery>): Promise<AdminSecurityAlertPage> {
    return this.admin.transaction(async (tx) => {
      const where = {
        ...(q.status ? { status: q.status } : {}),
        ...(q.severity ? { severity: q.severity } : {}),
        ...(q.firm === 'platform' ? { businessId: null } : q.firm ? { businessId: q.firm } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.securityAlert.count({ where }),
        tx.securityAlert.findMany({
          where,
          select: alertSelect,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const firmIds = [...new Set(rows.map((r) => r.businessId).filter((x): x is string => !!x))];
      const firms = new Map(
        (firmIds.length
          ? await tx.business.findMany({
              where: { id: { in: firmIds } },
              select: { id: true, name: true },
            })
          : []
        ).map((f) => [f.id, f.name]),
      );
      const names = await this.events.adminNames(rows.map((r) => r.assignedToUserId));
      return {
        items: rows.map((r) =>
          this.events.alertView(
            r,
            r.businessId
              ? { id: r.businessId, name: firms.get(r.businessId) ?? 'Unknown firm' }
              : { id: null, name: 'Firmivra' },
            names,
          ),
        ),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  /** A status move (the database stamps who and when), with its audit row. */
  private move(
    id: string,
    to: 'ACKNOWLEDGED' | 'RESOLVED' | 'DISMISSED',
    note?: string,
  ): Promise<AdminSecurityAlert> {
    const adminUserId = this.admin.adminUserId;
    return this.admin
      .transaction(async (tx) => {
        const a = await tx.securityAlert.findUnique({ where: { id }, select: alertSelect });
        if (!a) throw notFound();
        const allowed =
          a.status === 'OPEN' || (a.status === 'ACKNOWLEDGED' && to !== 'ACKNOWLEDGED');
        if (!allowed) throw alertState();
        await tx.securityAlert.update({
          where: { id },
          data: { status: to, ...(to !== 'ACKNOWLEDGED' && note ? { resolutionNote: note } : {}) },
        });
        await writeAdminEvent(tx, adminUserId, {
          action: `security_alert.${to.toLowerCase()}`,
          entityType: 'security_alert',
          entityId: id,
          category: 'SECURITY',
          severity: 'INFO',
          parentEventId: a.auditLogId,
          subjectBusinessId: a.businessId,
          metadata: { from: a.status, to, noteGiven: !!note },
        });
        return this.alertOut(
          tx,
          await tx.securityAlert.findUniqueOrThrow({ where: { id }, select: alertSelect }),
        );
      })
      .catch((e: unknown) => {
        if (isCheck(e)) throw alertState('This alert cannot make that move');
        throw e;
      });
  }

  acknowledge(id: string) {
    return this.move(id, 'ACKNOWLEDGED');
  }

  resolve(id: string, note: string) {
    return this.move(id, 'RESOLVED', note);
  }

  dismiss(id: string, body: Out<typeof AdminCloseAlertRequest>) {
    return this.move(id, 'DISMISSED', body.note);
  }

  /** Assign to a Super Admin, or unassign. A closed alert never changes. */
  assign(id: string, body: Out<typeof AdminAssignAlertRequest>): Promise<AdminSecurityAlert> {
    const adminUserId = this.admin.adminUserId;
    return this.admin.transaction(async (tx) => {
      const a = await tx.securityAlert.findUnique({ where: { id }, select: alertSelect });
      if (!a) throw notFound();
      if (a.status === 'RESOLVED' || a.status === 'DISMISSED') throw alertState();
      if (body.userId) {
        const admin = await tx.platformAdmin.findUnique({
          where: { userId: body.userId },
          select: { role: true },
        });
        if (admin?.role !== 'SUPER_ADMIN')
          throw new BadRequestException({
            code: 'VALIDATION_FAILED',
            message: 'Assign the alert to a Super Admin',
            details: [{ path: 'userId', message: 'Choose a Super Admin' }],
          });
      }
      await tx.securityAlert.update({ where: { id }, data: { assignedToUserId: body.userId } });
      await writeAdminEvent(tx, adminUserId, {
        action: 'security_alert.assigned',
        entityType: 'security_alert',
        entityId: id,
        category: 'SECURITY',
        severity: 'INFO',
        parentEventId: a.auditLogId,
        subjectBusinessId: a.businessId,
        metadata: { assignedToUserId: body.userId },
      });
      return this.alertOut(
        tx,
        await tx.securityAlert.findUniqueOrThrow({ where: { id }, select: alertSelect }),
      );
    });
  }
}
