import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  type CreateEsignRequestBody,
  ESIGN_ERRORS,
  type EsignErrorCode,
  type EsignAccessRole,
  type EsignDocument,
  EsignField,
  type EsignPage,
  type EsignPutRecipientsBody,
  EsignRecipient,
  type EsignRequestDetail,
  type EsignRequestRow,
  type EsignStatus,
  type OkResponse,
  type UpdateEsignRequestBody,
} from '@firmivra/types';
import { AuditService } from '../../audit/audit.service.js';
import { BUSINESS_MODULES, type BusinessModules } from '../../common/modules/requires-module.js';
import type { TenantRole } from '../../common/request-context.js';
import {
  CODE_HASHER,
  type CodeHasher,
  ESIGN_STORE,
  type EsignStore,
} from '../engine/engine.types.js';
import { allowedActions, nextAction, signersOf } from './actions.js';
import { type DirectoryClient, ESIGN_DIRECTORY, type EsignDirectory } from './esign-directory.js';
import {
  ESIGN_REPOSITORY,
  type EsignDocumentRecord,
  type EsignDraftPatch,
  type EsignRecipientRecord,
  type EsignRepository,
  type EsignRequestParts,
  type EsignRequestRecord,
} from './esign.repository.js';

/**
 * The signed-in member and their access (from TenantGuard; MANAGER and VIEWER once Firm Sign
 * roles land). A VIEWER reads what STAFF could and changes nothing (403 FORBIDDEN).
 */
export interface EsignActor {
  userId: string;
  role: Exclude<TenantRole, 'CLIENT'> | 'MANAGER' | 'VIEWER';
}

/** A Firm Sign refusal: 409 with the words users see (ESIGN_ERRORS). */
export const esignRefusal = (code: EsignErrorCode) =>
  new ConflictException({ code, message: ESIGN_ERRORS[code] });
const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const readOnly = (actor: EsignActor) => {
  if (actor.role === 'VIEWER') {
    throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
  }
};
/** Owner and Admin reach every request; a MANAGER sees only what STAFF sees. */
export const seesAll = (actor: EsignActor) => actor.role === 'OWNER' || actor.role === 'ADMIN';

export const invalid = (path: string, message: string) =>
  new BadRequestException({
    code: 'VALIDATION_FAILED',
    message: 'The request is not valid',
    details: [{ path, message }],
  });
/** Who may approve: an Owner, Admin or Firm Sign Manager (never the request's sender). */
const APPROVER_ROLES: ReadonlySet<EsignAccessRole> = new Set(['OWNER', 'ADMIN', 'MANAGER']);

const OPEN_SERVICE = new Set(['PENDING', 'ACTIVE']);
const iso = (d: Date | null) => d?.toISOString() ?? null;
const entity = (id: string) => ({ type: 'esign_request', id });
type PutRecipient = z.output<typeof EsignPutRecipientsBody>['recipients'][number];

/**
 * Firm Sign requests (R13 step 6): status, drafts, page plan and recipients. Access: Owner and
 * Admin reach every request; Staff and Managers the ones they send and those of clients assigned
 * to them; an approver may open and decide the ones they approve, but never change them.
 * Anything else is 404. Changes apply to DRAFTs only (409 INVALID_STATE). The audit log gets ids
 * only, never a file, a field value or an access code.
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
    @Inject(CODE_HASHER) private readonly codes: Pick<CodeHasher, 'hash'>,
  ) {}

  /** Never MODULE_OFF: off is `{ enabled: false, myEsignRole: null }`. */
  async status(businessId: string, actor: EsignActor): Promise<EsignStatus> {
    const enabled = await this.modules.isEnabled(businessId, 'esign');
    // TODO(r0_esign): MANAGER and VIEWER need the member's stored Firm Sign role, which r0_esign
    // adds; until then the firm role is the answer.
    return { enabled, myEsignRole: enabled ? actor.role : null };
  }

  async create(
    businessId: string,
    actor: EsignActor,
    body: z.output<typeof CreateEsignRequestBody>,
  ): Promise<EsignRequestDetail> {
    readOnly(actor);
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

  /** Returns client data, so every view is audited (ids only). */
  async get(businessId: string, actor: EsignActor, id: string): Promise<EsignRequestDetail> {
    const { record } = await this.reach(businessId, actor, id, 'read');
    await this.audit.log('esign.request_viewed', entity(id), { clientId: record.clientId });
    return this.toDetail(businessId, record, actor);
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
    const clientChange = newClient !== undefined && newClient !== record.clientId;
    if (clientChange) {
      clientId = newClient && (await this.reachableClient(businessId, actor, newClient)).id;
      patch.clientId = clientId;
      patch.engagementId = null;
    }
    if (newService !== undefined) {
      patch.engagementId = await this.openService(businessId, clientId, newService);
    }
    // Nothing to change: no write, no audit.
    if (Object.keys(patch).length === 0) return this.toDetail(businessId, record);
    // RECIPIENTS_LINKED is checked by the repository under the request's lock.
    const written = await this.repo.updateDraft(businessId, id, patch, { clientChange });
    if (typeof written === 'string') throw esignRefusal(written);
    await this.audit.log('esign.request_updated', entity(id), {
      changed: Object.keys(patch),
      ...(clientChange && { fromClientId: record.clientId, toClientId: clientId }),
    });
    // From the written record: the caller may no longer reach it (a cleared client), yet the
    // change was made and is answered.
    return this.toDetail(businessId, written);
  }

  /** Deletes a never-sent DRAFT, then its stored files. */
  async discard(businessId: string, actor: EsignActor, id: string): Promise<OkResponse> {
    await this.draft(businessId, actor, id);
    const documents = await this.repo.deleteDraft(businessId, id);
    if (!documents) throw esignRefusal('INVALID_STATE');
    // The draft is gone once deleteDraft commits: a failed audit write must not answer 500 and
    // leave its files behind, so it is logged (ids only) and the files are still removed.
    try {
      await this.audit.log('esign.request_discarded', entity(id), {
        documentIds: documents.map((d) => d.id),
      });
    } catch (error) {
      const name = error instanceof Error ? error.name : typeof error;
      this.logger.error(`Could not audit the discard of esign request ${id}: ${name}`);
    }
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

  /** The new packet order. Fields move with their page and go with it; rotating one is 409. */
  async putPagePlan(
    businessId: string,
    actor: EsignActor,
    id: string,
    pages: EsignPage[],
  ): Promise<EsignRequestDetail> {
    const record = await this.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const docs = new Map(parts.documents.map((d) => [d.id, d]));
    pages.forEach((p, i) => {
      const doc = docs.get(p.documentId);
      if (!doc || p.page >= doc.pageCount) {
        throw invalid(`pages.${i}`, 'This page is not in the request’s files');
      }
    });
    const key = (p: EsignPage) => `${p.documentId}:${p.page}`;
    const at = new Map(pages.map((p, i) => [key(p), i]));
    const fields = parts.fields.flatMap((f): EsignField[] => {
      const old = parts.pagePlan[f.pageIndex];
      const index = old === undefined ? undefined : at.get(key(old));
      if (old === undefined || index === undefined) return [];
      if (pages[index]?.rotation !== old.rotation) throw esignRefusal('PAGE_HAS_FIELDS');
      return [{ ...f, pageIndex: index }];
    });
    const saved = savedOrRefused(
      await this.repo.savePagePlan(businessId, id, pages, fields, record.lastActivityAt),
    );
    await this.audit.log('esign.page_plan_updated', entity(id), {
      pageCount: pages.length,
      fieldsRemoved: parts.fields.length - fields.length,
    });
    return this.answer(businessId, saved);
  }

  /** The whole list. Kept ids keep their colour; removed signers lose their fields. */
  async putRecipients(
    businessId: string,
    actor: EsignActor,
    id: string,
    body: z.output<typeof EsignPutRecipientsBody>,
  ): Promise<EsignRequestDetail> {
    const record = await this.draft(businessId, actor, id);
    const parts = await this.repo.parts(businessId, id);
    const current = new Map(parts.recipients.map((r) => [r.id, r]));
    const kept = new Set(body.recipients.map((r) => r.id));
    const taken = new Set(parts.recipients.filter((r) => kept.has(r.id)).map((r) => r.colorIndex));
    let spill = 0;
    /** The lowest free colour; past 8 recipients colours repeat. */
    const colour = () => {
      const free = [0, 1, 2, 3, 4, 5, 6, 7].find((c) => !taken.has(c));
      if (free === undefined) return spill++ % 8;
      taken.add(free);
      return free;
    };
    const recipients: EsignRecipientRecord[] = [];
    const approvers = new Set<string>();
    for (const [i, input] of body.recipients.entries()) {
      const old = input.id === undefined ? undefined : current.get(input.id);
      if (input.id !== undefined && !old) {
        throw invalid(`recipients.${i}.id`, 'This recipient is not on the request');
      }
      const recipientId = old?.id ?? randomUUID();
      const who = await this.who(businessId, record.clientId, input.who);
      if (input.kind === 'APPROVER') {
        await this.approver(businessId, record, input.who);
        const key = JSON.stringify(input.who);
        if (approvers.has(key)) throw invalid(`recipients.${i}.who`, 'Already an approver');
        approvers.add(key);
      }
      // A kept id that is now someone else needs a new code: the old one was given to another.
      const samePerson = old && sameLink(old.link, who.link) && old.email === who.email;
      let accessCodeHash: string | null = null;
      if (input.authMethod === 'ACCESS_CODE' && input.delivery !== 'IN_PERSON') {
        accessCodeHash = input.accessCode
          ? this.codes.hash(recipientId, 'ACCESS', input.accessCode)
          : samePerson
            ? old.accessCodeHash
            : null;
        if (!accessCodeHash) throw invalid(`recipients.${i}.accessCode`, 'Set an access code');
      }
      recipients.push({
        ...who,
        id: recipientId,
        kind: input.kind,
        role: input.role,
        roleLabel: input.role === 'CUSTOM' ? (input.roleLabel ?? null) : null,
        routingOrder: record.routing === 'PARALLEL' ? 1 : input.routingOrder,
        delivery: input.delivery,
        authMethod: input.authMethod,
        accessCodeHash,
        colorIndex: old?.colorIndex ?? colour(),
        status: 'WAITING',
        sentAt: null,
        viewedAt: null,
        signedAt: null,
        declinedAt: null,
        declineReason: null,
        lastRemindedAt: null,
        reminderCount: 0,
      });
    }
    const signers = new Set(recipients.filter((r) => r.kind === 'SIGNER').map((r) => r.id));
    const fields = parts.fields.filter((f) => f.recipientId === null || signers.has(f.recipientId));
    const saved = savedOrRefused(
      await this.repo.saveRecipients(businessId, id, recipients, fields, record.lastActivityAt),
    );
    await this.audit.log('esign.recipients_updated', entity(id), {
      recipientIds: recipients.map((r) => r.id),
      fieldsRemoved: parts.fields.length - fields.length,
    });
    return this.answer(businessId, saved);
  }

  /** The answer to a write: the request as written, with no view audit and no access check. */
  answer(businessId: string, record: EsignRequestRecord): Promise<EsignRequestDetail> {
    return this.toDetail(businessId, record);
  }

  /** Who a recipient is. Client logins are the request's client's own, by id, never by email. */
  private async who(
    businessId: string,
    clientId: string | null,
    who: PutRecipient['who'],
  ): Promise<Pick<EsignRecipient, 'name' | 'email' | 'phone' | 'link'>> {
    if (who.type === 'EXTERNAL') {
      const { name, email, phone } = who;
      return { name, email, phone: phone ?? null, link: { type: 'EXTERNAL' } };
    }
    if (who.type === 'STAFF') {
      const member = await this.directory.member(businessId, who.userId);
      if (!member?.active) throw esignRefusal('NOT_A_MEMBER');
      return { name: member.name, email: member.email, phone: null, link: who };
    }
    const login = await this.directory.clientLogin(businessId, who.clientAccountId);
    const usable =
      login !== null &&
      clientId !== null &&
      login.clientId === clientId &&
      login.status === 'ACTIVE' &&
      login.portalRole !== 'AUTHORIZED';
    if (!usable) throw esignRefusal('LOGIN_NOT_ACTIVE');
    return { name: login.name, email: login.email, phone: null, link: who };
  }

  /** 409 APPROVER_NOT_ALLOWED unless an Owner, Admin or Firm Sign Manager, not the sender. */
  private async approver(
    businessId: string,
    record: EsignRequestRecord,
    who: PutRecipient['who'],
  ): Promise<void> {
    const role = who.type === 'STAFF' ? await this.repo.esignRole(businessId, who.userId) : null;
    const allowed =
      who.type === 'STAFF' &&
      who.userId !== record.senderUserId &&
      role !== null &&
      APPROVER_ROLES.has(role);
    if (!allowed) throw esignRefusal('APPROVER_NOT_ALLOWED');
  }

  /**
   * The request, if the caller may reach it; else 404 (another firm's id included). 'write'
   * needs Owner or Admin, the sender or the client's assigned member; 'read' (also decisions)
   * admits an approver of the request too, whatever their role or the assignment.
   */
  async reach(businessId: string, actor: EsignActor, id: string, mode: 'read' | 'write') {
    const record = await this.repo.findRequest(businessId, id);
    if (!record) throw notFound();
    if (await this.manages(businessId, actor, record)) {
      if (mode === 'write') readOnly(actor);
      return { record, approverOnly: false, parts: null };
    }
    if (mode === 'read') {
      // `parts` is handed back so a read that needs them does not read them again.
      const parts = await this.repo.parts(businessId, record.id);
      const approves = parts.recipients.some(
        (r) => r.kind === 'APPROVER' && r.link.type === 'STAFF' && r.link.userId === actor.userId,
      );
      if (approves) return { record, approverOnly: true, parts };
    }
    throw notFound();
  }

  private async manages(businessId: string, actor: EsignActor, record: EsignRequestRecord) {
    if (seesAll(actor) || record.senderUserId === actor.userId) return true;
    const client = record.clientId && (await this.directory.client(businessId, record.clientId));
    return !!client && client.assignedUserId === actor.userId;
  }

  /** A DRAFT the caller may change (write mode), else 404 or 409 INVALID_STATE. */
  async draft(businessId: string, actor: EsignActor, id: string) {
    const { record } = await this.reach(businessId, actor, id, 'write');
    if (record.status !== 'DRAFT') throw esignRefusal('INVALID_STATE');
    return record;
  }

  /** A client the caller reaches and that is not archived; else 404. */
  async reachableClient(businessId: string, actor: EsignActor, clientId: string) {
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

  /**
   * The list's row for a request the caller may see. `actor` null: the answer to a draft write.
   * Reached only as an approver (not Owner or Admin, the sender or the client's assigned member),
   * the caller may decide and download, never change it.
   */
  async row(
    businessId: string,
    r: EsignRequestRecord,
    recipients: EsignRecipientRecord[],
    actor: EsignActor | null,
  ): Promise<EsignRequestRow> {
    const [client, sender] = await Promise.all([
      r.clientId ? this.directory.client(businessId, r.clientId) : null,
      this.directory.member(businessId, r.senderUserId),
    ]);
    const approverOnly =
      actor !== null &&
      !seesAll(actor) &&
      r.senderUserId !== actor.userId &&
      client?.assignedUserId !== actor.userId;
    const signers = signersOf(recipients);
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
      nextAction: nextAction(r.status, recipients),
      createdAt: r.createdAt.toISOString(),
      sentAt: iso(r.sentAt),
      lastActivityAt: r.lastActivityAt.toISOString(),
      expiresAt: iso(r.expiresAt),
      completedAt: iso(r.completedAt),
      allowedActions: allowedActions(r, recipients, actor, approverOnly),
    };
  }

  private async toDetail(
    businessId: string,
    r: EsignRequestRecord,
    actor: EsignActor | null = null,
  ): Promise<EsignRequestDetail> {
    const parts: EsignRequestParts = await this.repo.parts(businessId, r.id);
    const [row, service] = await Promise.all([
      this.row(businessId, r, parts.recipients, actor),
      r.engagementId ? this.directory.engagement(businessId, r.engagementId) : null,
    ]);
    return {
      ...row,
      internalNote: r.internalNote,
      emailSubject: r.emailSubject,
      emailMessage: r.emailMessage,
      routing: r.routing,
      engagement: service && { id: service.id, title: service.title },
      expiryDays: r.expiryDays,
      reminders: r.reminders,
      expiryWarningDays: r.expiryWarningDays,
      documents: parts.documents.map(toDocument),
      // Contract fields only (the schemas drop anything else a row holds).
      pagePlan: parts.pagePlan.map(({ documentId, page, rotation }) => ({
        documentId,
        page,
        rotation,
      })),
      recipients: parts.recipients.map(({ accessCodeHash, ...x }) =>
        EsignRecipient.parse({
          ...x,
          hasAccessCode: accessCodeHash !== null,
          sentAt: iso(x.sentAt),
          viewedAt: iso(x.viewedAt),
          signedAt: iso(x.signedAt),
          declinedAt: iso(x.declinedAt),
          lastRemindedAt: iso(x.lastRemindedAt),
        }),
      ),
      fields: parts.fields.map((f) => EsignField.parse(f)),
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
      originalSha256: r.originalSha256,
      finalSha256: null,
      certificateSha256: null,
      finalDocumentId: null,
      certificateDocumentId: null,
    };
  }
}

const clientRef = (c: DirectoryClient) => ({ id: c.id, displayName: c.displayName });

/** A file as the contract shows it. */
export function toDocument(d: EsignDocumentRecord): EsignDocument {
  return {
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
  };
}

/** A draft write's result: the request as written, or 409 INVALID_STATE when it was refused. */
export function savedOrRefused(record: EsignRequestRecord | null): EsignRequestRecord {
  if (!record) throw esignRefusal('INVALID_STATE');
  return record;
}

/** The same person by link: type and id compared field by field (never by JSON key order). */
function sameLink(a: EsignRecipient['link'], b: EsignRecipient['link']): boolean {
  if (a.type === 'STAFF') return b.type === 'STAFF' && a.userId === b.userId;
  if (a.type === 'CLIENT_LOGIN') {
    return b.type === 'CLIENT_LOGIN' && a.clientAccountId === b.clientAccountId;
  }
  return a.type === b.type;
}
