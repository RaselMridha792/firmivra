import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CreateServicePackageRequest,
  PackagePricing,
  PackagePricingRequest,
  ServicePackage,
  ServicePackageRow,
  UpdateServicePackageRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import {
  categoryRef,
  discountColumns,
  discountOf,
  diff,
  errors,
  inFirm,
  isUniqueViolation,
  iso,
  lockRow,
  packagePricing,
  pricedService,
  serviceTotalCents,
  statusOf,
  versionOf,
} from './catalog.shared.js';

type CreateBody = z.output<typeof CreateServicePackageRequest>;
type UpdateBody = z.output<typeof UpdateServicePackageRequest>;

const serviceBits = {
  id: true,
  name: true,
  iconKey: true,
  status: true,
  archivedAt: true,
  pricingType: true,
  basePriceCents: true,
  billingFrequency: true,
  // A service's price is its total: ADDITIVE line items add to the base (S6).
  lineItemMode: true,
  lineItems: { select: { quantity: true, rateCents: true } },
  category: { select: { id: true, name: true, color: true } },
} satisfies Prisma.ServiceSelect;

const packageInclude = {
  category: { select: { id: true, name: true, color: true } },
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: { service: { select: serviceBits } },
  },
  addOns: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] },
} satisfies Prisma.ServicePackageInclude;
type PackageShape = Prisma.ServicePackageGetPayload<{ include: typeof packageInclude }>;

const pricingOf = (p: PackageShape): PackagePricing =>
  packagePricing({
    included: p.items.filter((i) => i.included).map((i) => pricedService(i.service)),
    packagePriceCents: p.packagePriceCents,
    ...discountOf(p),
  });

const toRow = (p: PackageShape): ServicePackageRow => {
  const pricing = pricingOf(p);
  return {
    id: p.id,
    name: p.name,
    shortDescription: p.shortDescription,
    icon: p.iconKey,
    category: categoryRef(p.category),
    status: statusOf(p),
    serviceCount: p.items.length,
    packagePriceCents: pricing.packagePriceCents,
    savingsCents: pricing.savingsCents,
    updatedAt: iso(p.updatedAt),
  };
};

export const toServicePackage = (p: PackageShape): ServicePackage => ({
  ...toRow(p),
  services: p.items.map((i) => ({
    serviceId: i.serviceId,
    name: i.service.name,
    icon: i.service.iconKey,
    category: categoryRef(i.service.category),
    individualPriceCents: serviceTotalCents(i.service),
    pricingType: i.service.pricingType,
    included: i.included,
    inactive: i.service.status !== 'ACTIVE' || i.service.archivedAt !== null,
  })),
  pricing: pricingOf(p),
  // Only offered add-ons are stored; a row exists because it is ticked.
  addOns: p.addOns.map((a) => ({
    id: a.id,
    name: a.name,
    description: a.description,
    priceCents: a.priceCents,
    offered: true,
    linkedServiceId: null,
  })),
  visibleToClients: p.visibleToClients,
  allowClientAddOns: p.allowClientAddOns,
  displayOnWebsite: p.displayOnPortal,
  internalNotes: p.internalNotes,
  version: versionOf(p),
});

/**
 * The Package Builder: packages of catalog services at one price. Savings and totals are worked
 * out from the services' current prices on every read, never stored. Only an active service joins
 * a package; one deactivated later stays in it, flagged, until it is replaced.
 */
@Injectable()
export class CatalogPackagesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  async list(businessId: string): Promise<ServicePackageRow[]> {
    const rows = await this.tenantPrisma.db.servicePackage.findMany({
      where: { businessId, archivedAt: null },
      include: packageInclude,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRow);
  }

  async get(businessId: string, id: string): Promise<ServicePackage> {
    const p = await this.tenantPrisma.db.servicePackage.findFirst({
      where: { businessId, id },
      include: packageInclude,
    });
    if (!p) throw errors.notFound();
    return toServicePackage(p);
  }

  /** The Package Pricing panel for the form's unsaved values. Saves nothing. */
  async pricing(businessId: string, body: PackagePricingRequest): Promise<PackagePricing> {
    const ids = [...new Set(body.services.map((s) => s.serviceId))];
    const found = await this.tenantPrisma.db.service.findMany({
      where: { businessId, id: { in: ids } },
      select: {
        id: true,
        basePriceCents: true,
        pricingType: true,
        lineItemMode: true,
        lineItems: { select: { quantity: true, rateCents: true } },
      },
    });
    if (found.length !== ids.length)
      throw errors.invalid('services', 'Choose services of this firm');
    const byId = new Map(found.map((s) => [s.id, s]));
    return packagePricing({
      included: body.services
        .filter((s) => s.included)
        .map((s) => pricedService(byId.get(s.serviceId)!)),
      packagePriceCents: body.packagePriceCents,
      discountType: body.discountType,
      discountValue: body.discountValue,
    });
  }

  async create(businessId: string, userId: string, body: CreateBody): Promise<ServicePackage> {
    this.checkWidths(body);
    this.checkVisibility(body.visibleToClients, body.displayOnWebsite);
    const id = await this.write(businessId, async (tx) => {
      await this.checkName(tx, businessId, body.name);
      await this.checkCategory(tx, businessId, body.categoryId);
      const created = await tx.servicePackage.create({
        data: {
          businessId,
          name: body.name,
          categoryId: body.categoryId,
          shortDescription: body.shortDescription,
          iconKey: body.icon ?? null,
          packagePriceCents: body.packagePriceCents ?? null,
          ...discountColumns(body.discountType ?? 'NONE', body.discountValue ?? null),
          visibleToClients: body.visibleToClients ?? false,
          allowClientAddOns: body.allowClientAddOns ?? false,
          displayOnPortal: body.displayOnWebsite ?? false,
          internalNotes: body.internalNotes ?? null,
          status: 'DRAFT',
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      await this.saveItems(tx, businessId, created.id, body.services ?? [], true);
      await this.saveAddOns(tx, businessId, created.id, body.addOns ?? []);
      if (body.activate) await this.activateIn(tx, businessId, created.id);
      return created.id;
    });
    const created = await this.get(businessId, id);
    await this.audit.log(
      'catalog.package.created',
      { type: 'catalog_package', id },
      {
        status: created.status,
        services: created.services.map((s) => s.serviceId),
        packagePriceCents: created.packagePriceCents,
      },
    );
    return created;
  }

  async update(
    businessId: string,
    userId: string,
    id: string,
    body: UpdateBody,
  ): Promise<ServicePackage> {
    const { version, ...changes } = body;
    this.checkWidths(changes);
    const change = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'service_packages', businessId, id);
      const cur = await tx.servicePackage.findFirst({
        where: { businessId, id },
        include: packageInclude,
      });
      if (!cur) throw errors.notFound();
      if (versionOf(cur) !== version) throw errors.saveConflict();
      if (changes.name !== undefined && changes.name !== cur.name) {
        await this.checkName(tx, businessId, changes.name, id);
      }
      if (changes.categoryId !== undefined && changes.categoryId !== cur.categoryId) {
        await this.checkCategory(tx, businessId, changes.categoryId);
      }
      this.checkVisibility(
        changes.visibleToClients ?? cur.visibleToClients,
        changes.displayOnWebsite ?? cur.displayOnPortal,
      );
      const before = {
        name: cur.name,
        packagePriceCents: cur.packagePriceCents,
        ...discountOf(cur),
        services: cur.items.map((i) => `${i.serviceId}:${i.included}`).sort(),
      };
      const discount =
        changes.discountType !== undefined || changes.discountValue !== undefined
          ? discountColumns(
              changes.discountType ?? discountOf(cur).discountType,
              changes.discountValue !== undefined
                ? changes.discountValue
                : discountOf(cur).discountValue,
            )
          : {};
      if (changes.services !== undefined) {
        await this.saveItems(tx, businessId, id, changes.services, false);
      }
      if (changes.addOns !== undefined) await this.saveAddOns(tx, businessId, id, changes.addOns);
      const price = await this.priceToStore(tx, businessId, cur, changes);
      await tx.servicePackage.update({
        where: { id },
        data: {
          ...(changes.name !== undefined ? { name: changes.name } : {}),
          ...(changes.categoryId !== undefined ? { categoryId: changes.categoryId } : {}),
          ...(changes.shortDescription !== undefined
            ? { shortDescription: changes.shortDescription }
            : {}),
          ...(changes.icon !== undefined ? { iconKey: changes.icon } : {}),
          ...price,
          ...discount,
          ...(changes.visibleToClients !== undefined
            ? { visibleToClients: changes.visibleToClients }
            : {}),
          ...(changes.allowClientAddOns !== undefined
            ? { allowClientAddOns: changes.allowClientAddOns }
            : {}),
          ...(changes.displayOnWebsite !== undefined
            ? { displayOnPortal: changes.displayOnWebsite }
            : {}),
          ...(changes.internalNotes !== undefined ? { internalNotes: changes.internalNotes } : {}),
          updatedByUserId: userId,
        },
      });
      const after = await tx.servicePackage.findFirstOrThrow({
        where: { businessId, id },
        include: packageInclude,
      });
      // A live package keeps everything it needs to be sold.
      if (after.status === 'ACTIVE' && !after.archivedAt) {
        this.checkSellable(after);
      }
      return diff(before, {
        name: after.name,
        packagePriceCents: after.packagePriceCents,
        ...discountOf(after),
        services: after.items.map((i) => `${i.serviceId}:${i.included}`).sort(),
      });
    });
    await this.audit.log(
      'catalog.package.updated',
      { type: 'catalog_package', id },
      {
        fields: Object.keys(changes).sort(),
        ...(change.fields.length > 0 ? { from: change.from, to: change.to } : {}),
      },
    );
    return this.get(businessId, id);
  }

  async activate(businessId: string, userId: string, id: string): Promise<ServicePackage> {
    return this.setStatus(businessId, userId, id, 'catalog.package.activated', async (tx) => {
      await this.activateIn(tx, businessId, id);
    });
  }

  async deactivate(businessId: string, userId: string, id: string): Promise<ServicePackage> {
    return this.setStatus(businessId, userId, id, 'catalog.package.deactivated', async (tx) => {
      await tx.servicePackage.update({
        where: { id },
        data: { status: 'INACTIVE', archivedAt: null, updatedByUserId: userId },
      });
    });
  }

  async archive(businessId: string, userId: string, id: string): Promise<ServicePackage> {
    return this.setStatus(businessId, userId, id, 'catalog.package.archived', async (tx) => {
      await tx.servicePackage.update({
        where: { id },
        data: { archivedAt: new Date(), updatedByUserId: userId },
      });
    });
  }

  /** A new DRAFT copy "name (Copy)" with its services and add-ons. */
  async duplicate(businessId: string, userId: string, id: string): Promise<ServicePackage> {
    const copyId = await this.write(businessId, async (tx) => {
      const src = await tx.servicePackage.findFirst({
        where: { businessId, id },
        include: { category: { select: { archivedAt: true } }, items: true, addOns: true },
      });
      if (!src) throw errors.notFound();
      const taken = new Set(
        (
          await tx.servicePackage.findMany({
            where: { businessId, name: { startsWith: src.name.slice(0, 90) } },
            select: { name: true },
          })
        ).map((p) => p.name.toLowerCase()),
      );
      const base = `${src.name.slice(0, 90)} (Copy)`;
      let name = base;
      for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} ${n}`;
      const copy = await tx.servicePackage.create({
        data: {
          businessId,
          name,
          categoryId: src.category?.archivedAt ? null : src.categoryId,
          shortDescription: src.shortDescription,
          iconKey: src.iconKey,
          packagePriceCents: src.packagePriceCents,
          discountType: src.discountType,
          discountPercent: src.discountPercent,
          discountCents: src.discountCents,
          allowClientAddOns: src.allowClientAddOns,
          internalNotes: src.internalNotes,
          status: 'DRAFT',
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      // Only services still active can join (the database's rule); the rest are left out.
      const active = new Set(
        (
          await tx.service.findMany({
            where: {
              businessId,
              id: { in: src.items.map((i) => i.serviceId) },
              status: 'ACTIVE',
              archivedAt: null,
            },
            select: { id: true },
          })
        ).map((s) => s.id),
      );
      await tx.servicePackageItem.createMany({
        data: src.items
          .filter((i) => active.has(i.serviceId))
          .map((i) => ({
            businessId,
            packageId: copy.id,
            serviceId: i.serviceId,
            included: i.included,
            sortOrder: i.sortOrder,
          })),
      });
      await tx.servicePackageAddOn.createMany({
        data: src.addOns.map((a) => ({
          businessId,
          packageId: copy.id,
          serviceAddOnId: a.serviceAddOnId,
          name: a.name,
          description: a.description,
          priceCents: a.priceCents,
          sortOrder: a.sortOrder,
        })),
      });
      return copy.id;
    });
    await this.audit.log(
      'catalog.package.duplicated',
      { type: 'catalog_package', id: copyId },
      {
        from: id,
      },
    );
    return this.get(businessId, copyId);
  }

  // ---------- Rules ----------

  private async setStatus(
    businessId: string,
    _userId: string,
    id: string,
    action: string,
    apply: (tx: TxClient) => Promise<void>,
  ): Promise<ServicePackage> {
    const { from, to } = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'service_packages', businessId, id);
      const cur = await tx.servicePackage.findFirst({ where: { businessId, id } });
      if (!cur) throw errors.notFound();
      await apply(tx);
      const after = await tx.servicePackage.findFirstOrThrow({ where: { businessId, id } });
      return { from: statusOf(cur), to: statusOf(after) };
    });
    // Repeating the same change writes no audit row.
    if (from !== to) await this.audit.log(action, { type: 'catalog_package', id }, { from, to });
    return this.get(businessId, id);
  }

  /** Activating (also restoring an archived package): everything it needs, every service active. */
  private async activateIn(tx: TxClient, businessId: string, id: string): Promise<void> {
    const p = await tx.servicePackage.findFirstOrThrow({
      where: { businessId, id },
      include: packageInclude,
    });
    if (p.categoryId) await this.checkCategory(tx, businessId, p.categoryId);
    this.checkSellable(p);
    // A price worked out from a discount is the price the package is sold at from now on.
    await tx.servicePackage.update({
      where: { id },
      data: {
        status: 'ACTIVE',
        archivedAt: null,
        packagePriceCents: pricingOf(p).packagePriceCents,
      },
    });
  }

  /**
   * The price column for a save. A live package must keep a price (the database requires one): a
   * save that clears it falls back to the price its discount works out, else is refused.
   */
  private async priceToStore(
    tx: TxClient,
    businessId: string,
    cur: PackageShape,
    changes: Omit<UpdateBody, 'version'>,
  ): Promise<{ packagePriceCents?: number | null }> {
    const asked = changes.packagePriceCents;
    const next = asked !== undefined ? asked : cur.packagePriceCents;
    const live = cur.status === 'ACTIVE' && !cur.archivedAt;
    if (!live || next !== null) return asked !== undefined ? { packagePriceCents: asked } : {};
    const items = await tx.servicePackageItem.findMany({
      where: { businessId, packageId: cur.id, included: true },
      include: { service: { select: serviceBits } },
    });
    const now = discountOf(cur);
    const worked = packagePricing({
      included: items.map((i) => pricedService(i.service)),
      packagePriceCents: null,
      discountType: changes.discountType ?? now.discountType,
      discountValue:
        changes.discountValue !== undefined ? changes.discountValue : now.discountValue,
    });
    if (worked.packagePriceCents === null)
      throw errors.activationIncomplete('Enter the package price');
    return { packagePriceCents: worked.packagePriceCents };
  }

  private checkSellable(p: PackageShape): void {
    if (!p.categoryId) throw errors.activationIncomplete('Choose a category');
    if (!p.shortDescription.trim()) throw errors.activationIncomplete('Enter a short description');
    if (p.items.length === 0) throw errors.activationIncomplete('Add at least one service');
    if (p.items.some((i) => i.service.status !== 'ACTIVE' || i.service.archivedAt)) {
      throw errors.packageHasInactiveService();
    }
    // Throws INVALID_DISCOUNT for a discount that cannot work; derives a price from a discount.
    const pricing = pricingOf(p);
    if (pricing.packagePriceCents === null) {
      throw errors.activationIncomplete('Enter the package price');
    }
  }

  /** The services of the package: those named are kept, added or changed; the rest leave. */
  private async saveItems(
    tx: TxClient,
    businessId: string,
    packageId: string,
    services: { serviceId: string; included: boolean }[],
    creating: boolean,
  ): Promise<void> {
    const found = await tx.service.findMany({
      where: { businessId, id: { in: services.map((s) => s.serviceId) } },
      select: { id: true, status: true, archivedAt: true },
    });
    if (found.length !== services.length) {
      throw errors.invalid('services', 'Choose services of this firm');
    }
    const live = new Set(
      found.filter((s) => s.status === 'ACTIVE' && !s.archivedAt).map((s) => s.id),
    );
    const stored = creating
      ? []
      : await tx.servicePackageItem.findMany({
          where: { packageId },
          select: { id: true, serviceId: true },
        });
    const byService = new Map(stored.map((s) => [s.serviceId, s.id]));
    for (const [sortOrder, s] of services.entries()) {
      const existing = byService.get(s.serviceId);
      if (existing) {
        await tx.servicePackageItem.update({
          where: { id: existing },
          data: { included: s.included, sortOrder },
        });
      } else {
        // The database too refuses a service that is not active; the answer is the same.
        if (!live.has(s.serviceId)) throw errors.packageHasInactiveService();
        await tx.servicePackageItem.create({
          data: { businessId, packageId, serviceId: s.serviceId, included: s.included, sortOrder },
        });
      }
    }
    const keep = services.map((s) => s.serviceId);
    await tx.servicePackageItem.deleteMany({ where: { packageId, serviceId: { notIn: keep } } });
  }

  /** The add-ons offered with the package: those ticked are stored, those left out are removed. */
  private async saveAddOns(
    tx: TxClient,
    businessId: string,
    packageId: string,
    addOns: NonNullable<CreateBody['addOns']>,
  ): Promise<void> {
    const offered = addOns.filter((a) => a.offered);
    const names = offered.map((a) => a.name.toLowerCase());
    if (new Set(names).size !== names.length) {
      throw errors.invalid('addOns', 'Use each add-on name once');
    }
    for (const [i, a] of offered.entries()) {
      if (a.name.length > 100)
        throw errors.invalid(`addOns.${i}.name`, 'Use at most 100 characters');
      // package_add_ons links a service's add-on row, not a service: not stored yet (R55 file).
      if (a.linkedServiceId) {
        throw errors.invalid(
          `addOns.${i}.linkedServiceId`,
          'Linking an add-on to a service is not available yet',
        );
      }
    }
    const stored = await tx.servicePackageAddOn.findMany({
      where: { packageId },
      select: { id: true },
    });
    const known = new Set(stored.map((s) => s.id));
    const keep: string[] = [];
    for (const [sortOrder, a] of offered.entries()) {
      const data = {
        name: a.name,
        description: a.description ?? null,
        priceCents: a.priceCents,
        sortOrder,
      };
      if (a.id && !known.has(a.id))
        throw errors.invalid(`addOns.${sortOrder}.id`, 'Unknown add-on');
      if (a.id) {
        keep.push(a.id);
        await tx.servicePackageAddOn.update({ where: { id: a.id }, data });
      } else {
        const made = await tx.servicePackageAddOn.create({
          data: { businessId, packageId, ...data },
          select: { id: true },
        });
        keep.push(made.id);
      }
    }
    await tx.servicePackageAddOn.deleteMany({ where: { packageId, id: { notIn: keep } } });
  }

  private async checkName(tx: TxClient, businessId: string, name: string, exceptId?: string) {
    const clash = await tx.servicePackage.findFirst({
      where: {
        businessId,
        name: { equals: name, mode: 'insensitive' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      select: { id: true },
    });
    if (clash) throw errors.duplicateName('package');
  }

  private async checkCategory(tx: TxClient, businessId: string, categoryId: string) {
    const c = await tx.serviceCategory.findFirst({
      where: { businessId, id: categoryId },
      select: { archivedAt: true },
    });
    if (!c) throw errors.invalid('categoryId', 'Choose a category');
    if (c.archivedAt) throw errors.categoryInactive();
  }

  /** service_packages.name holds 100 characters; the contract allows 120. */
  private checkWidths(b: { name?: string }) {
    if (b.name && b.name.length > 100) throw errors.invalid('name', 'Use at most 100 characters');
  }

  private checkVisibility(visible?: boolean, onWebsite?: boolean) {
    if (onWebsite && !visible) {
      throw errors.invalid('displayOnWebsite', 'Make the package visible to clients first');
    }
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await inFirm(this.database, businessId, fn);
    } catch (e) {
      if (isUniqueViolation(e)) throw errors.duplicateName('package');
      throw e;
    }
  }
}
