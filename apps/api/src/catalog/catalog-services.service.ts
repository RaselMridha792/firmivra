import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CatalogService,
  CatalogServicePage,
  CatalogServicesQuery,
  CatalogSummary,
  CreateCatalogServiceRequest,
  ServiceUsage,
  UpdateCatalogServiceRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { TenantPrisma } from '../database/database.module.js';
import { DATABASE } from '../database/database.module.js';
import {
  categoryRef,
  diff,
  errors,
  inFirm,
  isForeignKeyViolation,
  isUniqueViolation,
  iso,
  lineTotalCents,
  lockRow,
  priceOf,
  serviceTotalCents,
  statusOf,
  versionOf,
} from './catalog.shared.js';

type ListQuery = z.output<typeof CatalogServicesQuery>;
type CreateBody = z.output<typeof CreateCatalogServiceRequest>;
type UpdateBody = z.output<typeof UpdateCatalogServiceRequest>;

const rowInclude = {
  category: { select: { id: true, name: true, color: true, archivedAt: true } },
  updatedBy: { select: { user: { select: { name: true } } } },
  // The list's price is the service's total: ADDITIVE line items add to the base (S6).
  lineItems: { select: { quantity: true, rateCents: true } },
} satisfies Prisma.ServiceInclude;

const detailInclude = {
  ...rowInclude,
  inclusions: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  lineItems: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
  addOns: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ServiceInclude;

type RowShape = Prisma.ServiceGetPayload<{ include: typeof rowInclude }>;
type DetailShape = Prisma.ServiceGetPayload<{ include: typeof detailInclude }>;

const row = (s: RowShape) => ({
  id: s.id,
  name: s.name,
  shortDescription: s.description,
  icon: s.iconKey,
  category: categoryRef(s.category),
  price: priceOf(s),
  status: statusOf(s),
  updatedAt: iso(s.updatedAt),
  updatedBy: s.updatedBy?.user.name ?? null,
});

export function toCatalogService(s: DetailShape): CatalogService {
  const lineItems = s.lineItems.map((l) => ({
    id: l.id,
    name: l.name,
    description: l.description,
    quantity: Number(l.quantity.toString()),
    rateCents: l.rateCents,
    totalCents: lineTotalCents(l),
  }));
  return {
    ...row(s),
    kind: s.kind,
    fullDescription: s.fullDescription,
    basePriceCents: s.basePriceCents,
    billingFrequency: priceOf(s).frequency,
    taxable: s.taxable,
    requireClientApproval: s.requiresClientApproval,
    included: s.inclusions.filter((i) => i.kind === 'INCLUDED').map((i) => i.text),
    notIncluded: s.inclusions.filter((i) => i.kind === 'NOT_INCLUDED').map((i) => i.text),
    lineItems,
    lineItemsMode: s.lineItemMode === 'ADDITIVE' ? 'ADDITIVE' : 'INCLUDED',
    totalPriceCents: serviceTotalCents(s),
    addOns: s.addOns.map((a) => ({
      id: a.id,
      name: a.name,
      description: a.description,
      priceCents: a.priceCents,
      status: a.archivedAt ? ('INACTIVE' as const) : ('ACTIVE' as const),
      clientSelectable: a.clientSelectable,
      linkedServiceId: a.linkedServiceId,
    })),
    internalNotes: s.internalNotes,
    createdAt: iso(s.createdAt),
    version: versionOf(s),
  };
}

const SORT: Record<
  ListQuery['sort'],
  (d: 'asc' | 'desc') => Prisma.ServiceOrderByWithRelationInput
> = {
  name: (d) => ({ name: d }),
  category: (d) => ({ category: { name: d } }),
  price: (d) => ({ basePriceCents: { sort: d, nulls: 'last' } }),
  status: (d) => ({ status: d }),
  updated: (d) => ({ updatedAt: d }),
};

const STATUS_WHERE: Record<ListQuery['status'], Prisma.ServiceWhereInput> = {
  active: { status: 'ACTIVE', archivedAt: null },
  inactive: { status: 'INACTIVE', archivedAt: null },
  draft: { status: 'DRAFT', archivedAt: null },
  archived: { archivedAt: { not: null } },
  all: {},
};

/**
 * The firm's services (contract in packages/types/src/services-pricing). A service is the existing
 * `services` row extended by R36. Names are unique in the firm; a service never used can be
 * deleted, any other is archived. Every change is audited with the fields it changed (old and
 * new values for the price and the status), never any client data.
 */
@Injectable()
export class CatalogServicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async summary(businessId: string): Promise<CatalogSummary> {
    const db = this.tenantPrisma.db;
    const now = new Date();
    const live = { archivedAt: null };
    const [active, inactive, draft, categories, packages, promotions] = await Promise.all([
      db.service.count({ where: { businessId, ...live, status: 'ACTIVE' } }),
      db.service.count({ where: { businessId, ...live, status: 'INACTIVE' } }),
      db.service.count({ where: { businessId, ...live, status: 'DRAFT' } }),
      db.serviceCategory.count({ where: { businessId, archivedAt: null } }),
      db.servicePackage.count({ where: { businessId, archivedAt: null } }),
      db.promotion.count({
        where: {
          businessId,
          status: 'ACTIVE',
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
          AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: now } }] }],
        },
      }),
    ]);
    return {
      total: active + inactive + draft,
      active,
      inactive,
      draft,
      categories,
      activePromotions: promotions,
      packages,
    };
  }

  async list(businessId: string, q: ListQuery): Promise<CatalogServicePage> {
    const where: Prisma.ServiceWhereInput = {
      businessId,
      ...STATUS_WHERE[q.status],
      ...(q.categoryId ? { categoryId: q.categoryId } : {}),
      ...(q.pricingType ? { pricingType: q.pricingType } : {}),
      ...(q.search
        ? {
            OR: [
              { name: { contains: q.search, mode: 'insensitive' } },
              { description: { contains: q.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const db = this.tenantPrisma.db;
    const [items, total] = await Promise.all([
      db.service.findMany({
        where,
        include: rowInclude,
        orderBy: [SORT[q.sort](q.direction), { id: 'asc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.service.count({ where }),
    ]);
    return { items: items.map(row), total, page: q.page, pageSize: q.pageSize };
  }

  async get(businessId: string, id: string): Promise<CatalogService> {
    const s = await this.tenantPrisma.db.service.findFirst({
      where: { businessId, id },
      include: detailInclude,
    });
    if (!s) throw errors.notFound();
    return toCatalogService(s);
  }

  async create(businessId: string, userId: string, body: CreateBody): Promise<CatalogService> {
    const id = await this.write(businessId, async (tx) => {
      await this.checkName(tx, businessId, body.name, undefined, body.allowDuplicateName);
      await this.checkCategory(tx, businessId, body.categoryId);
      if (body.activate) this.checkComplete(completeness(body));
      const last = await tx.service.aggregate({ where: { businessId }, _max: { sortOrder: true } });
      const created = await tx.service.create({
        data: {
          businessId,
          kind: body.kind ?? 'OTHER',
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          status: body.activate ? 'ACTIVE' : 'DRAFT',
          updatedByUserId: userId,
          ...columns(body),
          name: body.name,
          pricingType: body.pricingType,
        },
        select: { id: true },
      });
      await this.saveChildren(tx, businessId, created.id, body);
      return created.id;
    });
    const created = await this.get(businessId, id);
    await this.audit.log(
      'catalog.service.created',
      { type: 'catalog_service', id },
      {
        status: created.status,
        pricingType: created.price.type,
        basePriceCents: created.basePriceCents,
      },
    );
    return created;
  }

  async update(
    businessId: string,
    userId: string,
    id: string,
    body: UpdateBody,
  ): Promise<CatalogService> {
    const { version, allowDuplicateName, ...changes } = body;
    const change = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'services', businessId, id);
      const cur = await tx.service.findFirst({ where: { businessId, id } });
      if (!cur) throw errors.notFound();
      if (versionOf(cur) !== version) throw errors.saveConflict();
      if (changes.name !== undefined && changes.name !== cur.name) {
        await this.checkName(tx, businessId, changes.name, id, allowDuplicateName);
      }
      if (changes.categoryId !== undefined && changes.categoryId !== cur.categoryId) {
        await this.checkCategory(tx, businessId, changes.categoryId);
      }
      const data = columns(changes);
      const merged = {
        name: data.name ?? cur.name,
        categoryId: data.categoryId ?? cur.categoryId,
        description: data.description ?? cur.description,
        pricingType: data.pricingType ?? cur.pricingType,
        basePriceCents:
          data.basePriceCents !== undefined ? data.basePriceCents : cur.basePriceCents,
        billingFrequency:
          data.billingFrequency !== undefined ? data.billingFrequency : cur.billingFrequency,
      };
      // A live service keeps everything it needs to be sold.
      if (cur.status === 'ACTIVE' && !cur.archivedAt) this.checkComplete(complete(merged));
      const before = {
        name: cur.name,
        pricingType: cur.pricingType,
        basePriceCents: cur.basePriceCents,
        billingFrequency: cur.billingFrequency,
        categoryId: cur.categoryId,
      };
      await tx.service.update({
        where: { id },
        data: { ...data, updatedByUserId: userId },
      });
      await this.saveChildren(tx, businessId, id, changes);
      return diff(before, {
        name: merged.name,
        pricingType: merged.pricingType,
        basePriceCents: merged.basePriceCents,
        billingFrequency: merged.billingFrequency,
        categoryId: merged.categoryId,
      });
    });
    await this.audit.log(
      'catalog.service.updated',
      { type: 'catalog_service', id },
      {
        fields: Object.keys(changes).sort(),
        ...(change.fields.length > 0 ? { from: change.from, to: change.to } : {}),
      },
    );
    return this.get(businessId, id);
  }

  /** A new DRAFT copy "name (Copy)" with its text, inclusions, line items and add-ons. */
  async duplicate(businessId: string, userId: string, id: string): Promise<CatalogService> {
    const copyId = await this.write(businessId, async (tx) => {
      const src = await tx.service.findFirst({ where: { businessId, id }, include: detailInclude });
      if (!src) throw errors.notFound();
      const taken = new Set(
        (
          await tx.service.findMany({
            where: { businessId, name: { startsWith: src.name.slice(0, 100) } },
            select: { name: true },
          })
        ).map((s) => s.name.toLowerCase()),
      );
      const base = `${src.name.slice(0, 100)} (Copy)`;
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
      const last = await tx.service.aggregate({ where: { businessId }, _max: { sortOrder: true } });
      const copy = await tx.service.create({
        data: {
          businessId,
          name,
          kind: src.kind,
          description: src.description,
          fullDescription: src.fullDescription,
          iconKey: src.iconKey,
          internalNotes: src.internalNotes,
          // A deactivated category cannot be chosen again: the copy starts without one.
          categoryId: src.category?.archivedAt ? null : src.categoryId,
          pricingType: src.pricingType,
          basePriceCents: src.basePriceCents,
          billingFrequency: src.billingFrequency,
          billingInterval: src.billingInterval,
          taxable: src.taxable,
          requiresClientApproval: src.requiresClientApproval,
          lineItemMode: src.lineItemMode,
          status: 'DRAFT',
          sortOrder: (last._max.sortOrder ?? -1) + 1,
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      await tx.serviceInclusion.createMany({
        data: src.inclusions.map((i) => ({
          businessId,
          serviceId: copy.id,
          kind: i.kind,
          text: i.text,
          sortOrder: i.sortOrder,
        })),
      });
      await tx.serviceLineItem.createMany({
        data: src.lineItems.map((l) => ({
          businessId,
          serviceId: copy.id,
          name: l.name,
          description: l.description,
          quantity: l.quantity,
          rateCents: l.rateCents,
          sortOrder: l.sortOrder,
        })),
      });
      await tx.serviceAddOn.createMany({
        data: src.addOns.map((a) => ({
          businessId,
          serviceId: copy.id,
          name: a.name,
          description: a.description,
          priceCents: a.priceCents,
          linkedServiceId: a.linkedServiceId,
          clientSelectable: a.clientSelectable,
          sortOrder: a.sortOrder,
          archivedAt: a.archivedAt,
        })),
      });
      return copy.id;
    });
    await this.audit.log(
      'catalog.service.duplicated',
      { type: 'catalog_service', id: copyId },
      {
        from: id,
      },
    );
    return this.get(businessId, copyId);
  }

  /** Activating (also restoring an archived service) checks the service is complete. */
  async activate(businessId: string, userId: string, id: string): Promise<CatalogService> {
    return this.setStatus(businessId, userId, id, 'catalog.service.activated', async (tx, cur) => {
      this.checkComplete(
        complete({
          name: cur.name,
          categoryId: cur.categoryId,
          description: cur.description,
          pricingType: cur.pricingType,
          basePriceCents: cur.basePriceCents,
          billingFrequency: cur.billingFrequency,
        }),
      );
      if (cur.categoryId) await this.checkCategory(tx, businessId, cur.categoryId);
      return { status: 'ACTIVE', archivedAt: null };
    });
  }

  async deactivate(businessId: string, userId: string, id: string): Promise<CatalogService> {
    return this.setStatus(businessId, userId, id, 'catalog.service.deactivated', async () => ({
      status: 'INACTIVE',
      archivedAt: null,
    }));
  }

  async archive(businessId: string, userId: string, id: string): Promise<CatalogService> {
    return this.setStatus(businessId, userId, id, 'catalog.service.archived', async (_tx, cur) => ({
      status: cur.status,
      archivedAt: cur.archivedAt ?? new Date(),
    }));
  }

  private async setStatus(
    businessId: string,
    userId: string,
    id: string,
    action: string,
    next: (
      tx: TxClient,
      cur: Prisma.ServiceGetPayload<object>,
    ) => Promise<{ status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'; archivedAt: Date | null }>,
  ): Promise<CatalogService> {
    const { from, to, changed } = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'services', businessId, id);
      const cur = await tx.service.findFirst({ where: { businessId, id } });
      if (!cur) throw errors.notFound();
      const target = await next(tx, cur);
      const from = statusOf(cur);
      const to = statusOf(target);
      if (from === to) return { from, to, changed: false };
      await tx.service.update({ where: { id }, data: { ...target, updatedByUserId: userId } });
      return { from, to, changed: true };
    });
    // Repeating the same change writes no row and no audit.
    if (changed) await this.audit.log(action, { type: 'catalog_service', id }, { from, to });
    return this.get(businessId, id);
  }

  async remove(businessId: string, id: string): Promise<void> {
    try {
      await inFirm(this.database, businessId, async (tx) => {
        await lockRow(tx, 'services', businessId, id);
        const cur = await tx.service.findFirst({ where: { businessId, id }, select: { id: true } });
        if (!cur) throw errors.notFound();
        await tx.serviceInclusion.deleteMany({ where: { serviceId: id } });
        await tx.serviceLineItem.deleteMany({ where: { serviceId: id } });
        await tx.serviceAddOn.deleteMany({ where: { serviceId: id } });
        // Anything that ever used the service holds a restricting foreign key: the database
        // refuses, this transaction rolls back (the children above come back) and the answer is
        // IN_USE.
        await tx.service.delete({ where: { id } });
      });
    } catch (e) {
      if (isForeignKeyViolation(e)) {
        throw errors.inUse('This service has been used. Archive it instead.');
      }
      throw e;
    }
    await this.audit.log('catalog.service.deleted', { type: 'catalog_service', id });
  }

  async usage(businessId: string, id: string): Promise<ServiceUsage> {
    const db = this.tenantPrisma.db;
    const s = await db.service.findFirst({
      where: { businessId, id },
      select: {
        id: true,
        packageItems: {
          select: { package: { select: { id: true, name: true, status: true, archivedAt: true } } },
        },
        _count: {
          select: {
            engagements: true,
            invoiceLines: true,
            recurringLines: true,
            promotionTargets: true,
            appointmentTypes: true,
            appointments: true,
            intakeForms: true,
            intakeTemplates: true,
            agreements: true,
            leads: true,
            leadServices: true,
            tasks: true,
            taskTemplates: true,
            taskSeries: true,
            advisoryServices: true,
            linkedAddOns: true,
          },
        },
      },
    });
    if (!s) throw errors.notFound();
    const [activeEngagements, openInvoices] = await Promise.all([
      db.engagement.count({
        where: { businessId, serviceId: id, status: { in: ['PENDING', 'ACTIVE'] } },
      }),
      db.invoice.count({
        where: { businessId, status: 'OPEN', lines: { some: { serviceId: id } } },
      }),
    ]);
    const ever = Object.values(s._count).some((n) => n > 0) || s.packageItems.length > 0;
    return {
      packages: s.packageItems.map((i) => ({
        id: i.package.id,
        name: i.package.name,
        status: statusOf(i.package),
      })),
      activeEngagements,
      openInvoices,
      appointmentTypes: s._count.appointmentTypes,
      // The firm's automations are not built yet.
      automations: 0,
      deletable: !ever,
    };
  }

  // ---------- Rules ----------

  /** Names are unique ignoring case; a package of the same name is allowed only when told. */
  private async checkName(
    tx: TxClient,
    businessId: string,
    name: string,
    exceptId?: string,
    allowDuplicate?: boolean,
  ): Promise<void> {
    const services = await tx.service.findMany({
      where: { businessId, name: { equals: name, mode: 'insensitive' } },
      select: { id: true, name: true },
    });
    const clash = services.filter((s) => s.id !== exceptId);
    // The database's unique index is exact: only a name differing in case can be allowed.
    if (clash.some((s) => !allowDuplicate || s.name === name)) {
      throw errors.duplicateName('service');
    }
    if (!allowDuplicate) {
      const pkg = await tx.servicePackage.findFirst({
        where: { businessId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });
      if (pkg) throw errors.duplicateName('package');
    }
  }

  private async checkCategory(tx: TxClient, businessId: string, categoryId: string): Promise<void> {
    const c = await tx.serviceCategory.findFirst({
      where: { businessId, id: categoryId },
      select: { archivedAt: true },
    });
    if (!c) throw errors.invalid('categoryId', 'Choose a category');
    if (c.archivedAt) throw errors.categoryInactive();
  }

  private checkComplete(missing: string | null): void {
    if (missing) throw errors.activationIncomplete(missing);
  }

  /** Inclusions, line items and add-ons: each list sent replaces the stored one (ids keep rows). */
  private async saveChildren(
    tx: TxClient,
    businessId: string,
    serviceId: string,
    body: Partial<CreateBody>,
  ): Promise<void> {
    for (const [kind, list] of [
      ['INCLUDED', body.included],
      ['NOT_INCLUDED', body.notIncluded],
    ] as const) {
      if (list === undefined) continue;
      await tx.serviceInclusion.deleteMany({ where: { serviceId, kind } });
      await tx.serviceInclusion.createMany({
        data: list.map((text, sortOrder) => ({ businessId, serviceId, kind, text, sortOrder })),
      });
    }

    if (body.lineItems !== undefined) {
      const stored = await tx.serviceLineItem.findMany({
        where: { serviceId },
        select: { id: true },
      });
      const known = new Set(stored.map((l) => l.id));
      const keep = new Set<string>();
      for (const [sortOrder, l] of body.lineItems.entries()) {
        if (l.id && !known.has(l.id))
          throw errors.invalid(`lineItems.${sortOrder}.id`, 'Unknown line');
        if (l.id) {
          keep.add(l.id);
          await tx.serviceLineItem.update({
            where: { id: l.id },
            data: {
              name: l.name,
              description: l.description ?? null,
              quantity: l.quantity,
              rateCents: l.rateCents,
              sortOrder,
            },
          });
        } else {
          const made = await tx.serviceLineItem.create({
            data: {
              businessId,
              serviceId,
              name: l.name,
              description: l.description ?? null,
              quantity: l.quantity,
              rateCents: l.rateCents,
              sortOrder,
            },
            select: { id: true },
          });
          keep.add(made.id);
        }
      }
      await tx.serviceLineItem.deleteMany({ where: { serviceId, id: { notIn: [...keep] } } });
    }

    if (body.addOns !== undefined) {
      const names = body.addOns.map((a) => a.name.toLowerCase());
      if (new Set(names).size !== names.length) {
        throw errors.invalid('addOns', 'Use each add-on name once');
      }
      const linked = [
        ...new Set(body.addOns.flatMap((a) => (a.linkedServiceId ? [a.linkedServiceId] : []))),
      ];
      if (linked.length > 0) {
        const found = await tx.service.count({ where: { businessId, id: { in: linked } } });
        if (found !== linked.length) throw errors.invalid('addOns', 'Link a service of this firm');
      }
      const stored = await tx.serviceAddOn.findMany({ where: { serviceId }, select: { id: true } });
      const known = new Set(stored.map((a) => a.id));
      const keep = new Set<string>();
      for (const [sortOrder, a] of body.addOns.entries()) {
        if (a.name.length > 100)
          throw errors.invalid(`addOns.${sortOrder}.name`, 'Use at most 100 characters');
        if (a.linkedServiceId === serviceId) {
          throw errors.invalid(`addOns.${sortOrder}.linkedServiceId`, 'Link another service');
        }
        if (a.id && !known.has(a.id))
          throw errors.invalid(`addOns.${sortOrder}.id`, 'Unknown add-on');
        const data = {
          name: a.name,
          description: a.description ?? null,
          priceCents: a.priceCents,
          clientSelectable: a.clientSelectable,
          linkedServiceId: a.linkedServiceId ?? null,
          sortOrder,
          archivedAt: a.status === 'INACTIVE' ? new Date() : null,
        };
        if (a.id) {
          keep.add(a.id);
          await tx.serviceAddOn.update({ where: { id: a.id }, data });
        } else {
          await tx.serviceAddOn.create({ data: { businessId, serviceId, ...data } });
        }
      }
      // A removed add-on that an invoice or a package used is kept, switched off.
      for (const old of stored.filter((s) => !keep.has(s.id))) {
        const used =
          (await tx.invoiceLine.count({ where: { serviceAddOnId: old.id } })) +
          (await tx.servicePackageAddOn.count({ where: { serviceAddOnId: old.id } }));
        if (used > 0) {
          await tx.serviceAddOn.update({ where: { id: old.id }, data: { archivedAt: new Date() } });
        } else {
          await tx.serviceAddOn.delete({ where: { id: old.id } });
        }
      }
    }
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await inFirm(this.database, businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.duplicateName('service');
      throw e;
    }
  }
}

/** The service columns a request sets; a field the request leaves out is left out here too. */
function columns(b: Partial<CreateBody>) {
  const custom = b.pricingType === 'CUSTOM_QUOTE';
  return {
    name: b.name,
    categoryId: b.categoryId,
    description: b.shortDescription,
    iconKey: b.icon,
    pricingType: b.pricingType,
    basePriceCents: custom ? null : b.basePriceCents,
    billingFrequency: b.billingFrequency,
    taxable: b.taxable,
    requiresClientApproval: b.requireClientApproval,
    fullDescription: b.fullDescription,
    internalNotes: b.internalNotes,
    lineItemMode:
      b.lineItemsMode === undefined
        ? undefined
        : b.lineItemsMode === 'ADDITIVE'
          ? 'ADDITIVE'
          : 'INFORMATIONAL',
  } as const;
}

const completeness = (b: CreateBody) =>
  complete({
    name: b.name,
    categoryId: b.categoryId,
    description: b.shortDescription,
    pricingType: b.pricingType,
    basePriceCents: b.basePriceCents ?? null,
    billingFrequency: b.billingFrequency ?? null,
  });

/** What a service needs to be sold: the first thing missing, worded for the screen, or null. */
function complete(s: {
  name: string | null;
  categoryId: string | null;
  description: string | null;
  pricingType: string;
  basePriceCents: number | null;
  billingFrequency: string | null;
}): string | null {
  if (!s.name?.trim()) return 'Enter the service name';
  if (!s.categoryId) return 'Choose a category';
  if (!s.description?.trim()) return 'Enter a short description';
  if (s.pricingType !== 'CUSTOM_QUOTE' && s.basePriceCents === null) return 'Enter the base price';
  if (s.pricingType === 'RECURRING' && (!s.billingFrequency || s.billingFrequency === 'ONE_TIME')) {
    return 'Choose how often it bills';
  }
  return null;
}
