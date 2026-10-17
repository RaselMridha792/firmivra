import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { SavedReportDetail, SavedReportPage, SavedReportRow } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, memberNames, notFound } from '../workspaces/common.js';
import { stripText } from './text.js';
import { type Filters, checkDefinition } from './engine.js';
import { isAdmin, reportErrors, requireWrite, toRow, toView } from './reports.common.js';
import type { DuplicateBody, SaveBody, SavedQuery, UpdateSavedBody } from './reports-input.js';
import { type Ctx, ReportsService } from './reports.service.js';
import { sourceOf } from './sources.js';

type Query = z.output<typeof SavedQuery>;
type Save = z.output<typeof SaveBody>;
type Update = z.output<typeof UpdateSavedBody>;
type Duplicate = z.output<typeof DuplicateBody>;

const ENTITY = 'report_definition';

const include = (userId: string) =>
  ({
    shares: { select: { userId: true } },
    favorites: { where: { userId }, select: { userId: true } },
    _count: { select: { schedules: { where: { deletedAt: null } } } },
  }) satisfies Prisma.ReportDefinitionInclude;
type Shape = Prisma.ReportDefinitionGetPayload<{ include: ReturnType<typeof include> }>;

/**
 * Saved reports (`report_definitions`): a definition, never results. Names are unique among the
 * firm's live reports ignoring case. Only the owner, an Owner or an Admin changes one; who may
 * open it follows its visibility (private, selected roles and people, the company). Archived,
 * never deleted. Audited with ids and field names.
 */
@Injectable()
export class ReportsSavedService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly reports: ReportsService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw reportErrors.duplicateName();
      throw e;
    }
  }

  // ---------- Reads ----------

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Query,
  ): Promise<SavedReportPage> {
    return this.inFirm(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const and: Prisma.ReportDefinitionWhereInput[] = [{ businessId }, this.reports.visible(ctx)];
      if (!q.includeArchived) and.push({ archivedAt: null });
      if (q.category) and.push({ category: q.category });
      if (q.tab === 'mine') and.push({ ownerUserId: userId });
      if (q.tab === 'shared') and.push({ ownerUserId: { not: userId } });
      if (q.tab === 'favorites') and.push({ favorites: { some: { userId } } });
      if (q.search) and.push({ name: { contains: q.search, mode: 'insensitive' } });
      const where: Prisma.ReportDefinitionWhereInput = { AND: and };
      const [total, rows] = await Promise.all([
        tx.reportDefinition.count({ where }),
        tx.reportDefinition.findMany({
          where,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
          include: include(userId),
        }),
      ]);
      const last = await tx.reportRun.groupBy({
        by: ['definitionId'],
        where: { businessId, definitionId: { in: rows.map((r) => r.id) } },
        _max: { createdAt: true },
      });
      const lastBy = new Map(last.map((l) => [l.definitionId, l._max.createdAt]));
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.ownerUserId),
      );
      return {
        items: rows.map((r) => this.row(r, names, lastBy.get(r.id) ?? null)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<SavedReportDetail> {
    return this.inFirm(businessId, (tx) => this.detailIn(tx, businessId, tenant, userId, id));
  }

  private row(r: Shape, names: Map<string, string>, lastRunAt: Date | null): SavedReportRow {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      category: r.category,
      dataSource: r.dataSource,
      visibility: r.visibility,
      owner: { userId: r.ownerUserId, name: names.get(r.ownerUserId) ?? 'Former member' },
      favorite: r.favorites.length > 0,
      archived: r.archivedAt !== null,
      lastRunAt: lastRunAt?.toISOString() ?? null,
      scheduleCount: r._count.schedules,
      updatedAt: r.updatedAt.toISOString(),
    };
  }

  async detailIn(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<SavedReportDetail> {
    const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
    const r = await tx.reportDefinition.findFirst({
      where: { AND: [{ businessId, id }, this.reports.visible(ctx)] },
      include: include(userId),
    });
    if (!r) throw notFound();
    const source = sourceOf(r.dataSource);
    if (source?.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
    const names = await memberNames(tx, businessId, [
      r.ownerUserId,
      ...r.shares.map((s) => s.userId),
    ]);
    const last = await tx.reportRun.aggregate({
      where: { businessId, definitionId: id },
      _max: { createdAt: true },
    });
    return {
      ...this.row(r, names, last._max.createdAt),
      definition: toView(r),
      sharedRoles: r.sharedRoles.filter(
        (x): x is 'OWNER' | 'ADMIN' | 'STAFF' => x === 'OWNER' || x === 'ADMIN' || x === 'STAFF',
      ),
      sharedWith: r.shares.flatMap((s) =>
        names.get(s.userId) ? [{ userId: s.userId, name: names.get(s.userId)! }] : [],
      ),
      canEdit: isAdmin(tenant) || r.ownerUserId === userId,
      createdAt: r.createdAt.toISOString(),
      etag: r.updatedAt.toISOString(),
    };
  }

  // ---------- Writes ----------

  async save(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Save,
  ): Promise<SavedReportDetail> {
    requireWrite(tenant);
    const id = await this.write(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      this.checkDefinition(ctx, body.definition);
      const name = stripText(body.name);
      await this.uniqueName(tx, businessId, name);
      const visibility = this.visibility(body.visibility, body.sharedRoles, body.sharedWithUserIds);
      await this.members(tx, businessId, visibility.userIds);
      const row = await tx.reportDefinition.create({
        data: {
          businessId,
          name,
          description: body.description ? stripText(body.description) : null,
          ownerUserId: userId,
          visibility: body.visibility,
          sharedRoles: visibility.roles,
          ...toRow(body.definition as never),
        },
        select: { id: true },
      });
      if (visibility.userIds.length) {
        await tx.reportShare.createMany({
          data: visibility.userIds.map((u) => ({ businessId, definitionId: row.id, userId: u })),
        });
      }
      if (body.favorite)
        await tx.reportFavorite.create({ data: { businessId, definitionId: row.id, userId } });
      await this.audit.logIn(
        tx,
        'report.saved',
        { type: ENTITY, id: row.id },
        { category: body.definition.category, dataSource: body.definition.dataSource },
        { businessId, actorUserId: userId },
      );
      return row.id;
    });
    return this.get(businessId, tenant, userId, id);
  }

  async update(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Update,
  ): Promise<SavedReportDetail> {
    requireWrite(tenant);
    await this.write(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const cur = await this.lock(tx, businessId, tenant, ctx, id);
      if (cur.ownerUserId !== userId && !isAdmin(tenant)) throw reportErrors.notTheOwner();
      if (cur.archivedAt) throw reportErrors.archived();
      if (body.etag !== cur.updatedAt.toISOString()) throw reportErrors.saveConflict();
      const data: Prisma.ReportDefinitionUncheckedUpdateInput = {};
      if (body.name !== undefined) {
        const name = stripText(body.name);
        if (name.toLowerCase() !== cur.name.toLowerCase())
          await this.uniqueName(tx, businessId, name, id);
        data.name = name;
      }
      if (body.description !== undefined)
        data.description = body.description ? stripText(body.description) : null;
      if (body.definition) {
        this.checkDefinition(ctx, body.definition);
        Object.assign(data, toRow(body.definition as never));
      }
      const visibility = body.visibility ?? cur.visibility;
      if (
        body.visibility !== undefined ||
        body.sharedRoles !== undefined ||
        body.sharedWithUserIds !== undefined
      ) {
        const shares = await tx.reportShare.findMany({
          where: { definitionId: id },
          select: { userId: true },
        });
        const v = this.visibility(
          visibility,
          body.sharedRoles ?? (visibility === 'SELECTED' ? cur.sharedRoles : []),
          body.sharedWithUserIds ?? (visibility === 'SELECTED' ? shares.map((s) => s.userId) : []),
        );
        await this.members(tx, businessId, v.userIds);
        data.visibility = visibility;
        data.sharedRoles = v.roles;
        await tx.reportShare.deleteMany({ where: { businessId, definitionId: id } });
        if (v.userIds.length)
          await tx.reportShare.createMany({
            data: v.userIds.map((u) => ({ businessId, definitionId: id, userId: u })),
          });
      }
      await tx.reportDefinition.update({ where: { id }, data });
      await this.audit.logIn(
        tx,
        'report.updated',
        { type: ENTITY, id },
        { fields: Object.keys(body).filter((k) => k !== 'etag') },
        { businessId, actorUserId: userId },
      );
    });
    return this.get(businessId, tenant, userId, id);
  }

  /** Save As: a private copy, "(Copy)", never changing the original. */
  async duplicate(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Duplicate,
  ): Promise<SavedReportDetail> {
    requireWrite(tenant);
    const newId = await this.write(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const src = await tx.reportDefinition.findFirst({
        where: { AND: [{ businessId, id }, this.reports.visible(ctx)] },
      });
      if (!src) throw notFound();
      const name = body.name ? stripText(body.name) : await this.copyName(tx, businessId, src.name);
      await this.uniqueName(tx, businessId, name);
      const {
        id: _id,
        createdAt: _c,
        updatedAt: _u,
        archivedAt: _a,
        ownerUserId: _o,
        visibility: _v,
        sharedRoles: _s,
        name: _n,
        ...rest
      } = src;
      void [_id, _c, _u, _a, _o, _v, _s, _n];
      const row = await tx.reportDefinition.create({
        data: {
          ...rest,
          filters: rest.filters as Prisma.InputJsonValue,
          name,
          ownerUserId: userId,
          visibility: 'PRIVATE',
          sharedRoles: [],
        },
        select: { id: true },
      });
      await this.audit.logIn(
        tx,
        'report.duplicated',
        { type: ENTITY, id: row.id },
        { sourceId: id },
        { businessId, actorUserId: userId },
      );
      return row.id;
    });
    return this.get(businessId, tenant, userId, newId);
  }

  async setArchived(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    archive: boolean,
  ): Promise<SavedReportDetail> {
    requireWrite(tenant);
    await this.write(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const cur = await this.lock(tx, businessId, tenant, ctx, id);
      if (cur.ownerUserId !== userId && !isAdmin(tenant)) throw reportErrors.notTheOwner();
      if ((cur.archivedAt !== null) === archive) return;
      if (!archive) await this.uniqueName(tx, businessId, cur.name, id);
      await tx.reportDefinition.update({
        where: { id },
        data: { archivedAt: archive ? new Date() : null },
      });
      await this.audit.logIn(
        tx,
        archive ? 'report.archived' : 'report.restored',
        { type: ENTITY, id },
        {},
        { businessId, actorUserId: userId },
      );
    });
    return this.get(businessId, tenant, userId, id);
  }

  async favorite(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    on: boolean,
  ): Promise<SavedReportDetail> {
    await this.inFirm(businessId, async (tx) => {
      const ctx = await this.reports.ctx(tx, businessId, tenant, userId);
      const r = await tx.reportDefinition.findFirst({
        where: { AND: [{ businessId, id }, this.reports.visible(ctx)] },
        select: { id: true },
      });
      if (!r) throw notFound();
      if (on)
        await tx.reportFavorite.createMany({
          data: [{ businessId, definitionId: id, userId }],
          skipDuplicates: true,
        });
      else await tx.reportFavorite.deleteMany({ where: { businessId, definitionId: id, userId } });
    });
    return this.get(businessId, tenant, userId, id);
  }

  // ---------- Helpers ----------

  /** Throws the contract's errors for a definition the source does not allow, or a source the caller may not use. */
  private checkDefinition(ctx: Ctx, d: Save['definition']): void {
    const source = sourceOf(d.dataSource);
    if (!source)
      throw reportErrors.invalidDefinition([
        { path: 'definition.dataSource', message: `There is no data source “${d.dataSource}”` },
      ]);
    if (source.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
    if (source.category !== d.category)
      throw reportErrors.invalidDefinition([
        {
          path: 'definition.category',
          message: `${source.label} is a ${source.category.toLowerCase()} data source`,
        },
      ]);
    const { problems, forbidden } = checkDefinition(
      {
        columns: d.columns,
        filters: d.filters as Filters,
        groupBy: d.groupBy ?? null,
        sortBy: d.sortBy ?? null,
        showTotals: d.showTotals,
        showPercentage: d.showPercentage,
        compareTo: d.compareTo,
      },
      source,
      ctx.restricted,
    );
    if (forbidden.length > 0) throw reportErrors.fieldNotAllowed(forbidden);
    if (problems.length > 0)
      throw reportErrors.invalidDefinition(
        problems.map((p) => ({ path: `definition.${p.path}`, message: p.message })),
      );
  }

  /** The role list and people that go with a visibility: only SELECTED has any. */
  private visibility(visibility: string, roles: string[], userIds: string[]) {
    if (visibility !== 'SELECTED') {
      if (roles.length > 0 || userIds.length > 0) {
        throw reportErrors.invalid(
          'visibility',
          'Choose “Selected people and roles” to share with people or roles',
        );
      }
      return { roles: [], userIds: [] as string[] };
    }
    return { roles: [...new Set(roles)], userIds: [...new Set(userIds)] };
  }

  private async members(tx: TxClient, businessId: string, userIds: string[]) {
    if (userIds.length === 0) return;
    const n = await tx.membership.count({
      where: { businessId, userId: { in: userIds }, joinedAt: { not: null } },
    });
    if (n !== userIds.length) throw reportErrors.notAMember();
  }

  private async lock(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    ctx: Ctx,
    id: string,
  ) {
    const visible = await tx.reportDefinition.findFirst({
      where: { AND: [{ businessId, id }, this.reports.visible(ctx)] },
      select: { id: true },
    });
    if (!visible) throw notFound();
    await tx.$queryRaw`SELECT id FROM report_definitions WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    void tenant;
    return tx.reportDefinition.findFirstOrThrow({ where: { businessId, id } });
  }

  private async uniqueName(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const clash = await tx.reportDefinition.findFirst({
      where: {
        businessId,
        archivedAt: null,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw reportErrors.duplicateName();
  }

  private async copyName(tx: TxClient, businessId: string, name: string) {
    const base = name.replace(/ \(Copy( \d+)?\)$/, '').slice(0, 190);
    for (let n = 1; n < 100; n++) {
      const candidate = n === 1 ? `${base} (Copy)` : `${base} (Copy ${n})`;
      const clash = await tx.reportDefinition.findFirst({
        where: { businessId, archivedAt: null, name: { equals: candidate, mode: 'insensitive' } },
        select: { id: true },
      });
      if (!clash) return candidate;
    }
    throw reportErrors.duplicateName();
  }
}
