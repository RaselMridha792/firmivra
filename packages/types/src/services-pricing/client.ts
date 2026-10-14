import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  CatalogService,
  CatalogServiceId,
  CatalogServicePage,
  CatalogServicesQuery,
  CatalogSummary,
  CreateCatalogServiceRequest,
  CreateServicePackageRequest,
  MergeCategoryRequest,
  PackagePricing,
  PackagePricingRequest,
  Promotion,
  PromotionId,
  PromotionList,
  ReorderCategoriesRequest,
  SavePromotionRequest,
  SaveServiceCategoryRequest,
  ServiceCategory,
  ServiceCategoryId,
  ServiceCategoryList,
  ServicePackage,
  ServicePackageId,
  ServicePackageList,
  ServiceUsage,
  UpdateCatalogServiceRequest,
  UpdateServicePackageRequest,
} from './schemas.js';

const BASE = '/business/catalog';
const service = (id: string) => `${BASE}/services/${parseInput(CatalogServiceId, id)}`;
const category = (id: string) => `${BASE}/categories/${parseInput(ServiceCategoryId, id)}`;
const pkg = (id: string) => `${BASE}/packages/${parseInput(ServicePackageId, id)}`;
const promotion = (id: string) => `${BASE}/promotions/${parseInput(PromotionId, id)}`;
const post = (body?: unknown) => ({ method: 'POST', ...(body === undefined ? {} : { body }) });

/**
 * `api.servicesPricing` (apps/web/src/lib/api.ts): the firm's catalog. Everyone with the grid's
 * SERVICES_PRICING view reads; changes need Create, Edit or Manage (403 FORBIDDEN). Bad input
 * rejects with ApiRequestError(400, 'VALIDATION_FAILED') before anything is sent. No business id
 * is ever sent.
 */
export function createServicesPricingClient(request: ApiRequest) {
  return {
    summary: async (): Promise<CatalogSummary> => request(CatalogSummary, `${BASE}/summary`),

    // Services
    services: async (query: CatalogServicesQuery = {}): Promise<CatalogServicePage> =>
      request(
        CatalogServicePage,
        `${BASE}/services${toQuery(parseInput(CatalogServicesQuery, query))}`,
      ),
    service: async (id: string): Promise<CatalogService> => request(CatalogService, service(id)),
    createService: async (body: CreateCatalogServiceRequest): Promise<CatalogService> =>
      request(
        CatalogService,
        `${BASE}/services`,
        post(parseInput(CreateCatalogServiceRequest, body)),
      ),
    updateService: async (id: string, body: UpdateCatalogServiceRequest): Promise<CatalogService> =>
      request(CatalogService, service(id), {
        method: 'PATCH',
        body: parseInput(UpdateCatalogServiceRequest, body),
      }),
    /** A new DRAFT copy ("... (Copy)") with a new id. */
    duplicateService: async (id: string): Promise<CatalogService> =>
      request(CatalogService, `${service(id)}/duplicate`, post()),
    /** 400 ACTIVATION_INCOMPLETE when a required field is missing. */
    activateService: async (id: string): Promise<CatalogService> =>
      request(CatalogService, `${service(id)}/activate`, post()),
    deactivateService: async (id: string): Promise<CatalogService> =>
      request(CatalogService, `${service(id)}/deactivate`, post()),
    archiveService: async (id: string): Promise<CatalogService> =>
      request(CatalogService, `${service(id)}/archive`, post()),
    /** Only a service never used (409 IN_USE otherwise: archive it). */
    deleteService: async (id: string): Promise<OkResponse> =>
      request(OkResponse, service(id), { method: 'DELETE' }),
    usage: async (id: string): Promise<ServiceUsage> =>
      request(ServiceUsage, `${service(id)}/usage`),

    // Categories
    categories: async (): Promise<ServiceCategory[]> =>
      (await request(ServiceCategoryList, `${BASE}/categories`)).items,
    createCategory: async (body: SaveServiceCategoryRequest): Promise<ServiceCategory> =>
      request(
        ServiceCategory,
        `${BASE}/categories`,
        post(parseInput(SaveServiceCategoryRequest, body)),
      ),
    updateCategory: async (
      id: string,
      body: SaveServiceCategoryRequest,
    ): Promise<ServiceCategory> =>
      request(ServiceCategory, category(id), {
        method: 'PUT',
        body: parseInput(SaveServiceCategoryRequest, body),
      }),
    reorderCategories: async (body: ReorderCategoriesRequest): Promise<ServiceCategory[]> =>
      (
        await request(ServiceCategoryList, `${BASE}/categories/order`, {
          method: 'PUT',
          body: parseInput(ReorderCategoriesRequest, body),
        })
      ).items,
    mergeCategory: async (id: string, body: MergeCategoryRequest): Promise<ServiceCategory> =>
      request(
        ServiceCategory,
        `${category(id)}/merge`,
        post(parseInput(MergeCategoryRequest, body)),
      ),
    /** Only an unused category (409 IN_USE otherwise: merge or deactivate). */
    deleteCategory: async (id: string): Promise<OkResponse> =>
      request(OkResponse, category(id), { method: 'DELETE' }),

    // Packages
    packages: async (): Promise<ServicePackageList['items']> =>
      (await request(ServicePackageList, `${BASE}/packages`)).items,
    package: async (id: string): Promise<ServicePackage> => request(ServicePackage, pkg(id)),
    createPackage: async (body: CreateServicePackageRequest): Promise<ServicePackage> =>
      request(
        ServicePackage,
        `${BASE}/packages`,
        post(parseInput(CreateServicePackageRequest, body)),
      ),
    updatePackage: async (id: string, body: UpdateServicePackageRequest): Promise<ServicePackage> =>
      request(ServicePackage, pkg(id), {
        method: 'PATCH',
        body: parseInput(UpdateServicePackageRequest, body),
      }),
    /** The pricing panel for the form's unsaved values. */
    packagePricing: async (body: PackagePricingRequest): Promise<PackagePricing> =>
      request(
        PackagePricing,
        `${BASE}/packages/pricing`,
        post(parseInput(PackagePricingRequest, body)),
      ),
    /** 409 PACKAGE_HAS_INACTIVE_SERVICE; 400 ACTIVATION_INCOMPLETE. */
    activatePackage: async (id: string): Promise<ServicePackage> =>
      request(ServicePackage, `${pkg(id)}/activate`, post()),
    deactivatePackage: async (id: string): Promise<ServicePackage> =>
      request(ServicePackage, `${pkg(id)}/deactivate`, post()),
    duplicatePackage: async (id: string): Promise<ServicePackage> =>
      request(ServicePackage, `${pkg(id)}/duplicate`, post()),
    archivePackage: async (id: string): Promise<ServicePackage> =>
      request(ServicePackage, `${pkg(id)}/archive`, post()),

    // Discounts & Promotions
    promotions: async (): Promise<Promotion[]> =>
      (await request(PromotionList, `${BASE}/promotions`)).items,
    createPromotion: async (body: SavePromotionRequest): Promise<Promotion> =>
      request(Promotion, `${BASE}/promotions`, post(parseInput(SavePromotionRequest, body))),
    updatePromotion: async (id: string, body: SavePromotionRequest): Promise<Promotion> =>
      request(Promotion, promotion(id), {
        method: 'PUT',
        body: parseInput(SavePromotionRequest, body),
      }),
    /** End now: future use stops; completed transactions are untouched. */
    endPromotion: async (id: string): Promise<Promotion> =>
      request(Promotion, `${promotion(id)}/end`, post()),
  };
}
export type ServicesPricingClient = ReturnType<typeof createServicesPricingClient>;
