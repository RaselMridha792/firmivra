import {
  ApiRequestError,
  type CatalogService,
  type CatalogServiceRow,
  CatalogServicesQuery,
  CreateCatalogServiceRequest,
  CreateServicePackageRequest,
  MergeCategoryRequest,
  type PackagePricing,
  PackagePricingRequest,
  parseInput,
  type PricingType,
  type Promotion,
  ReorderCategoriesRequest,
  SavePromotionRequest,
  SaveServiceCategoryRequest,
  type ServiceCategory,
  type ServicePackage,
  type ServicesPricingClient,
  UpdateCatalogServiceRequest,
  UpdateServicePackageRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

/**
 * Mock data for `api.servicesPricing` (R43 contract, Services & Pricing). Sample prices only:
 * the API never hard-codes them. Same input checks and codes as the API: a used name is 409
 * DUPLICATE_NAME unless allowed; activating a priced service without a price is 400
 * ACTIVATION_INCOMPLETE; deleting a service a package uses is 409 IN_USE; a package with an
 * inactive service cannot be activated. Package totals and savings are worked out here as the
 * API will. STAFF read only (403 on changes). `empty: true` (NEXT_PUBLIC_API_MOCK_EMPTY=
 * servicesPricing) starts with categories only.
 */

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
interface Options {
  role?: MockRole;
  empty?: boolean;
}

const uuid = (block: string, n: number) =>
  `0199c0e0-${block}-7000-8000-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string, message: string) =>
  new ApiRequestError(status, code, message);
const copy = <T>(value: T): T => structuredClone(value);
const ago = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

interface Store {
  services: CatalogService[];
  categories: ServiceCategory[];
  packages: ServicePackage[];
  promotions: Promotion[];
  next: number;
}

function seed(empty: boolean): Store {
  const cats: [string, string][] = [
    ['Tax Preparation', 'info'],
    ['Advisory', 'purple'],
    ['Payroll', 'success'],
    ['Bookkeeping', 'warning'],
  ];
  const categories: ServiceCategory[] = cats.map(([name, tone], i) => ({
    id: uuid('0c00', i + 1),
    name,
    tone,
    description: null,
    icon: null,
    sortOrder: i,
    status: 'ACTIVE',
    serviceCount: 0,
  }));
  const ref = (i: number) => {
    const c = categories[i];
    return c ? { id: c.id, name: c.name, tone: c.tone } : null;
  };
  // name, short, category, type, price, icon, status
  const rows: [
    string,
    string,
    number,
    PricingType,
    number | null,
    string,
    CatalogService['status'],
  ][] = [
    [
      'Personal Tax Preparation',
      'Individual and family tax preparation.',
      0,
      'STARTING_AT',
      9_900,
      'user',
      'ACTIVE',
    ],
    [
      'Business Tax Preparation',
      'LLCs, S-Corps, C-Corps and more.',
      0,
      'STARTING_AT',
      29_000,
      'briefcase',
      'ACTIVE',
    ],
    [
      'Quarterly Tax Preparation',
      'Quarterly filing and compliance.',
      0,
      'STARTING_AT',
      15_000,
      'calendar',
      'ACTIVE',
    ],
    [
      'Tax Planning',
      'Strategic tax planning and consultation.',
      1,
      'STARTING_AT',
      25_000,
      'chart-bar',
      'ACTIVE',
    ],
    [
      'Business Planning & Development',
      'Business strategy and growth support.',
      1,
      'STARTING_AT',
      35_000,
      'users-three',
      'ACTIVE',
    ],
    [
      'Payroll Services',
      'Payroll setup and ongoing payroll.',
      2,
      'RECURRING',
      10_000,
      'money',
      'ACTIVE',
    ],
    [
      'Bookkeeping Services',
      'Ongoing bookkeeping and financial reports.',
      3,
      'RECURRING',
      19_900,
      'book',
      'ACTIVE',
    ],
    [
      'Back Tax Services',
      'Prior year tax filing and resolution.',
      0,
      'STARTING_AT',
      45_000,
      'file-text',
      'ACTIVE',
    ],
    [
      'Audit Representation',
      'Representation before the IRS.',
      0,
      'HOURLY',
      17_500,
      'shield',
      'ACTIVE',
    ],
    [
      'Business Entity Formation',
      'LLC, S-Corp or other entity setup.',
      1,
      'FIXED',
      35_000,
      'buildings',
      'ACTIVE',
    ],
    ['Amended Returns', 'Corrections to filed returns.', 0, 'FIXED', 7_500, 'pencil', 'INACTIVE'],
    [
      'Custom Consulting',
      'Projects quoted case by case.',
      1,
      'CUSTOM_QUOTE',
      null,
      'chart-bar',
      'INACTIVE',
    ],
  ];
  const services: CatalogService[] = empty
    ? []
    : rows.map(([name, short, cat, type, price, icon, status], i) => ({
        id: uuid('0a00', i + 1),
        name,
        shortDescription: short,
        icon,
        category: ref(cat),
        price: {
          type,
          amountCents: price,
          frequency: type === 'RECURRING' ? 'MONTHLY' : type === 'HOURLY' ? null : 'ONE_TIME',
        },
        status,
        updatedAt: ago(i + 1),
        updatedBy: i % 2 ? 'Team Member' : 'Morgan Avery',
        kind:
          cat === 0 ? 'ANNUAL_TAX' : cat === 2 ? 'PAYROLL' : cat === 3 ? 'BOOKKEEPING' : 'OTHER',
        fullDescription:
          i === 0
            ? 'A complete review of your tax situation to maximize your refund and file accurately. We handle W-2, 1099 and self-employment income.'
            : null,
        basePriceCents: price,
        billingFrequency: type === 'RECURRING' ? 'MONTHLY' : type === 'HOURLY' ? null : 'ONE_TIME',
        taxable: i === 0,
        requireClientApproval: false,
        included:
          i === 0
            ? [
                'Review of all tax documents',
                'Accurate tax return preparation',
                'Federal and state filing (if applicable)',
                'Direct deposit setup',
                'Year-round tax support for questions',
              ]
            : [],
        notIncluded:
          i === 0
            ? [
                'Amended returns (additional fee)',
                'Audit representation (available as add-on)',
                'Business tax preparation',
              ]
            : [],
        lineItems:
          i === 0
            ? [
                {
                  id: uuid('0d00', 1),
                  name: 'Base Preparation Fee',
                  description: 'Personal tax return preparation',
                  quantity: 1,
                  rateCents: 9_900,
                  totalCents: 9_900,
                },
                {
                  id: uuid('0d00', 2),
                  name: 'State Return (if required)',
                  description: 'State tax return filing',
                  quantity: 1,
                  rateCents: 0,
                  totalCents: 0,
                },
              ]
            : [],
        lineItemsMode: 'INCLUDED',
        totalPriceCents: price,
        addOns:
          i === 0
            ? [
                {
                  id: uuid('0e00', 1),
                  name: 'Amended Return',
                  description: null,
                  priceCents: 7_500,
                  status: 'ACTIVE',
                  clientSelectable: true,
                  linkedServiceId: uuid('0a00', 11),
                },
                {
                  id: uuid('0e00', 2),
                  name: 'Audit Representation',
                  description: null,
                  priceCents: 25_000,
                  status: 'ACTIVE',
                  clientSelectable: true,
                  linkedServiceId: uuid('0a00', 9),
                },
                {
                  id: uuid('0e00', 3),
                  name: 'Prior Year Return (per year)',
                  description: null,
                  priceCents: 7_500,
                  status: 'ACTIVE',
                  clientSelectable: true,
                  linkedServiceId: null,
                },
              ]
            : [],
        internalNotes:
          i === 0
            ? 'Standard service for individual and family returns. Promote during tax season.'
            : null,
        createdAt: ago(200),
        version: 'v1',
      }));
  const s: Store = { services, categories, packages: [], promotions: [], next: 100 };
  if (!empty) {
    s.packages.push(
      buildPackage(s, {
        id: uuid('0f00', 1),
        name: 'Small Business Tax Bundle',
        categoryIndex: 0,
        short: 'Essential tax and compliance services for new and growing businesses.',
        services: [
          [uuid('0a00', 2), true],
          [uuid('0a00', 3), true],
          [uuid('0a00', 7), true],
          [uuid('0a00', 6), false],
          [uuid('0a00', 5), false],
        ],
        priceCents: 49_900,
        discountType: 'PERCENTAGE',
        discountValue: 2_000,
      }),
    );
    s.promotions.push(
      {
        id: uuid('0b00', 1),
        name: 'Early Bird Tax Season',
        discountType: 'PERCENTAGE',
        value: 1_000,
        appliesTo: 'CATEGORIES',
        targetIds: [uuid('0c00', 1)],
        startsOn: ago(10).slice(0, 10),
        endsOn: ago(-60).slice(0, 10),
        eligibility: 'ALL_CLIENTS',
        promoCode: 'EARLY10',
        stackable: false,
        status: 'ACTIVE',
        usageCount: 14,
        updatedAt: ago(10),
      },
      {
        id: uuid('0b00', 2),
        name: 'New Client Welcome',
        discountType: 'FIXED',
        value: 2_500,
        appliesTo: 'ALL',
        targetIds: [],
        startsOn: null,
        endsOn: null,
        eligibility: 'NEW_CLIENTS',
        promoCode: null,
        stackable: false,
        status: 'ACTIVE',
        usageCount: 31,
        updatedAt: ago(40),
      },
      {
        id: uuid('0b00', 3),
        name: 'Payroll Switch Offer',
        discountType: 'PERCENTAGE',
        value: 1_500,
        appliesTo: 'SERVICES',
        targetIds: [uuid('0a00', 6)],
        startsOn: ago(30).slice(0, 10),
        endsOn: ago(-30).slice(0, 10),
        eligibility: 'NEW_CLIENTS',
        promoCode: 'PAYROLL15',
        stackable: false,
        status: 'ACTIVE',
        usageCount: 6,
        updatedAt: ago(30),
      },
    );
  }
  recount(s);
  return s;
}

function recount(s: Store) {
  for (const c of s.categories)
    c.serviceCount = s.services.filter(
      (x) => x.category?.id === c.id && x.status !== 'ARCHIVED',
    ).length;
}

function pricing(
  s: Store,
  input: {
    services: { serviceId: string; included: boolean }[];
    packagePriceCents: number | null;
    discountType: PackagePricing['discountType'];
    discountValue: number | null;
  },
): PackagePricing {
  const included = input.services
    .filter((x) => x.included)
    .map((x) => s.services.find((sv) => sv.id === x.serviceId));
  // As the API (catalog.shared.ts `packagePricing`): a quote-required service leaves the total
  // unknown, never $0, and with it a price worked out from a discount and the savings.
  const variablePrice = included.some(
    (sv) => !sv || (sv.price.type !== 'FIXED' && sv.price.type !== 'RECURRING'),
  );
  const quoteRequired = included.some((sv) => sv?.price.type === 'CUSTOM_QUOTE');
  const total = included.some((sv) => !sv || sv.totalPriceCents === null)
    ? null
    : included.reduce((sum, sv) => sum + (sv?.totalPriceCents ?? 0), 0);
  let price = input.packagePriceCents;
  if (price === null && input.discountType !== 'NONE' && input.discountValue !== null) {
    if (total !== null)
      price =
        input.discountType === 'PERCENTAGE'
          ? Math.round(total * (1 - input.discountValue / 10_000))
          : total - input.discountValue;
  }
  if (price !== null && price < 0)
    throw fail(400, 'INVALID_DISCOUNT', 'The discount is more than the services cost');
  const known = price !== null && total !== null && !variablePrice && included.length > 0;
  const savings = known ? Math.max(0, (total ?? 0) - (price ?? 0)) : null;
  return {
    totalSelectedCents: total,
    packagePriceCents: price,
    discountType: input.discountType,
    discountValue: input.discountType === 'NONE' ? null : input.discountValue,
    savingsCents: savings,
    savingsPercent: savings !== null && total ? Math.round((savings / total) * 10_000) / 100 : null,
    variablePrice,
    quoteRequired,
  };
}

function buildPackage(
  s: Store,
  p: {
    id: string;
    name: string;
    categoryIndex: number;
    short: string;
    services: [string, boolean][];
    priceCents: number;
    discountType: PackagePricing['discountType'];
    discountValue: number | null;
  },
): ServicePackage {
  const c = s.categories[p.categoryIndex];
  const items = p.services.map(([serviceId, included]) => ({ serviceId, included }));
  const priced = pricing(s, {
    services: items,
    packagePriceCents: p.priceCents,
    discountType: p.discountType,
    discountValue: p.discountValue,
  });
  return {
    id: p.id,
    name: p.name,
    shortDescription: p.short,
    icon: 'briefcase',
    category: c ? { id: c.id, name: c.name, tone: c.tone } : null,
    status: 'ACTIVE',
    serviceCount: items.filter((x) => x.included).length,
    packagePriceCents: priced.packagePriceCents,
    savingsCents: priced.savingsCents,
    updatedAt: ago(3),
    services: items.map(({ serviceId, included }) => {
      const sv = s.services.find((x) => x.id === serviceId);
      return {
        serviceId,
        name: sv?.name ?? 'Service',
        icon: sv?.icon ?? null,
        category: sv?.category ?? null,
        individualPriceCents: sv?.totalPriceCents ?? null,
        pricingType: sv?.price.type ?? 'FIXED',
        included,
        inactive: sv?.status !== 'ACTIVE',
      };
    }),
    pricing: priced,
    addOns: [
      {
        id: uuid('0e10', 1),
        name: 'Audit Representation',
        description: 'Professional representation in the event of an audit.',
        priceCents: 25_000,
        offered: true,
        linkedServiceId: uuid('0a00', 9),
      },
      {
        id: uuid('0e10', 2),
        name: 'Year-Round Support',
        description: 'Ongoing support for tax questions and notices.',
        priceCents: 15_000,
        offered: true,
        linkedServiceId: null,
      },
      {
        id: uuid('0e10', 3),
        name: 'Business Entity Formation',
        description: 'Help with LLC, S-Corp or other entity setup.',
        priceCents: 35_000,
        offered: false,
        linkedServiceId: uuid('0a00', 10),
      },
    ],
    visibleToClients: true,
    allowClientAddOns: true,
    displayOnWebsite: true,
    internalNotes: 'Targeted for new business clients.',
    version: 'v1',
  };
}

let stores: Map<string, Store> | undefined;
function storeFor(options: Options): Store {
  stores ??= new Map();
  const key = options.empty ? 'empty' : 'full';
  let s = stores.get(key);
  if (!s) {
    s = seed(options.empty ?? false);
    stores.set(key, s);
  }
  return s;
}

const toRow = (sv: CatalogService): CatalogServiceRow => ({
  id: sv.id,
  name: sv.name,
  shortDescription: sv.shortDescription,
  icon: sv.icon,
  category: sv.category,
  price: sv.price,
  status: sv.status,
  updatedAt: sv.updatedAt,
  updatedBy: sv.updatedBy,
});

/** `api.servicesPricing` in mock mode. */
export function createServicesPricingMock(options: Options = {}): ServicesPricingClient {
  const role = options.role ?? 'OWNER';
  const s = storeFor(options);
  const manage = () => {
    if (role === 'STAFF') throw fail(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const svc = (id: string) => {
    const x = s.services.find((v) => v.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  const cat = (id: string) => {
    const x = s.categories.find((v) => v.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  const pkg = (id: string) => {
    const x = s.packages.find((v) => v.id === id);
    if (!x) throw fail(404, 'NOT_FOUND', 'Not found');
    return x;
  };
  const touch = <T extends { updatedAt: string; version?: string }>(x: T) => {
    x.updatedAt = new Date().toISOString();
    if (x.version) x.version = `v${Number(x.version.slice(1)) + 1}`;
  };
  const uniqueName = (name: string, self?: string, allow?: boolean) => {
    if (
      !allow &&
      s.services.some((x) => x.id !== self && x.name.toLowerCase() === name.toLowerCase())
    ) {
      throw fail(409, 'DUPLICATE_NAME', 'A service with this name already exists');
    }
  };
  const activeCategory = (id: string) => {
    const c = cat(id);
    if (c.status !== 'ACTIVE') throw fail(409, 'CATEGORY_INACTIVE', 'Choose an active category');
    return { id: c.id, name: c.name, tone: c.tone };
  };
  const checkActivation = (sv: CatalogService) => {
    if (sv.price.type !== 'CUSTOM_QUOTE' && sv.basePriceCents === null)
      throw fail(400, 'ACTIVATION_INCOMPLETE', 'Enter the base price');
    if (!sv.shortDescription)
      throw fail(400, 'ACTIVATION_INCOMPLETE', 'Enter the short description');
  };
  const applyService = (
    sv: CatalogService,
    input: Partial<UpdateCatalogServiceRequest> & Record<string, unknown>,
  ) => {
    if (input.name !== undefined) sv.name = input.name;
    if (input.categoryId !== undefined) sv.category = activeCategory(input.categoryId);
    if (input.shortDescription !== undefined) sv.shortDescription = input.shortDescription;
    if (input.icon !== undefined) sv.icon = input.icon;
    if (input.kind !== undefined) sv.kind = input.kind;
    if (input.pricingType !== undefined) sv.price.type = input.pricingType;
    if (input.basePriceCents !== undefined) sv.basePriceCents = input.basePriceCents;
    if (input.billingFrequency !== undefined) sv.billingFrequency = input.billingFrequency;
    if (input.taxable !== undefined) sv.taxable = input.taxable;
    if (input.requireClientApproval !== undefined)
      sv.requireClientApproval = input.requireClientApproval;
    if (input.fullDescription !== undefined) sv.fullDescription = input.fullDescription;
    if (input.included !== undefined) sv.included = input.included;
    if (input.notIncluded !== undefined) sv.notIncluded = input.notIncluded;
    if (input.internalNotes !== undefined) sv.internalNotes = input.internalNotes;
    if (input.lineItemsMode !== undefined) sv.lineItemsMode = input.lineItemsMode;
    if (input.lineItems !== undefined) {
      sv.lineItems = input.lineItems.map((li) => {
        const quantity = li.quantity ?? 1;
        return {
          id: li.id ?? uuid('0d00', s.next++),
          name: li.name,
          description: li.description ?? null,
          quantity,
          rateCents: li.rateCents,
          totalCents: Math.round(quantity * li.rateCents),
        };
      });
    }
    if (input.addOns !== undefined) {
      sv.addOns = input.addOns.map((a) => ({
        id: a.id ?? uuid('0e00', s.next++),
        name: a.name,
        description: a.description ?? null,
        priceCents: a.priceCents,
        status: a.status ?? 'ACTIVE',
        clientSelectable: a.clientSelectable ?? true,
        linkedServiceId: a.linkedServiceId ?? null,
      }));
    }
    // As the API (`serviceTotalCents`): ADDITIVE line items add to the base price (S6).
    sv.totalPriceCents =
      sv.price.type === 'CUSTOM_QUOTE'
        ? null
        : sv.lineItemsMode === 'ADDITIVE' && sv.lineItems.length
          ? (sv.basePriceCents ?? 0) + sv.lineItems.reduce((n, li) => n + li.totalCents, 0)
          : sv.basePriceCents;
    sv.price.amountCents = sv.totalPriceCents;
    sv.price.frequency = sv.billingFrequency;
    sv.updatedBy = 'You';
  };
  const usedBy = (id: string) =>
    s.packages.filter((p) => p.services.some((x) => x.serviceId === id));
  const savePackage = (p: ServicePackage, input: Partial<UpdateServicePackageRequest>) => {
    if (input.name !== undefined) p.name = input.name;
    if (input.categoryId !== undefined) p.category = activeCategory(input.categoryId);
    if (input.shortDescription !== undefined) p.shortDescription = input.shortDescription;
    if (input.icon !== undefined) p.icon = input.icon;
    if (input.services !== undefined) {
      p.services = input.services.map(({ serviceId, included }) => {
        const sv = svc(serviceId);
        return {
          serviceId,
          name: sv.name,
          icon: sv.icon,
          category: sv.category,
          individualPriceCents: sv.totalPriceCents,
          pricingType: sv.price.type,
          included: included ?? true,
          inactive: sv.status !== 'ACTIVE',
        };
      });
    }
    if (input.addOns !== undefined) {
      p.addOns = input.addOns.map((a) => ({
        id: a.id ?? uuid('0e10', s.next++),
        name: a.name,
        description: a.description ?? null,
        priceCents: a.priceCents,
        offered: a.offered ?? true,
        linkedServiceId: a.linkedServiceId ?? null,
      }));
    }
    for (const k of ['visibleToClients', 'allowClientAddOns', 'displayOnWebsite'] as const)
      if (input[k] !== undefined) p[k] = input[k];
    if (input.internalNotes !== undefined) p.internalNotes = input.internalNotes;
    p.pricing = pricing(s, {
      services: p.services.map((x) => ({ serviceId: x.serviceId, included: x.included })),
      packagePriceCents:
        input.packagePriceCents !== undefined
          ? input.packagePriceCents
          : p.pricing.packagePriceCents,
      discountType: input.discountType ?? p.pricing.discountType,
      discountValue:
        input.discountValue !== undefined ? input.discountValue : p.pricing.discountValue,
    });
    p.packagePriceCents = p.pricing.packagePriceCents;
    p.savingsCents = p.pricing.savingsCents;
    p.serviceCount = p.services.filter((x) => x.included).length;
  };

  return {
    summary: async () => {
      await mockDelay();
      return {
        total: s.services.filter((x) => x.status !== 'ARCHIVED').length,
        active: s.services.filter((x) => x.status === 'ACTIVE').length,
        inactive: s.services.filter((x) => x.status === 'INACTIVE').length,
        draft: s.services.filter((x) => x.status === 'DRAFT').length,
        categories: s.categories.filter((c) => c.status === 'ACTIVE').length,
        activePromotions: s.promotions.filter((p) => p.status === 'ACTIVE').length,
        packages: s.packages.filter((p) => p.status !== 'ARCHIVED').length,
      };
    },

    services: async (query = {}) => {
      await mockDelay();
      const q = parseInput(CatalogServicesQuery, query);
      const search = q.search?.toLowerCase() ?? '';
      const key = (x: CatalogService): string | number =>
        q.sort === 'category'
          ? (x.category?.name ?? '')
          : q.sort === 'price'
            ? (x.basePriceCents ?? -1)
            : q.sort === 'status'
              ? x.status
              : q.sort === 'updated'
                ? x.updatedAt
                : x.name;
      const rows = s.services
        .filter((x) => q.status === 'all' || x.status === q.status.toUpperCase())
        .filter(
          (x) =>
            !search ||
            [x.name, x.shortDescription ?? '', x.category?.name ?? ''].some((t) =>
              t.toLowerCase().includes(search),
            ),
        )
        .filter((x) => !q.categoryId || x.category?.id === q.categoryId)
        .filter((x) => !q.pricingType || x.price.type === q.pricingType)
        .sort((a, b) => {
          const [ka, kb] = [key(a), key(b)];
          const order = ka < kb ? -1 : ka > kb ? 1 : 0;
          return q.direction === 'desc' ? -order : order;
        })
        .map(toRow);
      const start = (q.page - 1) * q.pageSize;
      return {
        items: copy(rows.slice(start, start + q.pageSize)),
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
      };
    },
    service: async (id) => {
      await mockDelay();
      const sv = svc(id);
      return copy(role === 'STAFF' ? { ...sv, internalNotes: null } : sv);
    },
    createService: async (body) => {
      await mockDelay();
      manage();
      const input = parseInput(CreateCatalogServiceRequest, body);
      uniqueName(input.name, undefined, input.allowDuplicateName);
      const at = new Date().toISOString();
      const sv: CatalogService = {
        id: uuid('0a00', s.next++),
        name: input.name,
        shortDescription: input.shortDescription,
        icon: input.icon ?? null,
        category: activeCategory(input.categoryId),
        price: { type: input.pricingType, amountCents: null, frequency: null },
        status: 'DRAFT',
        updatedAt: at,
        updatedBy: 'You',
        kind: input.kind ?? 'OTHER',
        fullDescription: null,
        basePriceCents: null,
        billingFrequency: null,
        taxable: false,
        requireClientApproval: false,
        included: [],
        notIncluded: [],
        lineItems: [],
        lineItemsMode: 'INCLUDED',
        totalPriceCents: null,
        addOns: [],
        internalNotes: null,
        createdAt: at,
        version: 'v1',
      };
      applyService(sv, input);
      if (input.activate) {
        checkActivation(sv);
        sv.status = 'ACTIVE';
      }
      s.services.push(sv);
      recount(s);
      return copy(sv);
    },
    updateService: async (id, body) => {
      await mockDelay();
      manage();
      const input = parseInput(UpdateCatalogServiceRequest, body);
      const sv = svc(id);
      if (input.version !== sv.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this service first');
      if (input.name) uniqueName(input.name, id, input.allowDuplicateName);
      applyService(sv, input);
      if (sv.status === 'ACTIVE') checkActivation(sv);
      touch(sv);
      recount(s);
      return copy(sv);
    },
    duplicateService: async (id) => {
      await mockDelay();
      manage();
      const sv = svc(id);
      const d: CatalogService = {
        ...copy(sv),
        id: uuid('0a00', s.next++),
        name: `${sv.name} (Copy)`,
        status: 'DRAFT',
        version: 'v1',
        createdAt: new Date().toISOString(),
      };
      touch(d);
      s.services.push(d);
      recount(s);
      return copy(d);
    },
    activateService: async (id) => {
      await mockDelay();
      manage();
      const sv = svc(id);
      checkActivation(sv);
      sv.status = 'ACTIVE';
      touch(sv);
      return copy(sv);
    },
    deactivateService: async (id) => {
      await mockDelay();
      manage();
      const sv = svc(id);
      sv.status = 'INACTIVE';
      for (const p of usedBy(id))
        for (const x of p.services) if (x.serviceId === id) x.inactive = true;
      touch(sv);
      return copy(sv);
    },
    archiveService: async (id) => {
      await mockDelay();
      manage();
      const sv = svc(id);
      sv.status = 'ARCHIVED';
      touch(sv);
      recount(s);
      return copy(sv);
    },
    deleteService: async (id) => {
      await mockDelay();
      manage();
      const sv = svc(id);
      if (usedBy(id).length || sv.status !== 'DRAFT')
        throw fail(409, 'IN_USE', 'This service is in use: archive it instead');
      s.services = s.services.filter((x) => x.id !== id);
      recount(s);
      return { ok: true };
    },
    usage: async (id) => {
      await mockDelay();
      const sv = svc(id);
      const packages = usedBy(id).map((p) => ({ id: p.id, name: p.name, status: p.status }));
      const engagements = sv.status === 'ACTIVE' ? 3 : 0;
      return {
        packages,
        activeEngagements: engagements,
        openInvoices: engagements ? 1 : 0,
        appointmentTypes: 0,
        automations: 0,
        deletable: packages.length === 0 && sv.status === 'DRAFT',
      };
    },

    categories: async () => {
      await mockDelay();
      recount(s);
      return copy([...s.categories].sort((a, b) => a.sortOrder - b.sortOrder));
    },
    createCategory: async (body) => {
      await mockDelay();
      manage();
      const input = parseInput(SaveServiceCategoryRequest, body);
      if (s.categories.some((c) => c.name.toLowerCase() === input.name.toLowerCase()))
        throw fail(409, 'DUPLICATE_NAME', 'A category with this name exists');
      const c: ServiceCategory = {
        id: uuid('0c00', s.next++),
        name: input.name,
        tone: input.tone ?? null,
        description: input.description ?? null,
        icon: input.icon ?? null,
        sortOrder: s.categories.length,
        status: input.status ?? 'ACTIVE',
        serviceCount: 0,
      };
      s.categories.push(c);
      return copy(c);
    },
    updateCategory: async (id, body) => {
      await mockDelay();
      manage();
      const input = parseInput(SaveServiceCategoryRequest, body);
      const c = cat(id);
      Object.assign(c, {
        name: input.name,
        description: input.description ?? null,
        icon: input.icon ?? c.icon,
        tone: input.tone ?? c.tone,
        status: input.status ?? c.status,
      });
      for (const sv of s.services)
        if (sv.category?.id === id) sv.category = { id, name: c.name, tone: c.tone };
      return copy(c);
    },
    reorderCategories: async (body) => {
      await mockDelay();
      manage();
      const { ids } = parseInput(ReorderCategoriesRequest, body);
      ids.forEach((id, i) => {
        cat(id).sortOrder = i;
      });
      return copy([...s.categories].sort((a, b) => a.sortOrder - b.sortOrder));
    },
    mergeCategory: async (id, body) => {
      await mockDelay();
      manage();
      const { intoId } = parseInput(MergeCategoryRequest, body);
      const from = cat(id);
      const into = cat(intoId);
      for (const sv of s.services)
        if (sv.category?.id === id) sv.category = { id: into.id, name: into.name, tone: into.tone };
      from.status = 'INACTIVE';
      recount(s);
      return copy(into);
    },
    deleteCategory: async (id) => {
      await mockDelay();
      manage();
      cat(id);
      if (s.services.some((sv) => sv.category?.id === id))
        throw fail(409, 'IN_USE', 'Move or merge its services first');
      s.categories = s.categories.filter((c) => c.id !== id);
      return { ok: true };
    },

    packages: async () => {
      await mockDelay();
      return s.packages.map(
        ({
          services: _s,
          pricing: _p,
          addOns: _a,
          visibleToClients: _v,
          allowClientAddOns: _c,
          displayOnWebsite: _d,
          internalNotes: _n,
          version: _ver,
          ...row
        }) => copy(row),
      );
    },
    package: async (id) => {
      await mockDelay();
      return copy(pkg(id));
    },
    createPackage: async (body) => {
      await mockDelay();
      manage();
      const input = parseInput(CreateServicePackageRequest, body);
      const p: ServicePackage = {
        id: uuid('0f00', s.next++),
        name: input.name,
        shortDescription: input.shortDescription,
        icon: null,
        category: activeCategory(input.categoryId),
        status: 'DRAFT',
        serviceCount: 0,
        packagePriceCents: null,
        savingsCents: null,
        updatedAt: new Date().toISOString(),
        services: [],
        pricing: {
          totalSelectedCents: 0,
          packagePriceCents: null,
          discountType: 'NONE',
          discountValue: null,
          savingsCents: null,
          savingsPercent: null,
          variablePrice: false,
          quoteRequired: false,
        },
        addOns: [],
        visibleToClients: false,
        allowClientAddOns: false,
        displayOnWebsite: false,
        internalNotes: null,
        version: 'v1',
      };
      savePackage(p, input);
      if (input.activate) {
        if (p.services.some((x) => x.inactive))
          throw fail(
            409,
            'PACKAGE_HAS_INACTIVE_SERVICE',
            'Replace or remove the inactive service first',
          );
        if (p.packagePriceCents === null)
          throw fail(400, 'ACTIVATION_INCOMPLETE', 'Enter the package price');
        p.status = 'ACTIVE';
      }
      s.packages.push(p);
      return copy(p);
    },
    updatePackage: async (id, body) => {
      await mockDelay();
      manage();
      const input = parseInput(UpdateServicePackageRequest, body);
      const p = pkg(id);
      if (input.version !== p.version)
        throw fail(409, 'SAVE_CONFLICT', 'Someone saved this package first');
      savePackage(p, input);
      touch(p);
      return copy(p);
    },
    packagePricing: async (body) => {
      await mockDelay();
      return pricing(s, parseInput(PackagePricingRequest, body));
    },
    activatePackage: async (id) => {
      await mockDelay();
      manage();
      const p = pkg(id);
      if (p.services.some((x) => x.included && x.inactive))
        throw fail(
          409,
          'PACKAGE_HAS_INACTIVE_SERVICE',
          'Replace or remove the inactive service first',
        );
      if (p.packagePriceCents === null)
        throw fail(400, 'ACTIVATION_INCOMPLETE', 'Enter the package price');
      p.status = 'ACTIVE';
      touch(p);
      return copy(p);
    },
    deactivatePackage: async (id) => {
      await mockDelay();
      manage();
      const p = pkg(id);
      p.status = 'INACTIVE';
      touch(p);
      return copy(p);
    },
    duplicatePackage: async (id) => {
      await mockDelay();
      manage();
      const p = pkg(id);
      const d: ServicePackage = {
        ...copy(p),
        id: uuid('0f00', s.next++),
        name: `${p.name} (Copy)`,
        status: 'DRAFT',
        version: 'v1',
      };
      touch(d);
      s.packages.push(d);
      return copy(d);
    },
    archivePackage: async (id) => {
      await mockDelay();
      manage();
      const p = pkg(id);
      p.status = 'ARCHIVED';
      touch(p);
      return copy(p);
    },

    promotions: async () => {
      await mockDelay();
      return copy(s.promotions);
    },
    createPromotion: async (body) => {
      await mockDelay();
      manage();
      const input = parseInput(SavePromotionRequest, body);
      if (input.promoCode && s.promotions.some((p) => p.promoCode === input.promoCode))
        throw fail(409, 'PROMOTION_CONFLICT', 'This code is already used');
      const today = new Date().toISOString().slice(0, 10);
      const p: Promotion = {
        id: uuid('0b00', s.next++),
        name: input.name,
        discountType: input.discountType,
        value: input.value,
        appliesTo: input.appliesTo,
        targetIds: input.targetIds,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        eligibility: input.eligibility,
        promoCode: input.promoCode ?? null,
        stackable: input.stackable,
        status: !input.activate
          ? 'DRAFT'
          : input.startsOn && input.startsOn > today
            ? 'SCHEDULED'
            : 'ACTIVE',
        usageCount: 0,
        updatedAt: new Date().toISOString(),
      };
      s.promotions.push(p);
      return copy(p);
    },
    updatePromotion: async (id, body) => {
      await mockDelay();
      manage();
      const input = parseInput(SavePromotionRequest, body);
      const p = s.promotions.find((x) => x.id === id);
      if (!p) throw fail(404, 'NOT_FOUND', 'Not found');
      Object.assign(p, {
        name: input.name,
        discountType: input.discountType,
        value: input.value,
        appliesTo: input.appliesTo,
        targetIds: input.targetIds,
        startsOn: input.startsOn ?? null,
        endsOn: input.endsOn ?? null,
        eligibility: input.eligibility,
        promoCode: input.promoCode ?? null,
        stackable: input.stackable,
        status: input.activate ? 'ACTIVE' : p.status,
        updatedAt: new Date().toISOString(),
      });
      return copy(p);
    },
    endPromotion: async (id) => {
      await mockDelay();
      manage();
      const p = s.promotions.find((x) => x.id === id);
      if (!p) throw fail(404, 'NOT_FOUND', 'Not found');
      p.status = 'EXPIRED';
      p.endsOn = new Date().toISOString().slice(0, 10);
      p.updatedAt = new Date().toISOString();
      return copy(p);
    },
  };
}
