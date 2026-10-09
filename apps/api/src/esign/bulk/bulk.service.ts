import { randomUUID } from 'node:crypto';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import type { EsignBulkBatch, EsignBulkSendBody } from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { ESIGN_DIRECTORY, type EsignDirectory } from '../requests/esign-directory.js';
import {
  type EsignActor,
  EsignRequestsService,
  esignRefusal,
  invalid,
  seesAll,
} from '../requests/requests.service.js';
import { rolesUnfilled } from '../templates/template-use.service.js';
import type { EsignTemplateVersionRecord } from '../templates/templates.repository.js';
import { EsignTemplatesService, forbidden } from '../templates/templates.service.js';
import {
  BULK_REPOSITORY,
  type EsignBulkBatchRecord,
  type EsignBulkItemRecord,
  type EsignBulkRepository,
} from './bulk.repository.js';

type Body = z.output<typeof EsignBulkSendBody>;
/** Roles that fill themselves for each client (the client's logins, the sender). */
const SELF_FILLED = new Set(['CLIENT', 'SPOUSE', 'PREPARER']);
/** A row's name when the caller can't reach that client (another firm's id included). */
const HIDDEN_NAME = 'Client';
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

/**
 * Bulk send (R13, contract 3): POST /esign/templates/{id}/bulk-send makes a batch, one row per
 * client, and answers it (202); EsignBulkJob then makes and sends each client's request with the
 * template's `use` and the requests' `send`. What holds for every client is checked here, before
 * anything is written (404, 403 FORBIDDEN, 409 TEMPLATE_ARCHIVED, TEMPLATE_ROLES_UNFILLED,
 * NOT_A_MEMBER, APPROVER_NOT_ALLOWED). A client the caller can't reach (another firm's, an
 * archived one, or one not assigned to Staff) becomes a NOT_SENT row with NO_CLIENT: nothing is
 * made for it and its name is not shown. GET /esign/bulk/{batchId}: Owner and Admin, or whoever
 * made it; any other is 404. The audit gets ids only.
 */
@Injectable()
export class EsignBulkService {
  constructor(
    @Inject(BULK_REPOSITORY) private readonly bulk: EsignBulkRepository,
    @Inject(EsignTemplatesService) private readonly templates: EsignTemplatesService,
    @Inject(EsignRequestsService) private readonly requests: EsignRequestsService,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  async send(
    businessId: string,
    actor: EsignActor,
    templateId: string,
    body: Body,
  ): Promise<EsignBulkBatch> {
    const t = await this.templates.reach(businessId, actor, templateId);
    if (actor.role === 'VIEWER') throw forbidden();
    if (t.archivedAt) throw esignRefusal('TEMPLATE_ARCHIVED');
    const v = await this.templates.current(businessId, t);
    await this.checkRoles(businessId, actor, v, body.roles);
    const items = await Promise.all(
      body.clients.map(async (c, position): Promise<EsignBulkItemRecord> => {
        const reached = await this.reaches(businessId, actor, c.clientId, true);
        return {
          ...{ position, clientId: c.clientId, engagementId: c.engagementId ?? null },
          ...{ requestId: randomUUID(), created: false, attempts: 0 },
          ...(reached
            ? { state: 'QUEUED', problem: null }
            : { state: 'NOT_SENT', problem: 'NO_CLIENT' }),
        };
      }),
    );
    const batch: EsignBulkBatchRecord = {
      id: randomUUID(),
      templateId: t.id,
      templateVersion: v.version,
      templateName: t.name,
      createdByUserId: actor.userId,
      createdAt: new Date(),
      title: body.title ?? null,
      roles: body.roles,
      items,
    };
    await this.bulk.create(businessId, batch);
    const queued = items.filter((i) => i.state === 'QUEUED');
    await this.audit.log(
      'esign.bulk_created',
      { type: 'esign_bulk_batch', id: batch.id },
      {
        templateId: t.id,
        templateVersion: v.version,
        clientIds: queued.map((i) => i.clientId),
        refused: items.length - queued.length,
      },
    );
    return this.answer(businessId, actor, batch);
  }

  /** Shows client names, so every view is audited (ids only). */
  async get(businessId: string, actor: EsignActor, batchId: string): Promise<EsignBulkBatch> {
    const batch = await this.bulk.find(businessId, batchId);
    if (!batch || !(seesAll(actor) || batch.createdByUserId === actor.userId)) throw notFound();
    await this.audit.log(
      'esign.bulk_viewed',
      { type: 'esign_bulk_batch', id: batchId },
      {
        templateId: batch.templateId,
      },
    );
    return this.answer(businessId, actor, batch);
  }

  /**
   * The roles that are the same for every client: each fill's role is in the template, every
   * role is filled (CLIENT, SPOUSE and PREPARER fill themselves) and none needs an access code
   * (bulk send never takes one), and each STAFF fill is an active member who may approve where
   * the role approves. Per-client gaps (no SPOUSE login) are the row's problem instead.
   */
  private async checkRoles(
    businessId: string,
    actor: EsignActor,
    v: EsignTemplateVersionRecord,
    fills: Body['roles'],
  ): Promise<void> {
    fills.forEach((f, i) => {
      if (!v.roles.some((r) => r.key === f.key)) {
        throw invalid(`roles.${i}.key`, 'This role is not in the template');
      }
    });
    const fillOf = new Map(fills.map((f) => [f.key, f]));
    const open = v.roles
      .filter((role) => {
        const fill = fillOf.get(role.key);
        const coded = (fill?.authMethod ?? role.authMethod) === 'ACCESS_CODE';
        const filled = fill?.who !== undefined || SELF_FILLED.has(role.role);
        return !filled || (coded && fill?.delivery !== 'IN_PERSON');
      })
      .map((role) => role.key);
    if (open.length > 0) throw rolesUnfilled(open);
    for (const role of v.roles) {
      const who = fillOf.get(role.key)?.who;
      if (!who) continue;
      await this.requests.who(businessId, null, who);
      if (role.kind === 'APPROVER') {
        await this.requests.approver(businessId, { senderUserId: actor.userId }, who);
      }
    }
  }

  /** The caller reaches the client (not archived, unless `active` is false). */
  private async reaches(businessId: string, actor: EsignActor, clientId: string, active: boolean) {
    const client = await this.directory.client(businessId, clientId);
    const mine = !!client && (seesAll(actor) || client.assignedUserId === actor.userId);
    return mine && (!active || !client.archived) ? client : null;
  }

  private async answer(
    businessId: string,
    actor: EsignActor,
    b: EsignBulkBatchRecord,
  ): Promise<EsignBulkBatch> {
    const [creator, clients] = await Promise.all([
      this.directory.member(businessId, b.createdByUserId),
      Promise.all(b.items.map((i) => this.reaches(businessId, actor, i.clientId, false))),
    ]);
    return {
      id: b.id,
      templateId: b.templateId,
      templateName: b.templateName,
      createdBy: { userId: b.createdByUserId, name: creator?.name ?? '' },
      createdAt: b.createdAt.toISOString(),
      done: b.items.every((i) => i.state !== 'QUEUED'),
      items: b.items.map((i, k) => ({
        clientId: i.clientId,
        clientName: clients[k]?.displayName ?? HIDDEN_NAME,
        state: i.state,
        requestId: i.created ? i.requestId : null,
        problem: i.problem,
      })),
    };
  }
}
