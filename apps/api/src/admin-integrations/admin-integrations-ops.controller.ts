import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  type AdminApiKey,
  AdminApiKeyId,
  type AdminExportJob,
  AdminIntegrationId,
  AdminIntegrationLogId,
  type AdminIssuedApiKey,
  type AdminLogFacets,
  type AdminLogRecord,
  AdminUsageQuery,
  AdminUsageRangeQuery,
  type AdminUsageReport,
  type AdminWebhookDelivery,
  AdminWebhookDeliveryId,
  type AdminWebhookEndpoint,
  AdminWebhookId,
  type AdminWebhookWithSecret,
  CreateAdminApiKeyRequest,
  CreateAdminWebhookRequest,
  ExportAdminLogsRequest,
  ListAdminApiKeysQuery,
  ListAdminIntegrationAuditQuery,
  type ListAdminIntegrationAuditResponse,
  ListAdminIntegrationLogsQuery,
  type ListAdminIntegrationLogsResponse,
  ListAdminWebhookDeliveriesQuery,
  type ListAdminWebhookDeliveriesResponse,
  ListAdminWebhooksQuery,
  RevokeAdminApiKeyRequest,
  UpdateAdminWebhookRequest,
} from '@firmivra/types';
import { Roles } from '../auth/decorators.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ApiAccessService } from './api-access.service.js';
import { IntegrationInsightsService } from './integration-insights.service.js';

const pipe = <T extends z.ZodType>(schema: T) => new ZodValidationPipe(schema);

/**
 * Super Admin Integrations, part 2 (contract: packages/types/src/admin-integrations/operations.ts;
 * R0 stage B8): API keys, webhooks and deliveries, the integration log and its export, usage, and
 * the module's audit trail. Static routes come before `:id`.
 */
@Controller('admin/integrations')
@Roles('SUPER_ADMIN')
export class AdminIntegrationsOpsController {
  constructor(
    private readonly access: ApiAccessService,
    private readonly insights: IntegrationInsightsService,
  ) {}

  // ---------- API keys ----------

  @Get('api-keys')
  listApiKeys(
    @Query(pipe(ListAdminApiKeysQuery)) q: z.output<typeof ListAdminApiKeysQuery>,
  ): Promise<AdminApiKey[]> {
    return this.access.listKeys(q);
  }

  @Post('api-keys')
  createApiKey(
    @Body(pipe(CreateAdminApiKeyRequest)) b: z.output<typeof CreateAdminApiKeyRequest>,
  ): Promise<AdminIssuedApiKey> {
    return this.access.createKey(b);
  }

  @Post('api-keys/:id/rotate')
  @HttpCode(200)
  rotateApiKey(@Param('id', pipe(AdminApiKeyId)) id: string): Promise<AdminIssuedApiKey> {
    return this.access.rotateKey(id);
  }

  @Post('api-keys/:id/revoke')
  @HttpCode(200)
  revokeApiKey(
    @Param('id', pipe(AdminApiKeyId)) id: string,
    @Body(pipe(RevokeAdminApiKeyRequest)) b: z.output<typeof RevokeAdminApiKeyRequest>,
  ): Promise<AdminApiKey> {
    return this.access.revokeKey(id, b);
  }

  // ---------- Webhooks ----------

  @Get('webhooks')
  listWebhooks(
    @Query(pipe(ListAdminWebhooksQuery)) q: z.output<typeof ListAdminWebhooksQuery>,
  ): Promise<AdminWebhookEndpoint[]> {
    return this.access.listWebhooks(q);
  }

  @Post('webhooks')
  createWebhook(
    @Body(pipe(CreateAdminWebhookRequest)) b: z.output<typeof CreateAdminWebhookRequest>,
  ): Promise<AdminWebhookWithSecret> {
    return this.access.createWebhook(b);
  }

  @Patch('webhooks/:id')
  updateWebhook(
    @Param('id', pipe(AdminWebhookId)) id: string,
    @Body(pipe(UpdateAdminWebhookRequest)) b: z.output<typeof UpdateAdminWebhookRequest>,
  ): Promise<AdminWebhookWithSecret> {
    return this.access.updateWebhook(id, b);
  }

  @Get('webhooks/:id/deliveries')
  webhookDeliveries(
    @Param('id', pipe(AdminWebhookId)) id: string,
    @Query(pipe(ListAdminWebhookDeliveriesQuery))
    q: z.output<typeof ListAdminWebhookDeliveriesQuery>,
  ): Promise<ListAdminWebhookDeliveriesResponse> {
    return this.access.deliveries(id, q);
  }

  @Post('deliveries/:id/redeliver')
  @HttpCode(200)
  redeliver(@Param('id', pipe(AdminWebhookDeliveryId)) id: string): Promise<AdminWebhookDelivery> {
    return this.access.redeliver(id);
  }

  // ---------- The integration log ----------

  @Get('logs')
  listLogs(
    @Query(pipe(ListAdminIntegrationLogsQuery)) q: z.output<typeof ListAdminIntegrationLogsQuery>,
  ): Promise<ListAdminIntegrationLogsResponse> {
    return this.insights.listLogs(q);
  }

  @Get('logs/facets')
  logFacets(): Promise<AdminLogFacets> {
    return this.insights.facets();
  }

  @Get('logs/exports')
  logExports(): Promise<AdminExportJob[]> {
    return this.insights.exports();
  }

  @Post('logs/export')
  @HttpCode(202)
  exportLogs(
    @Body(pipe(ExportAdminLogsRequest)) b: z.output<typeof ExportAdminLogsRequest>,
  ): Promise<AdminExportJob> {
    return this.insights.exportLogs(b);
  }

  @Get('logs/:id')
  getLog(@Param('id', pipe(AdminIntegrationLogId)) id: string): Promise<AdminLogRecord> {
    return this.insights.getLog(id);
  }

  // ---------- Usage ----------

  @Get('usage')
  usage(
    @Query(pipe(AdminUsageQuery)) q: z.output<typeof AdminUsageQuery>,
  ): Promise<AdminUsageReport> {
    return this.insights.usage(q);
  }

  /** One platform integration's usage (404 for an unknown one). */
  @Get('platform/:id/usage')
  platformUsage(
    @Param('id', pipe(AdminIntegrationId)) id: string,
    @Query(pipe(AdminUsageRangeQuery)) q: z.output<typeof AdminUsageRangeQuery>,
  ): Promise<AdminUsageReport> {
    return this.insights.usage({ scope: 'PLATFORM_INTEGRATION', subject: id, ...q });
  }

  // ---------- The module's audit trail ----------

  @Get('audit')
  auditTrail(
    @Query(pipe(ListAdminIntegrationAuditQuery)) q: z.output<typeof ListAdminIntegrationAuditQuery>,
  ): Promise<ListAdminIntegrationAuditResponse> {
    return this.insights.auditTrail(q);
  }
}
