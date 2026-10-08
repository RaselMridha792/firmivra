import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateFirmUploadRequest,
  DocumentCategory,
  DownloadLink,
  FirmDocument,
  FirmDocumentList,
  ListFirmDocumentsQuery,
  UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { decodeCursor, encodeCursor, likeEscape } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import {
  clientReach,
  type DocumentRow,
  documentSelect,
  type FirmActor,
  findTarget,
  lockReachableClient,
  notFound,
  peopleOf,
  reachableClient,
  toFirmDocument,
} from './document-records.js';
import { UploadsService } from './uploads.service.js';

type ListQuery = z.output<typeof ListFirmDocumentsQuery>;
type UploadBody = z.output<typeof CreateFirmUploadRequest>;

/**
 * A client's documents as the firm sees them (client record > Documents; R5, contract in
 * packages/types/src/documents). Owner and Admin reach every client, Staff only those assigned to
 * them (others are 404, as in R10's clients). A file the firm uploads is INTERNAL unless it is
 * shared with the client. Every list, view, upload and download link is audited with ids only.
 */
@Injectable()
export class FirmDocumentsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly uploads: UploadsService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** One page, newest first, with every tax year among the client's documents. */
  async list(
    businessId: string,
    actor: FirmActor,
    clientId: string,
    q: ListQuery,
  ): Promise<FirmDocumentList> {
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const where: Prisma.DocumentWhereInput = {
      AND: [
        { businessId, clientId },
        q.serviceId ? { engagementId: q.serviceId } : {},
        q.categoryId ? { categoryId: q.categoryId } : {},
        q.taxYear ? { taxYear: q.taxYear } : {},
        q.direction ? { direction: q.direction } : {},
        term ? { fileName: { contains: term, mode: 'insensitive' } } : {},
        after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    };
    const result = await this.inFirm(businessId, async (tx) => {
      await reachableClient(tx, businessId, actor, clientId);
      const rows = await tx.document.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: q.limit + 1,
        select: documentSelect,
      });
      const years = await tx.document.findMany({
        where: { businessId, clientId, taxYear: { not: null } },
        distinct: ['taxYear'],
        orderBy: { taxYear: 'desc' },
        select: { taxYear: true },
      });
      const page = rows.slice(0, q.limit);
      const people = await peopleOf(
        tx,
        page.map((r) => r.uploadedByUserId),
      );
      const last = page.at(-1);
      return {
        items: page.map((r) => toFirmDocument(r, people)),
        nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
        years: years.flatMap((y) => (y.taxYear === null ? [] : [y.taxYear])),
      };
    });
    await this.audit.log(
      'documents.listed',
      { type: 'client', id: clientId },
      { count: result.items.length },
    );
    return result;
  }

  async get(businessId: string, actor: FirmActor, id: string): Promise<FirmDocument> {
    const doc = await this.inFirm(businessId, async (tx) => {
      const row = await this.find(tx, businessId, actor, id);
      return toFirmDocument(row, await peopleOf(tx, [row.uploadedByUserId]));
    });
    await this.audit.log('document.viewed', { type: 'document', id }, { clientId: doc.clientId });
    return doc;
  }

  /**
   * Step 1 of an upload by the firm: 404 for a client, service or category it doesn't reach;
   * then 409 NO_OPEN_SERVICE (also for an archived client) or CATEGORY_ARCHIVED.
   */
  async createUpload(
    businessId: string,
    actor: FirmActor,
    clientId: string,
    body: UploadBody,
  ): Promise<UploadTicket> {
    await this.inFirm(businessId, async (tx) => {
      const { archived } = await lockReachableClient(tx, businessId, actor, clientId);
      await findTarget(tx, businessId, clientId, { ...body, clientArchived: archived });
    });
    return this.uploads.ticket({
      pool: 'STAFF',
      businessId,
      userId: actor.userId,
      clientAccountId: null,
      clientId,
      engagementId: body.serviceId,
      categoryId: body.categoryId ?? null,
      direction: body.shareWithClient ? 'FIRM_TO_CLIENT' : 'INTERNAL',
      taxYear: body.taxYear ?? null,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
    });
  }

  /**
   * Step 3. 410 UPLOAD_EXPIRED; 409 UPLOAD_MISMATCH, FILE_PASSWORD_PROTECTED or FILE_HAS_MACROS;
   * the member must still reach the client (404) and the service must still be open (409).
   */
  async confirmUpload(
    businessId: string,
    actor: FirmActor,
    uploadToken: string,
  ): Promise<FirmDocument> {
    const id = await this.uploads.confirm(
      { pool: 'STAFF', businessId, userId: actor.userId, clientAccountId: null },
      uploadToken,
      (tx, claim) => lockReachableClient(tx, businessId, actor, claim.clientId),
    );
    return this.inFirm(businessId, async (tx) => {
      const row = await this.find(tx, businessId, actor, id);
      return toFirmDocument(row, await peopleOf(tx, [row.uploadedByUserId]));
    });
  }

  /** A 5-minute link. 404 first, then 409 SCAN_PENDING or FILE_BLOCKED. */
  async download(businessId: string, actor: FirmActor, id: string): Promise<DownloadLink> {
    const row = await this.inFirm(businessId, (tx) => this.find(tx, businessId, actor, id));
    return this.uploads.downloadLink(row);
  }

  /** The firm's categories in order; archived ones too, for old documents. */
  async categories(businessId: string): Promise<DocumentCategory[]> {
    const rows = await this.database.forBusiness(businessId).documentCategory.findMany({
      where: { businessId },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      select: { id: true, name: true, retentionYears: true, archivedAt: true },
      take: 500,
    });
    return rows.map((r) => ({ ...r, archivedAt: r.archivedAt?.toISOString() ?? null }));
  }

  /** The document, if its client is one this member reaches; else 404. */
  private async find(
    tx: TxClient,
    businessId: string,
    actor: FirmActor,
    id: string,
  ): Promise<DocumentRow> {
    const row = await tx.document.findFirst({
      where: { businessId, id, engagement: { client: clientReach(actor) } },
      select: documentSelect,
    });
    if (!row) throw notFound();
    return row;
  }
}
