import { Body, Controller, Get, HttpCode, Module, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  CancelEngagementRequest,
  ClientId,
  CreateEngagementRequest,
  type Engagement,
  type EngagementHistory,
  EngagementId,
  ListEngagementsQuery,
  type MyService,
  RequestCancellationRequest,
  UpdateEngagementRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { EngagementsService } from './engagements.service.js';

const clientPipe = new ZodValidationPipe(ClientId);
const idPipe = new ZodValidationPipe(EngagementId);

function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/** A client's engagements (R10 step 6): Owner, Admin and Staff (Staff: their own clients). */
@Controller('business/clients/:id/engagements')
@Roles(...FIRM_STAFF)
export class ClientEngagementsController {
  constructor(private readonly engagements: EngagementsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Query(new ZodValidationPipe(ListEngagementsQuery)) q: z.output<typeof ListEngagementsQuery>,
  ): Promise<{ items: Engagement[] }> {
    return {
      items: await this.engagements.listForClient(
        tenant.businessId,
        actorOf(auth, tenant),
        clientId,
        q,
      ),
    };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientPipe) clientId: string,
    @Body(new ZodValidationPipe(CreateEngagementRequest))
    body: z.output<typeof CreateEngagementRequest>,
  ): Promise<Engagement> {
    return this.engagements.create(tenant.businessId, actorOf(auth, tenant), clientId, body);
  }
}

/** One engagement and its lifecycle. The firm comes from TenantGuard. */
@Controller('business/engagements')
@Roles(...FIRM_STAFF)
export class EngagementsController {
  constructor(private readonly engagements: EngagementsService) {}

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Engagement> {
    return this.engagements.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateEngagementRequest))
    body: z.output<typeof UpdateEngagementRequest>,
  ): Promise<Engagement> {
    return this.engagements.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Engagement> {
    return this.engagements.complete(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CancelEngagementRequest))
    body: z.output<typeof CancelEngagementRequest>,
  ): Promise<Engagement> {
    return this.engagements.cancel(tenant.businessId, actorOf(auth, tenant), id, body.reason);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<Engagement> {
    return this.engagements.reactivate(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get(':id/history')
  async history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<EngagementHistory> {
    return { items: await this.engagements.history(tenant.businessId, actorOf(auth, tenant), id) };
  }
}

/** The signed-in client's services at one firm (portal My Services); the client from the session. */
@Controller('portal/:firmSlug/me/services')
@Roles('CLIENT')
export class MyServicesController {
  constructor(private readonly engagements: EngagementsService) {}

  private account(tenant: TenantContext): string {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return tenant.clientAccountId;
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: MyService[] }> {
    return { items: await this.engagements.myServices(tenant.businessId, this.account(tenant)) };
  }

  @Post(':id/cancel-request')
  @HttpCode(200)
  requestCancellation(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RequestCancellationRequest))
    body: z.output<typeof RequestCancellationRequest>,
  ): Promise<MyService> {
    return this.engagements.requestCancellation(tenant.businessId, this.account(tenant), id, body);
  }
}

@Module({
  controllers: [ClientEngagementsController, EngagementsController, MyServicesController],
  providers: [EngagementsService],
})
export class EngagementsModule {}
