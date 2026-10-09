import { Body, Controller, Delete, Get, Module, Param, Patch, Post, Query } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  CreateTaxReturnRequest,
  type MyTaxReturn,
  MyTaxReturnsQuery,
  type OkResponse,
  type TaxReturn,
  TaxReturnId,
  UpdateTaxReturnRequest,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { ClientsActor } from '../clients/clients.service.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { TaxReturnsService } from './tax-returns.service.js';

const clientIdPipe = new ZodValidationPipe(ClientId);
const idPipe = new ZodValidationPipe(TaxReturnId);

/** The signed-in member and their role in this firm (TenantGuard). Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * A client's tax returns (R10 step 7): Owner, Admin and Staff (Staff: their own clients only).
 * The firm comes from TenantGuard.
 */
@Controller('business/clients/:id/tax-returns')
@Roles(...FIRM_STAFF)
export class ClientTaxReturnsController {
  constructor(private readonly returns: TaxReturnsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientIdPipe) id: string,
  ): Promise<{ items: TaxReturn[] }> {
    return {
      items: await this.returns.listForClient(tenant.businessId, actorOf(auth, tenant), id),
    };
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientIdPipe) id: string,
    @Body(new ZodValidationPipe(CreateTaxReturnRequest))
    body: z.output<typeof CreateTaxReturnRequest>,
  ): Promise<TaxReturn> {
    return this.returns.create(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}

/** One return by its id: change it, or delete it while it was never filed. */
@Controller('business/tax-returns')
@Roles(...FIRM_STAFF)
export class TaxReturnsController {
  constructor(private readonly returns: TaxReturnsService) {}

  @Patch(':id')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateTaxReturnRequest))
    body: z.output<typeof UpdateTaxReturnRequest>,
  ): Promise<TaxReturn> {
    return this.returns.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Delete(':id')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.returns.remove(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/**
 * The signed-in client's own returns at one firm (portal Taxes tab). The client comes from the
 * session (TenantGuard's client account), never from the URL.
 */
@Controller('portal/:firmSlug/me/tax-returns')
@Roles('CLIENT')
export class MyTaxReturnsController {
  constructor(private readonly returns: TaxReturnsService) {}

  @Get()
  async mine(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MyTaxReturnsQuery)) query: z.output<typeof MyTaxReturnsQuery>,
  ): Promise<{ items: MyTaxReturn[] }> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return { items: await this.returns.mine(tenant.businessId, tenant.clientAccountId, query) };
  }
}

@Module({
  controllers: [ClientTaxReturnsController, TaxReturnsController, MyTaxReturnsController],
  providers: [TaxReturnsService],
})
export class TaxReturnsModule {}
