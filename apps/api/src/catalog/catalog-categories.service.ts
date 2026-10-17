import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  MergeCategoryRequest,
  ReorderCategoriesRequest,
  SaveServiceCategoryRequest,
  ServiceCategory,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import {
  diff,
  errors,
  inFirm,
  isForeignKeyViolation,
  isUniqueViolation,
  lockRow,
  TONE_COLORS,
  toneOf,
  type Tone,
} from './catalog.shared.js';

type SaveBody = z.output<typeof SaveServiceCategoryRequest>;

const categorySelect = {
  id: true,
  name: true,
  description: true,
  iconKey: true,
  color: true,
  sortOrder: true,
  archivedAt: true,
  _count: { select: { services: { where: { archivedAt: null } } } },
} satisfies Prisma.ServiceCategorySelect;
type CategoryRow = Prisma.ServiceCategoryGetPayload<{ select: typeof categorySelect }>;

const toCategory = (c: CategoryRow): ServiceCategory => ({
  id: c.id,
  name: c.name,
  tone: toneOf(c.color),
  description: c.description,
  icon: c.iconKey,
  sortOrder: c.sortOrder,
  status: c.archivedAt ? 'INACTIVE' : 'ACTIVE',
  serviceCount: c._count.services,
});

/**
 * Service categories. They are deactivated, never deleted, while services or packages use them;
 * an unused one can be deleted. Names are unique in the firm.
 */
@Injectable()
export class CatalogCategoriesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(businessId: string): Promise<ServiceCategory[]> {
    const rows = await this.tenantPrisma.db.serviceCategory.findMany({
      where: { businessId },
      select: categorySelect,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toCategory);
  }

  async create(businessId: string, body: SaveBody): Promise<ServiceCategory> {
    this.checkDescription(body);
    const created = await this.write(businessId, async (tx) => {
      await this.checkName(tx, businessId, body.name);
      const last = await tx.serviceCategory.aggregate({
        where: { businessId },
        _max: { sortOrder: true },
      });
      return tx.serviceCategory.create({
        data: {
          businessId,
          name: body.name,
          description: body.description ?? null,
          iconKey: body.icon ?? null,
          color: body.tone ? TONE_COLORS[body.tone as Tone] : null,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          archivedAt: body.status === 'INACTIVE' ? new Date() : null,
        },
        select: categorySelect,
      });
    });
    await this.audit.log('catalog.category.created', { type: 'service_category', id: created.id });
    return toCategory(created);
  }

  /** A full save: a field left out stays as it was; `null` clears the description, icon, tone. */
  async update(businessId: string, id: string, body: SaveBody): Promise<ServiceCategory> {
    this.checkDescription(body);
    const { updated, change } = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'service_categories', businessId, id);
      const cur = await tx.serviceCategory.findFirst({ where: { businessId, id } });
      if (!cur) throw errors.notFound();
      if (body.name !== cur.name) await this.checkName(tx, businessId, body.name, id);
      const data = {
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.icon !== undefined ? { iconKey: body.icon } : {}),
        ...(body.tone !== undefined
          ? { color: body.tone ? TONE_COLORS[body.tone as Tone] : null }
          : {}),
        ...(body.status !== undefined
          ? { archivedAt: body.status === 'INACTIVE' ? (cur.archivedAt ?? new Date()) : null }
          : {}),
      };
      const updated = await tx.serviceCategory.update({
        where: { id },
        data,
        select: categorySelect,
      });
      const change = diff(
        { name: cur.name, status: cur.archivedAt ? 'INACTIVE' : 'ACTIVE' },
        { name: updated.name, status: updated.archivedAt ? 'INACTIVE' : 'ACTIVE' },
      );
      return { updated, change };
    });
    await this.audit.log('catalog.category.updated', { type: 'service_category', id }, change);
    return toCategory(updated);
  }

  /**
   * `ids` is the new order, normally every category. Any of the firm's categories may be left out:
   * they follow, in the order they had.
   */
  async reorder(businessId: string, body: ReorderCategoriesRequest): Promise<ServiceCategory[]> {
    const ids = (body as z.output<typeof ReorderCategoriesRequest>).ids;
    await this.write(businessId, async (tx) => {
      const all = await tx.serviceCategory.findMany({
        where: { businessId },
        select: { id: true },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      });
      const known = new Set(all.map((a) => a.id));
      if (new Set(ids).size !== ids.length || !ids.every((i) => known.has(i))) {
        throw errors.invalid('ids', 'List each of your categories once');
      }
      const order = [...ids, ...all.map((a) => a.id).filter((i) => !ids.includes(i))];
      for (const [sortOrder, id] of order.entries()) {
        await tx.serviceCategory.update({ where: { id }, data: { sortOrder } });
      }
    });
    await this.audit.log('catalog.category.reordered', { type: 'service_category' });
    return this.list(businessId);
  }

  /** Moves the category's services and packages into `intoId`, then deactivates it. Returns the target. */
  async merge(
    businessId: string,
    id: string,
    body: MergeCategoryRequest,
  ): Promise<ServiceCategory> {
    const { services, packages } = await this.write(businessId, async (tx) => {
      if (body.intoId === id) throw errors.invalid('intoId', 'Choose another category');
      for (const cid of [id, body.intoId].sort())
        await lockRow(tx, 'service_categories', businessId, cid);
      const from = await tx.serviceCategory.findFirst({ where: { businessId, id } });
      const into = await tx.serviceCategory.findFirst({ where: { businessId, id: body.intoId } });
      if (!from) throw errors.notFound();
      if (!into) throw errors.invalid('intoId', 'Choose a category');
      if (into.archivedAt) throw errors.categoryInactive();
      const services = await tx.service.updateMany({
        where: { businessId, categoryId: id },
        data: { categoryId: into.id },
      });
      const packages = await tx.servicePackage.updateMany({
        where: { businessId, categoryId: id },
        data: { categoryId: into.id },
      });
      await tx.serviceCategory.update({
        where: { id },
        data: { archivedAt: from.archivedAt ?? new Date() },
      });
      return { services: services.count, packages: packages.count };
    });
    await this.audit.log(
      'catalog.category.merged',
      { type: 'service_category', id },
      {
        into: body.intoId,
        services,
        packages,
      },
    );
    return this.one(businessId, body.intoId);
  }

  async remove(businessId: string, id: string): Promise<void> {
    try {
      await this.write(businessId, async (tx) => {
        await lockRow(tx, 'service_categories', businessId, id);
        const cur = await tx.serviceCategory.findFirst({ where: { businessId, id } });
        if (!cur) throw errors.notFound();
        // The restricting foreign keys of services, packages and promotion targets refuse a
        // category that anything points at (even an archived service).
        await tx.serviceCategory.delete({ where: { id } });
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw errors.inUse('This category is in use. Merge it into another or deactivate it.');
      }
      throw e;
    }
    await this.audit.log('catalog.category.deleted', { type: 'service_category', id });
  }

  private async one(businessId: string, id: string): Promise<ServiceCategory> {
    const row = await this.tenantPrisma.db.serviceCategory.findFirst({
      where: { businessId, id },
      select: categorySelect,
    });
    if (!row) throw errors.notFound();
    return toCategory(row);
  }

  /** Names are unique ignoring case (the database's unique index is exact; it stays the last line). */
  private async checkName(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const clash = await tx.serviceCategory.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw errors.duplicateName('category');
  }

  /** service_categories.description holds 200 characters; the contract allows 300. */
  private checkDescription(body: SaveBody) {
    if (body.description && body.description.length > 200) {
      throw errors.invalid('description', 'Use at most 200 characters');
    }
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await inFirm(this.database, businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.duplicateName('category');
      throw e;
    }
  }
}
