import {
  Body,
  Controller,
  Delete,
  HttpCode,
  Inject,
  Injectable,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  AddLeadFollowUpRequest,
  CompleteLeadFollowUpRequest,
  type LeadFollowUp,
  LeadId,
  type LeadProfile,
  UpdateLeadFollowUpRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { pipelineActor } from './lead-pipeline.controller.js';
import { conflict, notFound } from './leads.service.js';
import { CLOSED_STATUSES, loadProfile, lockLead, type PipelineActor } from './pipeline.shared.js';

// L8 (Octavia's Leads review of Oct 20): a lead's follow-up steps (lead_follow_ups, R1's #1051),
// each with its action, date and time, and notes; added while creating the lead or later, edited
// and removed while unfinished, completed with an outcome. The lead's Next Action is its next
// unfinished step: the lead's next_action_* columns are kept as that step's copy, so the list,
// the Overdue Follow-Ups card and Automations read it as before. A closed lead has no next action.

export type FollowUpInput = { type: LeadFollowUp['type']; dueAt: string; notes?: string | null };

export const ACTION_LABEL: Record<LeadFollowUp['type'], string> = {
  CALL: 'Call',
  EMAIL: 'Email',
  SMS: 'Text message',
  APPOINTMENT: 'Appointment',
  SEND_DOCUMENTS: 'Send documents',
  FOLLOW_UP: 'Follow up',
  CLOSE_LEAD: 'Close lead',
};

/**
 * A next action set before follow-up steps existed has no step: it becomes the lead's first one,
 * so nothing is lost when the steps take over.
 */
export async function adoptLegacy(
  tx: TxClient,
  businessId: string,
  leadId: string,
  userId: string | null,
): Promise<void> {
  const lead = await tx.lead.findFirst({
    where: { businessId, id: leadId },
    select: { nextActionType: true, nextActionAt: true, nextActionNote: true },
  });
  if (!lead?.nextActionType || !lead.nextActionAt) return;
  const open = await tx.leadFollowUp.count({ where: { businessId, leadId, doneAt: null } });
  if (open) return;
  await tx.leadFollowUp.create({
    data: {
      businessId,
      leadId,
      actionType: lead.nextActionType,
      dueAt: lead.nextActionAt,
      note: lead.nextActionNote,
      createdByUserId: userId,
    },
  });
}

/** New steps, each recorded in the lead's timeline (as Set Follow-Up always was). */
export async function addSteps(
  tx: TxClient,
  businessId: string,
  leadId: string,
  userId: string,
  steps: FollowUpInput[],
): Promise<void> {
  for (const step of steps) {
    await tx.leadFollowUp.create({
      data: {
        businessId,
        leadId,
        actionType: step.type,
        dueAt: new Date(step.dueAt),
        note: step.notes ?? null,
        createdByUserId: userId,
      },
    });
    await tx.leadActivity.create({
      data: {
        businessId,
        leadId,
        kind: 'FOLLOW_UP',
        actorUserId: userId,
        summary: ACTION_LABEL[step.type],
        metadata: { type: step.type, dueAt: step.dueAt },
      },
    });
  }
}

/** A lead that takes a follow-up: 404 archived, 409 ALREADY_CONVERTED or LEAD_CLOSED. */
function openForFollowUp(lead: { status: string; archivedAt: Date | null }): void {
  if (lead.archivedAt) throw notFound();
  if (lead.status === 'CONVERTED')
    throw conflict('ALREADY_CONVERTED', 'This lead is already a client');
  if (CLOSED_STATUSES.includes(lead.status as (typeof CLOSED_STATUSES)[number]))
    throw conflict('LEAD_CLOSED', 'A closed lead has no follow-up');
}

/** The lead's next action is its next unfinished step; none for a closed lead. */
export async function syncNextAction(
  tx: TxClient,
  businessId: string,
  leadId: string,
  userId: string,
): Promise<void> {
  const lead = await tx.lead.findFirst({
    where: { businessId, id: leadId },
    select: { status: true },
  });
  const closed = !lead || CLOSED_STATUSES.includes(lead.status as (typeof CLOSED_STATUSES)[number]);
  const next = closed
    ? null
    : await tx.leadFollowUp.findFirst({
        where: { businessId, leadId, doneAt: null },
        orderBy: [{ dueAt: 'asc' }, { id: 'asc' }],
      });
  await tx.lead.update({
    where: { id: leadId },
    data: {
      nextActionType: next?.actionType ?? null,
      nextActionAt: next?.dueAt ?? null,
      nextActionNote: next?.note ?? null,
      updatedByUserId: userId,
    },
  });
}

@Injectable()
export class LeadFollowUpsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  add(businessId: string, actor: PipelineActor, id: string, body: FollowUpInput) {
    return this.change(businessId, actor, id, 'lead.follow_up_added', { type: body.type }, (tx) =>
      addSteps(tx, businessId, id, actor.userId, [body]),
    );
  }

  /**
   * P4-2 (Clients Review 2 N8-18): Keep as Lead and Follow Up on a completed appointment with the
   * lead: one more step, by add's rules (404 archived, 409 LEAD_CLOSED or ALREADY_CONVERTED), in
   * the appointment's own transaction. The member reached the lead through that appointment (they
   * see it in full: its staff member, or the lead's), so the lead's row is locked here without the
   * lead pages' Staff rule. Audited as add is: the step's type only.
   */
  async addWithin(
    tx: TxClient,
    businessId: string,
    userId: string,
    leadId: string,
    body: FollowUpInput,
  ): Promise<void> {
    const [lead] = await tx.$queryRaw<{ status: string; archived_at: Date | null }[]>`
      SELECT status::text AS status, archived_at FROM leads
      WHERE business_id = ${businessId}::uuid AND id = ${leadId}::uuid
        AND status::text NOT IN ('DRAFT', 'EXPIRED')
      FOR UPDATE`;
    if (!lead) throw notFound();
    openForFollowUp({ status: lead.status, archivedAt: lead.archived_at });
    await adoptLegacy(tx, businessId, leadId, userId);
    await addSteps(tx, businessId, leadId, userId, [body]);
    await syncNextAction(tx, businessId, leadId, userId);
    await this.audit.logIn(
      tx,
      'lead.follow_up_added',
      { type: 'lead', id: leadId },
      { type: body.type },
    );
  }

  update(
    businessId: string,
    actor: PipelineActor,
    id: string,
    followUpId: string,
    body: Partial<FollowUpInput>,
  ) {
    return this.change(businessId, actor, id, 'lead.follow_up_changed', {}, async (tx) => {
      await this.unfinished(tx, businessId, id, followUpId);
      await tx.leadFollowUp.update({
        where: { id: followUpId },
        data: {
          ...(body.type !== undefined ? { actionType: body.type } : {}),
          ...(body.dueAt !== undefined ? { dueAt: new Date(body.dueAt) } : {}),
          ...(body.notes !== undefined ? { note: body.notes } : {}),
        },
      });
    });
  }

  remove(businessId: string, actor: PipelineActor, id: string, followUpId: string) {
    return this.change(businessId, actor, id, 'lead.follow_up_removed', {}, async (tx) => {
      await this.unfinished(tx, businessId, id, followUpId);
      await tx.leadFollowUp.delete({ where: { id: followUpId } });
    });
  }

  complete(
    businessId: string,
    actor: PipelineActor,
    id: string,
    followUpId: string,
    outcome: string | null,
  ) {
    return this.change(businessId, actor, id, 'lead.follow_up_completed', {}, async (tx) => {
      const step = await this.unfinished(tx, businessId, id, followUpId);
      await tx.leadFollowUp.update({
        where: { id: followUpId },
        data: { doneAt: new Date(), outcome },
      });
      await tx.leadActivity.create({
        data: {
          businessId,
          leadId: id,
          kind: 'FOLLOW_UP_COMPLETED',
          actorUserId: actor.userId,
          summary: ACTION_LABEL[step.actionType],
          body: outcome,
          metadata: { type: step.actionType },
        },
      });
    });
  }

  /**
   * One change to an open lead the member reaches (404, 409 LEAD_CLOSED or ALREADY_CONVERTED):
   * the lead held, its older next action adopted, the change, then its next action again. The
   * audit row names the action only, never a note or outcome.
   */
  private async change(
    businessId: string,
    actor: PipelineActor,
    id: string,
    action: string,
    metadata: Record<string, unknown>,
    work: (tx: TxClient) => Promise<void>,
  ): Promise<LeadProfile> {
    const profile = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      openForFollowUp(await lockLead(tx, businessId, actor, id));
      await adoptLegacy(tx, businessId, id, actor.userId);
      await work(tx);
      await syncNextAction(tx, businessId, id, actor.userId);
      await this.audit.logIn(tx, action, { type: 'lead', id }, metadata);
      return loadProfile(tx, businessId, actor, id, { unrestricted: true });
    });
    return profile;
  }

  /** The lead's unfinished step: 404 when it isn't the lead's, 409 FOLLOW_UP_DONE once done. */
  private async unfinished(tx: TxClient, businessId: string, leadId: string, followUpId: string) {
    const step = await tx.leadFollowUp.findFirst({
      where: { businessId, leadId, id: followUpId },
      select: { actionType: true, doneAt: true },
    });
    if (!step) throw notFound();
    if (step.doneAt) throw conflict('FOLLOW_UP_DONE', 'This follow-up is already done');
    return step;
  }
}

const idPipe = new ZodValidationPipe(LeadId);

/** L8: a lead's follow-up steps (the Lead Workspace's Next Action / Follow-Up card). */
@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadFollowUpsController {
  constructor(private readonly steps: LeadFollowUpsService) {}

  @Post(':id/follow-ups')
  add(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddLeadFollowUpRequest))
    body: z.output<typeof AddLeadFollowUpRequest>,
  ): Promise<LeadProfile> {
    return this.steps.add(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Patch(':id/follow-ups/:followUpId')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('followUpId', idPipe) followUpId: string,
    @Body(new ZodValidationPipe(UpdateLeadFollowUpRequest))
    body: z.output<typeof UpdateLeadFollowUpRequest>,
  ): Promise<LeadProfile> {
    return this.steps.update(tenant.businessId, pipelineActor(auth, tenant), id, followUpId, body);
  }

  @Delete(':id/follow-ups/:followUpId')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('followUpId', idPipe) followUpId: string,
  ): Promise<LeadProfile> {
    return this.steps.remove(tenant.businessId, pipelineActor(auth, tenant), id, followUpId);
  }

  @Post(':id/follow-ups/:followUpId/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('followUpId', idPipe) followUpId: string,
    @Body(new ZodValidationPipe(CompleteLeadFollowUpRequest))
    body: z.output<typeof CompleteLeadFollowUpRequest>,
  ): Promise<LeadProfile> {
    return this.steps.complete(
      tenant.businessId,
      pipelineActor(auth, tenant),
      id,
      followUpId,
      body.outcome ?? null,
    );
  }
}
