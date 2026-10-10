import { Inject, Injectable } from '@nestjs/common';
import {
  ESIGN_MAX_PAGES,
  type EsignAccessRole,
  type EsignDefaults,
  type EsignField,
  type EsignPage,
  type EsignRequestStatus,
} from '@firmivra/types';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  addEvents,
  addLinks,
  documentColumns,
  ensureDefaultConsent,
  EsignFieldValues,
  fresh,
  inFirm,
  InjectDatabase,
  lockRequest,
  nextActivity,
  planJson,
  Refused,
  refusable,
  REMINDERS,
  queueEmails,
  replaceFields,
  requestColumns,
  saveRecipientRows,
  type SealedValues,
  toDocument,
  toEvent,
  toRecipient,
  toRequest,
} from './esign-prisma.js';
import type {
  EsignApprovalNote,
  EsignDocumentRecord,
  EsignDraftPatch,
  EsignEventRecord,
  EsignListAfter,
  EsignListedRequest,
  EsignPendingUpload,
  EsignRecipientRecord,
  EsignRepository,
  EsignRequestFilter,
  EsignRequestParts,
  EsignRequestRecord,
  EsignSendWrite,
  NewEsignDocument,
  NewEsignRequest,
} from './esign.repository.js';

/** The platform's defaults (esign_settings' column defaults) until the firm changes one. */
export const PLATFORM_DEFAULTS: EsignDefaults = {
  expiryDays: 30,
  reminders: { firstAfterDays: 3, everyDays: 3, max: 3 },
  expiryWarningDays: 2,
  authMethod: 'EMAIL_CODE',
  requireApproval: false,
  emailMessage: null,
};

/** The firm's Signing Settings defaults, read in the firm's scope. */
export async function firmDefaults(database: Database, businessId: string): Promise<EsignDefaults> {
  const row = await database
    .forBusiness(businessId)
    .esignSettings.findUnique({ where: { businessId } });
  if (!row) return structuredClone(PLATFORM_DEFAULTS);
  return {
    expiryDays: row.expiryDays,
    reminders: {
      firstAfterDays: row.reminderFirstAfterDays,
      everyDays: row.reminderEveryDays,
      max: row.reminderMax,
    },
    expiryWarningDays: row.expiryWarningDays,
    authMethod: row.authMethod as EsignDefaults['authMethod'],
    requireApproval: row.requireApproval,
    emailMessage: row.emailMessage,
  };
}

/** ILIKE on a substring: Prisma passes %, _ and backslash through, so they are escaped here. */
export const insensitive = (search: string) => ({
  contains: search.replace(/[\\%_]/g, '\\$&'),
  mode: 'insensitive' as const,
});
/** Between `from` (inclusive) and `before` (exclusive), each when given. */
const range = (from?: Date, before?: Date) =>
  from || before ? { ...(from && { gte: from }), ...(before && { lt: before }) } : undefined;

/** The list's filter as a Prisma where (the firm's scope adds the firm). */
export function requestWhere(f: EsignRequestFilter): Prisma.EsignRequestWhereInput {
  const and: Prisma.EsignRequestWhereInput[] = [];
  const approver = (userId: string, pending: boolean) => ({
    recipients: {
      some: {
        kind: 'APPROVER' as const,
        staffUserId: userId,
        ...(pending && { status: { not: 'APPROVED' as const } }),
      },
    },
  });
  if (f.visibleTo !== null) {
    and.push({
      OR: [
        { senderUserId: f.visibleTo },
        { client: { assignedUserId: f.visibleTo } },
        approver(f.visibleTo, false),
      ],
    });
  }
  if (f.pendingApprover) and.push(approver(f.pendingApprover, true));
  if (f.search) {
    const s = insensitive(f.search);
    and.push({
      OR: [
        { title: s },
        { client: { displayName: s } },
        { sender: { user: { name: s } } },
        { recipients: { some: { kind: 'SIGNER', name: s } } },
      ],
    });
  }
  return {
    AND: and,
    ...(f.statuses && { status: { in: [...f.statuses] } }),
    ...(f.clientId && { clientId: f.clientId }),
    ...(f.senderUserId && { senderUserId: f.senderUserId }),
    ...(range(f.lastActivityFrom, f.lastActivityBefore) && {
      lastActivityAt: range(f.lastActivityFrom, f.lastActivityBefore),
    }),
    ...(range(f.expiresFrom, f.expiresBefore) && {
      expiresAt: range(f.expiresFrom, f.expiresBefore),
    }),
    ...(f.completedFrom && { completedAt: { gte: f.completedFrom } }),
  };
}

/**
 * Firm Sign's requests in PostgreSQL (R13, r0_esign). Every write that changes a request runs in
 * one transaction in the firm's scope that locks the request row FOR UPDATE first and moves
 * lastActivityAt strictly forward; a draft write also sends every APPROVER back to WAITING.
 */
@Injectable()
export class PrismaEsignRepository implements EsignRepository {
  constructor(
    @InjectDatabase() private readonly database: Database,
    @Inject(EsignFieldValues) private readonly values: EsignFieldValues,
  ) {}

  private db(businessId: string) {
    return this.database.forBusiness(businessId);
  }

  async listRequests(
    businessId: string,
    filter: EsignRequestFilter,
    page: { after: EsignListAfter | null; limit: number },
  ): Promise<EsignListedRequest[]> {
    const { after, limit } = page;
    const where = requestWhere(filter);
    const rows = await this.db(businessId).esignRequest.findMany({
      where: after
        ? {
            AND: [
              where,
              {
                OR: [
                  { lastActivityAt: { lt: after.lastActivityAt } },
                  { lastActivityAt: after.lastActivityAt, id: { lt: after.id } },
                ],
              },
            ],
          }
        : where,
      orderBy: [{ lastActivityAt: 'desc' }, { id: 'desc' }],
      take: limit,
      include: { recipients: { orderBy: { position: 'asc' } } },
    });
    return rows.map(({ recipients, ...row }) => ({
      record: toRequest(row),
      recipients: recipients.map(toRecipient),
    }));
  }

  async countRequests(businessId: string, filter: EsignRequestFilter) {
    const groups = await this.db(businessId).esignRequest.groupBy({
      by: ['status'],
      where: requestWhere(filter),
      _count: { _all: true },
    });
    const counts: Partial<Record<EsignRequestStatus, number>> = {};
    for (const g of groups) counts[g.status] = g._count._all;
    return counts;
  }

  async events(businessId: string, id: string): Promise<EsignEventRecord[]> {
    const rows = await this.db(businessId).esignEvent.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toEvent);
  }

  defaults(businessId: string): Promise<EsignDefaults> {
    return firmDefaults(this.database, businessId);
  }

  async createRequest(businessId: string, input: NewEsignRequest): Promise<EsignRequestRecord> {
    const row = await this.db(businessId).esignRequest.create({
      data: {
        ...requestColumns(input),
        ...REMINDERS(input),
        businessId,
      },
    });
    return toRequest(row);
  }

  async findRequest(businessId: string, id: string): Promise<EsignRequestRecord | null> {
    const row = await this.db(businessId).esignRequest.findFirst({ where: { id } });
    return row && toRequest(row);
  }

  async parts(businessId: string, id: string): Promise<EsignRequestParts> {
    const row = await this.db(businessId).esignRequest.findFirst({
      where: { id },
      select: {
        pagePlan: true,
        documents: { orderBy: { position: 'asc' } },
        recipients: { orderBy: { position: 'asc' } },
        fields: { orderBy: { position: 'asc' } },
      },
    });
    if (!row) return { documents: [], pagePlan: [], recipients: [], fields: [] };
    const fields: EsignField[] = [];
    for (const { valueEnc, position: _p, businessId: _b, requestId: _q, ...f } of row.fields) {
      // A sender's value is part of the request; a signer's stays with completion (inputs()).
      const value =
        f.recipientId === null && valueEnc
          ? await this.values.open(businessId, f.id, valueEnc)
          : null;
      fields.push({ ...f, mergeKey: f.mergeKey as EsignField['mergeKey'], value });
    }
    return {
      documents: row.documents.map(toDocument),
      pagePlan: row.pagePlan as unknown as EsignPage[],
      recipients: row.recipients.map(toRecipient),
      fields,
    };
  }

  async esignRole(businessId: string, userId: string): Promise<EsignAccessRole | null> {
    const member = await this.db(businessId).membership.findFirst({
      where: { businessId, userId },
      select: { role: true, esignRole: { select: { role: true } } },
    });
    if (!member) return null;
    if (member.role === 'OWNER' || member.role === 'ADMIN') return member.role;
    return member.esignRole?.role ?? 'STAFF';
  }

  /** Always true: a firm with no consent version gets the default text at its first send. */
  consentPublished(_businessId: string): Promise<boolean> {
    return Promise.resolve(true);
  }

  async approvalNotes(businessId: string, id: string): Promise<EsignApprovalNote[]> {
    const rows = await this.db(businessId).esignApprovalNote.findMany({
      where: { requestId: id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { recipientId: true, decision: true, note: true },
    });
    return rows.map((r) => ({ ...r, note: r.note ?? '' }));
  }

  /**
   * A draft write: under the request's lock, only while it is a DRAFT (and, with `readAt`, still
   * unchanged); lastActivityAt moves forward and every APPROVER goes back to WAITING (an edit
   * asks for approval again). Null when refused; `fn`'s answer otherwise.
   */
  private draftWrite<T>(
    businessId: string,
    id: string,
    readAt: Date | null,
    fn: (tx: TxClient, lastActivityAt: Date) => Promise<T>,
  ): Promise<T | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      if (locked?.status !== 'DRAFT' || (readAt && !fresh(locked, readAt))) return null;
      const lastActivityAt = nextActivity(locked.lastActivityAt);
      await tx.esignRequest.update({ where: { id }, data: { lastActivityAt } });
      const answer = await fn(tx, lastActivityAt);
      await tx.esignRecipient.updateMany({
        where: { requestId: id, kind: 'APPROVER', status: { not: 'WAITING' } },
        data: { status: 'WAITING' },
      });
      return answer;
    });
  }

  /** A draft write that answers the request as written. */
  private async written(
    businessId: string,
    id: string,
    readAt: Date | null,
    fn: (tx: TxClient) => Promise<unknown>,
  ): Promise<EsignRequestRecord | null> {
    return this.draftWrite(businessId, id, readAt, async (tx) => {
      await fn(tx);
      return toRequest(await tx.esignRequest.findUniqueOrThrow({ where: { id } }));
    });
  }

  async updateDraft(
    businessId: string,
    id: string,
    patch: EsignDraftPatch,
    options: { clientChange?: boolean } = {},
  ): Promise<EsignRequestRecord | 'INVALID_STATE' | 'RECIPIENTS_LINKED'> {
    const written = await refusable<EsignRequestRecord | null, 'RECIPIENTS_LINKED'>(() =>
      this.draftWrite(businessId, id, null, async (tx) => {
        // Checked under the lock, so a PUT recipients cannot slip in between.
        if (options.clientChange) {
          const linked = await tx.esignRecipient.count({
            where: { requestId: id, linkType: 'CLIENT_LOGIN' },
          });
          if (linked > 0) throw new Refused('RECIPIENTS_LINKED');
        }
        const row = await tx.esignRequest.update({ where: { id }, data: requestColumns(patch) });
        return toRequest(row);
      }),
    );
    return written ?? 'INVALID_STATE';
  }

  async deleteDraft(businessId: string, id: string) {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      if (locked?.status !== 'DRAFT') return null;
      const documents = await tx.esignDocument.findMany({
        where: { requestId: id },
        select: { id: true, s3Key: true },
      });
      await tx.esignRequest.delete({ where: { id } });
      return documents;
    });
  }

  async savePagePlan(
    businessId: string,
    id: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ) {
    const sealed = await this.seal(businessId, fields);
    return this.written(businessId, id, readAt, async (tx) => {
      await tx.esignRequest.update({ where: { id }, data: { pagePlan: planJson(pagePlan) } });
      await replaceFields(tx, businessId, id, fields, sealed);
    });
  }

  async saveRecipients(
    businessId: string,
    id: string,
    recipients: EsignRecipientRecord[],
    fields: EsignField[],
    readAt: Date,
  ) {
    const sealed = await this.seal(businessId, fields);
    return this.written(businessId, id, readAt, async (tx) => {
      // The fields first: they point at the recipients being replaced.
      await tx.esignField.deleteMany({ where: { requestId: id } });
      await saveRecipientRows(tx, businessId, id, recipients);
      await replaceFields(tx, businessId, id, fields, sealed);
    });
  }

  async saveFields(businessId: string, id: string, fields: EsignField[], readAt: Date) {
    const sealed = await this.seal(businessId, fields);
    return this.written(businessId, id, readAt, (tx) =>
      replaceFields(tx, businessId, id, fields, sealed),
    );
  }

  async sendDraft(businessId: string, id: string, write: EsignSendWrite, readAt: Date) {
    return inFirm(this.database, businessId, async (tx) => {
      const locked = await lockRequest(tx, id);
      if (locked?.status !== 'DRAFT' || !fresh(locked, readAt)) return null;
      for (const t of write.turn) {
        await tx.esignRecipient.update({
          where: { id: t.recipientId },
          data: { status: 'SENT', sentAt: write.sentAt },
        });
      }
      const row = await tx.esignRequest.update({
        where: { id },
        data: {
          status: 'SENT',
          sentAt: write.sentAt,
          expiresAt: write.expiresAt,
          originalSha256: write.originalSha256,
          lastActivityAt: nextActivity(locked.lastActivityAt, write.sentAt),
        },
      });
      const links = write.turn.flatMap((t) =>
        t.tokenHash ? [{ recipientId: t.recipientId, tokenHash: t.tokenHash }] : [],
      );
      await addLinks(tx, businessId, id, links, 'SIGN');
      await addEvents(tx, businessId, id, [write.event]);
      const emailIds = await queueEmails(tx, businessId, id, write.emails);
      const defaultConsentId = await ensureDefaultConsent(tx, businessId);
      return { request: toRequest(row), emailIds, ...(defaultConsentId && { defaultConsentId }) };
    });
  }

  async emailOutcome(
    businessId: string,
    emailId: string,
    outcome: { sent: true } | { sent: false; error: string },
  ): Promise<void> {
    const error = outcome.sent
      ? null
      : /^[A-Za-z0-9_.]{1,100}$/.test(outcome.error)
        ? outcome.error
        : 'Error';
    await this.db(businessId).esignEmail.updateMany({
      where: { id: emailId },
      data: {
        status: outcome.sent ? 'SENT' : 'FAILED',
        error,
        sentAt: outcome.sent ? new Date() : null,
        attempts: { increment: 1 },
      },
    });
  }

  async saveUpload(businessId: string, upload: EsignPendingUpload): Promise<void> {
    const { documentId, key, ...rest } = upload;
    await this.db(businessId).esignPendingUpload.create({
      data: { ...rest, businessId, kind: 'DOCUMENT', fileId: documentId, s3Key: key },
    });
  }

  async takeUpload(
    businessId: string,
    requestId: string,
    userId: string,
    tokenHash: string,
  ): Promise<EsignPendingUpload | null> {
    return inFirm(this.database, businessId, async (tx) => {
      const where = { businessId, tokenHash, requestId, userId, kind: 'DOCUMENT' as const };
      const row = await tx.esignPendingUpload.findFirst({ where });
      // Taken once: a second confirm finds nothing to delete.
      if (!row || (await tx.esignPendingUpload.deleteMany({ where })).count !== 1) return null;
      return {
        ...{ tokenHash: row.tokenHash, requestId: row.requestId, userId, documentId: row.fileId },
        ...{ key: row.s3Key, fileName: row.fileName, sizeBytes: row.sizeBytes },
        contentType: row.contentType as EsignPendingUpload['contentType'],
        ...{ sha256: row.sha256, createdAt: row.createdAt },
      };
    });
  }

  async addDocument(
    businessId: string,
    id: string,
    document: NewEsignDocument,
  ): Promise<EsignDocumentRecord | 'NOT_DRAFT' | 'TOO_MANY_PAGES'> {
    const added = await refusable<EsignDocumentRecord | null, 'TOO_MANY_PAGES'>(() =>
      this.draftWrite(businessId, id, null, async (tx) => {
        const row = await tx.esignRequest.findUniqueOrThrow({
          where: { id },
          select: { pagePlan: true, documents: { select: { position: true } } },
        });
        const plan = row.pagePlan as unknown as EsignPage[];
        if (plan.length + document.pageCount > ESIGN_MAX_PAGES) throw new Refused('TOO_MANY_PAGES');
        // After the last file: a removed file's position is never reused.
        const position = Math.max(-1, ...row.documents.map((d) => d.position)) + 1;
        const created = await tx.esignDocument.create({
          data: { ...documentColumns({ ...document, position }), businessId, requestId: id },
        });
        const pages = Array.from({ length: document.pageCount }, (_, page) => ({
          documentId: document.id,
          page,
          rotation: 0 as const,
        }));
        await tx.esignRequest.update({
          where: { id },
          data: { pagePlan: planJson([...plan, ...pages]) },
        });
        return toDocument(created);
      }),
    );
    return added ?? 'NOT_DRAFT';
  }

  async removeDocument(
    businessId: string,
    id: string,
    documentId: string,
    pagePlan: EsignPage[],
    fields: EsignField[],
    readAt: Date,
  ) {
    const sealed = await this.seal(businessId, fields);
    return this.written(businessId, id, readAt, async (tx) => {
      await tx.esignDocument.deleteMany({ where: { requestId: id, id: documentId } });
      await tx.esignRequest.update({ where: { id }, data: { pagePlan: planJson(pagePlan) } });
      await replaceFields(tx, businessId, id, fields, sealed);
    });
  }

  private seal(businessId: string, fields: readonly EsignField[]): Promise<SealedValues> {
    return this.values.seal(businessId, fields);
  }
}
