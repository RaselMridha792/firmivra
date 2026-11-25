import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  CheckPromotionCodeRequest,
  Promotion,
  PromotionCodeCheck,
  PromotionStatus,
  SavePromotionRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { CatalogPackagesService } from './catalog-packages.service.js';
import { CatalogServicesService } from './catalog-services.service.js';
import { diff, errors, inFirm, isUniqueViolation, iso, lockRow } from './catalog.shared.js';
import {
  type PromotionItem,
  type PromotionRules,
  promotionEligibility,
} from './promotion-eligibility.js';

type SaveBody = z.output<typeof SavePromotionRequest>;
type CheckBody = z.output<typeof CheckPromotionCodeRequest>;

/** A promotion row as the eligibility rule reads it. */
const rulesOf = (
  p: Prisma.PromotionGetPayload<{ include: { targets: true } }>,
): PromotionRules => ({
  id: p.id,
  name: p.name,
  status: p.status,
  startsAt: p.startsAt,
  endsAt: p.endsAt,
  appliesTo: p.appliesTo,
  targets: p.targets,
  allowStacking: p.allowStacking,
  discountType: p.discountType,
  discountPercent: p.discountPercent === null ? null : Number(p.discountPercent),
  discountCents: p.discountCents,
});

const promotionInclude = {
  targets: true,
  _count: { select: { redemptions: true } },
} satisfies Prisma.PromotionInclude;
type PromotionShape = Prisma.PromotionGetPayload<{ include: typeof promotionInclude }>;

/**
 * Promotion dates are calendar days. They are stored as instants in UTC: a start is the first
 * moment of its day and an end the last (the firm's own time zone is not applied yet).
 */
const startOf = (d: string | null | undefined) => (d ? new Date(`${d}T00:00:00.000Z`) : null);
const endOf = (d: string | null | undefined) => (d ? new Date(`${d}T23:59:59.999Z`) : null);
const dayOf = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/** "Scheduled" before the start and "Expired" after the end are worked out from the dates. */
export function promotionStatus(
  p: { status: 'DRAFT' | 'ACTIVE' | 'INACTIVE'; startsAt: Date | null; endsAt: Date | null },
  now = new Date(),
): PromotionStatus {
  if (p.status !== 'ACTIVE') return p.status;
  if (p.startsAt && p.startsAt > now) return 'SCHEDULED';
  if (p.endsAt && p.endsAt <= now) return 'EXPIRED';
  return 'ACTIVE';
}

export const toPromotion = (p: PromotionShape): Promotion => ({
  id: p.id,
  name: p.name,
  discountType: p.discountType === 'PERCENT' ? 'PERCENTAGE' : 'FIXED',
  value:
    p.discountType === 'PERCENT'
      ? Math.round(Number(p.discountPercent ?? 0) * 100)
      : (p.discountCents ?? 0),
  appliesTo: p.appliesTo,
  targetIds: p.targets
    .map((t) => t.categoryId ?? t.serviceId ?? t.packageId)
    .filter((x): x is string => !!x),
  startsOn: dayOf(p.startsAt),
  endsOn: dayOf(p.endsAt),
  eligibility: p.eligibility,
  promoCode: p.promoCode,
  stackable: p.allowStacking,
  status: promotionStatus(p),
  usageCount: p._count.redemptions,
  updatedAt: iso(p.updatedAt),
});

/**
 * Discounts & promotions. Changing or ending a promotion never touches an invoice it already
 * discounted: the discount is on the invoice and in its redemption. Codes are unique in the firm;
 * a promotion that does not stack cannot be live together with another that overlaps it.
 */
@Injectable()
export class CatalogPromotionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
    private readonly services: CatalogServicesService,
    private readonly packages: CatalogPackagesService,
  ) {}

  /**
   * R9/R13 (decided Nov 19), "Check a Code": whether `code` applies to one of the firm's services
   * or packages today, by the shared rule (promotion-eligibility.ts). Staff only; it orders,
   * charges and counts nothing, so it writes no audit entry. 404 for an item that is not the
   * firm's; an unknown code is an answer (UNKNOWN_CODE), never a 404.
   */
  async checkCode(businessId: string, body: CheckBody): Promise<PromotionCodeCheck> {
    const db = this.tenantPrisma.db;
    const item: PromotionItem =
      body.itemType === 'SERVICE'
        ? await this.services.get(businessId, body.itemId).then((s) => ({
            kind: 'SERVICE' as const,
            id: s.id,
            categoryId: s.category?.id ?? null,
            priceCents: s.price.type === 'CUSTOM_QUOTE' ? null : s.price.amountCents,
          }))
        : await this.packages.get(businessId, body.itemId).then((p) => ({
            kind: 'PACKAGE' as const,
            id: p.id,
            categoryId: p.category?.id ?? null,
            priceCents: p.pricing.packagePriceCents,
          }));
    const p = await db.promotion.findFirst({
      where: { businessId, promoCode: body.code },
      include: { targets: true },
    });
    if (!p) {
      return {
        result: 'UNKNOWN_CODE',
        promotion: null,
        priceCents: item.priceCents,
        discountCents: null,
        conflict: null,
        scope: [],
      };
    }
    const automatic = await db.promotion.findMany({
      where: { businessId, status: 'ACTIVE', promoCode: null, id: { not: p.id } },
      include: { targets: true },
    });
    const verdict = promotionEligibility(rulesOf(p), item, new Date(), automatic.map(rulesOf));
    return {
      result: verdict.result,
      promotion: {
        id: p.id,
        name: p.name,
        startsOn: dayOf(p.startsAt),
        endsOn: dayOf(p.endsAt),
        eligibility: p.eligibility,
      },
      priceCents: item.priceCents,
      discountCents: verdict.discountCents,
      conflict: verdict.conflict,
      scope: verdict.result.startsWith('WRONG_') ? await this.scopeOf(businessId, p.targets) : [],
    };
  }

  /** The names of what a promotion is for (its categories, services or packages). */
  private async scopeOf(
    businessId: string,
    targets: { categoryId: string | null; serviceId: string | null; packageId: string | null }[],
  ): Promise<string[]> {
    const db = this.tenantPrisma.db;
    const ids = (pick: (t: (typeof targets)[number]) => string | null) =>
      targets.map(pick).filter((x): x is string => !!x);
    const [categories, services, packages] = await Promise.all([
      db.serviceCategory.findMany({
        where: { businessId, id: { in: ids((t) => t.categoryId) } },
        select: { name: true },
      }),
      db.service.findMany({
        where: { businessId, id: { in: ids((t) => t.serviceId) } },
        select: { name: true },
      }),
      db.servicePackage.findMany({
        where: { businessId, id: { in: ids((t) => t.packageId) } },
        select: { name: true },
      }),
    ]);
    return [...categories, ...services, ...packages]
      .map((r) => r.name)
      .sort((a, b) => a.localeCompare(b));
  }

  async list(businessId: string): Promise<Promotion[]> {
    const rows = await this.tenantPrisma.db.promotion.findMany({
      where: { businessId },
      include: promotionInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    return rows.map(toPromotion);
  }

  async create(businessId: string, body: SaveBody): Promise<Promotion> {
    const id = await this.write(businessId, async (tx) => {
      const created = await tx.promotion.create({
        data: { businessId, ...columns(body), status: body.activate ? 'ACTIVE' : 'DRAFT' },
        select: { id: true },
      });
      await this.saveTargets(tx, businessId, created.id, body);
      if (body.activate) await this.checkStacking(tx, businessId, created.id);
      return created.id;
    });
    const created = await this.one(businessId, id);
    await this.audit.log(
      'catalog.promotion.created',
      { type: 'catalog_promotion', id },
      {
        discountType: created.discountType,
        value: created.value,
        appliesTo: created.appliesTo,
        status: created.status,
      },
    );
    return created;
  }

  /** A full save. `activate: true` makes it live; false leaves a live or ended promotion as it is. */
  async update(businessId: string, id: string, body: SaveBody): Promise<Promotion> {
    const change = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'promotions', businessId, id);
      const cur = await tx.promotion.findFirst({
        where: { businessId, id },
        include: promotionInclude,
      });
      if (!cur) throw errors.notFound();
      // Targets go first: the database checks a target against the promotion's kind.
      await tx.promotionTarget.deleteMany({ where: { promotionId: id } });
      await tx.promotion.update({
        where: { id },
        data: { ...columns(body), ...(body.activate ? { status: 'ACTIVE' as const } : {}) },
      });
      await this.saveTargets(tx, businessId, id, body);
      const after = await tx.promotion.findFirstOrThrow({
        where: { businessId, id },
        include: promotionInclude,
      });
      if (after.status === 'ACTIVE') await this.checkStacking(tx, businessId, id);
      const flat = (p: PromotionShape) => ({
        name: p.name,
        discountType: p.discountType,
        value: p.discountType === 'PERCENT' ? p.discountPercent?.toString() : p.discountCents,
        appliesTo: p.appliesTo,
        targets: p.targets.map((t) => t.categoryId ?? t.serviceId ?? t.packageId).sort(),
        startsOn: dayOf(p.startsAt),
        endsOn: dayOf(p.endsAt),
        eligibility: p.eligibility,
        promoCode: p.promoCode,
        stackable: p.allowStacking,
        status: p.status,
      });
      return diff(flat(cur), flat(after));
    });
    if (change.fields.length > 0) {
      await this.audit.log('catalog.promotion.updated', { type: 'catalog_promotion', id }, change);
    }
    return this.one(businessId, id);
  }

  /** End now: future use stops. Completed invoices keep what they got. */
  async end(businessId: string, id: string): Promise<Promotion> {
    const changed = await this.write(businessId, async (tx) => {
      await lockRow(tx, 'promotions', businessId, id);
      const cur = await tx.promotion.findFirst({ where: { businessId, id } });
      if (!cur) throw errors.notFound();
      if (cur.status === 'INACTIVE') return false;
      const now = new Date();
      await tx.promotion.update({
        where: { id },
        data: {
          status: 'INACTIVE',
          // Stops the window now, unless it has not begun (the window must stay forward).
          ...(!cur.startsAt || cur.startsAt < now
            ? { endsAt: cur.endsAt && cur.endsAt < now ? cur.endsAt : now }
            : {}),
        },
      });
      return true;
    });
    if (changed) await this.audit.log('catalog.promotion.ended', { type: 'catalog_promotion', id });
    return this.one(businessId, id);
  }

  private async one(businessId: string, id: string): Promise<Promotion> {
    const p = await this.tenantPrisma.db.promotion.findFirst({
      where: { businessId, id },
      include: promotionInclude,
    });
    if (!p) throw errors.notFound();
    return toPromotion(p);
  }

  /** The categories, services or packages it applies to must be this firm's. */
  private async saveTargets(
    tx: TxClient,
    businessId: string,
    promotionId: string,
    body: SaveBody,
  ): Promise<void> {
    if (body.appliesTo === 'ALL') return;
    const ids = [...new Set(body.targetIds)];
    const table = {
      CATEGORIES: tx.serviceCategory,
      SERVICES: tx.service,
      PACKAGES: tx.servicePackage,
    }[body.appliesTo];
    const found = await (table as typeof tx.service).count({
      where: { businessId, id: { in: ids } },
    });
    if (found !== ids.length) throw errors.invalid('targetIds', 'Choose items of this firm');
    const field = { CATEGORIES: 'categoryId', SERVICES: 'serviceId', PACKAGES: 'packageId' }[
      body.appliesTo
    ] as 'categoryId' | 'serviceId' | 'packageId';
    await tx.promotionTarget.createMany({
      data: ids.map((target) => ({ businessId, promotionId, [field]: target })),
    });
  }

  /**
   * A promotion that does not stack cannot be live with another that overlaps it in time and in
   * what it covers (ALL covers everything; otherwise they share a target of the same kind). Two
   * that both stack never conflict.
   */
  private async checkStacking(tx: TxClient, businessId: string, id: string): Promise<void> {
    const mine = await tx.promotion.findFirstOrThrow({
      where: { businessId, id },
      include: { targets: true },
    });
    const others = await tx.promotion.findMany({
      where: { businessId, status: 'ACTIVE', id: { not: id } },
      include: { targets: true },
    });
    const now = new Date();
    const open = (p: { startsAt: Date | null; endsAt: Date | null }) => !p.endsAt || p.endsAt > now;
    const overlap = (
      a: { startsAt: Date | null; endsAt: Date | null },
      b: { startsAt: Date | null; endsAt: Date | null },
    ) =>
      (!a.endsAt || !b.startsAt || b.startsAt < a.endsAt) &&
      (!b.endsAt || !a.startsAt || a.startsAt < b.endsAt);
    const key = (t: {
      categoryId: string | null;
      serviceId: string | null;
      packageId: string | null;
    }) => t.categoryId ?? t.serviceId ?? t.packageId;
    for (const o of others) {
      if (!open(o) || !overlap(mine, o)) continue;
      const covers =
        mine.appliesTo === 'ALL' ||
        o.appliesTo === 'ALL' ||
        (mine.appliesTo === o.appliesTo &&
          mine.targets.some((t) => o.targets.some((u) => key(u) === key(t))));
      if (covers && !(mine.allowStacking && o.allowStacking)) {
        // Y3: which promotion, and which rule: the one that does not stack, and the remedy.
        throw errors.promotionConflict(
          mine.allowStacking
            ? `“${o.name}” does not stack and runs at the same time on the same services. Change the dates or what this applies to, or allow stacking on “${o.name}”.`
            : `This promotion does not stack, and “${o.name}” runs at the same time on the same services. Change the dates or what it applies to, or allow stacking on both.`,
        );
      }
    }
  }

  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await inFirm(this.database, businessId, fn);
    } catch (e) {
      // The promo code is the promotions' one unique column (promotions_one_code).
      if (isUniqueViolation(e)) throw errors.promoCodeTaken();
      throw e;
    }
  }
}

/** The promotion columns of a request. promotions.name holds 100 characters (the contract 120). */
function columns(b: SaveBody) {
  if (b.name.length > 100) throw errors.invalid('name', 'Use at most 100 characters');
  return {
    name: b.name,
    discountType: b.discountType === 'PERCENTAGE' ? ('PERCENT' as const) : ('FIXED' as const),
    discountPercent: b.discountType === 'PERCENTAGE' ? b.value / 100 : null,
    discountCents: b.discountType === 'FIXED' ? b.value : null,
    appliesTo: b.appliesTo,
    startsAt: startOf(b.startsOn),
    endsAt: endOf(b.endsOn),
    eligibility: b.eligibility,
    promoCode: b.promoCode ?? null,
    allowStacking: b.stackable,
  };
}
