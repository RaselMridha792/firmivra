import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { databaseErrorCode } from '@firmivra/db';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  BillingFrequency,
  CatalogErrorCode,
  CatalogStatus,
  CategoryRef,
  DiscountType,
  PackagePricing,
  PriceDisplay,
  PricingType,
} from '@firmivra/types';

/** The errors of the catalog routes (codes in packages/types/src/services-pricing). */
const conflict = (code: CatalogErrorCode, message: string) =>
  new ConflictException({ code, message });

export const errors = {
  notFound: () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' }),
  forbidden: () =>
    new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' }),
  duplicateName: (what: string) =>
    conflict('DUPLICATE_NAME', `A ${what} with this name already exists`),
  inUse: (message: string) => conflict('IN_USE', message),
  categoryInactive: () =>
    conflict('CATEGORY_INACTIVE', 'This category is inactive. Choose another.'),
  packageHasInactiveService: () =>
    conflict(
      'PACKAGE_HAS_INACTIVE_SERVICE',
      'This package holds a service that is not active. Replace or remove it first.',
    ),
  promotionConflict: (message: string) => conflict('PROMOTION_CONFLICT', message),
  saveConflict: () =>
    conflict('SAVE_CONFLICT', 'Someone saved this after you opened it. Reload and try again.'),
  activationIncomplete: (message: string) =>
    new BadRequestException({ code: 'ACTIVATION_INCOMPLETE', message }),
  invalidDiscount: (message: string) =>
    new BadRequestException({ code: 'INVALID_DISCOUNT', message }),
  /** A request that passed the contract but cannot be stored (a column is narrower, an id is not the firm's). */
  invalid: (path: string, message: string) =>
    new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The request is not valid',
      details: [{ path, message }],
    }),
};

export const isUniqueViolation = (e: unknown) => databaseErrorCode(e) === '23505';
export const isForeignKeyViolation = (e: unknown) => databaseErrorCode(e) === '23503';

/** One transaction in the firm's scope. */
export const inFirm = <T>(
  database: Database,
  businessId: string,
  fn: (tx: TxClient) => Promise<T>,
): Promise<T> => database.withScope({ kind: 'business', businessId }, fn);

/** Locks one catalog row until the transaction ends, so a version check and its write agree. */
export async function lockRow(
  tx: TxClient,
  table: 'services' | 'service_packages' | 'promotions' | 'service_categories',
  businessId: string,
  id: string,
): Promise<void> {
  // The table name is one of the four literals above, never input.
  await tx.$executeRawUnsafe(
    `SELECT 1 FROM ${table} WHERE business_id = $1::uuid AND id = $2::uuid FOR NO KEY UPDATE`,
    businessId,
    id,
  );
}

// ---------- Category tone <-> colour ----------

/**
 * The database keeps a category's colour as `#rrggbb` (service_categories.color); the contract
 * speaks in token names. These are the colours the six tones are stored as, and any other stored
 * colour reads back as no tone.
 */
export const TONE_COLORS = {
  info: '#3B82F6',
  purple: '#8B5CF6',
  success: '#22C55E',
  warning: '#F59E0B',
  danger: '#EF4444',
  neutral: '#6B7280',
} as const;
export type Tone = keyof typeof TONE_COLORS;

export function toneOf(color: string | null): string | null {
  if (!color) return null;
  const hit = (Object.entries(TONE_COLORS) as [Tone, string][]).find(
    ([, hex]) => hex.toLowerCase() === color.toLowerCase(),
  );
  return hit ? hit[0] : null;
}

export const categoryRef = (
  c: { id: string; name: string; color: string | null } | null,
): CategoryRef | null => (c ? { id: c.id, name: c.name, tone: toneOf(c.color) } : null);

// ---------- Status and price ----------

export const statusOf = (row: {
  status: 'DRAFT' | 'ACTIVE' | 'INACTIVE';
  archivedAt: Date | null;
}): CatalogStatus => (row.archivedAt ? 'ARCHIVED' : row.status);

/** A stored line item's amount: its quantity (a decimal) times its rate, to the cent. */
export const lineTotalCents = (l: { quantity: { toString(): string }; rateCents: number }) =>
  Math.round(Number(l.quantity.toString()) * l.rateCents);

/** What a service's price is made of; without line items it is the base price. */
export interface ServicePriceParts {
  pricingType: PricingType;
  basePriceCents: number | null;
  lineItemMode?: 'INFORMATIONAL' | 'ADDITIVE';
  lineItems?: { quantity: { toString(): string }; rateCents: number }[];
}

/**
 * What the service costs (Octavia's S6): null for a Custom Quote; with ADDITIVE line items the base
 * price plus the lines (a $100.50 base and a $75.00 line make $175.50); otherwise the base price,
 * which INFORMATIONAL lines only explain (never charged twice).
 */
export function serviceTotalCents(s: ServicePriceParts): number | null {
  if (s.pricingType === 'CUSTOM_QUOTE') return null;
  if (s.lineItemMode !== 'ADDITIVE' || !s.lineItems?.length) return s.basePriceCents;
  return (s.basePriceCents ?? 0) + s.lineItems.reduce((n, l) => n + lineTotalCents(l), 0);
}

export function priceOf(
  row: ServicePriceParts & { billingFrequency: string | null },
): PriceDisplay {
  return {
    type: row.pricingType,
    amountCents: serviceTotalCents(row),
    // SEMI_MONTHLY is in the database but not in the contract: read as the closest, MONTHLY.
    frequency: (row.billingFrequency === 'SEMI_MONTHLY'
      ? 'MONTHLY'
      : row.billingFrequency) as BillingFrequency | null,
  };
}

/** The optimistic-concurrency token: the row's last change, to the millisecond. */
export const versionOf = (row: { updatedAt: Date }) => row.updatedAt.toISOString();

export const iso = (d: Date) => d.toISOString();

/** The changes between two flat records, for an audit row: only what really differs. */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
): { fields: string[]; from: Record<string, unknown>; to: Record<string, unknown> } {
  const fields = Object.keys(after)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .sort();
  return {
    fields,
    from: Object.fromEntries(fields.map((f) => [f, before[f] ?? null])),
    to: Object.fromEntries(fields.map((f) => [f, after[f] ?? null])),
  };
}

// ---------- Package pricing ----------

export interface PricedService {
  /** The service's price (`serviceTotalCents`); null for a Custom Quote. */
  priceCents: number | null;
  pricingType: PricingType;
}

/** A package's service as loaded: its price with its line items. */
export const pricedService = (s: ServicePriceParts): PricedService => ({
  priceCents: serviceTotalCents(s),
  pricingType: s.pricingType,
});

/**
 * The Package Pricing panel. "Total of selected services" counts the included services' current
 * prices; optional services and add-ons never count. When an included service needs a quote the
 * total is unknown, never $0 (Octavia's S9), and so is a price worked out from a discount. With a
 * discount and no package price, the price is the total less the discount. Savings are known only
 * when the package has a price and every included service has a fixed price.
 */
export function packagePricing(input: {
  included: PricedService[];
  packagePriceCents: number | null;
  discountType: DiscountType;
  /** Basis points for PERCENTAGE, cents for FIXED. */
  discountValue: number | null;
}): PackagePricing {
  const quoteRequired = input.included.some((s) => s.pricingType === 'CUSTOM_QUOTE');
  const total = input.included.some((s) => s.priceCents === null)
    ? null
    : input.included.reduce((sum, s) => sum + (s.priceCents ?? 0), 0);
  const variable = input.included.some((s) =>
    ['STARTING_AT', 'HOURLY', 'CUSTOM_QUOTE'].includes(s.pricingType),
  );
  const hasDiscount = input.discountType !== 'NONE' && input.discountValue !== null;
  let price = input.packagePriceCents;
  if (price === null && hasDiscount && total !== null) {
    const off =
      input.discountType === 'PERCENTAGE'
        ? Math.round((total * (input.discountValue ?? 0)) / 10_000)
        : (input.discountValue ?? 0);
    if (off > total) throw errors.invalidDiscount('The discount is more than the services cost');
    price = total - off;
  }
  if (hasDiscount && input.discountType === 'PERCENTAGE' && (input.discountValue ?? 0) > 10_000) {
    throw errors.invalidDiscount('Use at most 100%');
  }
  if (
    hasDiscount &&
    input.discountType === 'FIXED' &&
    total !== null &&
    (input.discountValue ?? 0) > total
  ) {
    throw errors.invalidDiscount('The discount is more than the services cost');
  }
  const known = price !== null && total !== null && !variable && input.included.length > 0;
  const savings = known ? Math.max(0, (total ?? 0) - (price ?? 0)) : null;
  return {
    totalSelectedCents: total,
    packagePriceCents: price,
    discountType: input.discountType,
    discountValue: input.discountType === 'NONE' ? null : input.discountValue,
    savingsCents: savings,
    savingsPercent: savings !== null && total ? Math.round((savings / total) * 10_000) / 100 : null,
    variablePrice: variable,
    quoteRequired,
  };
}

/** Basis points or cents from the package's columns. */
export function discountOf(row: {
  discountType: 'PERCENT' | 'FIXED' | null;
  discountPercent: Prisma.Decimal | null;
  discountCents: number | null;
}): { discountType: DiscountType; discountValue: number | null } {
  if (row.discountType === 'PERCENT') {
    return {
      discountType: 'PERCENTAGE',
      discountValue: Math.round(Number(row.discountPercent ?? 0) * 100),
    };
  }
  if (row.discountType === 'FIXED') {
    return { discountType: 'FIXED', discountValue: row.discountCents };
  }
  return { discountType: 'NONE', discountValue: null };
}

export function discountColumns(type: DiscountType, value: number | null) {
  return {
    discountType:
      type === 'NONE' || value === null ? null : type === 'PERCENTAGE' ? 'PERCENT' : 'FIXED',
    discountPercent: type === 'PERCENTAGE' && value !== null ? value / 100 : null,
    discountCents: type === 'FIXED' ? value : null,
  } as const;
}
