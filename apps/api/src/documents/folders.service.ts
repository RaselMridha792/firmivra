import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type DocumentCategory,
  type DocumentFolder,
  type DocumentSettings,
  UPLOAD_LIMITS,
  type UploadContentType,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { notFound } from '../storage/document-records.js';
import {
  isForeignKeyViolation,
  isUniqueViolation,
  memberNames,
  memberRef,
} from '../workspaces/common.js';
import { conflict, invalid, requireActiveMember, requireCapability } from './library.common.js';
import type {
  CreateCategoryBody,
  CreateFolderBody,
  ReorderFoldersBody,
  UpdateCategoryBody,
  UpdateFolderBody,
  UpdateSettingsBody,
} from './library.input.js';

type Out<S extends z.ZodType> = z.output<S>;

const MAX_DEPTH = 5;
const PLATFORM_TYPES = Object.keys(UPLOAD_LIMITS.types) as UploadContentType[];
const duplicate = () =>
  conflict('DUPLICATE_NAME', 'A folder or type with this name already exists');

const folderSelect = {
  id: true,
  name: true,
  description: true,
  parentId: true,
  scope: true,
  color: true,
  sortOrder: true,
  requireExpiryDate: true,
  remindBeforeExpiry: true,
  allowClientUploads: true,
  notifyStaffOnUpload: true,
  defaultClientAccess: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { documents: { where: { trashedAt: null } } } },
} satisfies Prisma.DocumentFolderSelect;
type FolderRow = Prisma.DocumentFolderGetPayload<{ select: typeof folderSelect }>;

/**
 * Frame 6 (R55): the folder tree, document types and the firm's Documents settings. Folders and
 * types are organisation only, never access; a FIRM folder holds internal documents and never
 * takes client uploads. Folders are archived for good or deleted while empty; at most 5 levels.
 */
@Injectable()
export class DocumentFoldersService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private toFolder(r: FolderRow, children: Map<string, number>): DocumentFolder {
    const { _count, ...rest } = r;
    return {
      ...rest,
      documentCount: _count.documents,
      subfolderCount: children.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  private async all(tx: TxClient, businessId: string): Promise<DocumentFolder[]> {
    const rows = await tx.documentFolder.findMany({
      where: { businessId, archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: folderSelect,
      take: 1000,
    });
    const children = new Map<string, number>();
    for (const r of rows)
      if (r.parentId) children.set(r.parentId, (children.get(r.parentId) ?? 0) + 1);
    return rows.map((r) => this.toFolder(r, children));
  }

  folders(tenant: TenantContext): Promise<DocumentFolder[]> {
    return this.inFirm(tenant, (tx) => this.all(tx, tenant.businessId));
  }

  /** The folder's level (1 at the top) and the ids above it. */
  private async ancestry(tx: TxClient, businessId: string, id: string | null) {
    const above: string[] = [];
    let at = id;
    while (at && above.length <= MAX_DEPTH + 1) {
      above.push(at);
      const f = await tx.documentFolder.findFirst({
        where: { businessId, id: at },
        select: { parentId: true },
      });
      at = f?.parentId ?? null;
    }
    return above;
  }

  /** The deepest level under a folder (0 for none). */
  private async height(tx: TxClient, businessId: string, id: string): Promise<number> {
    const kids = await tx.documentFolder.findMany({
      where: { businessId, parentId: id, archivedAt: null },
      select: { id: true },
    });
    let most = 0;
    for (const k of kids) most = Math.max(most, 1 + (await this.height(tx, businessId, k.id)));
    return most;
  }

  private checkFirmFlags(
    scope: 'CLIENT' | 'FIRM',
    body: { allowClientUploads?: boolean; defaultClientAccess?: string },
  ) {
    if (
      scope === 'FIRM' &&
      (body.allowClientUploads || (body.defaultClientAccess ?? 'NONE') !== 'NONE')
    ) {
      throw invalid(
        'A firm folder never takes client uploads or client access',
        'defaultClientAccess',
      );
    }
  }

  async createFolder(
    tenant: TenantContext,
    body: Out<typeof CreateFolderBody>,
  ): Promise<DocumentFolder> {
    await requireCapability(this.grants, tenant, 'DELETE');
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      let scope = body.scope;
      if (body.parentId) {
        const parent = await tx.documentFolder.findFirst({
          where: { businessId, id: body.parentId, archivedAt: null },
          select: { scope: true },
        });
        if (!parent) throw notFound();
        scope = parent.scope;
        if ((await this.ancestry(tx, businessId, body.parentId)).length >= MAX_DEPTH) {
          throw invalid('Folders go at most 5 levels deep', 'parentId');
        }
      }
      this.checkFirmFlags(scope, body);
      const top = await tx.documentFolder.aggregate({
        where: { businessId, parentId: body.parentId ?? null, archivedAt: null },
        _max: { sortOrder: true },
      });
      const id = await tx.documentFolder
        .create({
          data: {
            businessId,
            name: body.name,
            description: body.description ?? null,
            parentId: body.parentId ?? null,
            scope,
            ...(body.color ? { color: body.color } : {}),
            sortOrder: (top._max.sortOrder ?? -1) + 1,
            requireExpiryDate: body.requireExpiryDate ?? false,
            remindBeforeExpiry: body.remindBeforeExpiry ?? false,
            allowClientUploads: body.allowClientUploads ?? false,
            notifyStaffOnUpload: body.notifyStaffOnUpload ?? false,
            defaultClientAccess: body.defaultClientAccess ?? 'NONE',
          },
          select: { id: true },
        })
        .then((r) => r.id)
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      await this.audit.logIn(
        tx,
        'document_folder.created',
        { type: 'document_folder', id },
        { parentId: body.parentId ?? null, scope },
        { businessId },
      );
      const folder = (await this.all(tx, businessId)).find((f) => f.id === id);
      if (!folder) throw notFound();
      return folder;
    });
  }

  async updateFolder(
    tenant: TenantContext,
    id: string,
    body: Out<typeof UpdateFolderBody>,
  ): Promise<DocumentFolder> {
    await requireCapability(this.grants, tenant, 'DELETE');
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.inFirm(tenant, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM document_folders WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const folder = await tx.documentFolder.findFirst({
        where: { businessId, id, archivedAt: null },
        select: {
          scope: true,
          parentId: true,
          allowClientUploads: true,
          defaultClientAccess: true,
        },
      });
      if (!folder) throw notFound();
      if (body.parentId !== undefined && body.parentId !== folder.parentId) {
        if (body.parentId) {
          const parent = await tx.documentFolder.findFirst({
            where: { businessId, id: body.parentId, archivedAt: null },
            select: { scope: true },
          });
          if (!parent) throw notFound();
          if (parent.scope !== folder.scope) {
            throw conflict('FOLDER_SCOPE', 'A folder moves only under a folder of its own kind');
          }
          const above = await this.ancestry(tx, businessId, body.parentId);
          if (above.includes(id)) throw invalid('A folder cannot go inside itself', 'parentId');
          if (above.length + 1 + (await this.height(tx, businessId, id)) > MAX_DEPTH) {
            throw invalid('Folders go at most 5 levels deep', 'parentId');
          }
        }
      }
      this.checkFirmFlags(folder.scope, {
        allowClientUploads: body.allowClientUploads ?? folder.allowClientUploads,
        defaultClientAccess: body.defaultClientAccess ?? folder.defaultClientAccess,
      });
      await tx.documentFolder
        .update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.description !== undefined ? { description: body.description } : {}),
            ...(body.parentId !== undefined ? { parentId: body.parentId } : {}),
            ...(body.color !== undefined ? { color: body.color } : {}),
            ...(body.requireExpiryDate !== undefined
              ? { requireExpiryDate: body.requireExpiryDate }
              : {}),
            ...(body.remindBeforeExpiry !== undefined
              ? { remindBeforeExpiry: body.remindBeforeExpiry }
              : {}),
            ...(body.allowClientUploads !== undefined
              ? { allowClientUploads: body.allowClientUploads }
              : {}),
            ...(body.notifyStaffOnUpload !== undefined
              ? { notifyStaffOnUpload: body.notifyStaffOnUpload }
              : {}),
            ...(body.defaultClientAccess !== undefined
              ? { defaultClientAccess: body.defaultClientAccess }
              : {}),
          },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      await this.audit.logIn(
        tx,
        'document_folder.updated',
        { type: 'document_folder', id },
        { fields: fields.sort() },
        { businessId },
      );
      const out = (await this.all(tx, businessId)).find((f) => f.id === id);
      if (!out) throw notFound();
      return out;
    });
  }

  /** Delete an empty folder: 409 FOLDER_NOT_EMPTY while it holds documents or subfolders. */
  async deleteFolder(tenant: TenantContext, id: string): Promise<{ ok: true }> {
    await requireCapability(this.grants, tenant, 'DELETE');
    const businessId = tenant.businessId;
    await this.inFirm(tenant, async (tx) => {
      const folder = await tx.documentFolder.findFirst({
        where: { businessId, id },
        select: { id: true, _count: { select: { documents: true, children: true } } },
      });
      if (!folder) throw notFound();
      const full = () =>
        conflict('FOLDER_NOT_EMPTY', 'Move or remove its documents and subfolders first');
      if (folder._count.documents || folder._count.children) throw full();
      await tx.documentFolder.delete({ where: { id } }).catch((e: unknown) => {
        if (isForeignKeyViolation(e)) throw full();
        throw e;
      });
      await this.audit.logIn(
        tx,
        'document_folder.deleted',
        { type: 'document_folder', id },
        {},
        { businessId },
      );
    });
    return { ok: true };
  }

  /** One parent's live children in their new order (every child, once). */
  async reorderFolders(
    tenant: TenantContext,
    body: Out<typeof ReorderFoldersBody>,
  ): Promise<DocumentFolder[]> {
    await requireCapability(this.grants, tenant, 'DELETE');
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const kids = await tx.documentFolder.findMany({
        where: { businessId, parentId: body.parentId, archivedAt: null },
        select: { id: true },
      });
      const have = new Set(kids.map((k) => k.id));
      if (
        new Set(body.ids).size !== body.ids.length ||
        body.ids.length !== have.size ||
        body.ids.some((x) => !have.has(x))
      ) {
        throw invalid('Send every folder of that parent, once each', 'ids');
      }
      for (const [i, folderId] of body.ids.entries()) {
        await tx.documentFolder.update({ where: { id: folderId }, data: { sortOrder: i } });
      }
      await this.audit.logIn(
        tx,
        'document_folders.reordered',
        { type: 'document_folder', id: body.parentId ?? undefined },
        { count: body.ids.length },
        { businessId },
      );
      return this.all(tx, businessId);
    });
  }

  // ---------- Document types ----------

  private toCategory(r: {
    id: string;
    name: string;
    retentionYears: number | null;
    archivedAt: Date | null;
  }): DocumentCategory {
    return { ...r, archivedAt: r.archivedAt?.toISOString() ?? null };
  }

  async createCategory(
    tenant: TenantContext,
    body: Out<typeof CreateCategoryBody>,
  ): Promise<DocumentCategory> {
    await requireCapability(this.grants, tenant, 'MANAGE');
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const top = await tx.documentCategory.aggregate({
        where: { businessId },
        _max: { sortOrder: true },
      });
      const row = await tx.documentCategory
        .create({
          data: {
            businessId,
            name: body.name,
            ...(body.retentionYears !== undefined ? { retentionYears: body.retentionYears } : {}),
            sortOrder: (top._max.sortOrder ?? -1) + 1,
          },
          select: { id: true, name: true, retentionYears: true, archivedAt: true },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      await this.audit.logIn(
        tx,
        'document_category.created',
        { type: 'document_category', id: row.id },
        {},
        { businessId },
      );
      return this.toCategory(row);
    });
  }

  async updateCategory(
    tenant: TenantContext,
    id: string,
    body: Out<typeof UpdateCategoryBody>,
  ): Promise<DocumentCategory> {
    await requireCapability(this.grants, tenant, 'MANAGE');
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.inFirm(tenant, async (tx) => {
      const found = await tx.documentCategory.findFirst({
        where: { businessId, id },
        select: { archivedAt: true },
      });
      if (!found) throw notFound();
      const row = await tx.documentCategory
        .update({
          where: { id },
          data: {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.retentionYears !== undefined ? { retentionYears: body.retentionYears } : {}),
            ...(body.archived !== undefined
              ? { archivedAt: body.archived ? (found.archivedAt ?? new Date()) : null }
              : {}),
          },
          select: { id: true, name: true, retentionYears: true, archivedAt: true },
        })
        .catch((e: unknown) => {
          if (isUniqueViolation(e)) throw duplicate();
          throw e;
        });
      await this.audit.logIn(
        tx,
        'document_category.updated',
        { type: 'document_category', id },
        { fields: fields.sort() },
        { businessId },
      );
      return this.toCategory(row);
    });
  }

  // ---------- Settings ----------

  private async settingsRow(tx: TxClient, businessId: string) {
    await tx.$executeRaw`INSERT INTO document_settings (business_id, updated_at) VALUES (${businessId}::uuid, now()) ON CONFLICT (business_id) DO NOTHING`;
    return tx.documentSettings.findUniqueOrThrow({ where: { businessId } });
  }

  private async toSettings(
    tx: TxClient,
    businessId: string,
    s: Awaited<ReturnType<DocumentFoldersService['settingsRow']>>,
  ): Promise<DocumentSettings> {
    const names = await memberNames(tx, businessId, [s.defaultReviewerUserId]);
    return {
      requestReminderDaysBefore: s.requestReminderDaysBefore,
      requestExpiryDays: s.requestExpiryDays,
      documentExpiryReminderDays: s.documentExpiryReminderDays,
      shareExpiryDays: s.shareExpiryDays,
      uploadMaxBytes: s.uploadMaxBytes ?? UPLOAD_LIMITS.maxBytes,
      uploadTypes: (s.uploadTypes.length ? s.uploadTypes : PLATFORM_TYPES) as UploadContentType[],
      defaultReviewer: memberRef(names, s.defaultReviewerUserId),
      updatedAt: s.updatedAt.toISOString(),
    };
  }

  settings(tenant: TenantContext): Promise<DocumentSettings> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) =>
      this.toSettings(tx, businessId, await this.settingsRow(tx, businessId)),
    );
  }

  async updateSettings(
    tenant: TenantContext,
    body: Out<typeof UpdateSettingsBody>,
  ): Promise<DocumentSettings> {
    await requireCapability(this.grants, tenant, 'MANAGE');
    const businessId = tenant.businessId;
    const fields = Object.keys(body).filter(
      (k) => (body as Record<string, unknown>)[k] !== undefined,
    );
    return this.inFirm(tenant, async (tx) => {
      await this.settingsRow(tx, businessId);
      if (body.defaultReviewerUserId)
        await requireActiveMember(tx, businessId, body.defaultReviewerUserId);
      const types = body.uploadTypes ? [...new Set(body.uploadTypes)] : undefined;
      const row = await tx.documentSettings.update({
        where: { businessId },
        data: {
          ...(body.requestReminderDaysBefore !== undefined
            ? { requestReminderDaysBefore: body.requestReminderDaysBefore }
            : {}),
          ...(body.requestExpiryDays !== undefined
            ? { requestExpiryDays: body.requestExpiryDays }
            : {}),
          ...(body.documentExpiryReminderDays !== undefined
            ? { documentExpiryReminderDays: body.documentExpiryReminderDays }
            : {}),
          ...(body.shareExpiryDays !== undefined ? { shareExpiryDays: body.shareExpiryDays } : {}),
          ...(body.uploadMaxBytes !== undefined ? { uploadMaxBytes: body.uploadMaxBytes } : {}),
          // All the platform's types is stored as none chosen.
          ...(types ? { uploadTypes: types.length === PLATFORM_TYPES.length ? [] : types } : {}),
          ...(body.defaultReviewerUserId !== undefined
            ? { defaultReviewerUserId: body.defaultReviewerUserId }
            : {}),
        },
      });
      await this.audit.logIn(
        tx,
        'document_settings.updated',
        { type: 'document_settings' },
        { fields: fields.sort() },
        { businessId },
      );
      return this.toSettings(tx, businessId, row);
    });
  }
}
