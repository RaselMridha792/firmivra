import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  Param,
  Patch,
  Post,
  Put,
  Query,
} from '@nestjs/common';
import { z } from 'zod';
import {
  ActivateAdminPlatformRequest,
  type AdminCatalogItem,
  AdminCatalogItemId,
  type AdminCatalogPreview,
  AdminConfirmAccessLoss,
  type AdminConnectionTestResult,
  type AdminFirmOption,
  type AdminIntegrationAccess,
  AdminIntegrationId,
  type AdminIntegrationSummary,
  type AdminPlanOption,
  type AdminPlatformIntegrationDetail,
  type AdminPlatformRun,
  type AdminProviderTemplate,
  CreateAdminCatalogRequest,
  CreateAdminPlatformRequest,
  DisableAdminPlatformRequest,
  ListAdminCatalogQuery,
  type ListAdminCatalogResponse,
  ListAdminFirmOptionsQuery,
  ListAdminPlatformQuery,
  type ListAdminPlatformResponse,
  ListAdminPlatformRunsQuery,
  type ListAdminPlatformRunsResponse,
  PutAdminCatalogFirmRequest,
  PutAdminCredentialsRequest,
  RemoveAdminPlatformRequest,
  UpdateAdminCatalogRequest,
  UpdateAdminPlatformRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { AdminIntegrationsOpsController } from './admin-integrations-ops.controller.js';
import { ApiAccessService } from './api-access.service.js';
import { IntegrationCatalogService } from './catalog.service.js';
import { IntegrationInsightsService } from './integration-insights.service.js';
import { IntegrationRunWorker } from './integration-run-worker.js';
import { createPlatformSecretStore, PLATFORM_SECRETS } from './platform-secrets.js';
import { PlatformIntegrationsService } from './platform-integrations.service.js';

const IntegrationId = new ZodValidationPipe(AdminIntegrationId);
const CatalogId = new ZodValidationPipe(AdminCatalogItemId);
const Uuid = new ZodValidationPipe(z.uuid());
const body = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);

/**
 * Super Admin Integrations, part 1 (contract: packages/types/src/admin-integrations; R0 stage B8):
 * the dashboard, Firmivra's platform integrations and the customer catalog. Static routes come
 * before `:id`. API keys, webhooks, logs, usage and the audit trail are part 2
 * (admin-integrations-ops.controller.ts).
 */
@Controller('admin/integrations')
@Roles('SUPER_ADMIN')
export class AdminIntegrationsController {
  constructor(
    private readonly platform: PlatformIntegrationsService,
    private readonly catalog: IntegrationCatalogService,
  ) {}

  // ---------- Dashboard and options ----------

  @Get('access')
  access(): AdminIntegrationAccess {
    return this.platform.access();
  }

  @Get('summary')
  summary(): Promise<AdminIntegrationSummary> {
    return this.platform.summary();
  }

  @Get('providers')
  providers(): AdminProviderTemplate[] {
    return this.platform.providers();
  }

  @Get('plans')
  plans(): Promise<AdminPlanOption[]> {
    return this.catalog.plans();
  }

  @Get('firm-options')
  firmOptions(
    @Query(body(ListAdminFirmOptionsQuery)) q: z.output<typeof ListAdminFirmOptionsQuery>,
  ): Promise<AdminFirmOption[]> {
    return this.catalog.firmOptions(q.search || undefined);
  }

  // ---------- Platform integrations ----------

  @Get('platform')
  listPlatform(
    @Query(body(ListAdminPlatformQuery)) q: z.output<typeof ListAdminPlatformQuery>,
  ): Promise<ListAdminPlatformResponse> {
    return this.platform.list(q);
  }

  @Post('platform')
  createPlatform(
    @Body(body(CreateAdminPlatformRequest)) b: z.output<typeof CreateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.create(b);
  }

  @Get('platform/:id')
  getPlatform(@Param('id', IntegrationId) id: string): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.get(id);
  }

  @Patch('platform/:id')
  updatePlatform(
    @Param('id', IntegrationId) id: string,
    @Body(body(UpdateAdminPlatformRequest)) b: z.output<typeof UpdateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.update(id, b);
  }

  @Put('platform/:id/credentials')
  putCredentials(
    @Param('id', IntegrationId) id: string,
    @Body(body(PutAdminCredentialsRequest)) b: z.output<typeof PutAdminCredentialsRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.putCredentials(id, b);
  }

  @Post('platform/:id/test')
  @HttpCode(200)
  testPlatform(@Param('id', IntegrationId) id: string): Promise<AdminConnectionTestResult> {
    return this.platform.test(id);
  }

  @Post('platform/:id/reconnect')
  @HttpCode(200)
  reconnectPlatform(@Param('id', IntegrationId) id: string): Promise<AdminConnectionTestResult> {
    return this.platform.reconnect(id);
  }

  @Post('platform/:id/activate')
  @HttpCode(200)
  activatePlatform(
    @Param('id', IntegrationId) id: string,
    @Body(body(ActivateAdminPlatformRequest)) b: z.output<typeof ActivateAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.activate(id, b);
  }

  @Post('platform/:id/disable')
  @HttpCode(200)
  disablePlatform(
    @Param('id', IntegrationId) id: string,
    @Body(body(DisableAdminPlatformRequest)) b: z.output<typeof DisableAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.disable(id, b);
  }

  @Post('platform/:id/enable')
  @HttpCode(200)
  enablePlatform(@Param('id', IntegrationId) id: string): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.enable(id);
  }

  @Post('platform/:id/remove')
  @HttpCode(200)
  removePlatform(
    @Param('id', IntegrationId) id: string,
    @Body(body(RemoveAdminPlatformRequest)) b: z.output<typeof RemoveAdminPlatformRequest>,
  ): Promise<AdminPlatformIntegrationDetail> {
    return this.platform.remove(id, b);
  }

  @Post('platform/:id/sync')
  @HttpCode(200)
  syncPlatform(@Param('id', IntegrationId) id: string): Promise<AdminPlatformRun> {
    return this.platform.sync(id);
  }

  @Get('platform/:id/runs')
  platformRuns(
    @Param('id', IntegrationId) id: string,
    @Query(body(ListAdminPlatformRunsQuery)) q: z.output<typeof ListAdminPlatformRunsQuery>,
  ): Promise<ListAdminPlatformRunsResponse> {
    return this.platform.runs(id, q);
  }

  // ---------- Catalog ----------

  @Get('catalog')
  listCatalog(
    @Query(body(ListAdminCatalogQuery)) q: z.output<typeof ListAdminCatalogQuery>,
  ): Promise<ListAdminCatalogResponse> {
    return this.catalog.list(q);
  }

  @Post('catalog')
  createCatalog(
    @Body(body(CreateAdminCatalogRequest)) b: z.output<typeof CreateAdminCatalogRequest>,
  ): Promise<AdminCatalogItem> {
    return this.catalog.create(b);
  }

  @Get('catalog/:id')
  getCatalog(@Param('id', CatalogId) id: string): Promise<AdminCatalogItem> {
    return this.catalog.get(id);
  }

  @Patch('catalog/:id')
  updateCatalog(
    @Param('id', CatalogId) id: string,
    @Body(body(UpdateAdminCatalogRequest)) b: z.output<typeof UpdateAdminCatalogRequest>,
  ): Promise<AdminCatalogItem> {
    return this.catalog.update(id, b);
  }

  @Get('catalog/:id/preview')
  previewCatalog(@Param('id', CatalogId) id: string): Promise<AdminCatalogPreview> {
    return this.catalog.preview(id);
  }

  @Put('catalog/:id/plans/:planId')
  putCatalogPlan(
    @Param('id', CatalogId) id: string,
    @Param('planId', Uuid) planId: string,
  ): Promise<AdminCatalogItem> {
    return this.catalog.putPlan(id, planId);
  }

  @Delete('catalog/:id/plans/:planId')
  deleteCatalogPlan(
    @Param('id', CatalogId) id: string,
    @Param('planId', Uuid) planId: string,
    @Body(body(AdminConfirmAccessLoss)) b: z.output<typeof AdminConfirmAccessLoss>,
  ): Promise<AdminCatalogItem> {
    return this.catalog.deletePlan(id, planId, b);
  }

  @Put('catalog/:id/firms/:businessId')
  putCatalogFirm(
    @Param('id', CatalogId) id: string,
    @Param('businessId', Uuid) businessId: string,
    @Body(body(PutAdminCatalogFirmRequest)) b: z.output<typeof PutAdminCatalogFirmRequest>,
  ): Promise<AdminCatalogItem> {
    return this.catalog.putFirm(id, businessId, b);
  }

  @Delete('catalog/:id/firms/:businessId')
  deleteCatalogFirm(
    @Param('id', CatalogId) id: string,
    @Param('businessId', Uuid) businessId: string,
    @Body(body(AdminConfirmAccessLoss)) b: z.output<typeof AdminConfirmAccessLoss>,
  ): Promise<AdminCatalogItem> {
    return this.catalog.deleteFirm(id, businessId, b);
  }
}

@Module({
  controllers: [AdminIntegrationsController, AdminIntegrationsOpsController],
  providers: [
    AdminPrisma,
    PlatformIntegrationsService,
    IntegrationCatalogService,
    ApiAccessService,
    IntegrationInsightsService,
    IntegrationRunWorker,
    { provide: PLATFORM_SECRETS, useFactory: () => createPlatformSecretStore() },
  ],
})
export class AdminIntegrationsModule {}
