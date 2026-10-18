import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import type {
  TaxReturnActivityList,
  TaxReturnDetail,
  TaxReturnHistoryList,
  TaxReturnPage,
  TaxReturnSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import {
  AmendBody,
  CarryForwardBody,
  CreateReturnBody,
  IdParam,
  ReturnsQ,
  StatusBody,
  SummaryQ,
  UpdateDetailsBody,
} from './workspace.input.js';
import { TaxReturnWorkspaceService } from './workspace.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(IdParam);

/**
 * The Tax Returns workspace (R55, `api.taxReturnWorkspace`), part 1. Registered before R10's
 * TaxReturnsController (which keeps PATCH and DELETE :id). Static routes before ':id'.
 */
@Controller('business/tax-returns')
@Access('TAX_RETURNS')
@Roles(...FIRM_STAFF)
export class TaxReturnWorkspaceController {
  constructor(private readonly returns: TaxReturnWorkspaceService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ReturnsQ)) q: Out<typeof ReturnsQ>,
  ): Promise<TaxReturnPage> {
    return this.returns.list(tenant, auth.userId, q);
  }

  @Get('summary')
  summary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(SummaryQ)) q: Out<typeof SummaryQ>,
  ): Promise<TaxReturnSummary> {
    return this.returns.summary(tenant, auth.userId, q);
  }

  @Post()
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateReturnBody)) body: Out<typeof CreateReturnBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.create(tenant, auth.userId, body);
  }

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.get(tenant, auth.userId, id);
  }

  @Patch(':id/details')
  updateDetails(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateDetailsBody)) body: Out<typeof UpdateDetailsBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.updateDetails(tenant, auth.userId, id, body);
  }

  @Post(':id/status')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  changeStatus(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StatusBody)) body: Out<typeof StatusBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.changeStatus(tenant, auth.userId, id, body);
  }

  @Get(':id/history')
  async history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnHistoryList> {
    return { items: await this.returns.history(tenant, auth.userId, id) };
  }

  @Get(':id/activity')
  async activity(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnActivityList> {
    return { items: await this.returns.activity(tenant, auth.userId, id) };
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  archive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.archive(tenant, auth.userId, id, true);
  }

  @Post(':id/restore')
  @HttpCode(200)
  @Access('TAX_RETURNS', 'EDIT')
  restore(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<TaxReturnDetail> {
    return this.returns.archive(tenant, auth.userId, id, false);
  }

  @Post(':id/amend')
  amend(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AmendBody)) body: Out<typeof AmendBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.amend(tenant, auth.userId, id, body);
  }

  @Post(':id/carry-forward')
  carryForward(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CarryForwardBody)) body: Out<typeof CarryForwardBody>,
  ): Promise<TaxReturnDetail> {
    return this.returns.carryForward(tenant, auth.userId, id, body);
  }
}
