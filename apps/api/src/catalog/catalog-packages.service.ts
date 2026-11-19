import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CatalogPackagesQuery,
  CreateServicePackageRequest,
  PackagePricing,
  PackagePricingRequest,
  PublicLink,
  PublicLinkState,
  PublicPackage,
  ServicePackage,
  ServicePackageRow,
  UpdateServicePackageRequest,
} from '@firmivra/types';
import { publicButtonCode, publicItemUrl } from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
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
type PackageStatusFilter = NonNullable<CatalogPackagesQuery['status']>;

/** Which packages a status shows (S4); `live` is every package not archived. */
const PACKAGE_WHERE: Record<PackageStatusFilter | 'live', Prisma.ServicePackageWhereInput> = {
  live: { archivedAt: null },
  active: { status: 'ACTIVE', archivedAt: null },
  inactive: { status: 'INACTIVE', archivedAt: null },
  draft: { status: 'DRAFT', archivedAt: null },
  archived: { archivedAt: { not: null } },
  all: {},
};

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
  // S12: the Booking type, and whether clients can book it online now.
  appointmentType: { select: { id: true, name: true, archivedAt: true, clientBookable: true } },
} satisfies Prisma.ServicePackageInclude;
type PackageShape = Prisma.ServicePackageGetPayload<{ include: typeof packageInclude }>;

/**
 * SP-1 (S12): a package's public state. LIVE only while it is Active, Visible to Clients and set
 * to Display on Website/Portal; archived, a draft, inactive or hidden refuse new public use, and
 * the link stays the same so reactivating it brings it back.
 */
export function packagePublicState(p: {
  archivedAt: Date | null;
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  visibleToClients: boolean;
  displayOnPortal: boolean;
}): PublicLinkState {
  if (p.archivedAt) return 'ARCHIVED';
  if (p.status === 'DRAFT') return 'DRAFT';
  if (p.status === 'INACTIVE') return 'INACTIVE';
  return p.visibleToClients && p.displayOnPortal ? 'LIVE' : 'HIDDEN';
}

/**
 * A stored package's pricing. `read` (every list, page and public read) reports a discount that
 * no longer works instead of throwing (R1); `check` (saves and activation) refuses it.
 */
const pricingOf = (p: PackageShape, mode: 'check' | 'read' = 'read'): PackagePricing =>
  packagePricing(
    {
      included: p.items.filter((i) => i.included).map((i) => pricedService(i.service)),
      packagePriceCents: p.packagePriceCents,
      ...discountOf(p),
    },
    mode,
  );

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
  bookingType: p.appointmentType
    ? {
        id: p.appointmentType.id,
        name: p.appointmentType.name,
        bookable: bookable(p.appointmentType),
      }
    : null,
  internalNotes: p.internalNotes,
  version: versionOf(p),
});

/** S12: a Booking type the public page can open: not archived, and booked online by clients. */
const bookable = (t: { archivedAt: Date | null; clientBookable: boolean }) =>
  t.archivedAt === null && t.clientBookable;

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
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** By status (S4); without one, every package not archived. */
  async list(businessId: string, status?: PackageStatusFilter): Promise<ServicePackageRow[]> {
    const rows = await this.tenantPrisma.db.servicePackage.findMany({
      where: { businessId, ...PACKAGE_WHERE[status ?? 'live'] },
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

  /**
   * SP-1 (S12): the package's public link (`publicItemUrl`, on the portal host from config) and
   * its button code for the firm's website, with the state the public page applies. Everyone at
   * the firm reads it, whatever the package's state.
   */
  async publicLink(businessId: string, id: string): Promise<PublicLink> {
    return inFirm(this.database, businessId, async (tx) => {
      const p = await tx.servicePackage.findFirst({
        where: { businessId, id },
        select: {
          id: true,
          name: true,
          status: true,
          archivedAt: true,
          visibleToClients: true,
          displayOnPortal: true,
        },
      });
      if (!p) throw errors.notFound();
      const firm = await tx.business.findUniqueOrThrow({
        where: { id: businessId },
        select: { slug: true },
      });
      const settings = await tx.businessSettings.findUnique({
        where: { businessId },
        select: { buttonColor: true, brandColor: true },
      });
      const url = publicItemUrl(this.env.PORTAL_BASE_URL, firm.slug, 'PACKAGE', p.id);
      return {
        kind: 'PACKAGE',
        itemId: p.id,
        url,
        embedCode: publicButtonCode(
          url,
          `View ${p.name}`,
          settings?.buttonColor ?? settings?.brandColor,
        ),
        state: packagePublicState(p),
      };
    });
  }

  /**
   * SP-1 (S7, S12): the page behind the public link, before anyone signs in. Only while LIVE, and
   * only the client's view: the included services and the ones not included, the price and
   * savings, and the add-ons when clients may add them. Never internal notes or staff fields.
   */
  async publicPackage(businessId: string, id: string): Promise<PublicPackage> {
    const p = await this.database.forBusiness(businessId).servicePackage.findFirst({
      where: { businessId, id },
      include: packageInclude,
    });
    if (!p) throw errors.notFound();
    const state = packagePublicState(p);
    if (state !== 'LIVE') return { id: p.id, state, details: null };
    const pricing = pricingOf(p);
    return {
      id: p.id,
      state,
      details: {
        name: p.name,
        shortDescription: p.shortDescription,
        category: p.category?.name ?? null,
        packagePriceCents: pricing.packagePriceCents,
        savingsCents: pricing.savingsCents,
        included: p.items.filter((i) => i.included).map((i) => ({ name: i.service.name })),
        notIncluded: p.items.filter((i) => !i.included).map((i) => ({ name: i.service.name })),
        // S12: Book opens the Booking type's booking while clients can book it online.
        bookingTypeId:
          p.appointmentType && bookable(p.appointmentType) ? p.appointmentType.id : null,
        addOns: p.allowClientAddOns
          ? p.addOns.map((a) => ({
              name: a.name,
              description: a.description,
              priceCents: a.priceCents,
            }))
          : [],
      },
    };
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
      if (body.appointmentTypeId)
        await this.checkBookingType(tx, businessId, body.appointmentTypeId);
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
          appointmentTypeId: body.appointmentTypeId ?? null,
          internalNotes: body.internalNotes ?? null,
          status: 'DRAFT',
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      await this.saveItems(tx, businessId, created.id, body.services ?? [], true);
      await this.saveAddOns(tx, businessId, created.id, body.addOns ?? []);
      // R1: a draft too: a discount that cannot work is refused and nothing is stored.
      await this.checkDiscount(tx, businessId, created.id);
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
      if (changes.appointmentTypeId && changes.appointmentTypeId !== cur.appointmentTypeId) {
        await this.checkBookingType(tx, businessId, changes.appointmentTypeId);
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
        appointmentTypeId: cur.appointmentTypeId,
      };
      // R2: a percentage over 100% is refused before anything is written (the type may be the
      // stored one); the rest of the rule is checked once the services are saved, below.
      const stored = discountOf(cur);
      const nextType = changes.discountType ?? stored.discountType;
      const nextValue =
        changes.discountValue !== undefined ? changes.discountValue : stored.discountValue;
      if (nextType === 'PERCENTAGE' && (nextValue ?? 0) > 10_000)
        throw errors.invalidDiscount('Use at most 100%');
      const discount =
        changes.discountType !== undefined || changes.discountValue !== undefined
          ? discountColumns(nextType, nextValue)
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
          ...(changes.appointmentTypeId !== undefined
            ? { appointmentTypeId: changes.appointmentTypeId }
            : {}),
          updatedByUserId: userId,
        },
      });
      const after = await tx.servicePackage.findFirstOrThrow({
        where: { businessId, id },
        include: packageInclude,
      });
      // R1: any package, a draft too: a discount that cannot work is refused here, inside the
      // transaction, so nothing of the save is stored and the last good record stays.
      pricingOf(after, 'check');
      // A live package keeps everything it needs to be sold.
      if (after.status === 'ACTIVE' && !after.archivedAt) {
        this.checkSellable(after);
      }
      return diff(before, {
        name: after.name,
        packagePriceCents: after.packagePriceCents,
        ...discountOf(after),
        services: after.items.map((i) => `${i.serviceId}:${i.included}`).sort(),
        appointmentTypeId: after.appointmentTypeId,
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
          appointmentTypeId: src.appointmentTypeId,
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
        packagePriceCents: pricingOf(p, 'check').packagePriceCents,
      },
    });
  }

  /** R1: refuses (INVALID_DISCOUNT) a package whose discount cannot work, inside the save. */
  private async checkDiscount(tx: TxClient, businessId: string, id: string): Promise<void> {
    const p = await tx.servicePackage.findFirstOrThrow({
      where: { businessId, id },
      include: packageInclude,
    });
    pricingOf(p, 'check');
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
    const pricing = pricingOf(p, 'check');
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

  /** S12: a Booking type is one of the firm's appointment types, not archived. */
  private async checkBookingType(tx: TxClient, businessId: string, typeId: string) {
    const t = await tx.appointmentType.findFirst({
      where: { businessId, id: typeId },
      select: { archivedAt: true },
    });
    if (!t || t.archivedAt)
      throw errors.invalid('appointmentTypeId', 'Choose one of your active appointment types');
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
