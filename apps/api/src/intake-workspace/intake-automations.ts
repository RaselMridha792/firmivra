import { Inject, Injectable, Logger, Module } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { ConvertLeadToClientRequest } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { LeadConvertService } from '../leads/lead-convert.service.js';
import { LeadsModule } from '../leads/leads.controller.js';
import { OPEN as OPEN_LEADS } from '../leads/leads.service.js';
import { errorName } from '../notifications/notifier.js';

/** Leads that are done: never converted by an automation. */
const CLOSED_LEADS = ['CONVERTED', 'DECLINED', 'EXPIRED', 'LOST', 'DRAFT'];

/** What the automations of one submit did (for tests and the logs; never answers or text). */
export interface SubmitAutomationResult {
  taskId: string | null;
  clientId: string | null;
}

/**
 * Intake Forms Review Two 23-c to 23-f (the lead's decisions of Nov 17): Intake Form Settings >
 * Automation Rules, run once a form is submitted, after the submit committed. Each is once per
 * form: a correction or a resubmit reuses what the first submit made. Each writes its audit row.
 * With a switch OFF, nothing changes from before.
 *
 * - Auto-create client record (a lead's form, through its secure link): the lead becomes a client
 *   as Accept does, an existing client of the same email linked, else a new one, never a second;
 *   no portal invitation is sent (the firm invites from the client's record).
 * - Auto-create follow-up task: one task to review the submitted form, for its owner.
 * - Route by service type and Default follow-up owner: the task's owner is the form's assignee,
 *   else (with Route by service type on) the staff member of the client's engagement for the
 *   form's service, else the default follow-up owner, else nobody yet.
 *
 * A failure is logged with the form's id only and never undoes the submit.
 */
@Injectable()
export class IntakeAutomations {
  private readonly logger = new Logger(IntakeAutomations.name);

  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly convert: LeadConvertService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async afterSubmit(businessId: string, intakeId: string): Promise<SubmitAutomationResult> {
    const result: SubmitAutomationResult = { taskId: null, clientId: null };
    try {
      const plan = await this.inFirm(businessId, (tx) => this.plan(tx, businessId, intakeId));
      if (!plan) return result;
      if (plan.autoCreateClient && plan.lead) {
        result.clientId = await this.clientFor(businessId, intakeId, plan);
      }
      if (plan.autoCreateFollowUpTask) {
        result.taskId = await this.followUp(businessId, intakeId, {
          ...plan,
          clientId: plan.clientId ?? result.clientId,
        });
      }
    } catch (error) {
      this.logger.warn(`intake automations for intake ${intakeId} stopped (${errorName(error)})`);
    }
    return result;
  }

  /** The settings, the form and who would own its follow-up; null when every switch is off. */
  private async plan(tx: TxClient, businessId: string, intakeId: string) {
    const settings = await tx.intakeSettings.findUnique({
      where: { businessId },
      select: {
        autoCreateClient: true,
        autoCreateFollowUpTask: true,
        routeByService: true,
        followUpOwnerUserId: true,
      },
    });
    if (!settings?.autoCreateClient && !settings?.autoCreateFollowUpTask) return null;
    const intake = await tx.intake.findFirst({
      where: { businessId, id: intakeId },
      select: {
        assignedUserId: true,
        form: { select: { title: true, serviceId: true } },
        engagement: { select: { id: true, clientId: true, assignedUserId: true } },
        lead: {
          select: {
            id: true,
            email: true,
            status: true,
            clientId: true,
            firstName: true,
            lastName: true,
            phone: true,
            businessName: true,
            serviceId: true,
            archivedAt: true,
          },
        },
      },
    });
    if (!intake) return null;
    const active = async (userId: string | null | undefined) =>
      userId &&
      (await tx.membership.findFirst({
        where: { businessId, userId, status: 'ACTIVE' },
        select: { userId: true },
      }))
        ? userId
        : null;
    // The owner's order: the form's assignee, the engagement's staff (Route by service type),
    // the default follow-up owner.
    const ownerUserId =
      (await active(intake.assignedUserId)) ??
      (settings.routeByService ? await active(intake.engagement?.assignedUserId) : null) ??
      (await active(settings.followUpOwnerUserId));
    return {
      autoCreateClient: settings.autoCreateClient,
      autoCreateFollowUpTask: settings.autoCreateFollowUpTask,
      ownerUserId,
      formTitle: intake.form.title,
      clientId: intake.engagement?.clientId ?? intake.lead?.clientId ?? null,
      engagementId: intake.engagement?.id ?? null,
      lead: intake.lead,
    };
  }

  /**
   * 23-c: the lead becomes a client, once, through the Leads module's own conversion (the
   * database keeps a lead's client, engagement and CONVERTED together): a submitted web lead as
   * Accept converts it; a lead the firm works in the pipeline as Convert to Client does (it needs
   * the lead's phone). An existing client of the same email is linked instead of a new one; no
   * portal invitation goes out. A lead already converted keeps its client; a closed lead, or a
   * pipeline lead without a phone, is left as it is (audited with the reason). The conversion
   * acts as the firm's Owner (the automation has no person of its own).
   */
  private async clientFor(
    businessId: string,
    intakeId: string,
    plan: NonNullable<Awaited<ReturnType<IntakeAutomations['plan']>>>,
  ): Promise<string | null> {
    const lead = plan.lead!;
    if (lead.clientId) return lead.clientId;
    const skipped = async (reason: string) => {
      await this.audit.log(
        'intake.client_auto_skipped',
        { type: 'intake', id: intakeId },
        { reason },
        { businessId },
      );
      return null;
    };
    if (lead.archivedAt || CLOSED_LEADS.includes(lead.status)) return skipped('LEAD_CLOSED');
    const { owner, existing } = await this.inFirm(businessId, async (tx) => ({
      owner: await tx.membership.findFirst({
        where: { businessId, role: 'OWNER', status: 'ACTIVE' },
        orderBy: [{ createdAt: 'asc' }, { userId: 'asc' }],
        select: { userId: true },
      }),
      existing: await tx.client.findFirst({
        where: { businessId, email: { equals: lead.email, mode: 'insensitive' } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
    }));
    if (!owner) return skipped('NO_OWNER');
    const actor = { userId: owner.userId, role: 'OWNER' as const };
    let clientId: string;
    if ((OPEN_LEADS as readonly string[]).includes(lead.status)) {
      clientId = (
        await this.convert.convert(businessId, actor, lead.id, {
          ...(existing ? { clientId: existing.id } : {}),
          ...(plan.ownerUserId ? { assignedUserId: plan.ownerUserId } : {}),
          sendPortalInvite: false,
        })
      ).clientId;
    } else {
      if (!lead.phone) return skipped('NO_PHONE');
      clientId = (
        await this.convert.convertToClient(
          businessId,
          actor,
          lead.id,
          ConvertLeadToClientRequest.parse({
            idempotencyKey: intakeId,
            ...(existing ? { clientId: existing.id } : {}),
            fullName: `${lead.firstName} ${lead.lastName}`.trim().slice(0, 120),
            ...(lead.businessName ? { businessName: lead.businessName } : {}),
            email: lead.email,
            phone: lead.phone,
            serviceIds: [lead.serviceId],
            primaryStaffUserId: plan.ownerUserId ?? owner.userId,
            sendPortalInvite: false,
          }),
        )
      ).clientId;
    }
    await this.audit.log(
      'intake.client_auto_created',
      { type: 'intake', id: intakeId },
      { clientId, linked: existing ? 'existing' : 'new' },
      { businessId },
    );
    return clientId;
  }

  /**
   * 23-d: one follow-up task per form. The form's id is the task's idempotency key (scope
   * 'create'), so a correction or a resubmit finds the first task and makes no second one.
   */
  private async followUp(
    businessId: string,
    intakeId: string,
    plan: NonNullable<Awaited<ReturnType<IntakeAutomations['plan']>>>,
  ): Promise<string | null> {
    const made = await this.inFirm(businessId, async (tx) => {
      const found = await tx.task.findFirst({
        where: { businessId, idempotencyKey: intakeId },
        select: { id: true },
      });
      if (found) return null;
      return tx.task.create({
        data: {
          businessId,
          title: `Review the submitted form: ${plan.formTitle}`.slice(0, 200),
          details: 'Made when the form was submitted (Intake Form Settings > Automation Rules).',
          ...(plan.clientId
            ? {
                clientId: plan.clientId,
                ...(plan.engagementId ? { engagementId: plan.engagementId } : {}),
              }
            : plan.lead
              ? { leadId: plan.lead.id }
              : {}),
          ...(plan.ownerUserId ? { assignedUserId: plan.ownerUserId } : {}),
          idempotencyKey: intakeId,
          idempotencyScope: 'create',
        },
        select: { id: true },
      });
    });
    if (!made) return null;
    await this.audit.log(
      'intake.follow_up_task_created',
      { type: 'intake', id: intakeId },
      { taskId: made.id, assigned: plan.ownerUserId !== null },
      { businessId },
    );
    return made.id;
  }
}

/** The submit automations, for the portal's and the secure link's submit. */
@Module({
  imports: [LeadsModule],
  providers: [IntakeAutomations],
  exports: [IntakeAutomations],
})
export class IntakeAutomationsModule {}
