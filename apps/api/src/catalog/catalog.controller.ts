import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  type CatalogService,
  CatalogServiceId,
  type CatalogServicePage,
  CatalogServicesQuery,
  type CatalogSummary,
  CreateCatalogServiceRequest,
  CreateServicePackageRequest,
  MergeCategoryRequest,
  type OkResponse,
  type PackagePricing,
  PackagePricingRequest,
  type Promotion,
  PromotionId,
  type PromotionList,
  ReorderCategoriesRequest,
  SavePromotionRequest,
  SaveServiceCategoryRequest,
  type ServiceCategory,
  ServiceCategoryId,
  type ServiceCategoryList,
  type ServicePackage,
  ServicePackageId,
  type ServicePackageList,
  type ServiceUsage,
  UpdateCatalogServiceRequest,
  UpdateServicePackageRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CatalogCategoriesService } from './catalog-categories.service.js';
import { CatalogPackagesService } from './catalog-packages.service.js';
import { CatalogPromotionsService } from './catalog-promotions.service.js';
import { CatalogServicesService } from './catalog-services.service.js';

const OK: OkResponse = { ok: true };
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const serviceId = pipe(CatalogServiceId);
const categoryId = pipe(ServiceCategoryId);
const packageId = pipe(ServicePackageId);
const promotionId = pipe(PromotionId);

/**
 * The firm's Services & Pricing catalog (contract in packages/types/src/services-pricing). Everyone
 * with the permission grid's SERVICES_PRICING view reads; Owner and Admin change. The firm comes
 * from TenantGuard, never from the request.
 */
@Controller('business/catalog')
@Access('SERVICES_PRICING')
@Roles(...FIRM_STAFF)
export class CatalogSummaryController {
  constructor(private readonly services: CatalogServicesService) {}

  @Get('summary')
  summary(@CurrentTenant() tenant: TenantContext): Promise<CatalogSummary> {
    return this.services.summary(tenant.businessId);
  }
}

@Controller('business/catalog/services')
@Access('SERVICES_PRICING')
@Roles(...FIRM_STAFF)
export class CatalogServicesController {
  constructor(private readonly services: CatalogServicesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(pipe(CatalogServicesQuery)) q: z.output<typeof CatalogServicesQuery>,
  ): Promise<CatalogServicePage> {
    return this.services.list(tenant.businessId, q);
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(CreateCatalogServiceRequest)) body: z.output<typeof CreateCatalogServiceRequest>,
  ): Promise<CatalogService> {
    return this.services.create(tenant.businessId, auth.userId, body);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<CatalogService> {
    return this.services.get(tenant.businessId, id);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
    @Body(pipe(UpdateCatalogServiceRequest)) body: z.output<typeof UpdateCatalogServiceRequest>,
  ): Promise<CatalogService> {
    return this.services.update(tenant.businessId, auth.userId, id, body);
  }

  @Post(':id/duplicate')
  @Roles(...FIRM_MANAGERS)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<CatalogService> {
    return this.services.duplicate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/activate')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<CatalogService> {
    return this.services.activate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/deactivate')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<CatalogService> {
    return this.services.deactivate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<CatalogService> {
    return this.services.archive(tenant.businessId, auth.userId, id);
  }

  @Delete(':id')
  @Roles(...FIRM_MANAGERS)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<OkResponse> {
    await this.services.remove(tenant.businessId, id);
    return OK;
  }

  @Get(':id/usage')
  usage(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', serviceId) id: string,
  ): Promise<ServiceUsage> {
    return this.services.usage(tenant.businessId, id);
  }
}

@Controller('business/catalog/categories')
@Access('SERVICES_PRICING')
@Roles(...FIRM_STAFF)
export class CatalogCategoriesController {
  constructor(private readonly categories: CatalogCategoriesService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<ServiceCategoryList> {
    return { items: await this.categories.list(tenant.businessId) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(SaveServiceCategoryRequest)) body: z.output<typeof SaveServiceCategoryRequest>,
  ): Promise<ServiceCategory> {
    return this.categories.create(tenant.businessId, body);
  }

  // Before ':id', which would take "order" for an id.
  @Put('order')
  @Roles(...FIRM_MANAGERS)
  async reorder(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(ReorderCategoriesRequest)) body: z.output<typeof ReorderCategoriesRequest>,
  ): Promise<ServiceCategoryList> {
    return { items: await this.categories.reorder(tenant.businessId, body) };
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryId) id: string,
    @Body(pipe(SaveServiceCategoryRequest)) body: z.output<typeof SaveServiceCategoryRequest>,
  ): Promise<ServiceCategory> {
    return this.categories.update(tenant.businessId, id, body);
  }

  @Post(':id/merge')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  merge(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryId) id: string,
    @Body(pipe(MergeCategoryRequest)) body: z.output<typeof MergeCategoryRequest>,
  ): Promise<ServiceCategory> {
    return this.categories.merge(tenant.businessId, id, body);
  }

  @Delete(':id')
  @Roles(...FIRM_MANAGERS)
  async remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', categoryId) id: string,
  ): Promise<OkResponse> {
    await this.categories.remove(tenant.businessId, id);
    return OK;
  }
}

@Controller('business/catalog/packages')
@Access('SERVICES_PRICING')
@Roles(...FIRM_STAFF)
export class CatalogPackagesController {
  constructor(private readonly packages: CatalogPackagesService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<ServicePackageList> {
    return { items: await this.packages.list(tenant.businessId) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(CreateServicePackageRequest)) body: z.output<typeof CreateServicePackageRequest>,
  ): Promise<ServicePackage> {
    return this.packages.create(tenant.businessId, auth.userId, body);
  }

  // A calculation, not a change: it saves nothing, so a read-only member may use the panel too.
  @Post('pricing')
  @HttpCode(200)
  pricing(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(PackagePricingRequest)) body: z.output<typeof PackagePricingRequest>,
  ): Promise<PackagePricing> {
    return this.packages.pricing(tenant.businessId, body);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
  ): Promise<ServicePackage> {
    return this.packages.get(tenant.businessId, id);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
    @Body(pipe(UpdateServicePackageRequest)) body: z.output<typeof UpdateServicePackageRequest>,
  ): Promise<ServicePackage> {
    return this.packages.update(tenant.businessId, auth.userId, id, body);
  }

  @Post(':id/activate')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  activate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
  ): Promise<ServicePackage> {
    return this.packages.activate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/deactivate')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
  ): Promise<ServicePackage> {
    return this.packages.deactivate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/duplicate')
  @Roles(...FIRM_MANAGERS)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
  ): Promise<ServicePackage> {
    return this.packages.duplicate(tenant.businessId, auth.userId, id);
  }

  @Post(':id/archive')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', packageId) id: string,
  ): Promise<ServicePackage> {
    return this.packages.archive(tenant.businessId, auth.userId, id);
  }
}

@Controller('business/catalog/promotions')
@Access('SERVICES_PRICING')
@Roles(...FIRM_STAFF)
export class CatalogPromotionsController {
  constructor(private readonly promotions: CatalogPromotionsService) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<PromotionList> {
    return { items: await this.promotions.list(tenant.businessId) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentTenant() tenant: TenantContext,
    @Body(pipe(SavePromotionRequest)) body: z.output<typeof SavePromotionRequest>,
  ): Promise<Promotion> {
    return this.promotions.create(tenant.businessId, body);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', promotionId) id: string,
    @Body(pipe(SavePromotionRequest)) body: z.output<typeof SavePromotionRequest>,
  ): Promise<Promotion> {
    return this.promotions.update(tenant.businessId, id, body);
  }

  @Post(':id/end')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  end(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', promotionId) id: string,
  ): Promise<Promotion> {
    return this.promotions.end(tenant.businessId, id);
  }
}
