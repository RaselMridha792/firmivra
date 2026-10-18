import { createHash, randomUUID } from 'node:crypto';
import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type AssignedFormEvent,
  type AssignedFormRecord,
  COUNTED_UPLOAD_STATUSES,
  type FormFileLink,
  type IntakeFormDefinition,
  type IntakeStatus,
  intakeFields,
  shownIntakeKeys,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { readDefinition } from '../intake/intake-forms.js';
import { maskStoredNumbers } from '../intake/intake-numbers.js';
import { REPORT_FILES, type ReportFiles } from '../reports/report-files.js';
import { checkAssignee, conflict, memberNames, notFound, toDay } from '../workspaces/common.js';
import { renderIntakePdf } from './intake-pdf.js';
import { endOfDay, IntakeSendService } from './intake-send.service.js';
import { rowInclude, toRow } from './intake-workspace.service.js';
import type { UpdateAssignedBody } from './workspace-input.js';
import { day, iso, reachOf } from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type EventKind = AssignedFormEvent['kind'];

/** Statuses a reminder or a resend reaches: the recipient can still fill the form in. */
const FILLABLE: IntakeStatus[] = ['SENT', 'IN_PROGRESS', 'NEEDS_CORRECTION'];
const SUBMITTED: IntakeStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];

const invalidStatus = () => conflict('INVALID_STATUS', 'Not possible in this status');
const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message });

const recordInclude = {
  ...rowInclude,
  form: {
    select: {
      ...rowInclude.form.select,
      version: true,
      definition: true,
      service: { select: { id: true, name: true, kind: true } },
    },
  },
  completedBy: { select: { userId: true, user: { select: { name: true } } } },
  submissions: {
    orderBy: { version: 'desc' },
    select: { version: true, answers: true, submittedAt: true },
  },
} satisfies Prisma.IntakeInclude;
type RecordRow = Prisma.IntakeGetPayload<{ include: typeof recordInclude }>;

/** What each audited action shows as in the history (the audit log keeps ids and field names). */
const EVENTS: Record<string, { kind: EventKind; label: string }> = {
  'intake.sent': { kind: 'SENT', label: 'Form sent' },
  'intake.resent': { kind: 'RESENT', label: 'Form resent' },
  'intake.reminded': { kind: 'REMINDER', label: 'Reminder sent' },
  'intake.step_saved': { kind: 'SAVED', label: 'Progress saved' },
  'intake.submitted': { kind: 'SUBMITTED', label: 'Form submitted' },
  'intake.review_started': { kind: 'REVIEW_STARTED', label: 'Review started' },
  'intake.correction_requested': { kind: 'REVISION_REQUESTED', label: 'Revision requested' },
  'intake.unlocked': { kind: 'REVISION_REQUESTED', label: 'Unlocked for changes' },
  'intake.completed': { kind: 'COMPLETED', label: 'Marked reviewed' },
  'intake.archived': { kind: 'ARCHIVED', label: 'Form archived' },
};
const COMMUNICATION: EventKind[] = ['SENT', 'RESENT', 'REMINDER'];

/** A stable id for an event read from the intake's own dates (no audit row behind it). */
function eventId(intakeId: string, kind: string, at: Date): string {
  const h = createHash('sha256').update(`${intakeId}:${kind}:${at.toISOString()}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const isEmpty = (v: unknown) =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/**
 * One assigned form (Frame 3): the record (header, Submission Summary, documents, history), the
 * row More menu (assign, dates, resend, remind, archive) and Export PDF. Staff reach the forms of
 * their own clients and leads and those assigned to them (404 otherwise). Notes need a table
 * (FormNote): the list is empty and adding one answers 503 NOTES_UNAVAILABLE.
 */
@Injectable()
export class IntakeRecordService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly sender: IntakeSendService,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  /** The intake as the member reaches it, locked FOR UPDATE when it is about to change. */
  private async find(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    lock = false,
  ): Promise<RecordRow> {
    const businessId = tenant.businessId;
    if (lock) {
      await tx.$executeRaw`SELECT 1 FROM intakes
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const row = await tx.intake.findFirst({
      where: { AND: [{ businessId, id, status: { not: 'DRAFT' } }, reachOf(tenant, userId)] },
      include: recordInclude,
    });
    if (!row) throw notFound();
    return row;
  }

  private definitionOf(row: RecordRow): IntakeFormDefinition | null {
    if (row.form.service.kind === 'OTHER') return null;
    try {
      return readDefinition(row.form, row.form.service.kind);
    } catch {
      return null;
    }
  }

  private async build(tx: TxClient, tenant: TenantContext, row: RecordRow) {
    const businessId = tenant.businessId;
    const definition = this.definitionOf(row);
    const answers = (row.submissions[0]?.answers ?? {}) as Record<string, unknown>;
    const docs = await tx.document.findMany({
      where: { businessId, intakeId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        fileName: true,
        contentType: true,
        intakeSlot: true,
        scanStatus: true,
        createdAt: true,
      },
    });
    const fields = definition ? intakeFields(definition) : [];
    const labelOf = new Map(fields.map((f) => [f.key, f.label]));

    // Submission Summary: the shown questions answered, and the shown required uploads.
    const counted = new Map<string, number>();
    for (const d of docs) {
      if (d.intakeSlot && COUNTED_UPLOAD_STATUSES.includes(d.scanStatus)) {
        counted.set(d.intakeSlot, (counted.get(d.intakeSlot) ?? 0) + 1);
      }
    }
    const shown = definition ? shownIntakeKeys(definition, answers).fields : new Set<string>();
    let total = 0;
    let answered = 0;
    let questionsDone = true;
    let documentsDone = true;
    for (const f of fields) {
      if (!shown.has(f.key) || f.type === 'info') continue;
      total++;
      const done =
        f.type === 'upload'
          ? (counted.get(f.key) ?? 0) > 0 ||
            (answers[f.key] as { notAvailable?: boolean } | undefined)?.notAvailable === true
          : !isEmpty(answers[f.key]);
      if (done) answered++;
      else if (f.required && f.type === 'upload') documentsDone = false;
      else if (f.required) questionsDone = false;
    }
    const submitted = SUBMITTED.includes(row.status);

    // History: the audit log of the intake, then what only the intake's own dates show.
    const logs = await tx.auditLog.findMany({
      where: { businessId, entityType: 'intake', entityId: row.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 300,
      select: { id: true, action: true, actorUserId: true, createdAt: true, metadata: true },
    });
    const names = await memberNames(
      tx,
      businessId,
      logs.map((l) => l.actorUserId),
    );
    const byOf = (userId: string | null) =>
      userId === null ? null : (names.get(userId) ?? 'Client');
    const history: AssignedFormEvent[] = [];
    for (const l of logs) {
      const fieldsChanged = ((l.metadata as { fields?: unknown } | null)?.fields ?? []) as string[];
      let event = EVENTS[l.action];
      if (l.action === 'intake.viewed' && l.actorUserId && !names.has(l.actorUserId)) {
        event = { kind: 'OPENED', label: 'Opened by the recipient' };
      } else if (l.action === 'intake.updated') {
        if (fieldsChanged.includes('assignedUserId')) {
          history.push({
            id: eventId(l.id, 'ASSIGNED', l.createdAt),
            at: l.createdAt.toISOString(),
            kind: 'ASSIGNED',
            label: 'Assignee changed',
            by: byOf(l.actorUserId),
          });
          if (!fieldsChanged.some((f) => f !== 'assignedUserId')) continue;
        }
        event = {
          kind: 'EXTENDED',
          label: fieldsChanged.includes('expiresOn') ? 'Expiration changed' : 'Due date changed',
        };
      }
      if (!event) continue;
      history.push({
        id: eventId(l.id, event.kind, l.createdAt),
        at: l.createdAt.toISOString(),
        kind: event.kind,
        label: event.label,
        by: byOf(l.actorUserId),
      });
    }
    const has = (kind: EventKind) => history.some((e) => e.kind === kind);
    const add = (kind: EventKind, label: string, at: Date | null | undefined) => {
      if (at && !has(kind)) {
        history.push({
          id: eventId(row.id, kind, at),
          at: at.toISOString(),
          kind,
          label,
          by: null,
        });
      }
    };
    add('SENT', 'Form sent', row.sentAt);
    add('SUBMITTED', 'Form submitted', row.submissions.find((s) => s.submittedAt)?.submittedAt);
    add('COMPLETED', 'Marked reviewed', row.completedAt);
    for (const d of docs) {
      history.push({
        id: eventId(d.id, 'UPLOADED', d.createdAt),
        at: d.createdAt.toISOString(),
        kind: 'UPLOADED',
        label: 'Document uploaded',
        by: null,
      });
    }
    history.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));

    const record: AssignedFormRecord = {
      ...toRow(row),
      submittedAt: iso(row.submissions.find((s) => s.submittedAt)?.submittedAt),
      completedAt: iso(row.completedAt),
      completedBy: row.completedBy
        ? { userId: row.completedBy.userId, name: row.completedBy.user.name }
        : null,
      progress: {
        percent: total === 0 ? (submitted ? 100 : 0) : Math.round((answered / total) * 100),
        allQuestionsAnswered: questionsDone,
        requiredDocumentsUploaded: documentsDone,
        submitted,
        readyForReview: row.status === 'SUBMITTED' || row.status === 'UNDER_REVIEW',
      },
      documents: docs.map((d) => ({
        id: d.id,
        fileName: d.fileName,
        contentType: d.contentType,
        questionLabel: d.intakeSlot ? (labelOf.get(d.intakeSlot) ?? null) : null,
        uploadedAt: d.createdAt.toISOString(),
        scanStatus: d.scanStatus,
      })),
      notes: [],
      history: history.slice(-200),
      communications: history.filter((e) => COMMUNICATION.includes(e.kind)),
      revisionNote: row.correctionNote,
    };
    return record;
  }

  private load(tenant: TenantContext, userId: string, id: string): Promise<AssignedFormRecord> {
    return this.inFirm(tenant, async (tx) =>
      this.build(tx, tenant, await this.find(tx, tenant, userId, id)),
    );
  }

  /** GET /business/intakes/{id}/record. */
  async record(tenant: TenantContext, userId: string, id: string): Promise<AssignedFormRecord> {
    const record = await this.load(tenant, userId, id);
    await this.audit.log('intake.record_viewed', { type: 'intake', id });
    return record;
  }

  /** POST /business/intakes/{id}/notes: no table keeps assigned-form notes yet. */
  async addNote(tenant: TenantContext, userId: string, id: string): Promise<never> {
    await this.inFirm(tenant, (tx) => this.find(tx, tenant, userId, id));
    throw new HttpException(
      {
        code: 'NOTES_UNAVAILABLE',
        message: 'Notes on a form are not available yet: add the note on the client instead',
      },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }

  /** PATCH /business/intakes/{id}: assignee, due date, expiration (an expired form reopens). */
  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateAssignedBody>,
  ): Promise<AssignedFormRecord> {
    const businessId = tenant.businessId;
    const fields = Object.keys(body)
      .filter((k) => (body as Record<string, unknown>)[k] !== undefined)
      .sort();
    const record = await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      if (row.status === 'ARCHIVED') throw invalidStatus();
      const datesChange = body.dueOn !== undefined || body.expiresOn !== undefined;
      if (datesChange && row.status === 'COMPLETED') throw invalidStatus();
      const data: Prisma.IntakeUncheckedUpdateInput = {};
      if (body.assignedUserId !== undefined) {
        if (body.assignedUserId !== null) {
          const owner = row.engagement
            ? await tx.client.findFirst({
                where: { businessId, id: row.engagement.client.id },
                select: { assignedUserId: true },
              })
            : await tx.lead.findFirst({
                where: { businessId, id: row.leadId! },
                select: { assignedUserId: true },
              });
          await checkAssignee(tx, businessId, body.assignedUserId, {
            assignedUserId: owner?.assignedUserId ?? null,
          });
        }
        data.assignedUserId = body.assignedUserId;
      }
      const dueOn = body.dueOn === undefined ? day(row.dueOn) : body.dueOn;
      const expiresOn = body.expiresOn === undefined ? day(row.expiresAt) : body.expiresOn;
      if (body.expiresOn) {
        if (body.expiresOn <= new Date().toISOString().slice(0, 10)) {
          throw invalid('The expiration date must be after today');
        }
        data.expiresAt = endOfDay(body.expiresOn);
      } else if (body.expiresOn === null) {
        data.expiresAt = null;
      }
      if (dueOn && expiresOn && dueOn > expiresOn) {
        throw invalid('The due date cannot be after the expiration date');
      }
      if (body.dueOn !== undefined) data.dueOn = body.dueOn ? toDay(body.dueOn) : null;
      // Extending an expired form opens it again where the recipient left it.
      if (row.status === 'EXPIRED' && body.expiresOn !== undefined) {
        const started = row.submissions[0]?.answers;
        data.status = started && Object.keys(started as object).length > 0 ? 'IN_PROGRESS' : 'SENT';
      }
      await tx.intake.update({ where: { id: row.id }, data });
      // In the transaction, so the history this answer shows has the change.
      await this.audit.logIn(tx, 'intake.updated', { type: 'intake', id }, { fields });
      return this.build(tx, tenant, await this.find(tx, tenant, userId, id));
    });
    return record;
  }

  /** Resend (the same form, never a second one) or a reminder now. */
  private async nudge(
    tenant: TenantContext,
    userId: string,
    id: string,
    action: 'intake.resent' | 'intake.reminded',
  ): Promise<AssignedFormRecord> {
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      if (!FILLABLE.includes(row.status)) throw invalidStatus();
      // Leads have no secure link page yet, so nothing can reach them.
      if (!row.engagement) {
        throw new HttpException(
          {
            code: 'LEAD_LINK_UNAVAILABLE',
            message: 'Forms for leads need the secure link page, which is not available yet',
          },
          HttpStatus.SERVICE_UNAVAILABLE,
        );
      }
      await tx.intake.update({ where: { id: row.id }, data: { lastActivityAt: new Date() } });
    });
    const reached = await this.sender.deliver(businessId, id, userId, `${action}:${randomUUID()}`);
    await this.audit.log(action, { type: 'intake', id }, { delivered: reached });
    return this.load(tenant, userId, id);
  }

  /** POST /business/intakes/{id}/resend. */
  resend(tenant: TenantContext, userId: string, id: string): Promise<AssignedFormRecord> {
    return this.nudge(tenant, userId, id, 'intake.resent');
  }

  /** POST /business/intakes/{id}/remind: 409 INVALID_STATUS once submitted or completed. */
  remind(tenant: TenantContext, userId: string, id: string): Promise<AssignedFormRecord> {
    return this.nudge(tenant, userId, id, 'intake.reminded');
  }

  /** POST /business/intakes/{id}/archive: hidden from the table; the record stays. */
  async archive(tenant: TenantContext, userId: string, id: string): Promise<AssignedFormRecord> {
    const changed = await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      if (row.status === 'ARCHIVED') return false;
      await tx.intake.update({ where: { id: row.id }, data: { status: 'ARCHIVED' } });
      return true;
    });
    if (changed) await this.audit.log('intake.archived', { type: 'intake', id });
    return this.load(tenant, userId, id);
  }

  /**
   * GET /business/intakes/{id}/pdf: the answers as a PDF (SSN and EIN as their last four), kept
   * under the firm's reports prefix and reached by a 5-minute link.
   */
  async pdf(tenant: TenantContext, userId: string, id: string): Promise<FormFileLink> {
    const businessId = tenant.businessId;
    const input = await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id);
      const definition = this.definitionOf(row);
      if (!definition) throw invalid('This form cannot be exported');
      const stored = (row.submissions[0]?.answers ?? {}) as Record<string, unknown>;
      const files = await tx.document.findMany({
        where: { businessId, intakeId: row.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { fileName: true, intakeSlot: true },
      });
      const r = toRow(row);
      return {
        definition,
        answers: await maskStoredNumbers(definition, stored),
        files,
        header: {
          title: row.form.title,
          recipient: r.recipient.name,
          status: row.status,
          sentAt: r.sentAt,
          submittedAt: iso(row.submissions.find((s) => s.submittedAt)?.submittedAt),
        },
      };
    });
    const bytes = await renderIntakePdf(input);
    const key = `tenant/${businessId}/reports/intake-${randomUUID()}.pdf`;
    const name =
      input.header.title
        .replace(/[^A-Za-z0-9 _-]+/g, '')
        .trim()
        .slice(0, 60) || 'intake-form';
    let url: string;
    try {
      await this.files.put(key, bytes, 'application/pdf');
      url = await this.files.presignDownload({
        key,
        fileName: `${name}.pdf`,
        contentType: 'application/pdf',
      });
    } catch {
      throw new HttpException(
        {
          code: 'FILE_STORE_UNAVAILABLE',
          message: 'The file could not be saved. Try again shortly.',
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
    await this.audit.log('intake.pdf_exported', { type: 'intake', id });
    return { url, expiresAt: new Date(Date.now() + 300_000).toISOString() };
  }
}
