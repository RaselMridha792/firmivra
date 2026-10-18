import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import type { z } from 'zod';
import {
  type ConnectIntegrationResult,
  type CustomIntegrationConfig,
  type CustomIntegrationEventList,
  type CustomIntegrationTestResult,
  type IntegrationActivityPage,
  type IntegrationConnectionDetail,
  type IntegrationConnectionHealth,
  IntegrationConnectionId,
  type IntegrationConnectionSummary,
  type IntegrationHistoryPage,
  type IntegrationMappings,
  type IntegrationMarketplace,
  type IntegrationPermissionList,
  type IntegrationProviderDetail,
  IntegrationProviderKey,
  type IntegrationRequestList,
  type IntegrationRequestRow,
  type IntegrationsOverview,
  type IntegrationSyncRun,
  type IntegrationSyncRunDetail,
  IntegrationSyncRunId,
  type IntegrationTestResult,
} from '@firmivra/types';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CustomIntegrationService } from './custom-integration.service.js';
import { IntegrationsReadService } from './integrations-read.service.js';
import {
  ActivityQuery,
  ConnectBody,
  CreateRequestBody,
  DisconnectBody,
  HistoryQuery,
  IntegrationsQueryInput,
  MappingsBody,
  MarketplaceQuery,
  ReconnectBody,
  RotateBody,
  SaveCustomBody,
  SettingsBody,
  SyncBody,
} from './integrations-input.js';
import {
  IntegrationsService,
  STATE_COOKIE,
  INTEGRATION_STATE_SECONDS,
} from './integrations.service.js';

const providerPipe = new ZodValidationPipe(IntegrationProviderKey);
const idPipe = new ZodValidationPipe(IntegrationConnectionId);
const runPipe = new ZodValidationPipe(IntegrationSyncRunId);
type Out<S extends z.ZodType> = z.output<S>;

const staff = (auth: AuthContext, tenant: TenantContext) => {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, tenant };
};

/**
 * The Integrations module (contract in packages/types/src/integrations). Everyone with the
 * Integrations view reads; connecting, configuring, syncing, testing and disconnecting are Owner
 * and Admin (and a grid role with the Edit capability): the service answers 403 for anyone else.
 * Never a portal route. The firm comes from TenantGuard. No secret is ever in a response.
 */
@Controller('business/integrations')
@Access('INTEGRATIONS')
@Roles(...FIRM_STAFF)
export class IntegrationsController {
  constructor(
    private readonly reader: IntegrationsReadService,
    private readonly integrations: IntegrationsService,
    private readonly custom: CustomIntegrationService,
  ) {}

  // ----- Main page and marketplace (static paths first) -----

  @Get()
  overview(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(IntegrationsQueryInput)) q: Out<typeof IntegrationsQueryInput>,
  ): Promise<IntegrationsOverview> {
    return this.reader.overview(tenant.businessId, tenant, q);
  }

  @Get('activity')
  activity(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ActivityQuery)) q: Out<typeof ActivityQuery>,
  ): Promise<IntegrationActivityPage> {
    return this.reader.activityPage(tenant.businessId, q);
  }

  @Get('marketplace')
  marketplace(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MarketplaceQuery)) q: Out<typeof MarketplaceQuery>,
  ): Promise<IntegrationMarketplace> {
    return this.reader.marketplace(tenant.businessId, q);
  }

  @Get('custom-events')
  customEvents(): CustomIntegrationEventList {
    return { items: this.custom.events() };
  }

  // ----- Connect -----

  @Get('providers/:provider')
  provider(
    @CurrentTenant() tenant: TenantContext,
    @Param('provider', providerPipe) provider: string,
  ): Promise<IntegrationProviderDetail> {
    return this.reader.providerDetail(tenant.businessId, tenant, provider);
  }

  @Post('providers/:provider/connect')
  @HttpCode(200)
  async connect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('provider', providerPipe) provider: string,
    @Body(new ZodValidationPipe(ConnectBody)) body: Out<typeof ConnectBody>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConnectIntegrationResult> {
    const { userId } = staff(auth, tenant);
    const out = await this.integrations.connect(tenant.businessId, tenant, userId, provider, body);
    return this.answer(out, res);
  }

  /** The browser-binding cookie of a redirect: the callback needs it to match the state. */
  private answer(
    out: Awaited<ReturnType<IntegrationsService['connect']>>,
    res: Response,
  ): ConnectIntegrationResult {
    if (out.mode === 'CONNECTED') return out;
    res.cookie(STATE_COOKIE, out.nonce, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/integrations',
      maxAge: INTEGRATION_STATE_SECONDS * 1000,
    });
    return { mode: 'REDIRECT', url: out.url };
  }

  // ----- Manage a connection -----

  @Get('connections/:id')
  connection(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationConnectionDetail> {
    return this.reader.connection(tenant.businessId, tenant, id);
  }

  @Patch('connections/:id/settings')
  updateSettings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SettingsBody)) body: Out<typeof SettingsBody>,
  ): Promise<IntegrationConnectionDetail> {
    const { userId } = staff(auth, tenant);
    return this.integrations.updateSettings(tenant.businessId, tenant, userId, id, body);
  }

  @Post('connections/:id/sync')
  @HttpCode(200)
  sync(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SyncBody)) body: Out<typeof SyncBody>,
  ): Promise<IntegrationSyncRun> {
    const { userId } = staff(auth, tenant);
    return this.integrations.syncNow(tenant.businessId, tenant, userId, id, body);
  }

  @Post('connections/:id/pause')
  @HttpCode(200)
  pause(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationConnectionSummary> {
    const { userId } = staff(auth, tenant);
    return this.integrations.pause(tenant.businessId, tenant, userId, id);
  }

  @Post('connections/:id/resume')
  @HttpCode(200)
  resume(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationConnectionSummary> {
    const { userId } = staff(auth, tenant);
    return this.integrations.resume(tenant.businessId, tenant, userId, id);
  }

  @Post('connections/:id/test')
  @HttpCode(200)
  test(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationTestResult> {
    const { userId } = staff(auth, tenant);
    return this.integrations.test(tenant.businessId, tenant, userId, id);
  }

  @Get('connections/:id/health')
  health(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationConnectionHealth> {
    return this.reader.health(tenant.businessId, id);
  }

  @Post('connections/:id/reconnect')
  @HttpCode(200)
  async reconnect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ReconnectBody)) body: Out<typeof ReconnectBody>,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ConnectIntegrationResult> {
    const { userId } = staff(auth, tenant);
    const out = await this.integrations.reconnect(tenant.businessId, tenant, userId, id, body);
    return this.answer(out, res);
  }

  @Post('connections/:id/disconnect')
  @HttpCode(200)
  disconnect(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(DisconnectBody)) _body: Out<typeof DisconnectBody>,
  ): Promise<IntegrationConnectionSummary> {
    const { userId } = staff(auth, tenant);
    return this.integrations.disconnect(tenant.businessId, tenant, userId, id);
  }

  @Get('connections/:id/history')
  history(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Query(new ZodValidationPipe(HistoryQuery)) q: Out<typeof HistoryQuery>,
  ): Promise<IntegrationHistoryPage> {
    return this.reader.history(tenant.businessId, id, q);
  }

  @Get('connections/:id/history/:runId')
  run(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('runId', runPipe) runId: string,
  ): Promise<IntegrationSyncRunDetail> {
    return this.reader.run(tenant.businessId, id, runId);
  }

  @Get('connections/:id/mappings')
  mappings(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationMappings> {
    return this.reader.mappings(tenant.businessId, id);
  }

  @Put('connections/:id/mappings')
  saveMappings(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(MappingsBody)) body: Out<typeof MappingsBody>,
  ): Promise<IntegrationMappings> {
    const { userId } = staff(auth, tenant);
    return this.integrations.saveMappings(tenant.businessId, tenant, userId, id, body);
  }

  @Get('connections/:id/permissions')
  permissions(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntegrationPermissionList> {
    return this.reader.permissions(tenant.businessId, id);
  }

  // ----- Custom API & Webhooks -----

  @Get('connections/:id/custom')
  customConfig(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CustomIntegrationConfig> {
    return this.custom.get(tenant.businessId, id);
  }

  @Patch('connections/:id/custom')
  saveCustom(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SaveCustomBody)) body: Out<typeof SaveCustomBody>,
  ): Promise<CustomIntegrationConfig> {
    const { userId } = staff(auth, tenant);
    return this.custom.save(tenant.businessId, tenant, userId, id, body);
  }

  @Post('connections/:id/custom/secret')
  @HttpCode(200)
  rotateSecret(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RotateBody)) body: Out<typeof RotateBody>,
  ): Promise<CustomIntegrationConfig> {
    const { userId } = staff(auth, tenant);
    return this.custom.rotateSecret(tenant.businessId, tenant, userId, id, body);
  }

  @Post('connections/:id/custom/test')
  @HttpCode(200)
  testCustom(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<CustomIntegrationTestResult> {
    const { userId } = staff(auth, tenant);
    return this.custom.test(tenant.businessId, tenant, userId, id);
  }
}

/** The firm's requests for an integration that is not listed (Super Admin reviews them elsewhere). */
@Controller('business/integration-requests')
@Access('INTEGRATIONS')
@Roles(...FIRM_STAFF)
export class IntegrationRequestsController {
  constructor(
    private readonly reader: IntegrationsReadService,
    private readonly integrations: IntegrationsService,
  ) {}

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<IntegrationRequestList> {
    return { items: await this.reader.requests(tenant.businessId) };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateRequestBody)) body: Out<typeof CreateRequestBody>,
  ): Promise<IntegrationRequestRow> {
    const { userId } = staff(auth, tenant);
    return this.integrations.createRequest(tenant.businessId, tenant, userId, body);
  }
}
