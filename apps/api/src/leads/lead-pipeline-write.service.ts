import { ConflictException, ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateLeadRequest,
  LeadBulkRequest,
  LeadBulkResult,
  LeadPipelineStatus,
  LeadProfile,
  UpdateLeadRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { conflict, notFound } from './leads.service.js';
import {
  CLOSED_STATUSES,
  CONTACT_TO_DB,
  invalid,
  loadProfile,
  lockLead,
  type PipelineActor,
  reach,
  requireActiveMember,
  requireCapability,
  visibleLead,
} from './pipeline.shared.js';

type Create = z.output<typeof CreateLeadRequest>;
type Update = z.output<typeof UpdateLeadRequest>;
type Bulk = z.output<typeof LeadBulkRequest>;

const NOT_QUALIFIED_REASON = 'Marked not qualified';
const ACTION_LABEL = {
  CALL: 'Call',
  EMAIL: 'Email',
  SMS: 'Text message',
  APPOINTMENT: 'Appointment',
  SEND_DOCUMENTS: 'Send documents',
  FOLLOW_UP: 'Follow up',
  CLOSE_LEAD: 'Close lead',
} as const;

/** Campaigns and a date of birth have no column on leads yet: say so instead of dropping them. */
const unavailable = (what: string) => invalid(`${what} is not available yet`, 'FIELD_UNAVAILABLE');

/** Add New Lead, Edit and the bulk bar (R57). Every change is one transaction and one audit row per lead. */
@Injectable()
export class LeadPipelineWriteService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async create(businessId: string, actor: PipelineActor, body: Create): Promise<LeadProfile> {
    if (body.campaignId) throw unavailable('Campaigns');
    const serviceIds = [...new Set(body.serviceIds)];
    // leads.service_id is required: a lead needs a first service until the column is optional.
    if (serviceIds.length === 0) throw invalid('Choose at least one service');
    if (CLOSED_STATUSES.includes(body.stage) && body.nextAction) {
      throw invalid('A closed lead has no follow-up');
    }
    const staff = legacyFirmRole(actor.role) === 'STAFF';
    if (staff && body.assignedUserId && body.assignedUserId !== actor.userId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
    const assignedUserId = body.assignedUserId ?? (staff ? actor.userId : null);
    const email = body.email.toLowerCase();
    const profile = await this.inFirm(businessId, async (tx) => {
      await this.requireServices(tx, businessId, serviceIds);
      if (assignedUserId) await requireActiveMember(tx, businessId, assignedUserId);
      if (!body.allowDuplicate)
        await this.rejectDuplicate(tx, businessId, email, body.phone ?? null);
      const lead = await tx.lead.create({
        data: {
          businessId,
          serviceId: serviceIds[0]!,
          status: body.stage,
          submittedAt: new Date(),
          firstName: body.firstName,
          lastName: body.lastName,
          businessName: body.businessName ?? null,
          email,
          phone: body.phone ?? null,
          source: body.source,
          sourceDetail: body.sourceDetail ?? null,
          priority: body.priority,
          assignedUserId,
          preferredContactMethods: [...new Set(body.preferredContact.map((c) => CONTACT_TO_DB[c]))],
          nextActionType: body.nextAction?.type ?? null,
          nextActionAt: body.nextAction ? new Date(body.nextAction.dueAt) : null,
          nextActionNote: body.nextAction?.notes ?? null,
          declineReason: body.stage === 'DECLINED' ? NOT_QUALIFIED_REASON : null,
          updatedByUserId: actor.userId,
        },
        select: { id: true },
      });
      await tx.leadService.createMany({
        data: serviceIds.map((serviceId) => ({ businessId, leadId: lead.id, serviceId })),
      });
      if (body.nextAction) await this.logFollowUp(tx, businessId, lead.id, actor, body.nextAction);
      return loadProfile(tx, businessId, actor, lead.id, { unrestricted: true });
    });
    await this.audit.log('lead.created', { type: 'lead', id: profile.id }, { source: body.source });
    return profile;
  }

  async update(
    businessId: string,
    actor: PipelineActor,
    id: string,
    body: Update,
  ): Promise<LeadProfile> {
    if (body.campaignId) throw unavailable('Campaigns');
    if (body.dateOfBirth) throw unavailable('Date of birth');
    if (body.address && body.address.length > 200)
      throw invalid('Use at most 200 characters for the address');
    if (body.serviceIds?.length === 0) throw invalid('Choose at least one service');
    const profile = await this.inFirm(businessId, async (tx) => {
      const lead = await lockLead(tx, businessId, actor, id);
      if (lead.archivedAt) throw notFound();
      if (body.version && body.version !== lead.updatedAt.toISOString()) {
        throw conflict('SAVE_CONFLICT', 'Someone saved this lead after you opened it');
      }
      // Prisma leaves a field that is undefined as it is; null clears it.
      const data: Prisma.LeadUncheckedUpdateInput = {
        updatedByUserId: actor.userId,
        firstName: body.firstName,
        lastName: body.lastName,
        businessName: body.businessName,
        email: body.email?.toLowerCase(),
        phone: body.phone,
        bestTimeToContact: body.bestTimeToContact,
        source: body.source,
        sourceDetail: body.sourceDetail,
        priority: body.priority,
        preferredContactMethods: body.preferredContact && [
          ...new Set(body.preferredContact.map((c) => CONTACT_TO_DB[c])),
        ],
        // One free-text address replaces the whole stored address (line 1, line 2, city, state, ZIP).
        ...(body.address === undefined
          ? {}
          : {
              addressLine1: body.address,
              addressLine2: null,
              city: null,
              state: null,
              postalCode: null,
            }),
      };
      if (body.assignedUserId !== undefined && body.assignedUserId !== lead.assignedUserId) {
        if (body.assignedUserId) await requireActiveMember(tx, businessId, body.assignedUserId);
        data.assignedUserId = body.assignedUserId;
      }
      if (body.stage && body.stage !== lead.status) {
        if (lead.status === 'CONVERTED')
          throw conflict('ALREADY_CONVERTED', 'This lead is already a client');
        data.status = body.stage;
        if (CLOSED_STATUSES.includes(body.stage)) {
          Object.assign(data, { nextActionType: null, nextActionAt: null, nextActionNote: null });
        }
        if (body.stage === 'DECLINED')
          data.declineReason = lead.declineReason ?? NOT_QUALIFIED_REASON;
      }
      await tx.lead.update({ where: { id }, data });
      if (body.serviceIds)
        await this.setServices(tx, businessId, id, lead.serviceId, [...new Set(body.serviceIds)]);
      if (body.tags) await this.setTags(tx, businessId, actor, [id], body.tags, true);
      return loadProfile(tx, businessId, actor, id, { unrestricted: true });
    });
    await this.audit.log(
      'lead.updated',
      { type: 'lead', id },
      { fields: Object.keys(body).filter((k) => k !== 'version') },
    );
    return profile;
  }

  async bulk(businessId: string, actor: PipelineActor, body: Bulk): Promise<LeadBulkResult> {
    requireCapability(
      actor,
      {
        ASSIGN: 'EDIT',
        STAGE: 'EDIT',
        CAMPAIGN: 'MANAGE',
        TAGS: 'MANAGE',
        ARCHIVE: 'DELETE',
        RESTORE: 'DELETE',
      }[body.action] as 'EDIT',
    );
    const ids = [...new Set(body.ids)];
    const changed = await this.inFirm(businessId, async (tx) => {
      // A converted lead, an archived one and another member's lead are skipped, not errors.
      const rows = await tx.lead.findMany({
        where: {
          AND: [
            visibleLead(businessId),
            reach(actor),
            {
              id: { in: ids },
              // Restore takes the archived ones (L10); every other action the open ones.
              archivedAt: body.action === 'RESTORE' ? { not: null } : null,
              status: { not: 'CONVERTED' },
            },
          ],
        },
        select: { id: true, status: true, assignedUserId: true },
      });
      const base = { updatedByUserId: actor.userId };
      switch (body.action) {
        case 'ASSIGN': {
          if (body.assignedUserId) await requireActiveMember(tx, businessId, body.assignedUserId);
          const todo = rows
            .filter((r) => r.assignedUserId !== body.assignedUserId)
            .map((r) => r.id);
          await tx.lead.updateMany({
            where: { businessId, id: { in: todo } },
            data: { ...base, assignedUserId: body.assignedUserId },
          });
          return todo;
        }
        case 'STAGE': {
          const todo = rows.filter((r) => r.status !== body.stage).map((r) => r.id);
          const closed = CLOSED_STATUSES.includes(body.stage as LeadPipelineStatus);
          await tx.lead.updateMany({
            where: { businessId, id: { in: todo } },
            data: {
              ...base,
              status: body.stage,
              ...(closed ? { nextActionType: null, nextActionAt: null, nextActionNote: null } : {}),
              ...(body.stage === 'DECLINED' ? { declineReason: NOT_QUALIFIED_REASON } : {}),
            },
          });
          return todo;
        }
        // Leads carry no campaign yet (see the PR's gaps): nothing is changed, all are skipped.
        case 'CAMPAIGN':
          return [];
        case 'TAGS': {
          const todo = rows.map((r) => r.id);
          await this.setTags(tx, businessId, actor, todo, body.add, false);
          await tx.lead.updateMany({ where: { businessId, id: { in: todo } }, data: base });
          return todo;
        }
        case 'ARCHIVE': {
          const todo = rows.map((r) => r.id);
          await tx.lead.updateMany({
            where: { businessId, id: { in: todo } },
            data: { ...base, archivedAt: new Date(), archivedByUserId: actor.userId },
          });
          return todo;
        }
        // Back with the status, details and history it had: only the archive mark goes.
        case 'RESTORE': {
          const todo = rows.map((r) => r.id);
          await tx.lead.updateMany({
            where: { businessId, id: { in: todo } },
            data: { ...base, archivedAt: null, archivedByUserId: null },
          });
          return todo;
        }
      }
    });
    for (const id of changed) {
      await this.audit.log(`lead.bulk_${body.action.toLowerCase()}`, { type: 'lead', id });
    }
    return { changed: changed.length, skipped: ids.length - changed.length };
  }

  /** A live service of this firm for each id: 404 for anything else (another firm's included). */
  private async requireServices(tx: TxClient, businessId: string, ids: string[]): Promise<void> {
    const found = await tx.service.count({
      where: { businessId, archivedAt: null, id: { in: ids } },
    });
    if (found !== ids.length) throw notFound();
  }

  private async rejectDuplicate(
    tx: TxClient,
    businessId: string,
    email: string,
    phone: string | null,
  ) {
    const match = (extra: object) => ({ OR: [{ email }, ...(phone ? [{ phone }] : [])], ...extra });
    const [leads, clients] = await Promise.all([
      tx.lead.count({ where: { AND: [visibleLead(businessId), match({})] } }),
      tx.client.count({ where: { businessId, ...match({}) } }),
    ]);
    if (leads + clients > 0) {
      throw new ConflictException({
        code: 'POSSIBLE_DUPLICATE',
        message: 'A lead or client with this email or phone already exists',
        details: { leads, clients },
      });
    }
  }

  private async logFollowUp(
    tx: TxClient,
    businessId: string,
    leadId: string,
    actor: PipelineActor,
    next: { type: keyof typeof ACTION_LABEL; dueAt: string },
  ): Promise<void> {
    await tx.leadActivity.create({
      data: {
        businessId,
        leadId,
        kind: 'FOLLOW_UP',
        actorUserId: actor.userId,
        summary: ACTION_LABEL[next.type],
        metadata: { type: next.type, dueAt: next.dueAt },
      },
    });
  }

  /** The services shown for the lead: exactly these (the lead's own first service stays as it is). */
  private async setServices(
    tx: TxClient,
    businessId: string,
    leadId: string,
    firstServiceId: string,
    ids: string[],
  ): Promise<void> {
    await this.requireServices(tx, businessId, ids);
    // The lead's first service never changes (leads_rules) and its engagement is for it.
    if (!ids.includes(firstServiceId)) throw invalid("The lead's first service cannot be removed");
    await tx.leadService.deleteMany({ where: { businessId, leadId, serviceId: { notIn: ids } } });
    await tx.leadService.createMany({
      data: ids.map((serviceId) => ({ businessId, leadId, serviceId })),
      skipDuplicates: true,
    });
  }

  /**
   * Tags by name from the firm's catalog. A tag that does not exist yet is made only by an Owner or
   * Admin (staff apply existing ones: 400 UNKNOWN_TAG). `replace` makes the leads' tags exactly
   * these; otherwise the names are added. Each tag newly put on a lead is logged on it.
   */
  private async setTags(
    tx: TxClient,
    businessId: string,
    actor: PipelineActor,
    leadIds: string[],
    names: string[],
    replace: boolean,
  ): Promise<void> {
    const tags: { id: string; name: string }[] = [];
    for (const name of new Map(names.map((n) => [n.toLowerCase(), n])).values()) {
      let tag = await tx.tag.findFirst({
        where: { businessId, archivedAt: null, name: { equals: name, mode: 'insensitive' } },
        select: { id: true, name: true },
      });
      if (!tag) {
        if (legacyFirmRole(actor.role) === 'STAFF')
          throw invalid(`The tag "${name}" does not exist`, 'UNKNOWN_TAG');
        tag = await tx.tag.create({
          data: { businessId, name, createdByUserId: actor.userId },
          select: { id: true, name: true },
        });
      }
      tags.push(tag);
    }
    if (replace) {
      await tx.leadTag.deleteMany({
        where: { businessId, leadId: { in: leadIds }, tagId: { notIn: tags.map((t) => t.id) } },
      });
    }
    const had = await tx.leadTag.findMany({
      where: { businessId, leadId: { in: leadIds }, tagId: { in: tags.map((t) => t.id) } },
      select: { leadId: true, tagId: true },
    });
    const fresh = leadIds.flatMap((leadId) =>
      tags
        .filter((t) => !had.some((h) => h.leadId === leadId && h.tagId === t.id))
        .map((t) => ({ leadId, tag: t })),
    );
    await tx.leadTag.createMany({
      data: fresh.map((f) => ({
        businessId,
        leadId: f.leadId,
        tagId: f.tag.id,
        addedByUserId: actor.userId,
      })),
    });
    await tx.leadActivity.createMany({
      data: fresh.map((f) => ({
        businessId,
        leadId: f.leadId,
        kind: 'TAG_ADDED' as const,
        actorUserId: actor.userId,
        summary: f.tag.name,
      })),
    });
  }
}
