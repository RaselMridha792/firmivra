import { z } from 'zod';
import { CalendarDate } from '../clients/schemas.js';
import { clearable, SearchText, text } from '../clients/text.js';
import { ServiceKind } from '../db-enums.js';

// Services & Pricing (R43 contract, for Arfan's screens): the services list with its five tabs
// (Active, Inactive, Service Categories, Package Builder, Discounts & Promotions), Add / Edit
// Service, the Package Builder with its service picker, categories and promotions. Designs:
// docs/mockups/firm-workspace/services-and-pricing/source/. Brief:
// docs/work/briefs/services-pricing-contract.md.
// A service here is the firm's existing `services` row (R0: name, description, kind, billing
// interval, archived), extended with pricing (to build). Firm routes under /api/v1/business
// (`@Access('SERVICES_PRICING')`): everyone at the firm with view reads; Owner and Admin (or the
// grid's Manage) change. Money is integer cents of the firm's currency; totals and savings are
// worked out by the API and checked again on save. Editing a price never changes invoices,
// engagements or payments already made: they keep their own snapshot. Every price, status,
// package-content and promotion change is audited with old and new values.
// Responses are plain objects; requests are strict.

const DateTime = z.iso.datetime({ offset: true });
const Cents = z.number().int().min(0).max(99_999_999_999);

export const CatalogServiceId = z.uuid();
export const ServiceCategoryId = z.uuid();
export const ServicePackageId = z.uuid();
export const PromotionId = z.uuid();

/** DRAFT is not sellable; INACTIVE is off sale but kept; ARCHIVED is hidden from both lists. */
export const CatalogStatus = z.enum(['DRAFT', 'ACTIVE', 'INACTIVE', 'ARCHIVED']);
export type CatalogStatus = z.infer<typeof CatalogStatus>;

export const PricingType = z.enum(['FIXED', 'STARTING_AT', 'HOURLY', 'CUSTOM_QUOTE', 'RECURRING']);
export type PricingType = z.infer<typeof PricingType>;

export const BillingFrequency = z.enum([
  'ONE_TIME',
  'WEEKLY',
  'BIWEEKLY',
  'MONTHLY',
  'QUARTERLY',
  'SEMIANNUAL',
  'ANNUAL',
]);
export type BillingFrequency = z.infer<typeof BillingFrequency>;

/** An approved icon key (the screen maps it to a Phosphor icon); uploads are not designed. */
export const CatalogIcon = z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'Choose an icon');

export const CategoryRef = z.object({
  id: z.uuid(),
  name: z.string(),
  /** A token name for the category chip ("info", "purple", "success", "warning"). */
  tone: z.string().nullable(),
});
export type CategoryRef = z.infer<typeof CategoryRef>;

/** How a price reads: "$99.00+", "$75.00/hour", "Quote required", "$199.00 / month". */
export const PriceDisplay = z.object({
  type: PricingType,
  /** Null for CUSTOM_QUOTE. */
  amountCents: z.number().int().nullable(),
  frequency: BillingFrequency.nullable(),
});
export type PriceDisplay = z.infer<typeof PriceDisplay>;

// ---------- Services list ----------

export const ServiceSort = z.enum(['name', 'category', 'price', 'status', 'updated']);

/** GET /business/catalog/services: the Active / Inactive tabs and the package service picker. */
export const CatalogServicesQuery = z.strictObject({
  status: z.enum(['active', 'inactive', 'draft', 'archived', 'all']).optional().default('active'),
  search: SearchText.optional(),
  categoryId: z.uuid().optional(),
  pricingType: PricingType.optional(),
  sort: ServiceSort.optional().default('name'),
  direction: z.enum(['asc', 'desc']).optional().default('asc'),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(8),
});
export type CatalogServicesQuery = z.input<typeof CatalogServicesQuery>;

/** One row (Service Name with icon and short description, Category, Pricing, Status, Last Updated). */
export const CatalogServiceRow = z.object({
  id: z.uuid(),
  name: z.string(),
  shortDescription: z.string().nullable(),
  icon: z.string().nullable(),
  category: CategoryRef.nullable(),
  price: PriceDisplay,
  status: CatalogStatus,
  updatedAt: DateTime,
  updatedBy: z.string().nullable(),
});
export type CatalogServiceRow = z.infer<typeof CatalogServiceRow>;

export const CatalogServicePage = z.object({
  items: z.array(CatalogServiceRow).max(100),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export type CatalogServicePage = z.infer<typeof CatalogServicePage>;

/** GET /business/catalog/summary: Total, Active, Inactive, Categories, Active Promotions. */
export const CatalogSummary = z.object({
  total: z.number().int(),
  active: z.number().int(),
  inactive: z.number().int(),
  draft: z.number().int(),
  categories: z.number().int(),
  activePromotions: z.number().int(),
  packages: z.number().int(),
});
export type CatalogSummary = z.infer<typeof CatalogSummary>;

// ---------- One service (Add / Edit Service) ----------

export const ServiceLineItem = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  quantity: z.number(),
  rateCents: z.number().int(),
  /** quantity x rate, worked out by the API. */
  totalCents: z.number().int(),
});
export type ServiceLineItem = z.infer<typeof ServiceLineItem>;

export const ServiceAddOn = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  clientSelectable: z.boolean(),
  /** An existing service this add-on sells, where linked. */
  linkedServiceId: z.uuid().nullable(),
});
export type ServiceAddOn = z.infer<typeof ServiceAddOn>;

/** GET /business/catalog/services/{id}. */
export const CatalogService = CatalogServiceRow.extend({
  /** The existing service kind (Begin Online, engagements); OTHER for new kinds of work. */
  kind: ServiceKind,
  fullDescription: z.string().nullable(),
  basePriceCents: z.number().int().nullable(),
  billingFrequency: BillingFrequency.nullable(),
  taxable: z.boolean(),
  requireClientApproval: z.boolean(),
  included: z.array(z.string()),
  notIncluded: z.array(z.string()),
  lineItems: z.array(ServiceLineItem),
  /**
   * INCLUDED: the line items explain the base price (never charged twice). ADDITIVE: the total is
   * the line items' sum. "Total Price" on the form follows this.
   */
  lineItemsMode: z.enum(['INCLUDED', 'ADDITIVE']),
  totalPriceCents: z.number().int().nullable(),
  addOns: z.array(ServiceAddOn),
  /** Staff only; never in the client preview, portal, website or invoices. */
  internalNotes: z.string().nullable(),
  createdAt: DateTime,
  version: z.string(),
});
export type CatalogService = z.infer<typeof CatalogService>;

const LineItemInput = z.strictObject({
  /** Leave out for a new line. */
  id: z.uuid().optional(),
  name: text(120),
  description: clearable(text(300)),
  quantity: z.number().positive().max(10_000).default(1),
  rateCents: Cents,
});

const AddOnInput = z.strictObject({
  id: z.uuid().optional(),
  name: text(120),
  description: clearable(text(300)),
  priceCents: Cents,
  status: z.enum(['ACTIVE', 'INACTIVE']).default('ACTIVE'),
  clientSelectable: z.boolean().default(true),
  linkedServiceId: z.uuid().nullable().optional(),
});

const serviceFields = {
  name: text(120),
  categoryId: z.uuid(),
  shortDescription: text(300),
  icon: CatalogIcon.nullable().optional(),
  kind: ServiceKind.optional(),
  pricingType: PricingType,
  /** Required unless CUSTOM_QUOTE. */
  basePriceCents: Cents.nullable().optional(),
  /** Required for RECURRING. */
  billingFrequency: BillingFrequency.nullable().optional(),
  taxable: z.boolean().optional(),
  requireClientApproval: z.boolean().optional(),
  fullDescription: clearable(text(1000, 'many')),
  included: z.array(text(200)).max(30).optional(),
  notIncluded: z.array(text(200)).max(30).optional(),
  lineItems: z.array(LineItemInput).max(50).optional(),
  lineItemsMode: z.enum(['INCLUDED', 'ADDITIVE']).optional(),
  addOns: z.array(AddOnInput).max(30).optional(),
  internalNotes: clearable(text(500, 'many')),
};

const priced = (b: {
  pricingType?: PricingType;
  basePriceCents?: number | null;
  billingFrequency?: string | null;
}) =>
  b.pricingType === undefined ||
  b.pricingType === 'CUSTOM_QUOTE' ||
  (b.basePriceCents !== undefined && b.basePriceCents !== null);
const recurring = (b: { pricingType?: PricingType; billingFrequency?: string | null }) =>
  b.pricingType !== 'RECURRING' || (b.billingFrequency ?? 'ONE_TIME') !== 'ONE_TIME';

/**
 * POST /business/catalog/services: Save as Draft (`activate: false`) or Save & Activate.
 * Activating checks every required field (400 ACTIVATION_INCOMPLETE otherwise). A name already
 * used is 409 DUPLICATE_NAME unless `allowDuplicateName`.
 */
export const CreateCatalogServiceRequest = z
  .strictObject({
    ...serviceFields,
    activate: z.boolean().default(false),
    allowDuplicateName: z.boolean().optional(),
  })
  .refine(priced, { message: 'Enter the base price', path: ['basePriceCents'] })
  .refine(recurring, { message: 'Choose how often it bills', path: ['billingFrequency'] });
export type CreateCatalogServiceRequest = z.input<typeof CreateCatalogServiceRequest>;

/** PATCH /business/catalog/services/{id}: only the fields sent change; same id, same history. */
export const UpdateCatalogServiceRequest = z
  .strictObject(serviceFields)
  .partial()
  .extend({
    version: z.string().min(1).max(100),
    allowDuplicateName: z.boolean().optional(),
  })
  .refine(priced, { message: 'Enter the base price', path: ['basePriceCents'] })
  .refine(recurring, { message: 'Choose how often it bills', path: ['billingFrequency'] });
export type UpdateCatalogServiceRequest = z.input<typeof UpdateCatalogServiceRequest>;

/** Row menu > View Usage. */
export const ServiceUsage = z.object({
  packages: z.array(z.object({ id: z.uuid(), name: z.string(), status: CatalogStatus })),
  activeEngagements: z.number().int(),
  openInvoices: z.number().int(),
  appointmentTypes: z.number().int(),
  automations: z.number().int(),
  /** False when anything ever used it: Delete is refused, Archive instead. */
  deletable: z.boolean(),
});
export type ServiceUsage = z.infer<typeof ServiceUsage>;

// ---------- Categories ----------

export const ServiceCategory = CategoryRef.extend({
  description: z.string().nullable(),
  icon: z.string().nullable(),
  sortOrder: z.number().int(),
  status: z.enum(['ACTIVE', 'INACTIVE']),
  serviceCount: z.number().int(),
});
export type ServiceCategory = z.infer<typeof ServiceCategory>;

export const ServiceCategoryList = z.object({ items: z.array(ServiceCategory) });
export type ServiceCategoryList = z.infer<typeof ServiceCategoryList>;

export const SaveServiceCategoryRequest = z.strictObject({
  name: text(60),
  description: clearable(text(300)),
  icon: CatalogIcon.nullable().optional(),
  tone: z.enum(['info', 'purple', 'success', 'warning', 'danger', 'neutral']).nullable().optional(),
  status: z.enum(['ACTIVE', 'INACTIVE']).optional(),
});
export type SaveServiceCategoryRequest = z.input<typeof SaveServiceCategoryRequest>;

/** Reorder: every category id in the new order. */
export const ReorderCategoriesRequest = z.strictObject({ ids: z.array(z.uuid()).min(1).max(100) });
export type ReorderCategoriesRequest = z.input<typeof ReorderCategoriesRequest>;

/** Merge: move every service of this category into `intoId`, then deactivate this one. */
export const MergeCategoryRequest = z.strictObject({ intoId: z.uuid() });
export type MergeCategoryRequest = z.input<typeof MergeCategoryRequest>;

// ---------- Packages (Package Builder) ----------

export const DiscountType = z.enum(['NONE', 'PERCENTAGE', 'FIXED']);
export type DiscountType = z.infer<typeof DiscountType>;

export const PackageService = z.object({
  serviceId: z.uuid(),
  name: z.string(),
  icon: z.string().nullable(),
  category: CategoryRef.nullable(),
  /** The service's current price; null for CUSTOM_QUOTE. */
  individualPriceCents: z.number().int().nullable(),
  pricingType: PricingType,
  /** "Included in Package": only included services count in the comparison value. */
  included: z.boolean(),
  /** The service is no longer active: replace or remove it before activating. */
  inactive: z.boolean(),
});
export type PackageService = z.infer<typeof PackageService>;

export const PackageAddOn = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string().nullable(),
  priceCents: z.number().int(),
  /** Ticked: offered with this package. */
  offered: z.boolean(),
  linkedServiceId: z.uuid().nullable(),
});
export type PackageAddOn = z.infer<typeof PackageAddOn>;

/** The Package Pricing panel, worked out by the API. */
export const PackagePricing = z.object({
  /** "Total of Selected Services": included services' individual prices. */
  totalSelectedCents: z.number().int(),
  packagePriceCents: z.number().int().nullable(),
  discountType: DiscountType,
  /** Basis points for PERCENTAGE (2000 = 20%), cents for FIXED, null for NONE. */
  discountValue: z.number().int().nullable(),
  /** "Client Savings: $140.00 (20%)"; null when it cannot be guaranteed. */
  savingsCents: z.number().int().nullable(),
  savingsPercent: z.number().nullable(),
  /** A Starting At, Hourly or Custom Quote service is included: savings are an estimate. */
  variablePrice: z.boolean(),
});
export type PackagePricing = z.infer<typeof PackagePricing>;

export const ServicePackageRow = z.object({
  id: z.uuid(),
  name: z.string(),
  shortDescription: z.string().nullable(),
  icon: z.string().nullable(),
  category: CategoryRef.nullable(),
  status: CatalogStatus,
  serviceCount: z.number().int(),
  packagePriceCents: z.number().int().nullable(),
  savingsCents: z.number().int().nullable(),
  updatedAt: DateTime,
});
export type ServicePackageRow = z.infer<typeof ServicePackageRow>;

export const ServicePackageList = z.object({ items: z.array(ServicePackageRow) });
export type ServicePackageList = z.infer<typeof ServicePackageList>;

/** GET /business/catalog/packages/{id}. */
export const ServicePackage = ServicePackageRow.extend({
  services: z.array(PackageService),
  pricing: PackagePricing,
  addOns: z.array(PackageAddOn),
  visibleToClients: z.boolean(),
  allowClientAddOns: z.boolean(),
  displayOnWebsite: z.boolean(),
  internalNotes: z.string().nullable(),
  version: z.string(),
});
export type ServicePackage = z.infer<typeof ServicePackage>;

const packageFields = {
  name: text(120),
  categoryId: z.uuid(),
  shortDescription: text(200),
  icon: CatalogIcon.nullable().optional(),
  services: z
    .array(z.strictObject({ serviceId: z.uuid(), included: z.boolean().default(true) }))
    .max(30)
    .refine(
      (list) => new Set(list.map((s) => s.serviceId)).size === list.length,
      'Add each service once',
    )
    .optional(),
  packagePriceCents: Cents.nullable().optional(),
  discountType: DiscountType.optional(),
  discountValue: z.number().int().min(0).nullable().optional(),
  addOns: z
    .array(
      z.strictObject({
        id: z.uuid().optional(),
        name: text(120),
        description: clearable(text(300)),
        priceCents: Cents,
        offered: z.boolean().default(true),
        linkedServiceId: z.uuid().nullable().optional(),
      }),
    )
    .max(30)
    .optional(),
  visibleToClients: z.boolean().optional(),
  allowClientAddOns: z.boolean().optional(),
  displayOnWebsite: z.boolean().optional(),
  internalNotes: clearable(text(500, 'many')),
};

/** POST /business/catalog/packages: Save as Draft or Save & Activate. */
export const CreateServicePackageRequest = z.strictObject({
  ...packageFields,
  activate: z.boolean().default(false),
});
export type CreateServicePackageRequest = z.input<typeof CreateServicePackageRequest>;

export const UpdateServicePackageRequest = z
  .strictObject(packageFields)
  .partial()
  .extend({ version: z.string().min(1).max(100) });
export type UpdateServicePackageRequest = z.input<typeof UpdateServicePackageRequest>;

/** POST /business/catalog/packages/pricing: the pricing panel for unsaved values (no save). */
export const PackagePricingRequest = z.strictObject({
  services: z.array(z.strictObject({ serviceId: z.uuid(), included: z.boolean() })).max(30),
  packagePriceCents: Cents.nullable(),
  discountType: DiscountType,
  discountValue: z.number().int().min(0).nullable(),
});
export type PackagePricingRequest = z.input<typeof PackagePricingRequest>;

// ---------- Discounts & Promotions ----------

export const PromotionStatus = z.enum(['DRAFT', 'SCHEDULED', 'ACTIVE', 'EXPIRED', 'INACTIVE']);
export type PromotionStatus = z.infer<typeof PromotionStatus>;

export const Promotion = z.object({
  id: z.uuid(),
  name: z.string(),
  discountType: z.enum(['PERCENTAGE', 'FIXED']),
  /** Basis points for PERCENTAGE, cents for FIXED. */
  value: z.number().int(),
  appliesTo: z.enum(['ALL', 'CATEGORIES', 'SERVICES', 'PACKAGES']),
  targetIds: z.array(z.uuid()),
  startsOn: CalendarDate.nullable(),
  endsOn: CalendarDate.nullable(),
  eligibility: z.enum(['ALL_CLIENTS', 'NEW_CLIENTS', 'EXISTING_CLIENTS']),
  promoCode: z.string().nullable(),
  stackable: z.boolean(),
  status: PromotionStatus,
  usageCount: z.number().int(),
  updatedAt: DateTime,
});
export type Promotion = z.infer<typeof Promotion>;

export const PromotionList = z.object({ items: z.array(Promotion) });
export type PromotionList = z.infer<typeof PromotionList>;

export const SavePromotionRequest = z
  .strictObject({
    name: text(120),
    discountType: z.enum(['PERCENTAGE', 'FIXED']),
    value: z.number().int().positive(),
    appliesTo: z.enum(['ALL', 'CATEGORIES', 'SERVICES', 'PACKAGES']),
    targetIds: z.array(z.uuid()).max(100).default([]),
    startsOn: CalendarDate.nullable().optional(),
    endsOn: CalendarDate.nullable().optional(),
    eligibility: z.enum(['ALL_CLIENTS', 'NEW_CLIENTS', 'EXISTING_CLIENTS']).default('ALL_CLIENTS'),
    promoCode: clearable(
      z.string().regex(/^[A-Z0-9-]{3,30}$/, 'Use 3 to 30 capitals, digits or -'),
    ),
    stackable: z.boolean().default(false),
    activate: z.boolean().default(false),
  })
  .refine((p) => p.discountType !== 'PERCENTAGE' || p.value <= 10_000, {
    message: 'Use at most 100%',
    path: ['value'],
  })
  .refine((p) => p.appliesTo === 'ALL' || p.targetIds.length > 0, {
    message: 'Choose what it applies to',
    path: ['targetIds'],
  })
  .refine((p) => !p.startsOn || !p.endsOn || p.startsOn <= p.endsOn, {
    message: 'End after the start',
    path: ['endsOn'],
  });
export type SavePromotionRequest = z.input<typeof SavePromotionRequest>;

export const CatalogErrorCode = z.enum([
  /** 409: the name is used by another service or package; resend with allowDuplicateName. */
  'DUPLICATE_NAME',
  /** 400: a required field is missing for activation (the message names it). */
  'ACTIVATION_INCOMPLETE',
  /** 409: used by packages, engagements or invoices: deactivate or archive instead. */
  'IN_USE',
  /** 409: the category is inactive: choose another. */
  'CATEGORY_INACTIVE',
  /** 409: the package holds an inactive service: replace or remove it first. */
  'PACKAGE_HAS_INACTIVE_SERVICE',
  /** 400: the discount makes the package price negative. */
  'INVALID_DISCOUNT',
  /** 409: the promotion overlaps another one that does not stack, or the code is taken. */
  'PROMOTION_CONFLICT',
  /** 409: someone saved it after it was loaded. */
  'SAVE_CONFLICT',
]);
export type CatalogErrorCode = z.infer<typeof CatalogErrorCode>;
