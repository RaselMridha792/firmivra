import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AddDeadlineDocumentRequest,
  AddDeadlineLinkRequest,
  CreateDeadlineTaskRequest,
  LinkDeadlineTaskRequest,
  BulkDeadlinesRequest,
  BulkDeadlinesResult,
  CompleteComplianceDeadlineRequest,
  ComplianceDeadline,
  ComplianceSettings,
  CreateComplianceDeadlineRequest,
  ExtensionRequest,
  NotApplicableRequest,
  ReassignRequest,
  SaveRemindersRequest,
  UpdateComplianceDeadlineRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { LIVE_TASK } from '../tasks/task-common.js';
import {
  checkAssignee,
  isUniqueViolation,
  lockClient,
  notAMember,
  reachesClient,
  sentFields,
} from '../workspaces/common.js';
import {
  type ComplianceActor,
  findDeadline,
  isManager,
  loadSettings,
  reachWhere,
  toDetail,
  toTime,
} from './compliance.mappers.js';
import {
  CLOSED_STATUSES,
  errors,
  inFirm,
  isoDay,
  mapComplianceDbError,
  OPEN_STATUSES,
  toDay,
} from './compliance.shared.js';

type Create = z.output<typeof CreateComplianceDeadlineRequest>;
type Update = z.output<typeof UpdateComplianceDeadlineRequest>;
type Reminders = z.output<typeof SaveRemindersRequest>['reminders'];

const OPEN: readonly string[] = OPEN_STATUSES;
const CLOSED: readonly string[] = CLOSED_STATUSES;
/** Library and imported dates are statutory: moving one needs a reason and the Owner or an Admin. */
const STATUTORY_SOURCES: readonly string[] = ['GOVERNMENT', 'IMPORTED'];

const reminderRows = (businessId: string, deadlineId: string, reminders: Reminders) =>
  reminders.map((r) => ({
    businessId,
    deadlineId,
    daysBefore: r.daysBefore,
    inApp: r.inApp,
    channels: r.channels,
  }));

/**
 * The writes of Compliance & Deadlines on one deadline: create and edit, the status actions,
 * reminders, linked tasks, documents and related deadlines, and bulk actions. A deadline is the
 * source of truth for the obligation and its date; a task is the work, and completing a deadline
 * never completes its tasks. Every change is audited (fields and ids, never notes or client
 * data). A moved statutory date keeps the library date (`statutoryDueOn`), needs a reason and
 * Owner or Admin, and is logged. Archived deadlines change no more.
 */
@Injectable()
export class ComplianceDeadlineActionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** The deadline as the screens show it, read again after a change. */
  private async detail(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    id: string,
  ): Promise<ComplianceDeadline> {
    const row = await findDeadline(tx, businessId, actor, id);
    return toDetail(tx, businessId, row, await loadSettings(tx, businessId));
  }

  /** The client the caller reaches (404 otherwise), locked until the change commits. */
  private async reachedClient(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    clientId: string,
  ) {
    const client = await lockClient(tx, businessId, clientId);
    if (!client || !reachesClient(actor, client)) throw errors.notFound();
    const live = await tx.client.findFirst({
      where: { businessId, id: clientId, archivedAt: null },
      select: { id: true },
    });
    if (!live) throw errors.notFound();
    return client;
  }

  private async checkEngagement(
    tx: TxClient,
    businessId: string,
    clientId: string,
    engagementId: string | null | undefined,
  ) {
    if (!engagementId) return;
    const found = await tx.engagement.findFirst({
      where: { businessId, id: engagementId, clientId },
      select: { id: true },
    });
    if (!found) throw errors.notThisClients('engagement');
  }

  // ---------- Create and edit ----------

  async create(
    businessId: string,
    actor: ComplianceActor,
    body: Create,
  ): Promise<ComplianceDeadline> {
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const client = await this.reachedClient(tx, businessId, actor, body.clientId);
        await this.checkEngagement(tx, businessId, body.clientId, body.engagementId);
        if (body.assignedUserId) {
          await checkAssignee(tx, businessId, body.assignedUserId, client);
        }
        const settings = await loadSettings(tx, businessId);
        const statutory = body.statutoryDueOn ?? null;
        const moved = statutory !== null && statutory !== body.dueOn;
        const reason = body.dueOverrideReason ?? null;
        if (moved) {
          if (!isManager(actor)) throw errors.overrideNotAllowed();
          if (!reason) throw errors.overrideReasonRequired();
        } else if (reason) {
          throw errors.invalid('dueOverrideReason', 'Only a moved date has a reason');
        }
        if (body.createTask && body.taskTemplateId) {
          await this.requireTemplate(tx, businessId, body.taskTemplateId);
        }
        const row = await tx.complianceDeadline.create({
          data: {
            businessId,
            clientId: body.clientId,
            engagementId: body.engagementId ?? null,
            name: body.name,
            type: body.type,
            source: body.source,
            description: body.description ?? null,
            internalNotes: body.internalNotes ?? null,
            clientNotes: body.clientNotes ?? null,
            entityType: body.entityType ?? null,
            taxYear: body.taxYear ?? null,
            filingPeriod: body.filingPeriod ?? null,
            relatedForm: body.relatedForm ?? null,
            agency: body.agency ?? null,
            jurisdiction: body.jurisdiction ?? null,
            state: body.state ?? null,
            statutoryDueOn: statutory ? toDay(statutory) : null,
            dueOn: toDay(body.dueOn),
            dueTime: toTime(body.dueTime) ?? null,
            dueOverridden: moved,
            dueOverrideReason: moved ? reason : null,
            paymentDueOn: body.paymentDueOn ? toDay(body.paymentDueOn) : null,
            priority: body.priority,
            status: body.status,
            assignedUserId: body.assignedUserId ?? null,
            clientVisible: body.clientVisible,
            createTask: body.createTask,
            taskTemplateId: body.createTask ? (body.taskTemplateId ?? null) : null,
            createdByUserId: actor.userId,
          },
          select: { id: true },
        });
        await tx.complianceDeadlineReminder.createMany({
          data: reminderRows(businessId, row.id, body.reminders ?? settings.defaultReminders),
        });
        if (moved) {
          await this.logOverride(tx, businessId, actor, row.id, statutory, body.dueOn);
        }
        if (body.createTask) {
          await this.makeTask(tx, businessId, actor, settings, row.id, {
            templateId: body.taskTemplateId,
          });
        }
        await this.audit.logIn(
          tx,
          'compliance.deadline.created',
          { type: 'compliance_deadline', id: row.id },
          {
            clientId: body.clientId,
            type: body.type,
            source: body.source,
            overridden: moved,
            createdTask: body.createTask,
          },
        );
        return this.detail(tx, businessId, actor, row.id);
      });
    } catch (error) {
      return this.rethrow(error);
    }
  }

  async update(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: Update,
  ): Promise<ComplianceDeadline> {
    try {
      return await inFirm(this.database, businessId, async (tx) => {
        const current = await findDeadline(tx, businessId, actor, id);
        if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
        if (body.status !== undefined && CLOSED.includes(current.status)) {
          throw errors.deadlineState('Reopen this deadline before changing its status');
        }
        const client = await this.reachedClient(tx, businessId, actor, current.clientId);
        if (body.engagementId !== undefined) {
          await this.checkEngagement(tx, businessId, current.clientId, body.engagementId);
        }
        if (body.assignedUserId) {
          await checkAssignee(tx, businessId, body.assignedUserId, client);
        }
        const dueOn = body.dueOn ?? isoDay(current.dueOn);
        const dateMoved = dueOn !== isoDay(current.dueOn);
        const source = body.source ?? current.source;
        const statutory = current.statutoryDueOn
          ? isoDay(current.statutoryDueOn)
          : STATUTORY_SOURCES.includes(source) && dateMoved
            ? isoDay(current.dueOn)
            : null;
        const reason = body.dueOverrideReason ?? null;
        let override: Prisma.ComplianceDeadlineUncheckedUpdateInput = {};
        let moved = false;
        if (statutory !== null && dateMoved) {
          if (dueOn === statutory) {
            override = { dueOverridden: false, dueOverrideReason: null };
          } else {
            if (!isManager(actor)) throw errors.overrideNotAllowed();
            if (!reason) throw errors.overrideReasonRequired();
            moved = true;
            override = {
              statutoryDueOn: toDay(statutory),
              dueOverridden: true,
              dueOverrideReason: reason,
            };
          }
        } else if (reason) {
          throw errors.invalid('dueOverrideReason', 'Only a moved government date has a reason');
        }
        if (dateMoved && current.extendedDueOn && toDay(dueOn) > current.extendedDueOn) {
          throw errors.deadlineState('The due date cannot be after the extended filing date');
        }
        const { dueOverrideReason: _reason, ...fields } = body;
        void _reason;
        await tx.complianceDeadline.update({
          where: { businessId_id: { businessId, id } },
          data: {
            ...fields,
            dueOn: fields.dueOn === undefined ? undefined : toDay(fields.dueOn),
            dueTime: toTime(fields.dueTime),
            paymentDueOn:
              fields.paymentDueOn === undefined
                ? undefined
                : fields.paymentDueOn
                  ? toDay(fields.paymentDueOn)
                  : null,
            ...override,
          },
        });
        if (moved) await this.logOverride(tx, businessId, actor, id, statutory, dueOn);
        await this.audit.logIn(
          tx,
          'compliance.deadline.updated',
          { type: 'compliance_deadline', id },
          {
            clientId: current.clientId,
            fields: sentFields(body, Object.keys(body) as (keyof Update & string)[]).filter(
              (k) => k !== 'dueOverrideReason',
            ),
            dateMoved,
            overridden: moved,
          },
        );
        return this.detail(tx, businessId, actor, id);
      });
    } catch (error) {
      return this.rethrow(error);
    }
  }

  // ---------- Status actions ----------

  /**
   * Moves a deadline to a new state when it is in one of `from`: 404 when the caller does not reach
   * it, 409 DEADLINE_STATE when archived or in another state. Returns the row before the change.
   */
  private async transition(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    id: string,
    from: readonly string[],
    data: Prisma.ComplianceDeadlineUncheckedUpdateManyInput,
    action: string,
    meta: Record<string, unknown> = {},
  ) {
    const current = await tx.complianceDeadline.findFirst({
      where: { AND: [{ businessId, id }, reachWhere(actor)] },
      select: { id: true, clientId: true, status: true, archivedAt: true },
    });
    if (!current) throw errors.notFound();
    if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
    if (!from.includes(current.status)) {
      throw errors.deadlineState(
        `A ${current.status.toLowerCase().replace(/_/g, ' ')} deadline cannot do that`,
      );
    }
    const { count } = await tx.complianceDeadline.updateMany({
      where: { businessId, id, status: current.status, archivedAt: null },
      data,
    });
    if (count === 0) throw errors.deadlineState('The deadline changed: try again');
    await this.audit.logIn(
      tx,
      action,
      { type: 'compliance_deadline', id },
      { clientId: current.clientId, from: current.status, ...meta },
    );
    return current;
  }

  private run(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    work: (tx: TxClient) => Promise<unknown>,
  ): Promise<ComplianceDeadline> {
    return inFirm(this.database, businessId, async (tx) => {
      try {
        await work(tx);
      } catch (error) {
        return this.rethrow(error);
      }
      return this.detail(tx, businessId, actor, id);
    });
  }

  start(businessId: string, actor: ComplianceActor, id: string) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        OPEN,
        { status: 'IN_PROGRESS' },
        'compliance.deadline.started',
      ),
    );
  }

  waitOnClient(businessId: string, actor: ComplianceActor, id: string) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        OPEN,
        { status: 'WAITING_ON_CLIENT' },
        'compliance.deadline.waiting-on-client',
      ),
    );
  }

  complete(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof CompleteComplianceDeadlineRequest>,
  ) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        OPEN,
        {
          status: 'COMPLETED',
          completedAt: new Date(),
          completedByUserId: actor.userId,
          filedOn: body.filedOn ? toDay(body.filedOn) : null,
          confirmationNumber: body.confirmationNumber ?? null,
        },
        'compliance.deadline.completed',
        { evidence: sentFields(body, ['filedOn', 'confirmationNumber']) },
      ),
    );
  }

  reopen(businessId: string, actor: ComplianceActor, id: string) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        CLOSED,
        { status: 'UPCOMING', completedAt: null, completedByUserId: null },
        'compliance.deadline.reopened',
      ),
    );
  }

  notApplicable(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof NotApplicableRequest>,
  ) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        OPEN,
        { status: 'NOT_APPLICABLE', notApplicableReason: body.reason },
        'compliance.deadline.not-applicable',
      ),
    );
  }

  archive(businessId: string, actor: ComplianceActor, id: string) {
    return this.run(businessId, actor, id, (tx) =>
      this.transition(
        tx,
        businessId,
        actor,
        id,
        [...OPEN, ...CLOSED],
        { archivedAt: new Date() },
        'compliance.deadline.archived',
      ),
    );
  }

  reassign(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof ReassignRequest>,
  ) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true },
      });
      if (!current) throw errors.notFound();
      if (body.assignedUserId) {
        const client = await this.reachedClient(tx, businessId, actor, current.clientId);
        await checkAssignee(tx, businessId, body.assignedUserId, client);
      }
      await this.transition(
        tx,
        businessId,
        actor,
        id,
        [...OPEN, ...CLOSED],
        { assignedUserId: body.assignedUserId },
        'compliance.deadline.reassigned',
        { unassigned: body.assignedUserId === null },
      );
    });
  }

  fileExtension(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof ExtensionRequest>,
  ) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { dueOn: true },
      });
      if (!current) throw errors.notFound();
      if (toDay(body.extendedDueOn) < current.dueOn) {
        throw errors.invalid('extendedDueOn', 'An extension cannot be before the due date');
      }
      // The payment date stays: an extension to file is not an extension to pay.
      await this.transition(
        tx,
        businessId,
        actor,
        id,
        OPEN,
        { extensionFiledOn: toDay(body.filedOn), extendedDueOn: toDay(body.extendedDueOn) },
        'compliance.deadline.extension-filed',
      );
    });
  }

  saveReminders(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof SaveRemindersRequest>,
  ) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true, archivedAt: true },
      });
      if (!current) throw errors.notFound();
      if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
      await tx.complianceDeadlineReminder.deleteMany({ where: { businessId, deadlineId: id } });
      await tx.complianceDeadlineReminder.createMany({
        data: reminderRows(businessId, id, body.reminders),
      });
      await this.audit.logIn(
        tx,
        'compliance.deadline.reminders-saved',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, count: body.reminders.length },
      );
    });
  }

  // ---------- Tasks, documents, related deadlines ----------

  private async requireTemplate(tx: TxClient, businessId: string, templateId: string) {
    const template = await tx.taskTemplate.findFirst({
      where: { businessId, id: templateId, archivedAt: null },
      select: {
        id: true,
        name: true,
        typeId: true,
        serviceId: true,
        priority: true,
        assignedUserId: true,
      },
    });
    if (!template) throw errors.templateNotFound();
    return template;
  }

  /**
   * One task of a deadline, from a template (once: the database holds one task per deadline and
   * template, so asking again finds the first). The task is the deadline's client's and due on the
   * deadline's date; it never marks the deadline filed.
   */
  private async makeTask(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    settings: ComplianceSettings,
    deadlineId: string,
    opts: { templateId?: string | null | undefined; title?: string | undefined },
  ): Promise<string> {
    const d = await tx.complianceDeadline.findFirstOrThrow({
      where: { businessId, id: deadlineId },
      select: {
        id: true,
        clientId: true,
        engagementId: true,
        name: true,
        type: true,
        dueOn: true,
        priority: true,
        assignedUserId: true,
      },
    });
    const templateId =
      opts.templateId ??
      settings.taskTemplates.find((t) => t.type === d.type)?.taskTemplateId ??
      null;
    const template = templateId ? await this.requireTemplate(tx, businessId, templateId) : null;
    if (template) {
      const existing = await tx.task.findFirst({
        where: { businessId, deadlineId, templateId: template.id, ...LIVE_TASK },
        select: { id: true },
      });
      if (existing) return existing.id;
    }
    const title = (opts.title ?? (template ? `${template.name}: ${d.name}` : d.name)).slice(0, 200);
    try {
      const task = await tx.task.create({
        data: {
          businessId,
          clientId: d.clientId,
          engagementId: d.engagementId,
          title,
          dueOn: d.dueOn,
          priority: template?.priority ?? d.priority,
          typeId: template?.typeId ?? null,
          serviceId: template?.serviceId ?? null,
          assignedUserId: d.assignedUserId ?? template?.assignedUserId ?? null,
          deadlineId,
          templateId: template?.id ?? null,
          createdByUserId: actor.userId,
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'compliance.deadline.task-created',
        { type: 'compliance_deadline', id: deadlineId },
        { clientId: d.clientId, taskId: task.id, templateId: template?.id ?? null },
      );
      return task.id;
    } catch (error) {
      if (isUniqueViolation(error) && template) {
        const existing = await tx.task.findFirst({
          where: { businessId, deadlineId, templateId: template.id, ...LIVE_TASK },
          select: { id: true },
        });
        if (existing) return existing.id;
      }
      throw error;
    }
  }

  addTask(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof CreateDeadlineTaskRequest>,
  ): Promise<ComplianceDeadline> {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true, archivedAt: true },
      });
      if (!current) throw errors.notFound();
      if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
      const settings = await loadSettings(tx, businessId);
      await this.makeTask(tx, businessId, actor, settings, id, {
        templateId: body.templateId,
        title: body.title,
      });
    });
  }

  linkTask(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof LinkDeadlineTaskRequest>,
  ): Promise<ComplianceDeadline> {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true, archivedAt: true },
      });
      if (!current) throw errors.notFound();
      if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
      const task = await tx.task.findFirst({
        where: { businessId, id: body.taskId, ...LIVE_TASK },
        select: { clientId: true, deadlineId: true },
      });
      if (!task || task.clientId !== current.clientId) throw errors.notThisClients('task');
      if (task.deadlineId === id) return;
      if (task.deadlineId) throw errors.duplicate('That task already belongs to a deadline');
      await tx.task.update({
        where: { businessId_id: { businessId, id: body.taskId } },
        data: { deadlineId: id },
      });
      await this.audit.logIn(
        tx,
        'compliance.deadline.task-linked',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, taskId: body.taskId },
      );
    });
  }

  removeTask(businessId: string, actor: ComplianceActor, id: string, taskId: string) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true },
      });
      if (!current) throw errors.notFound();
      const { count } = await tx.task.updateMany({
        where: { businessId, id: taskId, deadlineId: id, ...LIVE_TASK },
        data: { deadlineId: null },
      });
      if (count === 0) throw errors.notFound();
      await this.audit.logIn(
        tx,
        'compliance.deadline.task-unlinked',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, taskId },
      );
    });
  }

  addDocument(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof AddDeadlineDocumentRequest>,
  ) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true, archivedAt: true },
      });
      if (!current) throw errors.notFound();
      if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
      const document = await tx.document.findFirst({
        where: { businessId, id: body.documentId, clientId: current.clientId },
        select: { id: true },
      });
      if (!document) throw errors.notThisClients('document');
      const exists = await tx.complianceDeadlineDocument.findFirst({
        where: { businessId, deadlineId: id, documentId: body.documentId },
        select: { id: true },
      });
      if (exists) return;
      await tx.complianceDeadlineDocument.create({
        data: {
          businessId,
          deadlineId: id,
          documentId: body.documentId,
          addedByUserId: actor.userId,
        },
      });
      await this.audit.logIn(
        tx,
        'compliance.deadline.document-added',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, documentId: body.documentId },
      );
    });
  }

  removeDocument(businessId: string, actor: ComplianceActor, id: string, documentId: string) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true },
      });
      if (!current) throw errors.notFound();
      const { count } = await tx.complianceDeadlineDocument.deleteMany({
        where: { businessId, deadlineId: id, documentId },
      });
      if (count === 0) throw errors.notFound();
      await this.audit.logIn(
        tx,
        'compliance.deadline.document-removed',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, documentId },
      );
    });
  }

  addLink(
    businessId: string,
    actor: ComplianceActor,
    id: string,
    body: z.output<typeof AddDeadlineLinkRequest>,
  ) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true, archivedAt: true },
      });
      if (!current) throw errors.notFound();
      if (current.archivedAt) throw errors.deadlineState('This deadline is archived');
      if (body.relatedDeadlineId === id) {
        throw errors.invalid('relatedDeadlineId', 'A deadline cannot be related to itself');
      }
      const related = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id: body.relatedDeadlineId }, reachWhere(actor)] },
        select: { clientId: true },
      });
      if (!related) throw errors.notFound();
      if (related.clientId !== current.clientId) throw errors.notThisClients('deadline');
      const exists = await tx.complianceDeadlineLink.findFirst({
        where: {
          businessId,
          OR: [
            { deadlineId: id, relatedDeadlineId: body.relatedDeadlineId },
            { deadlineId: body.relatedDeadlineId, relatedDeadlineId: id },
          ],
        },
        select: { deadlineId: true },
      });
      if (exists) return;
      await tx.complianceDeadlineLink.create({
        data: { businessId, deadlineId: id, relatedDeadlineId: body.relatedDeadlineId },
      });
      await this.audit.logIn(
        tx,
        'compliance.deadline.link-added',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, relatedDeadlineId: body.relatedDeadlineId },
      );
    });
  }

  removeLink(businessId: string, actor: ComplianceActor, id: string, relatedId: string) {
    return this.run(businessId, actor, id, async (tx) => {
      const current = await tx.complianceDeadline.findFirst({
        where: { AND: [{ businessId, id }, reachWhere(actor)] },
        select: { clientId: true },
      });
      if (!current) throw errors.notFound();
      const { count } = await tx.complianceDeadlineLink.deleteMany({
        where: {
          businessId,
          OR: [
            { deadlineId: id, relatedDeadlineId: relatedId },
            { deadlineId: relatedId, relatedDeadlineId: id },
          ],
        },
      });
      if (count === 0) throw errors.notFound();
      await this.audit.logIn(
        tx,
        'compliance.deadline.link-removed',
        { type: 'compliance_deadline', id },
        { clientId: current.clientId, relatedDeadlineId: relatedId },
      );
    });
  }

  // ---------- Bulk ----------

  /** Each deadline is changed in its own transaction; one that cannot be is skipped with the reason. */
  async bulk(
    businessId: string,
    actor: ComplianceActor,
    body: z.output<typeof BulkDeadlinesRequest>,
  ): Promise<BulkDeadlinesResult> {
    const ids = [...new Set(body.ids)];
    // A deadline the caller cannot reach (or that is not in the firm) refuses the whole request.
    const reached = await this.tenantReach(businessId, actor, ids);
    if (reached !== ids.length) throw errors.notFound();
    // An assignee who is not a member of this firm refuses the whole request, as a single change does.
    if (body.action === 'REASSIGN' && body.assignedUserId) {
      await inFirm(this.database, businessId, async (tx) => {
        const member = await tx.membership.findFirst({
          where: { businessId, userId: body.assignedUserId as string, status: 'ACTIVE' },
          select: { userId: true },
        });
        if (!member) throw notAMember();
      });
    }
    const updated: string[] = [];
    const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      try {
        await inFirm(this.database, businessId, async (tx) => {
          if (body.action === 'ARCHIVE') {
            await this.transition(
              tx,
              businessId,
              actor,
              id,
              [...OPEN, ...CLOSED],
              { archivedAt: new Date() },
              'compliance.deadline.archived',
              { bulk: true },
            );
          } else if (body.action === 'REASSIGN') {
            const current = await tx.complianceDeadline.findFirst({
              where: { AND: [{ businessId, id }, reachWhere(actor)] },
              select: { clientId: true },
            });
            if (!current) throw errors.notFound();
            if (body.assignedUserId) {
              const client = await this.reachedClient(tx, businessId, actor, current.clientId);
              await checkAssignee(tx, businessId, body.assignedUserId, client);
            }
            await this.transition(
              tx,
              businessId,
              actor,
              id,
              [...OPEN, ...CLOSED],
              { assignedUserId: body.assignedUserId ?? null },
              'compliance.deadline.reassigned',
              { bulk: true },
            );
          } else if (body.status === 'COMPLETED') {
            await this.transition(
              tx,
              businessId,
              actor,
              id,
              OPEN,
              { status: 'COMPLETED', completedAt: new Date(), completedByUserId: actor.userId },
              'compliance.deadline.completed',
              { bulk: true },
            );
          } else if (body.status === 'NOT_APPLICABLE') {
            await this.transition(
              tx,
              businessId,
              actor,
              id,
              OPEN,
              { status: 'NOT_APPLICABLE', notApplicableReason: body.reason ?? null },
              'compliance.deadline.not-applicable',
              { bulk: true },
            );
          } else {
            await this.transition(
              tx,
              businessId,
              actor,
              id,
              OPEN,
              { status: body.status as 'UPCOMING' },
              'compliance.deadline.status-changed',
              { bulk: true, to: body.status },
            );
          }
        });
        updated.push(id);
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
        const response = error.getResponse() as { message?: string };
        skipped.push({ id, reason: response.message ?? 'Not changed' });
      }
    }
    await this.audit.log(
      'compliance.deadlines.bulk',
      { type: 'compliance' },
      { action: body.action, updated: updated.length, skipped: skipped.length },
    );
    return { updated, skipped };
  }

  /**
   * A deadline a rule or a recurring definition makes for a client (generation, or a confirmed
   * suggestion), inside the caller's transaction. It records why it applies and the library entry
   * or definition behind it; the database holds one per client, entry and date.
   */
  async makeFromRule(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    settings: ComplianceSettings,
    input: {
      client: { id: string; assignedUserId: string | null };
      name: string;
      type: Create['type'];
      source: Create['source'];
      description: string | null;
      relatedForm: string | null;
      agency: string | null;
      jurisdiction: Create['jurisdiction'] | null;
      state: string | null;
      statutoryDueOn: Date;
      dueOn: Date;
      calendarEntryId: string | null;
      recurrenceId: string | null;
      applicabilityReason: string;
      priority?: Create['priority'];
      assignedUserId?: string | null;
      clientVisible?: boolean;
      reminders: Reminders;
      createTask: boolean;
      taskTemplateId: string | null;
    },
  ): Promise<string> {
    let assignee: string | null = null;
    if (input.assignedUserId) {
      try {
        await checkAssignee(tx, businessId, input.assignedUserId, input.client);
        assignee = input.assignedUserId;
      } catch (error) {
        if (!(error instanceof HttpException)) throw error;
      }
    }
    const row = await tx.complianceDeadline.create({
      data: {
        businessId,
        clientId: input.client.id,
        name: input.name,
        type: input.type,
        source: input.source,
        description: input.description,
        relatedForm: input.relatedForm,
        agency: input.agency,
        jurisdiction: input.jurisdiction,
        state: input.state,
        statutoryDueOn: input.statutoryDueOn,
        dueOn: input.dueOn,
        priority: input.priority ?? 'MEDIUM',
        assignedUserId: assignee,
        clientVisible: input.clientVisible ?? false,
        createTask: input.createTask,
        taskTemplateId: input.createTask ? input.taskTemplateId : null,
        calendarEntryId: input.calendarEntryId,
        recurrenceId: input.recurrenceId,
        applicabilityReason: input.applicabilityReason.slice(0, 500),
        createdByUserId: actor.userId,
      },
      select: { id: true },
    });
    await tx.complianceDeadlineReminder.createMany({
      data: reminderRows(businessId, row.id, input.reminders),
    });
    if (input.createTask) {
      await this.makeTask(tx, businessId, actor, settings, row.id, {
        templateId: input.taskTemplateId,
      });
    }
    await this.audit.logIn(
      tx,
      'compliance.deadline.created',
      { type: 'compliance_deadline', id: row.id },
      {
        clientId: input.client.id,
        type: input.type,
        source: input.source,
        generated: true,
        createdTask: input.createTask,
      },
    );
    return row.id;
  }

  /** The deadline as the screens show it (for the services that make one). */
  detailIn(tx: TxClient, businessId: string, actor: ComplianceActor, id: string) {
    return this.detail(tx, businessId, actor, id);
  }

  private tenantReach(businessId: string, actor: ComplianceActor, ids: string[]): Promise<number> {
    return inFirm(this.database, businessId, (tx) =>
      tx.complianceDeadline.count({
        where: { AND: [{ businessId, id: { in: ids } }, reachWhere(actor)] },
      }),
    );
  }

  // ---------- Shared ----------

  private async logOverride(
    tx: TxClient,
    businessId: string,
    actor: ComplianceActor,
    deadlineId: string,
    statutory: string | null,
    dueOn: string,
  ) {
    const days =
      statutory === null
        ? 0
        : Math.round((toDay(dueOn).getTime() - toDay(statutory).getTime()) / 86_400_000);
    await tx.complianceLog.create({
      data: {
        businessId,
        kind: 'OVERRIDE',
        outcome: 'SUCCESS',
        deadlineId,
        message: 'A government or imported due date was moved',
        details: { daysMoved: days },
        actorUserId: actor.userId,
      },
    });
  }

  private rethrow(error: unknown): never {
    if (isUniqueViolation(error)) {
      throw errors.duplicate('A deadline with the same details already exists');
    }
    return mapComplianceDbError(error);
  }
}
