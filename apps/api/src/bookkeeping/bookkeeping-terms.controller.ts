import { Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query } from '@nestjs/common';
import {
  ActivateBookkeepingTermsRequest,
  BookkeepingClientId,
  type BookkeepingPaymentSchedule,
  BookkeepingPaymentScheduleQuery,
  type BookkeepingTerms,
  type BookkeepingTermsEvent,
  type BookkeepingTermsHistory,
  BookkeepingTermsHistoryQuery,
  BookkeepingTermsId,
  BookkeepingTermsNoticeRequest,
  type BookkeepingTermsPage,
  CreateBookkeepingTermsRequest,
  SendBookkeepingTermsRequest,
  SetBookkeepingTermsAgreementRequest,
  TerminateBookkeepingTermsRequest,
  UpdateBookkeepingTermsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
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
import { actorOf } from '../workspaces/common.js';
import { BookkeepingTermsService } from './bookkeeping-terms.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const pipe = <S extends z.ZodType>(schema: S) => new ZodValidationPipe(schema);
const clientId = pipe(BookkeepingClientId);
const termsId = pipe(BookkeepingTermsId);

/**
 * A bookkeeping client's Terms page (R55; contract in packages/types/src/bookkeeping/terms.ts).
 * Everyone with the grid's BOOKKEEPING view reads the clients they reach; Owner and Admin change
 * terms and pricing. Registered ahead of BookkeepingController.
 */
@Controller('business/bookkeeping')
@Access('BOOKKEEPING')
@Roles(...FIRM_STAFF)
export class BookkeepingTermsController {
  constructor(private readonly terms: BookkeepingTermsService) {}

  @Get('clients/:id/terms')
  page(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
  ): Promise<BookkeepingTermsPage> {
    return this.terms.page(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Get('clients/:id/terms/history')
  history(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(BookkeepingTermsHistoryQuery)) q: Out<typeof BookkeepingTermsHistoryQuery>,
  ): Promise<BookkeepingTermsHistory> {
    return this.terms.history(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Get('clients/:id/terms/payment-schedule')
  paymentSchedule(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Query(pipe(BookkeepingPaymentScheduleQuery)) q: Out<typeof BookkeepingPaymentScheduleQuery>,
  ): Promise<BookkeepingPaymentSchedule> {
    return this.terms.paymentSchedule(tenant.businessId, actorOf(auth, tenant), id, q);
  }

  @Post('clients/:id/terms')
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', clientId) id: string,
    @Body(pipe(CreateBookkeepingTermsRequest)) body: Out<typeof CreateBookkeepingTermsRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.create(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('terms/:termsId')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
  ): Promise<BookkeepingTerms> {
    return this.terms.get(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Patch('terms/:termsId')
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(UpdateBookkeepingTermsRequest)) body: Out<typeof UpdateBookkeepingTermsRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.update(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('terms/:termsId/send')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(SendBookkeepingTermsRequest)) body: Out<typeof SendBookkeepingTermsRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.send(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('terms/:termsId/back-to-draft')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  backToDraft(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
  ): Promise<BookkeepingTerms> {
    return this.terms.backToDraft(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('terms/:termsId/activate')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  activate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(ActivateBookkeepingTermsRequest)) body: Out<typeof ActivateBookkeepingTermsRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.activate(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('terms/:termsId/terminate')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  terminate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(TerminateBookkeepingTermsRequest))
    body: Out<typeof TerminateBookkeepingTermsRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.terminate(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Post('terms/:termsId/notices')
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  recordNotice(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(BookkeepingTermsNoticeRequest)) body: Out<typeof BookkeepingTermsNoticeRequest>,
  ): Promise<BookkeepingTermsEvent> {
    return this.terms.recordNotice(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Put('terms/:termsId/agreement')
  @Roles(...FIRM_MANAGERS)
  @Access('BOOKKEEPING', 'MANAGE')
  setAgreement(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('termsId', termsId) id: string,
    @Body(pipe(SetBookkeepingTermsAgreementRequest))
    body: Out<typeof SetBookkeepingTermsAgreementRequest>,
  ): Promise<BookkeepingTerms> {
    return this.terms.setAgreement(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}
