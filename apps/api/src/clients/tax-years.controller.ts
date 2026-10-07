import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  type ClientTaxYear,
  type ClientTaxYearHistory,
  type MyTaxYearList,
  SetClientTaxYearRequest,
  TaxYear,
} from '@firmivra/types';
import { CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import type { ClientsActor } from './clients.service.js';
import { TaxYearsService } from './tax-years.service.js';

const idPipe = new ZodValidationPipe(ClientId);
const yearPipe = new ZodValidationPipe(TaxYear);

function actorOf(auth: AuthContext, tenant: TenantContext): ClientsActor {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { userId: auth.userId, role: tenant.role };
}

/**
 * A client's tax status per year (R10 step 5): Owner, Admin and Staff (Staff: their own clients).
 * The firm comes from TenantGuard.
 */
@Controller('business/clients/:id/tax-years')
@Roles(...FIRM_STAFF)
export class ClientTaxYearsController {
  constructor(private readonly years: TaxYearsService) {}

  @Get()
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<{ items: ClientTaxYear[] }> {
    return { items: await this.years.list(tenant.businessId, actorOf(auth, tenant), id) };
  }

  @Put(':year')
  set(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('year', yearPipe) year: number,
    @Body(new ZodValidationPipe(SetClientTaxYearRequest))
    body: z.output<typeof SetClientTaxYearRequest>,
  ): Promise<ClientTaxYear> {
    return this.years.set(tenant.businessId, actorOf(auth, tenant), id, year, body);
  }

  @Get(':year/history')
  async history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('year', yearPipe) year: number,
  ): Promise<ClientTaxYearHistory> {
    return { items: await this.years.history(tenant.businessId, actorOf(auth, tenant), id, year) };
  }
}

/**
 * The signed-in client's own tax years at one firm (portal). The client comes from the session
 * (TenantGuard's client account), never from the URL.
 */
@Controller('portal/:firmSlug/me/tax-years')
@Roles('CLIENT')
export class MyTaxYearsController {
  constructor(private readonly years: TaxYearsService) {}

  @Get()
  async mine(@CurrentTenant() tenant: TenantContext): Promise<MyTaxYearList> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return { items: await this.years.mine(tenant.businessId, tenant.clientAccountId) };
  }
}
