import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  EsignApprovalBody,
  type EsignApproverList,
  type EsignInPersonSession,
  type EsignInPersonState,
  type EsignMemberRole,
  type EsignMemberRoleList,
  type EsignReport,
  EsignReportQuery,
  EsignRequestId,
  type EsignRequestDetail,
  ExitEsignInPersonBody,
  type OkResponse,
  StartEsignInPersonBody,
  SetEsignMemberRoleBody,
  SubmitEsignApprovalBody,
} from '@firmivra/types';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../../auth/decorators.js';
import type { AuthContext, TenantContext } from '../../common/request-context.js';
import { ZodValidationPipe } from '../../common/zod-validation.pipe.js';
import { EsignRoute } from './esign-role.guard.js';
import { actorOf } from '../requests/requests.controller.js';
import { EsignApprovalsService } from './approvals.service.js';
import { EsignInPersonService } from './in-person.service.js';
import { KioskAllowed } from './kiosk.js';
import { EsignReportsService } from './reports.service.js';
import { EsignRolesService } from './roles.service.js';

const idPipe = new ZodValidationPipe(EsignRequestId);

/** Firm Sign's extras (contract 3: packages/types/src/esign/extras.ts, docs/api/esign.yaml). */
@Controller('esign')
@Roles(...FIRM_STAFF)
@EsignRoute()
export class EsignExtrasController {
  constructor(
    private readonly approvals: EsignApprovalsService,
    private readonly roles: EsignRolesService,
    private readonly reports: EsignReportsService,
    private readonly inPerson: EsignInPersonService,
  ) {}

  /** `confirm: true` is the review screen's explicit confirmation (the pipe checks it). */
  @Post('requests/:id/submit-for-approval')
  @HttpCode(200)
  submitForApproval(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SubmitEsignApprovalBody)) _body: SubmitEsignApprovalBody,
  ): Promise<EsignRequestDetail> {
    return this.approvals.submit(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('requests/:id/approval')
  @HttpCode(200)
  decideApproval(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(EsignApprovalBody)) body: z.output<typeof EsignApprovalBody>,
  ): Promise<EsignRequestDetail> {
    return this.approvals.decide(tenant.businessId, actorOf(auth, tenant), id, body);
  }

  @Get('approvers')
  approvers(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignApproverList> {
    return this.approvals.approvers(tenant.businessId, actorOf(auth, tenant));
  }

  @Get('roles')
  @Roles(...FIRM_MANAGERS)
  listRoles(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignMemberRoleList> {
    return this.roles.list(tenant.businessId, actorOf(auth, tenant));
  }

  @Put('roles/:userId')
  @Roles(...FIRM_MANAGERS)
  setRole(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('userId', new ZodValidationPipe(z.uuid())) userId: string,
    @Body(new ZodValidationPipe(SetEsignMemberRoleBody)) body: SetEsignMemberRoleBody,
  ): Promise<EsignMemberRole> {
    return this.roles.set(tenant.businessId, actorOf(auth, tenant), userId, body);
  }

  @Get('reports')
  report(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(EsignReportQuery)) query: z.output<typeof EsignReportQuery>,
  ): Promise<EsignReport> {
    return this.reports.report(tenant.businessId, actorOf(auth, tenant), query);
  }

  /** Locks the caller's session until `in-person/exit` (EsignKioskInterceptor). */
  @Post('requests/:id/in-person')
  @HttpCode(200)
  startInPerson(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(StartEsignInPersonBody)) body: StartEsignInPersonBody,
  ): Promise<EsignInPersonSession> {
    const actor = actorOf(auth, tenant);
    return this.inPerson.start(tenant.businessId, actor, id, body.recipientId);
  }

  @Get('in-person')
  @KioskAllowed()
  inPersonState(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
  ): Promise<EsignInPersonState> {
    return this.inPerson.state(tenant.businessId, actorOf(auth, tenant));
  }

  /** 400 PASSWORD_WRONG; the last wrong try signs the caller out (401, cookies cleared). */
  @Post('in-person/exit')
  @HttpCode(200)
  @KioskAllowed()
  exitInPerson(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body(new ZodValidationPipe(ExitEsignInPersonBody)) body: ExitEsignInPersonBody,
  ): Promise<OkResponse> {
    const actor = { ...actorOf(auth, tenant), cognitoSub: auth.cognitoSub };
    return this.inPerson.exit(req, res, tenant.businessId, actor, body.password);
  }
}
