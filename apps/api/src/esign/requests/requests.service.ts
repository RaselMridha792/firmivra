import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { z } from 'zod';
import {
  type CreateEsignRequestBody,
  ESIGN_ERRORS,
  type EsignErrorCode,
  type EsignRequestDetail,
  type EsignStatus,
  type OkResponse,
  type UpdateEsignRequestBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import { ESIGN_STORE, type EsignStore } from '../engine/engine.types.js';
import { type DirectoryClient, ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignDraftPatch,
  type EsignRepository,
  type EsignRequestParts,
  type EsignRequestRecord,
} from './esign.repository.js';

/** The signed-in member and their access (from TenantGuard; MANAGER once Firm Sign roles land). */
export interface EsignActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'MANAGER' | 'STAFF';
}

/** A Firm Sign refusal: 409 with the words users see (ESIGN_ERRORS). */
export const esignRefusal = (code: EsignErrorCode) =>
  new ConflictException({ code, message: ESIGN_ERRORS[code] });
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
/** Owner and Admin reach every request; a MANAGER sees only what STAFF sees. */
const seesAll = (actor: EsignActor) => actor.role === 'OWNER' || actor.role === 'ADMIN';

const OPEN_SERVICE = new Set(['PENDING', 'ACTIVE']);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const entity = (id: string) => ({ type: 'esign_request', id });

/**
 * Firm Sign requests (R13 step 6): status and drafts. Access: Owner and Admin reach every
 * request; Staff and Managers the ones they send and those of clients assigned to them; anything
 * else is 404. Changes apply to DRAFTs only (409 INVALID_STATE). The audit log gets ids only,
 * never a file, a field value or an access code.
 */
@Injectable()
export class EsignRequestsService {
  private readonly logger = new Logger(EsignRequestsService.name);

  constructor(
    @Inject(ESIGN_REPOSITORY) private readonly repo: EsignRepository,
    @Inject(ESIGN_DIRECTORY) private readonly directory: EsignDirectory,
    @Inject(BUSINESS_MODULES) private readonly modules: BusinessModules,
    @Inject(ESIGN_STORE) private readonly store: Pick<EsignStore, 'remove'>,
    @Inject(AuditService) private readonly audit: Pick<AuditService, 'log'>,
  ) {}

  /** Never MODULE_OFF: off is `{ enabled: false, myEsignRole: null }`. */
  async status(businessId: string, actor: EsignActor): Promise<EsignStatus> {
    const enabled = await this.modules.isEnabled(businessId, 'esign');
    // VIEWER comes with the roles of contract 3.
    return { enabled, myEsignRole: enabled ? actor.role : null };
  }

  async create(
    businessId: string,
    actor: EsignActor,
    body: z.output<typeof CreateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    const client = body.clientId
      ? await this.reachableClient(businessId, actor, body.clientId)
      : null;
    const clientId = client?.id ?? null;
    const engagementId = await this.openService(businessId, clientId, body.engagementId ?? null);
    const defaults = await this.repo.defaults(businessId);
    const record = await this.repo.createRequest(businessId, {
      title: body.title,
      source: body.source,
      clientId,
      engagementId,
      senderUserId: actor.userId,
      internalNote: null,
      emailSubject: null,
      emailMessage: defaults.emailMessage,
      routing: 'SEQUENTIAL',
      expiryDays: defaults.expiryDays,
      reminders: defaults.reminders,
      expiryWarningDays: defaults.expiryWarningDays,
    });
    await this.audit.log('esign.request_created', entity(record.id), {
      clientId,
      engagementId,
      source: body.source,
    });
    return this.toDetail(businessId, record);
  }

  async get(businessId: string, actor: EsignActor, id: string): Promise<EsignRequestDetail> {
    return this.toDetail(businessId, await this.reach(businessId, actor, id));
  }

  async update(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof UpdateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    const record = await this.draft(businessId, actor, id);
    const { clientId: newClient, engagementId: newService, ...rest } = body;
    const patch: EsignDraftPatch = Object.fromEntries(
      Object.entries(rest).filter(([, v]) => v !== undefined),
    );
    let clientId = record.clientId;
    if (newClient !== undefined && newClient !== record.clientId) {
      const { recipients } = await this.repo.parts(businessId, id);
      if (recipients.some((r) => r.link.type === 'CLIENT_LOGIN')) {
        throw esignRefusal('RECIPIENTS_LINKED');
      }
      clientId = newClient && (await this.reachableClient(businessId, actor, newClient)).id;
      patch.clientId = clientId;
      patch.engagementId = null;
    }
    if (newService !== undefined) {
      patch.engagementId = await this.openService(businessId, clientId, newService);
    }
    await this.drafted(this.repo.updateDraft(businessId, id, patch));
    await this.audit.log('esign.request_updated', entity(id), { changed: Object.keys(patch) });
    return this.get(businessId, actor, id);
  }

  /** Deletes a never-sent DRAFT, then its stored files. */
  async discard(businessId: string, actor: EsignActor, id: string): Promise<OkResponse> {
    await this.draft(businessId, actor, id);
    const { documents } = await this.repo.parts(businessId, id);
    await this.drafted(this.repo.deleteDraft(businessId, id));
    await this.audit.log('esign.request_discarded', entity(id), {
      documentIds: documents.map((d) => d.id),
    });
    for (const doc of documents) {
      try {
        await this.store.remove(businessId, doc.s3Key);
      } catch (error) {
        const name = error instanceof Error ? error.name : typeof error;
        this.logger.warn(`Could not delete esign document ${doc.id}: ${name}`); // ids only
      }
    }
    return { ok: true };
  }

  /** The request, if the caller may reach it; else 404 (another firm's id included). */
  private async reach(businessId: string, actor: EsignActor, id: string) {
    const record = await this.repo.findRequest(businessId, id);
    if (!record) throw notFound();
    if (!seesAll(actor) && record.senderUserId !== actor.userId) {
      const client = record.clientId && (await this.directory.client(businessId, record.clientId));
      if (!client || client.assignedUserId !== actor.userId) throw notFound();
    }
    return record;
  }

  private async draft(businessId: string, actor: EsignActor, id: string) {
    const record = await this.reach(businessId, actor, id);
    if (record.status !== 'DRAFT') throw esignRefusal('INVALID_STATE');
    return record;
  }

  /** A draft write that found the request no longer a DRAFT (sent or discarded meanwhile). */
  private async drafted(write: Promise<boolean>): Promise<void> {
    if (!(await write)) throw esignRefusal('INVALID_STATE');
  }

  private async reachableClient(businessId: string, actor: EsignActor, clientId: string) {
    const client = await this.directory.client(businessId, clientId);
    const reached =
      client && !client.archived && (seesAll(actor) || client.assignedUserId === actor.userId);
    if (!reached) throw notFound();
    return client;
  }

  /** One of the client's PENDING or ACTIVE services, or 409 ENGAGEMENT_MISMATCH. */
  private async openService(businessId: string, clientId: string | null, id: string | null) {
    if (id === null) return null;
    const service = await this.directory.engagement(businessId, id);
    if (!service || service.clientId !== clientId || !OPEN_SERVICE.has(service.status)) {
      throw esignRefusal('ENGAGEMENT_MISMATCH');
    }
    return service.id;
  }

  private async toDetail(businessId: string, r: EsignRequestRecord): Promise<EsignRequestDetail> {
    const parts: EsignRequestParts = await this.repo.parts(businessId, r.id);
    const [client, service, sender] = await Promise.all([
      r.clientId ? this.directory.client(businessId, r.clientId) : null,
      r.engagementId ? this.directory.engagement(businessId, r.engagementId) : null,
      this.directory.member(businessId, r.senderUserId),
    ]);
    const signers = parts.recipients
      .filter((x) => x.kind === 'SIGNER')
      .sort((a, b) => a.routingOrder - b.routingOrder);
    const draft = r.status === 'DRAFT';
    return {
      id: r.id,
      title: r.title,
      status: r.status,
      source: r.source,
      client: client && clientRef(client),
      sender: { userId: r.senderUserId, name: sender?.name ?? '' },
      signerNames: signers.map((s) => s.name),
      signedCount: signers.filter((s) => s.status === 'SIGNED').length,
      signerCount: signers.length,
      // Sent requests' next action and actions come with part 3 (list and lifecycle).
      nextAction: { kind: draft ? 'FINISH_DRAFT' : 'NONE', waitingOn: [] },
      createdAt: r.createdAt.toISOString(),
      sentAt: iso(r.sentAt),
      lastActivityAt: r.lastActivityAt.toISOString(),
      expiresAt: iso(r.expiresAt),
      completedAt: iso(r.completedAt),
      allowedActions: draft ? ['EDIT', 'DISCARD', 'SEND'] : [],
      internalNote: r.internalNote,
      emailSubject: r.emailSubject,
      emailMessage: r.emailMessage,
      routing: r.routing,
      engagement: service && { id: service.id, title: service.title },
      expiryDays: r.expiryDays,
      reminders: r.reminders,
      expiryWarningDays: r.expiryWarningDays,
      documents: parts.documents.map((d) => ({
        id: d.id,
        position: d.position,
        fileName: d.fileName,
        contentType: d.contentType,
        sizeBytes: d.sizeBytes,
        pageCount: d.pageCount,
        pageSizes: d.pageSizes,
        sourceDocumentId: d.sourceDocumentId,
        scanStatus: d.scanStatus,
        createdAt: d.createdAt.toISOString(),
      })),
      pagePlan: parts.pagePlan,
      recipients: parts.recipients.map(({ accessCodeHash, ...x }) => ({
        ...x,
        hasAccessCode: accessCodeHash !== null,
        sentAt: iso(x.sentAt),
        viewedAt: iso(x.viewedAt),
        signedAt: iso(x.signedAt),
        declinedAt: iso(x.declinedAt),
        lastRemindedAt: iso(x.lastRemindedAt),
      })),
      fields: parts.fields,
      // The columns below arrive with r0_esign and are read from part 3 on.
      replacesRequestId: null,
      replacedByRequestId: null,
      template: null,
      approvalNotes: [],
      declinedAt: null,
      expiredAt: null,
      voidedAt: null,
      voidReason: null,
      voidedBy: null,
      originalSha256: null,
      finalSha256: null,
      certificateSha256: null,
      finalDocumentId: null,
      certificateDocumentId: null,
    };
  }
}

const clientRef = (c: DirectoryClient) => ({ id: c.id, displayName: c.displayName });
