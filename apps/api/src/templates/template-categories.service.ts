import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type { TemplateCategory } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { DATABASE } from '../database/database.module.js';
import { isUniqueViolation, notFound } from '../workspaces/common.js';
import { stripTags } from './html.js';
import type {
  CategoriesQuery,
  CreateCategoryBody,
  MergeCategoryBody,
  ReorderBody,
  UpdateCategoryBody,
} from './template-input.js';
import { templateErrors, toCategory, visibleTo } from './templates.common.js';

type Query = z.output<typeof CategoriesQuery>;
type Create = z.output<typeof CreateCategoryBody>;
type Update = z.output<typeof UpdateCategoryBody>;
type Reorder = z.output<typeof ReorderBody>;
type Merge = z.output<typeof MergeCategoryBody>;

const ENTITY = 'template_category';

/**
 * A firm's template categories, one list per template kind. Owner and Admin change them (the
 * routes say so); everyone with the Templates view reads them, with counts over the templates they
 * may see. Archived, never deleted; names are unique in a kind, ignoring case.
 */
@Injectable()
export class TemplateCategoriesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw templateErrors.duplicateName('category');
      throw e;
    }
  }

  list(businessId: string, actor: ClientsActor, q: Query): Promise<TemplateCategory[]> {
    return this.inFirm(businessId, (tx) => this.listIn(tx, businessId, actor, q));
  }

  private async listIn(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    q: Query,
  ): Promise<TemplateCategory[]> {
    const where: Prisma.TemplateCategoryWhereInput = {
      businessId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.includeArchived ? {} : { archivedAt: null }),
    };
    const [rows, counts] = await Promise.all([
      tx.templateCategory.findMany({
        where,
        orderBy: [{ kind: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
      }),
      tx.messageTemplate.groupBy({
        by: ['categoryId'],
        where: {
          businessId,
          categoryId: { not: null },
          status: { not: 'ARCHIVED' },
          ...visibleTo(actor),
        },
        _count: { _all: true },
      }),
    ]);
    const n = new Map(counts.map((c) => [c.categoryId, c._count._all]));
    return rows.map((c) => toCategory(c, n.get(c.id) ?? 0));
  }

  async create(businessId: string, actor: ClientsActor, body: Create): Promise<TemplateCategory> {
    const name = stripTags(body.name).trim();
    const row = await this.write(businessId, async (tx) => {
      await this.uniqueName(tx, businessId, body.kind, name);
      const last = await tx.templateCategory.aggregate({
        where: { businessId, kind: body.kind },
        _max: { sortOrder: true },
      });
      return tx.templateCategory.create({
        data: {
          businessId,
          kind: body.kind,
          name,
          description: body.description ? stripTags(body.description).trim() : null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    });
    await this.audit.log(
      'template_category.created',
      { type: ENTITY, id: row.id },
      {
        kind: row.kind,
      },
    );
    return toCategory(row, 0);
  }

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Update,
  ): Promise<TemplateCategory> {
    const category = await this.write(businessId, async (tx) => {
      const cur = await tx.templateCategory.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      const name = body.name === undefined ? cur.name : stripTags(body.name).trim();
      if (name.toLowerCase() !== cur.name.toLowerCase()) {
        await this.uniqueName(tx, businessId, cur.kind, name, id);
      }
      await tx.templateCategory.update({
        where: { id },
        data: {
          name,
          ...(body.description === undefined
            ? {}
            : { description: body.description ? stripTags(body.description).trim() : null }),
        },
      });
      return this.one(tx, businessId, actor, id);
    });
    await this.audit.log(
      'template_category.updated',
      { type: ENTITY, id },
      {
        fields: Object.keys(body),
      },
    );
    return category;
  }

  /** The ids of one kind in their new order; categories not listed keep their order after them. */
  async reorder(
    businessId: string,
    actor: ClientsActor,
    body: Reorder,
  ): Promise<TemplateCategory[]> {
    const ids = [...new Set(body.ids)];
    const list = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.templateCategory.findMany({
        where: { businessId, kind: body.kind },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        select: { id: true },
      });
      const known = new Set(rows.map((r) => r.id));
      if (ids.length !== body.ids.length || ids.some((id) => !known.has(id))) throw notFound();
      const order = [...ids, ...rows.map((r) => r.id).filter((id) => !ids.includes(id))];
      for (const [i, id] of order.entries()) {
        await tx.templateCategory.update({ where: { id }, data: { sortOrder: i } });
      }
      return this.listIn(tx, businessId, actor, { kind: body.kind, includeArchived: true });
    });
    await this.audit.log(
      'template_category.reordered',
      { type: ENTITY, id: ids[0]! },
      {
        kind: body.kind,
        ids,
      },
    );
    return list;
  }

  /** The templates move to `intoId` (same kind, active), then this category is archived. Returns `intoId`. */
  async merge(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: Merge,
  ): Promise<TemplateCategory> {
    const { category, moved } = await this.write(businessId, async (tx) => {
      const from = await tx.templateCategory.findFirst({ where: { businessId, id } });
      if (!from) throw notFound();
      const into = await tx.templateCategory.findFirst({ where: { businessId, id: body.intoId } });
      if (!into) throw notFound();
      if (into.id === from.id || into.kind !== from.kind || into.archivedAt) {
        throw templateErrors.categoryNotAllowed();
      }
      const moved = await tx.messageTemplate.updateMany({
        where: { businessId, categoryId: from.id },
        data: { categoryId: into.id },
      });
      await tx.templateCategory.update({ where: { id }, data: { archivedAt: new Date() } });
      return { category: await this.one(tx, businessId, actor, into.id), moved: moved.count };
    });
    await this.audit.log(
      'template_category.merged',
      { type: ENTITY, id },
      {
        intoId: body.intoId,
        templates: moved,
      },
    );
    return category;
  }

  archive(businessId: string, actor: ClientsActor, id: string) {
    return this.setArchived(businessId, actor, id, true);
  }
  restore(businessId: string, actor: ClientsActor, id: string) {
    return this.setArchived(businessId, actor, id, false);
  }

  private async setArchived(
    businessId: string,
    actor: ClientsActor,
    id: string,
    archive: boolean,
  ): Promise<TemplateCategory> {
    const { category, changed } = await this.inFirm(businessId, async (tx) => {
      const cur = await tx.templateCategory.findFirst({ where: { businessId, id } });
      if (!cur) throw notFound();
      const changed = (cur.archivedAt !== null) !== archive;
      if (changed) {
        await tx.templateCategory.update({
          where: { id },
          data: { archivedAt: archive ? new Date() : null },
        });
      }
      return { category: await this.one(tx, businessId, actor, id), changed };
    });
    if (changed) {
      await this.audit.log(archive ? 'template_category.archived' : 'template_category.restored', {
        type: ENTITY,
        id,
      });
    }
    return category;
  }

  private async one(tx: TxClient, businessId: string, actor: ClientsActor, id: string) {
    const [c] = (await this.listIn(tx, businessId, actor, { includeArchived: true })).filter(
      (x) => x.id === id,
    );
    if (!c) throw notFound();
    return c;
  }

  private async uniqueName(
    tx: TxClient,
    businessId: string,
    kind: TemplateCategory['kind'],
    name: string,
    exceptId?: string,
  ) {
    const clash = await tx.templateCategory.findFirst({
      where: {
        businessId,
        kind,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw templateErrors.duplicateName('category');
  }
}
