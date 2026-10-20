import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  FormDeliveryChannel,
  IntakeStatus,
  SendDraft,
  SendIntakeFormResult,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { checkAssignee, conflict, notFound, toDay } from '../workspaces/common.js';
import { rowInclude, toRow } from './intake-workspace.service.js';
import type { SendBody, SendDraftBody } from './workspace-input.js';
import { day, formMetaOf } from './workspace.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Send = Out<typeof SendBody>;
type Draft = Out<typeof SendDraftBody>;

/** A form still open with its recipient: sending it again is a resend (409 FORM_ALREADY_OPEN). */
export const OPEN_FORM_STATUSES: IntakeStatus[] = [
  'SENT',
  'IN_PROGRESS',
  'NEEDS_CORRECTION',
  'SUBMITTED',
  'UNDER_REVIEW',
];

const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message });
const unavailable = (code: string, message: string) =>
  new HttpException({ code, message }, HttpStatus.SERVICE_UNAVAILABLE);
const leadLinkUnavailable = () =>
  unavailable(
    'LEAD_LINK_UNAVAILABLE',
    'Forms for leads and new contacts need the secure link page, which is not available yet',
  );

/** "d***@example.test": the address the form went to, masked. */
export function maskEmail(email: string | null): string {
  if (!email) return '';
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

/** End of a calendar day (UTC), as intakes.expires_at holds an expiration date. */
export const endOfDay = (value: string) => new Date(`${value}T23:59:59.999Z`);
const todayUtc = () => new Date().toISOString().slice(0, 10);
const addDays = (days: number) =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

interface Recipient {
  engagementId: string | null;
  leadId: string | null;
  /** The client or lead's own assignee, for the Staff-assignee rule. */
  assignedUserId: string | null;
  email: string | null;
  clientId: string | null;
}

/**
 * Send Intake Form (Frame 2) and its drafts. A send draft is a DRAFT intake (R37: send setup saved
 * but not sent), so it needs a recipient (client or lead) and a form; sending promotes it. Clients
 * get the form in the portal: the bell and its email copy through R6's Notifier. Leads and new
 * contacts need the secure link page (503 LEAD_LINK_UNAVAILABLE); SMS has no sender for intake
 * forms yet (400 SMS_UNAVAILABLE). The email subject and message are kept with the intake; the
 * Notifier never sends text from a caller.
 */
@Injectable()
export class IntakeSendService {
  private readonly logger = new Logger(IntakeSendService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private isStaff(tenant: TenantContext) {
    return legacyFirmRole(tenant.role as Parameters<typeof legacyFirmRole>[0]) === 'STAFF';
  }

  /** The form's template and its live version; 404, or 409 FORM_NOT_PUBLISHED. */
  private async liveForm(tx: TxClient, businessId: string, templateId: string) {
    const t = await tx.intakeTemplate.findFirst({
      where: { businessId, id: templateId, archivedAt: null },
      select: {
        id: true,
        serviceId: true,
        defaultAssignedUserId: true,
        forms: {
          where: { status: 'PUBLISHED' },
          orderBy: { version: 'desc' },
          take: 1,
          select: { id: true, definition: true },
        },
      },
    });
    if (!t) throw notFound();
    const live = t.forms[0];
    if (!live) throw conflict('FORM_NOT_PUBLISHED', 'Publish this form before sending it');
    return { ...t, live };
  }

  /** The client (and its engagement for the form's service) or lead, as the member reaches it. */
  private async recipient(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    to: { kind: 'CLIENT' | 'LEAD'; id: string },
    serviceId: string,
    engagementId: string | undefined,
  ): Promise<Recipient> {
    const businessId = tenant.businessId;
    const staffOnly = this.isStaff(tenant) ? { assignedUserId: userId } : {};
    if (to.kind === 'LEAD') {
      const lead = await tx.lead.findFirst({
        where: { businessId, id: to.id, archivedAt: null, ...staffOnly },
        select: { id: true, serviceId: true, assignedUserId: true, email: true },
      });
      if (!lead) throw notFound();
      if (lead.serviceId !== serviceId) {
        throw invalid("This form is not for the lead's service");
      }
      return {
        engagementId: null,
        leadId: lead.id,
        assignedUserId: lead.assignedUserId,
        email: lead.email,
        clientId: null,
      };
    }
    const client = await tx.client.findFirst({
      where: { businessId, id: to.id, archivedAt: null, ...staffOnly },
      select: { id: true, assignedUserId: true, email: true },
    });
    if (!client) throw notFound();
    const engagement = await tx.engagement.findFirst({
      where: {
        businessId,
        clientId: client.id,
        serviceId,
        ...(engagementId ? { id: engagementId } : { status: 'ACTIVE' }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
    if (!engagement) {
      if (engagementId) throw notFound();
      throw conflict('NO_ENGAGEMENT', "This client has no active service for this form's service");
    }
    return {
      engagementId: engagement.id,
      leadId: null,
      assignedUserId: client.assignedUserId,
      email: client.email,
      clientId: client.id,
    };
  }

  /** Who the form is assigned to: the one chosen, or the form's and then the firm's default. */
  private async assigneeFor(
    tx: TxClient,
    businessId: string,
    chosen: string | null | undefined,
    defaults: (string | null | undefined)[],
    to: Recipient,
  ): Promise<string | null> {
    const owner = { assignedUserId: to.assignedUserId };
    if (chosen !== undefined) {
      if (chosen !== null) await checkAssignee(tx, businessId, chosen, owner);
      return chosen;
    }
    for (const candidate of defaults) {
      if (!candidate) continue;
      try {
        await checkAssignee(tx, businessId, candidate, owner);
        return candidate;
      } catch {
        // A default that no longer fits (a former member) is skipped, never an error.
      }
    }
    return null;
  }

  /** Due and expiration dates: the expiration defaults from the form, then the firm's settings. */
  private dates(
    dueOn: string | null | undefined,
    expiresOn: string | null | undefined,
    fallbackDays: number | null,
  ) {
    const expires =
      expiresOn === undefined ? (fallbackDays ? addDays(fallbackDays) : null) : expiresOn;
    if (expires !== null && expires <= todayUtc()) {
      throw invalid('The expiration date must be after today');
    }
    if (dueOn && expires && dueOn > expires) {
      throw invalid('The due date cannot be after the expiration date');
    }
    return {
      dueOn: dueOn ? toDay(dueOn) : null,
      expiresAt: expires ? endOfDay(expires) : null,
    };
  }

  /** POST /business/intakes/send. Retry-safe by the idempotency key. */
  async send(tenant: TenantContext, userId: string, body: Send): Promise<SendIntakeFormResult> {
    if (body.channel === 'SMS') {
      throw new BadRequestException({
        code: 'SMS_UNAVAILABLE',
        message: 'Text messages are not available for intake forms yet: choose Email or Portal',
      });
    }
    if (body.recipient.kind === 'LEAD' && body.channel === 'PORTAL') {
      throw conflict('PORTAL_UNAVAILABLE', 'A lead has no portal access: choose Email');
    }
    if (body.recipient.kind !== 'CLIENT') throw leadLinkUnavailable();
    const recipientRef = body.recipient;
    const businessId = tenant.businessId;
    const sent = await this.inFirm(tenant, async (tx) => {
      // One send per key at a time; a retry finds the first one's audit row.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`intake-send:${businessId}:${body.idempotencyKey}`}, 0))`;
      const first = await tx.auditLog.findFirst({
        where: {
          businessId,
          action: 'intake.sent',
          entityType: 'intake',
          metadata: { path: ['idempotencyKey'], equals: body.idempotencyKey },
        },
        select: { entityId: true, actorUserId: true },
      });
      if (first?.entityId) {
        if (first.actorUserId !== userId) throw notFound();
        return { replay: true as const, id: first.entityId };
      }
      const form = await this.liveForm(tx, businessId, body.formId);
      const to = await this.recipient(
        tx,
        tenant,
        userId,
        recipientRef,
        form.serviceId,
        body.engagementId,
      );
      if (body.channel === 'PORTAL') {
        const login = await tx.clientAccount.findFirst({
          where: { businessId, clientId: to.clientId!, status: 'ACTIVE' },
          select: { id: true },
        });
        if (!login) {
          throw conflict(
            'PORTAL_UNAVAILABLE',
            'This client has no portal access yet: choose Email',
          );
        }
      } else if (!to.email) {
        throw invalid('This client has no email address');
      }
      // Held so two sends to one engagement run one at a time.
      await tx.$executeRaw`SELECT 1 FROM engagements
        WHERE business_id = ${businessId}::uuid AND id = ${to.engagementId}::uuid FOR UPDATE`;
      const open = await tx.intake.findFirst({
        where: {
          businessId,
          engagementId: to.engagementId,
          status: { in: OPEN_FORM_STATUSES },
          form: { templateId: form.id },
        },
        select: { id: true },
      });
      if (open) {
        throw conflict('FORM_ALREADY_OPEN', 'This client already has this form open: resend it');
      }
      const settings = await tx.intakeSettings.findUnique({ where: { businessId } });
      const assignedUserId = await this.assigneeFor(
        tx,
        businessId,
        body.assignedUserId,
        [form.defaultAssignedUserId, settings?.defaultOwnerUserId],
        to,
      );
      const formDays = formMetaOf(form.live.definition).settings['expiresAfterDays'];
      const dates = this.dates(
        body.dueOn,
        body.expiresOn,
        formDays === null || typeof formDays === 'number'
          ? formDays
          : (settings?.defaultExpiryDays ?? 14),
      );
      const data = {
        ...dates,
        assignedUserId,
        deliveryChannel: body.channel,
        messageSubject: body.subject,
        messageBody: body.message,
        remindersEnabled: body.reminders?.enabled ?? settings?.remindersEnabled ?? true,
        allowSaveResume: body.allowSaveAndContinue,
      };
      // The member's own draft of this form for this engagement is the one that is sent.
      const draft = await tx.intake.findFirst({
        where: {
          businessId,
          engagementId: to.engagementId,
          status: 'DRAFT',
          formId: form.live.id,
          createdByUserId: userId,
        },
        orderBy: { updatedAt: 'desc' },
        select: { id: true },
      });
      const intake = draft
        ? await tx.intake.update({
            where: { id: draft.id },
            data: { ...data, status: 'SENT' },
            select: { id: true },
          })
        : await tx.intake.create({
            data: {
              ...data,
              businessId,
              formId: form.live.id,
              engagementId: to.engagementId,
              status: 'SENT',
              createdByUserId: userId,
            },
            select: { id: true },
          });
      const versions = await tx.intakeSubmission.count({
        where: { businessId, intakeId: intake.id },
      });
      if (versions === 0) {
        await tx.intakeSubmission.create({ data: { businessId, intakeId: intake.id, version: 1 } });
      }
      await this.audit.logIn(
        tx,
        'intake.sent',
        { type: 'intake', id: intake.id },
        {
          idempotencyKey: body.idempotencyKey,
          channel: body.channel,
          formId: form.id,
          engagementId: to.engagementId,
          fromDraft: draft !== null,
        },
      );
      return { replay: false as const, id: intake.id };
    });

    let failed: boolean;
    if (sent.replay) {
      failed =
        (await this.database.forBusiness(businessId).auditLog.count({
          where: {
            businessId,
            action: 'intake.delivery_failed',
            entityType: 'intake',
            entityId: sent.id,
          },
        })) > 0;
    } else {
      failed = !(await this.deliver(businessId, sent.id, userId, `intake-send:${sent.id}`));
      if (failed) {
        await this.audit.log('intake.delivery_failed', { type: 'intake', id: sent.id });
      }
    }
    const row = await this.inFirm(tenant, (tx) =>
      tx.intake.findFirstOrThrow({ where: { businessId, id: sent.id }, include: rowInclude }),
    );
    const form = toRow(row);
    return {
      form,
      delivery: {
        channel: (row.deliveryChannel ?? body.channel) as FormDeliveryChannel,
        status: failed ? 'FAILED' : 'SENT',
        to: row.deliveryChannel === 'PORTAL' ? 'Client portal' : maskEmail(form.recipient.email),
      },
    };
  }

  /**
   * The client's bell item and its email copy (R6's Notifier, `intake.sent`). False when nothing
   * reached anyone (no portal login, or the database step failed); the form stays sent.
   */
  async deliver(
    businessId: string,
    intakeId: string,
    actorUserId: string,
    eventKey: string,
  ): Promise<boolean> {
    try {
      const result = await this.notifier.notify({
        businessId,
        event: 'intake.sent',
        recordId: intakeId,
        actorUserId,
        eventKey,
      });
      return !result.failed && result.written > 0;
    } catch (error) {
      this.logger.warn(`intake.sent for intake ${intakeId} not written (${errorName(error)})`);
      return false;
    }
  }

  // ---------- Send drafts ----------

  private toDraft(i: {
    id: string;
    formId: string;
    updatedAt: Date;
    engagementId: string | null;
    leadId: string | null;
    dueOn: Date | null;
    expiresAt: Date | null;
    assignedUserId: string | null;
    deliveryChannel: FormDeliveryChannel | null;
    messageSubject: string | null;
    messageBody: string | null;
    remindersEnabled: boolean;
    allowSaveResume: boolean;
    form: { templateId: string | null; id: string };
    engagement: { clientId: string } | null;
  }): SendDraft {
    const data: Record<string, unknown> = {
      recipient: i.engagement
        ? { kind: 'CLIENT', id: i.engagement.clientId }
        : { kind: 'LEAD', id: i.leadId },
      formId: i.form.templateId ?? i.form.id,
      ...(i.engagementId ? { engagementId: i.engagementId } : {}),
      dueOn: day(i.dueOn),
      expiresOn: day(i.expiresAt),
      assignedUserId: i.assignedUserId,
      reminders: { enabled: i.remindersEnabled },
      allowSaveAndContinue: i.allowSaveResume,
    };
    if (i.deliveryChannel) data['channel'] = i.deliveryChannel;
    if (i.messageSubject) data['subject'] = i.messageSubject;
    if (i.messageBody) data['message'] = i.messageBody;
    return { id: i.id, data, updatedAt: i.updatedAt.toISOString() };
  }

  private readonly draftSelect = {
    id: true,
    formId: true,
    updatedAt: true,
    engagementId: true,
    leadId: true,
    dueOn: true,
    expiresAt: true,
    assignedUserId: true,
    deliveryChannel: true,
    messageSubject: true,
    messageBody: true,
    remindersEnabled: true,
    allowSaveResume: true,
    form: { select: { id: true, templateId: true } },
    engagement: { select: { clientId: true } },
  } satisfies Prisma.IntakeSelect;

  /** GET /business/intakes/send-drafts: the member's own unsent drafts, newest first. */
  async drafts(tenant: TenantContext, userId: string): Promise<{ items: SendDraft[] }> {
    const rows = await this.inFirm(tenant, (tx) =>
      tx.intake.findMany({
        where: { businessId: tenant.businessId, status: 'DRAFT', createdByUserId: userId },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        take: 50,
        select: this.draftSelect,
      }),
    );
    return { items: rows.map((r) => this.toDraft(r)) };
  }

  /**
   * POST /business/intakes/send-drafts and PUT .../{id}: Save as Draft. A new recipient or form
   * on a saved draft starts a new draft (the old one is archived): the response's id is the one
   * to use from then on.
   */
  async saveDraft(
    tenant: TenantContext,
    userId: string,
    body: Draft,
    draftId?: string,
  ): Promise<SendDraft> {
    if (body.recipient?.kind === 'NEW_CONTACT') {
      throw invalid('A draft for a new contact cannot be saved yet: choose a client or lead');
    }
    const businessId = tenant.businessId;
    const { id, replaced } = await this.inFirm(tenant, async (tx) => {
      const before = draftId
        ? await tx.intake.findFirst({
            where: { businessId, id: draftId, status: 'DRAFT', createdByUserId: userId },
            select: this.draftSelect,
          })
        : null;
      if (draftId && !before) throw notFound();
      const prior = before ? this.toDraft(before).data : {};
      const recipient = (body.recipient ?? prior['recipient']) as
        { kind: 'CLIENT' | 'LEAD'; id: string } | undefined;
      const formId = body.formId ?? (prior['formId'] as string | undefined);
      if (!recipient || !formId) {
        throw invalid('Choose a client or lead and a form to save a draft');
      }
      const form = await this.liveForm(tx, businessId, formId);
      const to = await this.recipient(
        tx,
        tenant,
        userId,
        recipient,
        form.serviceId,
        body.engagementId ?? (body.recipient ? undefined : (before?.engagementId ?? undefined)),
      );
      if (body.channel === 'PORTAL' && to.leadId) {
        throw conflict('PORTAL_UNAVAILABLE', 'A lead has no portal access: choose Email');
      }
      const assignedUserId =
        body.assignedUserId === undefined
          ? (before?.assignedUserId ?? null)
          : await this.assigneeFor(tx, businessId, body.assignedUserId, [], to);
      const dueOn =
        body.dueOn === undefined ? (prior['dueOn'] as string | null | undefined) : body.dueOn;
      const expiresOn =
        body.expiresOn === undefined
          ? (prior['expiresOn'] as string | null | undefined)
          : body.expiresOn;
      if (dueOn && expiresOn && dueOn > expiresOn) {
        throw invalid('The due date cannot be after the expiration date');
      }
      const data = {
        dueOn: dueOn ? toDay(dueOn) : null,
        // A draft has no sent time yet: the expiration is checked again when it is sent.
        expiresAt: expiresOn ? endOfDay(expiresOn) : null,
        assignedUserId,
        ...(body.channel !== undefined ? { deliveryChannel: body.channel } : {}),
        ...(body.subject !== undefined ? { messageSubject: body.subject } : {}),
        ...(body.message !== undefined ? { messageBody: body.message } : {}),
        ...(body.reminders !== undefined ? { remindersEnabled: body.reminders.enabled } : {}),
        ...(body.allowSaveAndContinue !== undefined
          ? { allowSaveResume: body.allowSaveAndContinue }
          : {}),
      };
      const same =
        before &&
        before.formId === form.live.id &&
        before.engagementId === to.engagementId &&
        before.leadId === to.leadId;
      if (same) {
        await tx.intake.update({ where: { id: before.id }, data });
        return { id: before.id, replaced: null };
      }
      const created = await tx.intake.create({
        data: {
          ...(before
            ? {
                deliveryChannel: before.deliveryChannel,
                messageSubject: before.messageSubject,
                messageBody: before.messageBody,
                remindersEnabled: before.remindersEnabled,
                allowSaveResume: before.allowSaveResume,
              }
            : {}),
          ...data,
          businessId,
          formId: form.live.id,
          engagementId: to.engagementId,
          leadId: to.leadId,
          status: 'DRAFT',
          createdByUserId: userId,
        },
        select: { id: true },
      });
      if (before) {
        await tx.intake.update({ where: { id: before.id }, data: { status: 'ARCHIVED' } });
      }
      return { id: created.id, replaced: before?.id ?? null };
    });
    await this.audit.log(
      replaced || !draftId ? 'intake.draft_saved' : 'intake.draft_updated',
      { type: 'intake', id },
      {
        fields: Object.keys(body).sort(),
        ...(replaced ? { replacedDraftId: replaced } : {}),
      },
    );
    const row = await this.inFirm(tenant, (tx) =>
      tx.intake.findFirst({ where: { businessId, id }, select: this.draftSelect }),
    );
    if (!row) throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    return this.toDraft(row);
  }
}
