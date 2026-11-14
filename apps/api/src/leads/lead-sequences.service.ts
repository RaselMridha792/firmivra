import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  ApplyLeadSequenceRequest,
  LeadId,
  type LeadProfile,
  type LeadSequenceTemplate,
  SaveLeadSequenceRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { syncNextAction } from './lead-follow-ups.js';
import { pipelineActor } from './lead-pipeline.controller.js';
import { notFound } from './leads.service.js';
import { CLOSED_STATUSES, loadProfile, lockLead, type PipelineActor } from './pipeline.shared.js';

const conflict = (code: string, message: string) => new ConflictException({ code, message });
const idPipe = new ZodValidationPipe(LeadId);
const uuidPipe = new ZodValidationPipe(z.uuid());

/** "09:30" from a TIME column, or null. */
const timeOf = (t: Date | null) => (t ? t.toISOString().slice(11, 16) : null);
/** A TIME column's value for "09:30". */
const timeValue = (t: string | null) => (t ? new Date(`1970-01-01T${t}:00.000Z`) : null);

/**
 * Leads R2 19: reusable follow-up sequences. Templates (Owner, Admin) are archived, never deleted
 * (a run names its template). Applying one (anyone who reaches the lead, on an open lead) makes
 * the steps the member previewed and edited into the lead's follow-up steps, each with its owner
 * and REMINDER or OUTREACH; nothing is ever sent. One open run of a template per lead (409
 * SEQUENCE_ALREADY_APPLIED). Audited with ids and counts, never a note.
 */
@Injectable()
export class LeadSequencesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async read(tx: TxClient, businessId: string, id?: string) {
    const rows = await tx.leadSequenceTemplate.findMany({
      where: { businessId, archivedAt: null, ...(id ? { id } : {}) },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: { steps: { orderBy: { position: 'asc' } } },
    });
    return rows.map((t): LeadSequenceTemplate => ({
      id: t.id,
      name: t.name,
      description: t.description,
      updatedAt: t.updatedAt.toISOString(),
      steps: t.steps.map((s) => ({
        offsetDays: s.offsetDays,
        atTime: timeOf(s.atTime),
        actionType: s.actionType,
        mode: s.mode,
        owner: s.owner,
        note: s.note,
      })),
    }));
  }

  list(businessId: string): Promise<LeadSequenceTemplate[]> {
    return this.inFirm(businessId, (tx) => this.read(tx, businessId));
  }

  async save(
    businessId: string,
    userId: string,
    body: z.output<typeof SaveLeadSequenceRequest>,
    id?: string,
  ): Promise<LeadSequenceTemplate> {
    try {
      return await this.inFirm(businessId, async (tx) => {
        let templateId = id;
        if (id) {
          const found = await tx.leadSequenceTemplate.findFirst({
            where: { businessId, id, archivedAt: null },
            select: { id: true },
          });
          if (!found) throw notFound();
          await tx.leadSequenceTemplate.update({
            where: { id },
            data: { name: body.name, description: body.description ?? null },
          });
          await tx.leadSequenceStep.deleteMany({ where: { businessId, templateId: id } });
        } else {
          templateId = (
            await tx.leadSequenceTemplate.create({
              data: {
                businessId,
                name: body.name,
                description: body.description ?? null,
                createdByUserId: userId,
              },
              select: { id: true },
            })
          ).id;
        }
        await tx.leadSequenceStep.createMany({
          data: body.steps.map((s, position) => ({
            businessId,
            templateId: templateId!,
            position,
            offsetDays: s.offsetDays,
            atTime: timeValue(s.atTime),
            actionType: s.actionType,
            mode: s.mode,
            owner: s.owner,
            note: s.note ?? null,
          })),
        });
        await this.audit.logIn(
          tx,
          id ? 'lead_sequence.updated' : 'lead_sequence.created',
          { type: 'lead_sequence', id: templateId },
          { steps: body.steps.length },
        );
        return (await this.read(tx, businessId, templateId))[0]!;
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('NAME_TAKEN', 'Another sequence has this name');
      }
      throw error;
    }
  }

  async archive(businessId: string, id: string): Promise<LeadSequenceTemplate> {
    return this.inFirm(businessId, async (tx) => {
      const [found] = await this.read(tx, businessId, id);
      if (!found) throw notFound();
      await tx.leadSequenceTemplate.update({ where: { id }, data: { archivedAt: new Date() } });
      await this.audit.logIn(tx, 'lead_sequence.archived', { type: 'lead_sequence', id });
      return found;
    });
  }

  async apply(
    businessId: string,
    actor: PipelineActor,
    leadId: string,
    body: z.output<typeof ApplyLeadSequenceRequest>,
  ): Promise<LeadProfile> {
    try {
      return await this.inFirm(businessId, async (tx) => {
        const lead = await lockLead(tx, businessId, actor, leadId);
        if (lead.archivedAt) throw notFound();
        if (CLOSED_STATUSES.includes(lead.status as (typeof CLOSED_STATUSES)[number])) {
          throw conflict('LEAD_CLOSED', 'A converted or closed lead has no follow-up');
        }
        const template = await tx.leadSequenceTemplate.findFirst({
          where: { businessId, id: body.templateId, archivedAt: null },
          select: { id: true },
        });
        if (!template) throw notFound();
        const owners = [
          ...new Set(body.steps.flatMap((s) => (s.assignedUserId ? [s.assignedUserId] : []))),
        ];
        const active = await tx.membership.count({
          where: { businessId, status: 'ACTIVE', userId: { in: owners } },
        });
        if (active !== owners.length) throw notFound();
        const run = await tx.leadSequenceRun.create({
          data: { businessId, leadId, templateId: template.id, appliedByUserId: actor.userId },
          select: { id: true },
        });
        await tx.leadFollowUp.createMany({
          data: body.steps.map((s) => ({
            businessId,
            leadId,
            actionType: s.actionType,
            dueAt: new Date(s.dueAt),
            note: s.note ?? null,
            mode: s.mode,
            assignedUserId: s.assignedUserId,
            sequenceRunId: run.id,
            createdByUserId: actor.userId,
          })),
        });
        await syncNextAction(tx, businessId, leadId, actor.userId);
        await this.audit.logIn(
          tx,
          'lead.sequence_applied',
          { type: 'lead', id: leadId },
          { templateId: template.id, runId: run.id, steps: body.steps.length },
        );
        return loadProfile(tx, businessId, actor, leadId, { unrestricted: true });
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2002') {
        throw conflict('SEQUENCE_ALREADY_APPLIED', 'This sequence is already running on the lead');
      }
      throw error;
    }
  }

  async stop(
    businessId: string,
    actor: PipelineActor,
    leadId: string,
    runId: string,
  ): Promise<LeadProfile> {
    return this.inFirm(businessId, async (tx) => {
      await lockLead(tx, businessId, actor, leadId);
      const run = await tx.leadSequenceRun.findFirst({
        where: { businessId, id: runId, leadId },
        select: { id: true, stoppedAt: true },
      });
      if (!run) throw notFound();
      if (!run.stoppedAt) {
        await tx.leadSequenceRun.update({
          where: { id: run.id },
          data: { stoppedAt: new Date(), stopReason: 'Stopped' },
        });
        await this.audit.logIn(
          tx,
          'lead.sequence_stopped',
          { type: 'lead', id: leadId },
          { runId },
        );
      }
      return loadProfile(tx, businessId, actor, leadId, { unrestricted: true });
    });
  }
}

@Controller('business/lead-sequences')
@Access('LEADS')
export class LeadSequencesController {
  constructor(private readonly sequences: LeadSequencesService) {}

  @Get()
  @Roles(...FIRM_STAFF)
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: LeadSequenceTemplate[] }> {
    return { items: await this.sequences.list(tenant.businessId) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveLeadSequenceRequest))
    body: z.output<typeof SaveLeadSequenceRequest>,
  ): Promise<LeadSequenceTemplate> {
    return this.sequences.save(tenant.businessId, auth.userId, body);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
    @Body(new ZodValidationPipe(SaveLeadSequenceRequest))
    body: z.output<typeof SaveLeadSequenceRequest>,
  ): Promise<LeadSequenceTemplate> {
    return this.sequences.save(tenant.businessId, auth.userId, body, id);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', uuidPipe) id: string,
  ): Promise<LeadSequenceTemplate> {
    return this.sequences.archive(tenant.businessId, id);
  }
}

@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadSequenceRunsController {
  constructor(private readonly sequences: LeadSequencesService) {}

  @Post(':id/sequences')
  @HttpCode(200)
  apply(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ApplyLeadSequenceRequest))
    body: z.output<typeof ApplyLeadSequenceRequest>,
  ): Promise<LeadProfile> {
    return this.sequences.apply(tenant.businessId, pipelineActor(auth, tenant), id, body);
  }

  @Post(':id/sequences/:runId/stop')
  @HttpCode(200)
  stop(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('runId', uuidPipe) runId: string,
  ): Promise<LeadProfile> {
    return this.sequences.stop(tenant.businessId, pipelineActor(auth, tenant), id, runId);
  }
}

@Module({
  controllers: [LeadSequencesController, LeadSequenceRunsController],
  providers: [LeadSequencesService],
})
export class LeadSequencesModule {}
