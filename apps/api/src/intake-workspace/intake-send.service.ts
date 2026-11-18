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
import { intakeReminderPlan } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { errorName, Notifier } from '../notifications/notifier.js';
import { NOTIFY_SERVICE, type NotifyService } from '../notify/notify.types.js';
import { checkAssignee, conflict, notFound, toDay } from '../workspaces/common.js';
import { rowInclude, toRow } from './intake-workspace.service.js';
import { emailLeadLink, newLeadLink } from './lead-link.js';
import type { SendBody, SendDraftBody } from './workspace-input.js';
import { day, formMetaOf, iso } from './workspace.common.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { checkDue, chosenExpiry, expiryAfterDays } from './intake-expiry.js';
import { requestedEngagement } from '../engagements/requested-engagement.js';
import { auditChanges } from '../audit/audit-changes.js';

/** N8-23: the title of the pending request an intake send makes (no service yet). */
export const REQUESTED_TITLE = 'Requested (from an intake send)';

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
    'Forms for new contacts are not available yet: add them as a lead first',
  );

/** "d***@example.test": the address the form went to, masked. */
export function maskEmail(email: string | null): string {
  if (!email) return '';
  const [name = '', domain = ''] = email.split('@');
  return `${name.slice(0, 1)}***@${domain}`;
}

/** What reached the client for one send, resend or reminder (19b). */
export interface DeliveryOutcome {
  status: 'SENT' | 'RETRYING' | 'FAILED';
  /** The portal notice (bell item) was written. */
  portalNotice: boolean;
  reason: string | null;
  /** Why, as a code History can keep (no address or mail-service text in the audit). */
  code?: DeliveryCode;
}

/** Why a delivery did not (yet) reach the recipient, for History (19b). */
export type DeliveryCode =
  | 'NO_PORTAL_LOGIN'
  | 'WRITE_FAILED'
  | 'EMAIL_RETRYING'
  | 'NOT_OPEN'
  | 'NO_EMAIL_ADDRESS'
  | 'LEAD_EMAIL_FAILED';

const NO_PORTAL_LOGIN =
  'Nothing was sent: this client has no client portal login yet, and the form opens in the portal. Invite them to the portal, then use Resend.';
const WRITE_FAILED =
  'Nothing was sent: the portal notice could not be written (a problem on our side). Use Resend in a moment.';
export const LEAD_EMAIL_FAILED =
  'The email with the secure link could not be sent. Use Resend to send a new link.';

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
 * get the form in the portal: the bell and its email copy through R6's Notifier (which never sends
 * text from a caller). A lead gets an email with a secure link (lead-link.ts: the token's hash
 * kept on the intake; the member's subject and message in the email) to the link page
 * (IntakeLinkService). New contacts are not available yet (503 LEAD_LINK_UNAVAILABLE); SMS has no
 * sender for intake forms yet (400 SMS_UNAVAILABLE).
 */
@Injectable()
export class IntakeSendService {
  private readonly logger = new Logger(IntakeSendService.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly notifier: Notifier,
    @Inject(NOTIFY_SERVICE) private readonly notify: NotifyService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private isStaff(tenant: TenantContext) {
    return legacyFirmRole(tenant.role as Parameters<typeof legacyFirmRole>[0]) === 'STAFF';
  }

  /**
   * A9: the client's own appointment a form is for (never another client's, or a cancelled one);
   * the appointment then shows the form and whether it is done. 409 APPOINTMENT_MISMATCH.
   */
  private async appointmentOf(
    tx: TxClient,
    businessId: string,
    to: { clientId: string | null },
    appointmentId: string,
  ): Promise<void> {
    const appointment = to.clientId
      ? await tx.appointment.findFirst({
          where: {
            businessId,
            id: appointmentId,
            clientId: to.clientId,
            status: { not: 'CANCELLED' },
          },
          select: { id: true },
        })
      : null;
    if (!appointment) {
      throw conflict(
        'APPOINTMENT_MISMATCH',
        "That appointment is not this client's, or it is cancelled",
      );
    }
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
    const found = await tx.engagement.findFirst({
      where: {
        businessId,
        clientId: client.id,
        serviceId,
        ...(engagementId ? { id: engagementId } : { status: 'ACTIVE' }),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, status: true },
    });
    if (!found && engagementId) throw notFound();
    const engagement =
      found ??
      (await requestedEngagement(tx, this.audit, {
        businessId,
        userId,
        clientId: client.id,
        serviceId,
        title: REQUESTED_TITLE,
        via: 'intake_send',
      }));
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

  /**
   * Due date and expiration (EXPIRY-01): the time chosen (later than now), else the form's default
   * of N days, else the firm's, each to the end of that day in the firm's time zone; null: none.
   */
  private dates(
    body: { dueOn?: string | null; expiresOn?: string | null; expiresAt?: string | null },
    fallbackDays: number | null,
    timeZone: string,
  ) {
    const chosen = chosenExpiry(body, timeZone);
    const expires =
      chosen !== undefined ? chosen : fallbackDays ? expiryAfterDays(fallbackDays, timeZone) : null;
    checkDue(body.dueOn, expires, timeZone);
    return { dueOn: body.dueOn ? toDay(body.dueOn) : null, expiresAt: expires };
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
    if (body.recipient.kind === 'NEW_CONTACT') throw leadLinkUnavailable();
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
      if (body.appointmentId) await this.appointmentOf(tx, businessId, to, body.appointmentId);
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
        throw invalid(`This ${to.leadId ? 'lead' : 'client'} has no email address`);
      }
      // Held so two sends to one engagement (or lead) run one at a time.
      if (to.engagementId) {
        await tx.$executeRaw`SELECT 1 FROM engagements
          WHERE business_id = ${businessId}::uuid AND id = ${to.engagementId}::uuid FOR UPDATE`;
      } else {
        await tx.$executeRaw`SELECT 1 FROM leads
          WHERE business_id = ${businessId}::uuid AND id = ${to.leadId}::uuid FOR UPDATE`;
      }
      const whose = to.engagementId ? { engagementId: to.engagementId } : { leadId: to.leadId };
      const open = await tx.intake.findFirst({
        where: {
          businessId,
          ...whose,
          status: { in: OPEN_FORM_STATUSES },
          form: { templateId: form.id },
        },
        select: { id: true },
      });
      if (open) {
        throw conflict(
          'FORM_ALREADY_OPEN',
          `This ${to.leadId ? 'lead' : 'client'} already has this form open: resend it`,
        );
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
        body,
        formDays === null || typeof formDays === 'number'
          ? formDays
          : (settings?.defaultExpiryDays ?? 14),
        await firmTimeZone(tx, businessId),
      );
      // A lead's secure link: the token for the email only, its hash kept on the intake.
      const link = to.leadId ? newLeadLink(dates.expiresAt) : null;
      // Review Two 22 (P2-5): the firm's No reminders holds; a send can only turn them off.
      const reminders = (settings?.remindersEnabled ?? true) && (body.reminders?.enabled ?? true);
      const data = {
        ...dates,
        ...(link?.data ?? {}),
        assignedUserId,
        deliveryChannel: body.channel,
        messageSubject: body.subject,
        messageBody: body.message,
        remindersEnabled: reminders,
        // The schedule, fixed now (r1_intake_schedule): later settings never move this form. The
        // first counts from sending; the final and the staff alert count back from its expiry.
        reminderFirstMinutes: reminders ? (settings?.firstReminderMinutes ?? 4320) : null,
        reminderFinalMinutes:
          reminders && dates.expiresAt ? (settings?.finalReminderMinutes ?? 10080) : null,
        expiryAlertMinutes: dates.expiresAt
          ? settings
            ? settings.expiryAlertMinutes
            : 1440
          : null,
        allowSaveResume: body.allowSaveAndContinue,
        ...(body.appointmentId ? { appointmentId: body.appointmentId } : {}),
      };
      // The member's own draft of this form for this engagement (or lead) is the one that is sent.
      const draft = await tx.intake.findFirst({
        where: {
          businessId,
          ...whose,
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
              leadId: to.leadId,
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
          ...whose,
          fromDraft: draft !== null,
          ...(body.appointmentId ? { appointmentId: body.appointmentId } : {}),
        },
      );
      // Review Two 10c: a reminder the order rules skip is in History from the start, as the
      // send screen said (the schedule job never sends it).
      const plan = intakeReminderPlan({
        sentAt: new Date(),
        expiresAt: data.expiresAt,
        firstMinutes: data.reminderFirstMinutes,
        finalMinutes: data.reminderFinalMinutes,
      });
      for (const [kind, reason] of [
        ['FIRST', plan.firstSkipped],
        ['FINAL', plan.finalSkipped],
      ] as const) {
        if (!reason) continue;
        await this.audit.logIn(
          tx,
          'intake.reminder_skipped',
          { type: 'intake', id: intake.id },
          { kind, reason },
        );
      }
      return { replay: false as const, id: intake.id, token: link?.token ?? null };
    });

    const sentRow = await this.inFirm(tenant, (tx) =>
      tx.intake.findFirstOrThrow({
        where: { businessId, id: sent.id },
        select: { deliveryChannel: true, leadId: true },
      }),
    );
    const byEmail = (sentRow.deliveryChannel ?? body.channel) === 'EMAIL';
    const key = `intake-send:${sent.id}`;
    let outcome: DeliveryOutcome;
    if (sent.replay) {
      // The same answer as the first time: read from what was written, never sent again.
      outcome = sentRow.leadId
        ? (await this.database.forBusiness(businessId).auditLog.count({
            where: {
              businessId,
              action: 'intake.delivery_failed',
              entityType: 'intake',
              entityId: sent.id,
            },
          })) > 0
          ? {
              status: 'FAILED',
              portalNotice: false,
              reason: LEAD_EMAIL_FAILED,
              code: 'LEAD_EMAIL_FAILED',
            }
          : { status: 'SENT', portalNotice: false, reason: null }
        : await this.outcomeOf(businessId, sent.id, key, byEmail, null);
    } else {
      outcome = sent.token
        ? (await this.emailLink(businessId, sent.id, sent.token))
          ? { status: 'SENT', portalNotice: false, reason: null }
          : {
              status: 'FAILED',
              portalNotice: false,
              reason: LEAD_EMAIL_FAILED,
              code: 'LEAD_EMAIL_FAILED',
            }
        : await this.deliver(businessId, sent.id, userId, key, byEmail);
      if (outcome.status === 'FAILED') {
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
        status: outcome.status,
        to: row.deliveryChannel === 'PORTAL' ? 'Client portal' : maskEmail(form.recipient.email),
        portalNotice: outcome.portalNotice,
        reason: outcome.reason,
      },
    };
  }

  /** A lead's form: the email with its secure link (lead-link.ts). */
  emailLink(businessId: string, intakeId: string, token: string): Promise<boolean> {
    return emailLeadLink(
      { database: this.database, notify: this.notify, env: this.env, logger: this.logger },
      businessId,
      intakeId,
      token,
    );
  }

  /**
   * The client's portal notice (R6's Notifier, `intake.sent`) and, for a form sent by Email, its
   * email through the outbox (19b). The outcome says what really happened: the email accepted by
   * the mail service, retrying, or not sent and why. The form stays sent either way.
   */
  async deliver(
    businessId: string,
    intakeId: string,
    actorUserId: string | null,
    eventKey: string,
    byEmail: boolean,
    /** The schedule job's reminders use their own words (`intake.reminder`). */
    event: 'intake.sent' | 'intake.reminder' = 'intake.sent',
  ): Promise<DeliveryOutcome> {
    let written: { written: number; failed?: boolean };
    try {
      written = await this.notifier.notify({
        businessId,
        event,
        recordId: intakeId,
        actorUserId,
        eventKey,
        channels: { inApp: true, email: byEmail, sms: false },
      });
    } catch (error) {
      this.logger.warn(`${event} for intake ${intakeId} not written (${errorName(error)})`);
      written = { written: 0, failed: true };
    }
    return this.outcomeOf(businessId, intakeId, eventKey, byEmail, written);
  }

  /**
   * What reached the client for one delivery (`eventKey`), read from its portal notice and that
   * notice's email row in the outbox, so a replayed send answers as the first one did. `written`
   * is the Notifier's own answer when there is one (a database failure there writes nothing).
   */
  async outcomeOf(
    businessId: string,
    intakeId: string,
    eventKey: string,
    byEmail: boolean,
    written: { written: number; failed?: boolean } | null,
  ): Promise<DeliveryOutcome> {
    const db = this.database.forBusiness(businessId);
    const notices = await db.notification.findMany({
      where: { businessId, entityId: intakeId, eventKey },
      select: { id: true, recipientUserId: true },
    });
    const clients = notices.length
      ? await db.clientAccount.findMany({
          where: { businessId, userId: { in: notices.map((n) => n.recipientUserId) } },
          select: { userId: true },
        })
      : [];
    const mine = notices.filter((n) => clients.some((c) => c.userId === n.recipientUserId));
    if (mine.length === 0) {
      return {
        status: 'FAILED',
        portalNotice: false,
        reason: written?.failed ? WRITE_FAILED : NO_PORTAL_LOGIN,
        code: written?.failed ? 'WRITE_FAILED' : 'NO_PORTAL_LOGIN',
      };
    }
    if (!byEmail) return { status: 'SENT', portalNotice: true, reason: null };
    const email = await db.notificationDelivery.findFirst({
      where: { businessId, channel: 'EMAIL', notificationId: { in: mine.map((n) => n.id) } },
      orderBy: { createdAt: 'desc' },
      select: { status: true, lastError: true },
    });
    if (email?.status === 'SENT') return { status: 'SENT', portalNotice: true, reason: null };
    if (email?.status === 'QUEUED' || email?.status === 'FAILED') {
      return {
        status: 'RETRYING',
        portalNotice: true,
        code: 'EMAIL_RETRYING',
        reason: `The mail service has not accepted the email yet${email.lastError ? ` (${email.lastError})` : ''}. It is tried again automatically for about 25 minutes; the portal notice is already there.`,
      };
    }
    return {
      status: 'FAILED',
      portalNotice: true,
      reason: email
        ? 'No email was sent: the form is no longer open.'
        : 'No email was sent: the client portal login has no email address. The portal notice is there.',
      code: email ? 'NOT_OPEN' : 'NO_EMAIL_ADDRESS',
    };
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
      expiresAt: iso(i.expiresAt),
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
    const { id, replaced, changes } = await this.inFirm(tenant, async (tx) => {
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
      // A9: a draft keeps an appointment only of its client, as sending checks.
      if (body.appointmentId) await this.appointmentOf(tx, businessId, to, body.appointmentId);
      const dueOn =
        body.dueOn === undefined ? (prior['dueOn'] as string | null | undefined) : body.dueOn;
      const timeZone = await firmTimeZone(tx, businessId);
      // A draft has no sent time yet: the expiration is checked against now when it is sent.
      const chosen = chosenExpiry(body, timeZone, false);
      const kept = prior['expiresAt'];
      const expiresAt =
        chosen !== undefined ? chosen : typeof kept === 'string' ? new Date(kept) : null;
      checkDue(dueOn, expiresAt, timeZone);
      const data = {
        dueOn: dueOn ? toDay(dueOn) : null,
        expiresAt,
        assignedUserId,
        ...(body.channel !== undefined ? { deliveryChannel: body.channel } : {}),
        ...(body.subject !== undefined ? { messageSubject: body.subject } : {}),
        ...(body.message !== undefined ? { messageBody: body.message } : {}),
        ...(body.reminders !== undefined ? { remindersEnabled: body.reminders.enabled } : {}),
        ...(body.allowSaveAndContinue !== undefined
          ? { allowSaveResume: body.allowSaveAndContinue }
          : {}),
      };
      // Audit Log Review 2, R03: each changed field's old and new value (the message as "changed").
      const changes = auditChanges(before ?? {}, data, { fields: Object.keys(data) });
      const same =
        before &&
        before.formId === form.live.id &&
        before.engagementId === to.engagementId &&
        before.leadId === to.leadId;
      if (same) {
        await tx.intake.update({ where: { id: before.id }, data });
        return { id: before.id, replaced: null, changes };
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
      return { id: created.id, replaced: before?.id ?? null, changes };
    });
    await this.audit.log(
      replaced || !draftId ? 'intake.draft_saved' : 'intake.draft_updated',
      { type: 'intake', id },
      {
        ...changes,
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
