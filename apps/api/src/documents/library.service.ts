import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type BulkDocumentsResult,
  type DocumentActivity,
  type DocumentVersionList,
  type DownloadLink,
  fileNameFitsType,
  type LibraryDocument,
  type LibraryPage,
  type LibrarySummary,
  type UploadContentType,
  type UploadTicket,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import {
  type DocumentRow,
  findTarget,
  lockReachableClient,
  notFound,
} from '../storage/document-records.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { DocumentRequestsService } from '../storage/document-requests.service.js';
import { UploadsService } from '../storage/uploads.service.js';
import { memberNames } from '../workspaces/common.js';
import {
  actorOf,
  conflict,
  docReach,
  invalid,
  librarySelect,
  liveFolder,
  type LibraryRow,
  namesFor,
  requireActiveMember,
  requireCapability,
  rethrowCheck,
  toLibraryDocument,
} from './library.common.js';
import type {
  BulkBody,
  LibraryQ,
  ReviewBody,
  UpdateDocumentBody,
  UploadBody,
} from './library.input.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
const ACTIVE: Prisma.DocumentWhereInput = { archivedAt: null, trashedAt: null };
const toDay = (v: string) => new Date(`${v}T00:00:00Z`);

/** What each audited action shows as in a document's activity (ids and field names only). */
const ACTIVITY: Record<string, [DocumentActivity['kind'], string]> = {
  'document.uploaded': ['UPLOADED', 'Uploaded'],
  'document.download_link_issued': ['DOWNLOADED', 'Downloaded'],
  'document.reviewed': ['REVIEW', 'Review updated'],
  'document.archived': ['ARCHIVED', 'Archived'],
  'document.restored': ['RESTORED', 'Restored'],
  'document.trashed': ['TRASHED', 'Moved to Trash'],
  'document.untrashed': ['RESTORED', 'Restored from Trash'],
  'document.shared': ['SHARED', 'Shared'],
  'document.share_changed': ['SHARE_CHANGED', 'Access changed'],
  'document.share_revoked': ['SHARE_REVOKED', 'Access revoked'],
};

/**
 * The firm-wide Documents library (R55; contract packages/types/src/documents/library.ts): the
 * list, summary, Frame 1's upload (R5's tickets and confirm with the library's fields), Frame 2's
 * details, edits, review, archive and trash, versions, activity and preview, and bulk actions.
 * Staff reach only their own clients' documents (others 404). Every list, view and change is
 * audited with ids and field names only.
 */
@Injectable()
export class DocumentLibraryService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly uploads: UploadsService,
    private readonly requests: DocumentRequestsService,
    private readonly grants: PermissionGrantsService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  /** The document as the member reaches it (FOR UPDATE when it is about to change); 404 else. */
  private async find(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    id: string,
    lock = false,
  ): Promise<LibraryRow> {
    const businessId = tenant.businessId;
    if (lock) {
      await tx.$executeRaw`SELECT 1 FROM documents
        WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    }
    const row = await tx.document.findFirst({
      where: { AND: [{ businessId, id }, docReach(actorOf(userId, tenant))] },
      select: librarySelect,
    });
    if (!row) throw notFound();
    return row;
  }

  private async one(tx: TxClient, tenant: TenantContext, row: LibraryRow) {
    return toLibraryDocument(row, await namesFor(tx, tenant.businessId, [row]));
  }

  // ---------- List and summary ----------

  async list(tenant: TenantContext, userId: string, q: Out<typeof LibraryQ>): Promise<LibraryPage> {
    const businessId = tenant.businessId;
    const and: Prisma.DocumentWhereInput[] = [{ businessId }, docReach(actorOf(userId, tenant))];
    if (q.scope === 'active') and.push(ACTIVE);
    else if (q.scope === 'archived') and.push({ archivedAt: { not: null }, trashedAt: null });
    else and.push({ trashedAt: { not: null } });
    if (q.folderId === 'firm') and.push({ folder: { scope: 'FIRM' } });
    else if (q.folderId === 'client') {
      and.push({ OR: [{ folderId: null }, { folder: { scope: 'CLIENT' } }] });
    } else if (q.folderId) and.push({ folderId: q.folderId });
    if (q.clientId) and.push({ clientId: q.clientId });
    if (q.serviceId) and.push({ engagementId: q.serviceId });
    if (q.categoryId) and.push({ categoryId: q.categoryId });
    if (q.taxYear) and.push({ taxYear: q.taxYear });
    if (q.reviewStatus) and.push({ reviewStatus: q.reviewStatus });
    if (q.reviewerUserId) and.push({ reviewerUserId: q.reviewerUserId });
    if (q.direction) and.push({ direction: q.direction });
    if (q.tag) and.push({ tags: { has: q.tag } });
    if (q.uploadedFrom) and.push({ createdAt: { gte: toDay(q.uploadedFrom) } });
    if (q.uploadedTo)
      and.push({ createdAt: { lt: new Date(toDay(q.uploadedTo).getTime() + DAY) } });
    if (q.search) {
      const term = likeEscape(q.search);
      const contains = { contains: term, mode: 'insensitive' as const };
      and.push({
        OR: [
          { fileName: contains },
          { description: contains },
          { tags: { has: q.search } },
          { engagement: { title: contains } },
          { engagement: { client: { displayName: contains } } },
          { category: { name: contains } },
        ],
      });
    }
    const orderBy: Prisma.DocumentOrderByWithRelationInput[] =
      q.sort === 'oldest'
        ? [{ createdAt: 'asc' }]
        : q.sort === 'name'
          ? [{ fileName: 'asc' }]
          : q.sort === 'size'
            ? [{ sizeBytes: 'desc' }]
            : q.sort === 'client'
              ? [{ engagement: { client: { displayName: 'asc' } } }, { createdAt: 'desc' }]
              : [{ createdAt: 'desc' }];
    const where: Prisma.DocumentWhereInput = { AND: and };
    const page = await this.inFirm(tenant, async (tx) => {
      const [total, rows] = await Promise.all([
        tx.document.count({ where }),
        tx.document.findMany({
          where,
          orderBy: [...orderBy, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          select: librarySelect,
        }),
      ]);
      const names = await namesFor(tx, businessId, rows);
      return {
        items: rows.map((r) => toLibraryDocument(r, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
    await this.audit.log(
      'documents.library_listed',
      { type: 'document' },
      { count: page.items.length },
    );
    return page;
  }

  async summary(tenant: TenantContext, userId: string): Promise<LibrarySummary> {
    const businessId = tenant.businessId;
    const actor = actorOf(userId, tenant);
    const reach = docReach(actor);
    return this.inFirm(tenant, async (tx) => {
      const count = (extra: Prisma.DocumentWhereInput) =>
        tx.document.count({ where: { AND: [{ businessId }, reach, extra] } });
      const [all, recent, review, completed, firm, client, archived, trash, byFolder, missing] =
        await Promise.all([
          count(ACTIVE),
          count({ ...ACTIVE, createdAt: { gte: new Date(Date.now() - 7 * DAY) } }),
          count({ ...ACTIVE, reviewStatus: { in: ['NEEDS_REVIEW', 'IN_REVIEW'] } }),
          count({ ...ACTIVE, reviewStatus: { in: ['VERIFIED', 'COMPLETED'] } }),
          count({ ...ACTIVE, folder: { scope: 'FIRM' } }),
          count({ ...ACTIVE, OR: [{ folderId: null }, { folder: { scope: 'CLIENT' } }] }),
          count({ archivedAt: { not: null }, trashedAt: null }),
          count({ trashedAt: { not: null } }),
          tx.document.groupBy({
            by: ['folderId'],
            where: { AND: [{ businessId, folderId: { not: null } }, reach, ACTIVE] },
            _count: { _all: true },
          }),
          tx.documentRequest.count({
            where: {
              businessId,
              status: { in: ['REQUESTED', 'REJECTED'] },
              ...(actor.role === 'STAFF'
                ? { engagement: { client: { assignedUserId: actor.userId } } }
                : {}),
            },
          }),
        ]);
      return {
        all,
        recentlyUploaded: recent,
        needsReview: review,
        completed,
        missing,
        folders: {
          firm,
          client,
          archived,
          trash,
          byFolder: byFolder.map((g) => ({ folderId: g.folderId!, count: g._count._all })),
        },
      };
    });
  }

  // ---------- Upload (Frame 1) ----------

  /**
   * Step 1. 404 for a client, service, category, folder or document it doesn't reach; 409
   * NO_OPEN_SERVICE / CATEGORY_ARCHIVED (R5), FOLDER_SCOPE, NOT_A_MEMBER. Confirm is R5's.
   */
  async createUpload(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof UploadBody>,
  ): Promise<UploadTicket> {
    const businessId = tenant.businessId;
    const actor = actorOf(userId, tenant);
    const direction = body.shareWithClient ? 'FIRM_TO_CLIENT' : 'INTERNAL';
    await this.inFirm(tenant, async (tx) => {
      const { archived } = await lockReachableClient(tx, businessId, actor, body.clientId);
      await findTarget(tx, businessId, body.clientId, {
        serviceId: body.serviceId,
        categoryId: body.categoryId ?? null,
        requestId: body.requestId ?? null,
        clientArchived: archived,
      });
      if (body.folderId) {
        const folder = await liveFolder(tx, businessId, body.folderId);
        if (!folder) throw notFound();
        if (folder.scope === 'FIRM' && direction !== 'INTERNAL') {
          throw conflict('FOLDER_SCOPE', 'A firm folder holds internal documents only');
        }
      }
      if (body.reviewerUserId) await requireActiveMember(tx, businessId, body.reviewerUserId);
      if (body.replacesId) {
        const old = await tx.document.findFirst({
          where: { businessId, id: body.replacesId, trashedAt: null },
          select: { clientId: true, engagementId: true, direction: true },
        });
        if (!old || old.clientId !== body.clientId) throw notFound();
        if (old.engagementId !== body.serviceId || old.direction !== direction) {
          throw invalid(
            'A new version keeps the service and sharing of the document it replaces',
            'replacesId',
          );
        }
      }
    });
    return this.uploads.ticket({
      pool: 'STAFF',
      businessId,
      userId,
      clientAccountId: null,
      clientId: body.clientId,
      engagementId: body.serviceId,
      requestId: body.requestId ?? null,
      categoryId: body.categoryId ?? null,
      direction,
      taxYear: body.taxYear ?? null,
      fileName: body.fileName,
      contentType: body.contentType,
      sizeBytes: body.sizeBytes,
      sha256: body.sha256,
      library: {
        folderId: body.folderId ?? null,
        description: body.description ?? null,
        tags: body.tags ?? [],
        reviewerUserId: body.reviewerUserId ?? null,
        expiresOn: body.expiresOn ?? null,
        notifyClient: body.notifyClient,
        replacesId: body.replacesId ?? null,
      },
    });
  }

  // ---------- One document (Frame 2) ----------

  async details(tenant: TenantContext, userId: string, id: string): Promise<LibraryDocument> {
    const doc = await this.inFirm(tenant, async (tx) =>
      this.one(tx, tenant, await this.find(tx, tenant, userId, id)),
    );
    await this.audit.log('document.viewed', { type: 'document', id }, { clientId: doc.client.id });
    return doc;
  }

  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof UpdateDocumentBody>,
  ): Promise<LibraryDocument> {
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    const doc = await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      if (row.trashedAt) throw conflict('INVALID_STATUS', 'Restore the document from Trash first');
      const data: Prisma.DocumentUncheckedUpdateInput = {};
      if (body.fileName !== undefined) {
        if (!fileNameFitsType(body.fileName, row.contentType as UploadContentType)) {
          throw invalid('Keep the file ending of its type (.pdf, .docx...)', 'fileName');
        }
        data.fileName = body.fileName;
      }
      if (body.description !== undefined) data.description = body.description;
      if (body.tags !== undefined) {
        const lower = body.tags.map((t) => t.toLowerCase());
        if (new Set(lower).size !== lower.length) throw invalid('Each tag once', 'tags');
        data.tags = body.tags;
      }
      if (body.folderId !== undefined) {
        if (body.folderId) {
          const folder = await liveFolder(tx, businessId, body.folderId);
          if (!folder) throw notFound();
          if (folder.scope === 'FIRM' && row.direction !== 'INTERNAL') {
            throw conflict('FOLDER_SCOPE', 'A firm folder holds internal documents only');
          }
        }
        data.folderId = body.folderId;
      }
      if (body.categoryId !== undefined) {
        if (body.categoryId) {
          const cat = await tx.documentCategory.findFirst({
            where: { businessId, id: body.categoryId, archivedAt: null },
            select: { id: true },
          });
          if (!cat) throw notFound();
        }
        data.categoryId = body.categoryId;
      }
      if (body.taxYear !== undefined) data.taxYear = body.taxYear;
      if (body.expiresOn !== undefined)
        data.expiresOn = body.expiresOn ? toDay(body.expiresOn) : null;
      if (body.reviewerUserId !== undefined) {
        if (body.reviewerUserId) {
          await requireActiveMember(tx, businessId, body.reviewerUserId);
          if (row.reviewStatus === null) data.reviewStatus = 'NEEDS_REVIEW';
        }
        data.reviewerUserId = body.reviewerUserId;
      }
      await tx.document
        .update({ where: { id }, data })
        .catch((e: unknown) =>
          rethrowCheck(e, 'INVALID_STATUS', 'The document cannot change this way'),
        );
      await this.audit.logIn(
        tx,
        'document.updated',
        { type: 'document', id },
        { fields: fields.sort() },
        { businessId },
      );
      return this.one(tx, tenant, await this.find(tx, tenant, userId, id));
    });
    return doc;
  }

  /** Start Review, Mark Verified, Request Replacement (asks the client again), Complete. */
  async review(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof ReviewBody>,
  ): Promise<LibraryDocument> {
    const businessId = tenant.businessId;
    const { requestId } = await this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      if (row.trashedAt) throw conflict('INVALID_STATUS', 'Restore the document from Trash first');
      const now = new Date();
      const data: Prisma.DocumentUncheckedUpdateInput =
        body.action === 'START'
          ? { reviewStatus: 'IN_REVIEW', reviewedAt: null, reviewedByUserId: null }
          : body.action === 'VERIFY'
            ? { reviewStatus: 'VERIFIED', reviewedAt: now, reviewedByUserId: userId }
            : body.action === 'COMPLETE'
              ? { reviewStatus: 'COMPLETED', reviewedAt: now, reviewedByUserId: userId }
              : { reviewStatus: 'REPLACEMENT_REQUESTED', reviewedAt: null, reviewedByUserId: null };
      if (!row.reviewerUserId && body.action !== 'REQUEST_REPLACEMENT')
        data.reviewerUserId = userId;
      await tx.document.update({ where: { id }, data });
      await this.audit.logIn(
        tx,
        'document.reviewed',
        { type: 'document', id },
        { action: body.action },
        { businessId },
      );
      return { requestId: row.requestId };
    });
    // The client is asked again for the request item this file answered (R5's reject).
    if (body.action === 'REQUEST_REPLACEMENT' && requestId) {
      const item = await this.database.forBusiness(businessId).documentRequest.findFirst({
        where: { businessId, id: requestId },
        select: { status: true },
      });
      if (item?.status === 'SUBMITTED') {
        await this.requests.reject(businessId, actorOf(userId, tenant), requestId, body.reason);
      }
    }
    return this.inFirm(tenant, async (tx) =>
      this.one(tx, tenant, await this.find(tx, tenant, userId, id)),
    );
  }

  /** Archive, Restore, Move to Trash, Restore from Trash. */
  async move(
    tenant: TenantContext,
    userId: string,
    id: string,
    to: 'archive' | 'restore' | 'trash' | 'untrash',
  ): Promise<LibraryDocument> {
    const businessId = tenant.businessId;
    if (to === 'trash' || to === 'untrash') await requireCapability(this.grants, tenant, 'DELETE');
    return this.inFirm(tenant, async (tx) => {
      const row = await this.find(tx, tenant, userId, id, true);
      const now = new Date();
      const plan: Record<typeof to, [boolean, Prisma.DocumentUncheckedUpdateInput, string]> = {
        archive: [!row.trashedAt && !row.archivedAt, { archivedAt: now }, 'document.archived'],
        restore: [!row.trashedAt && !!row.archivedAt, { archivedAt: null }, 'document.restored'],
        trash: [!row.trashedAt, { trashedAt: now, archivedAt: null }, 'document.trashed'],
        untrash: [!!row.trashedAt, { trashedAt: null }, 'document.untrashed'],
      };
      const [allowed, data, action] = plan[to];
      const already =
        (to === 'archive' && row.archivedAt && !row.trashedAt) ||
        (to === 'trash' && row.trashedAt) ||
        (to === 'restore' && !row.archivedAt && !row.trashedAt) ||
        (to === 'untrash' && !row.trashedAt);
      if (!allowed) {
        if (already) return this.one(tx, tenant, row);
        throw conflict('INVALID_STATUS', 'Restore the document from Trash first');
      }
      await tx.document.update({ where: { id }, data });
      await this.audit.logIn(tx, action, { type: 'document', id }, {}, { businessId });
      return this.one(tx, tenant, await this.find(tx, tenant, userId, id));
    });
  }

  /** The version chain the document belongs to, newest first. */
  async versions(
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<DocumentVersionList['items']> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const start = await this.find(tx, tenant, userId, id);
      const select = {
        id: true,
        versionNo: true,
        fileName: true,
        sizeBytes: true,
        scanStatus: true,
        uploadedByUserId: true,
        createdAt: true,
        replacesId: true,
        supersededAt: true,
      } as const;
      type VersionRow = Prisma.DocumentGetPayload<{ select: typeof select }>;
      const chain = new Map<string, VersionRow>();
      let back: string | null = start.id;
      while (back && chain.size < 100) {
        const r: VersionRow | null = await tx.document.findFirst({
          where: { businessId, id: back },
          select,
        });
        if (!r) break;
        chain.set(r.id, r);
        back = r.replacesId;
      }
      let forward: string | null = start.id;
      while (forward && chain.size < 100) {
        const r: VersionRow | null = await tx.document.findFirst({
          where: { businessId, replacesId: forward },
          select,
        });
        if (!r) break;
        chain.set(r.id, r);
        forward = r.id;
      }
      const rows = [...chain.values()].sort((a, b) => b.versionNo - a.versionNo);
      const ids = [...new Set(rows.map((r) => r.uploadedByUserId).filter((x): x is string => !!x))];
      const users = ids.length
        ? await tx.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, pool: true },
          })
        : [];
      const by = new Map(users.map((u) => [u.id, { name: u.name, byClient: u.pool === 'CLIENT' }]));
      const newest = rows[0]?.id;
      return rows.map((r) => ({
        id: r.id,
        versionNo: r.versionNo,
        fileName: r.fileName,
        sizeBytes: r.sizeBytes,
        scanStatus: r.scanStatus,
        uploadedBy: r.uploadedByUserId ? (by.get(r.uploadedByUserId) ?? null) : null,
        createdAt: r.createdAt.toISOString(),
        current: r.id === newest,
      }));
    });
  }

  /** Activity History (and the access history, `sharesOnly`) from the audit log. */
  async activity(
    tenant: TenantContext,
    userId: string,
    id: string,
    sharesOnly = false,
  ): Promise<DocumentActivity[]> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      await this.find(tx, tenant, userId, id);
      const logs = await tx.auditLog.findMany({
        where: {
          businessId,
          entityType: 'document',
          entityId: id,
          ...(sharesOnly ? { action: { startsWith: 'document.share' } } : {}),
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 200,
        select: { id: true, action: true, actorUserId: true, createdAt: true, metadata: true },
      });
      const names = await memberNames(
        tx,
        businessId,
        logs.map((l) => l.actorUserId),
      );
      return logs.flatMap((l) => {
        let entry = ACTIVITY[l.action];
        if (l.action === 'document.updated') {
          const f = ((l.metadata as { fields?: string[] } | null)?.fields ?? []) as string[];
          entry =
            f.length === 1 && f[0] === 'fileName'
              ? ['RENAMED', 'Renamed']
              : f.length === 1 && f[0] === 'folderId'
                ? ['MOVED', 'Moved']
                : ['UPDATED', 'Details changed'];
        }
        if (!entry) return [];
        return [
          {
            id: l.id,
            at: l.createdAt.toISOString(),
            kind: entry[0],
            label: entry[1],
            by: l.actorUserId ? (names.get(l.actorUserId) ?? 'Client') : null,
          },
        ];
      });
    });
  }

  /** A short-lived link to view the file (CLEAN only; R5's checks and audit). */
  async preview(tenant: TenantContext, userId: string, id: string): Promise<DownloadLink> {
    const row = await this.inFirm(tenant, (tx) => this.find(tx, tenant, userId, id));
    return this.uploads.downloadLink(row as unknown as DocumentRow);
  }

  async bulk(
    tenant: TenantContext,
    userId: string,
    body: Out<typeof BulkBody>,
  ): Promise<BulkDocumentsResult> {
    const businessId = tenant.businessId;
    const ids = [...new Set(body.ids)];
    const skipped: BulkDocumentsResult['skipped'] = [];
    if (body.action === 'DOWNLOAD') {
      const rows = await this.inFirm(tenant, (tx) =>
        tx.document.findMany({
          where: { AND: [{ businessId, id: { in: ids } }, docReach(actorOf(userId, tenant))] },
          select: librarySelect,
        }),
      );
      // None of them reachable: 404, as for one document.
      if (rows.length === 0) throw notFound();
      const links: NonNullable<BulkDocumentsResult['links']> = [];
      for (const id of ids) {
        const row = rows.find((r) => r.id === id);
        if (!row) {
          skipped.push({ id, code: 'NOT_FOUND' });
          continue;
        }
        try {
          const link = await this.uploads.downloadLink(row as unknown as DocumentRow);
          links.push({ id, ...link });
        } catch {
          skipped.push({ id, code: 'FILE_NOT_CLEAN' });
        }
      }
      return { updated: 0, skipped, links };
    }
    const updated = await this.inFirm(tenant, async (tx) => {
      let data: Prisma.DocumentUncheckedUpdateInput;
      if (body.action === 'MOVE') {
        if (body.folderId) {
          const folder = await liveFolder(tx, businessId, body.folderId);
          if (!folder) throw notFound();
          if (folder.scope === 'FIRM') {
            const shared = await tx.document.count({
              where: { businessId, id: { in: ids }, direction: { not: 'INTERNAL' } },
            });
            if (shared)
              throw conflict('FOLDER_SCOPE', 'A firm folder holds internal documents only');
          }
        }
        data = { folderId: body.folderId };
      } else if (body.action === 'RECLASSIFY') {
        if (body.categoryId) {
          const cat = await tx.documentCategory.findFirst({
            where: { businessId, id: body.categoryId, archivedAt: null },
            select: { id: true },
          });
          if (!cat) throw notFound();
        }
        data = { categoryId: body.categoryId };
      } else if (body.action === 'ASSIGN_REVIEWER') {
        if (body.reviewerUserId) await requireActiveMember(tx, businessId, body.reviewerUserId);
        data = { reviewerUserId: body.reviewerUserId };
      } else {
        data = { archivedAt: new Date() };
      }
      const reachable = await tx.document.findMany({
        where: {
          AND: [
            { businessId, id: { in: ids }, trashedAt: null },
            docReach(actorOf(userId, tenant)),
            body.action === 'ARCHIVE' ? { archivedAt: null } : {},
          ],
        },
        select: { id: true, reviewStatus: true },
      });
      const ok = new Set(reachable.map((r) => r.id));
      for (const id of ids) if (!ok.has(id)) skipped.push({ id, code: 'NOT_FOUND' });
      if (!ok.size) throw notFound();
      await tx.document.updateMany({ where: { businessId, id: { in: [...ok] } }, data });
      if (body.action === 'ASSIGN_REVIEWER' && body.reviewerUserId) {
        await tx.document.updateMany({
          where: { businessId, id: { in: [...ok] }, reviewStatus: null },
          data: { reviewStatus: 'NEEDS_REVIEW' },
        });
      }
      for (const id of ok) {
        await this.audit.logIn(
          tx,
          body.action === 'ARCHIVE' ? 'document.archived' : 'document.updated',
          { type: 'document', id },
          body.action === 'ARCHIVE'
            ? { bulk: true }
            : {
                bulk: true,
                fields: [
                  body.action === 'MOVE'
                    ? 'folderId'
                    : body.action === 'RECLASSIFY'
                      ? 'categoryId'
                      : 'reviewerUserId',
                ],
              },
          { businessId },
        );
      }
      return ok.size;
    });
    return { updated, skipped };
  }
}
