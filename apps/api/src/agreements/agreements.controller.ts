import { Body, Controller, Get, Module, Param, Post, Query } from '@nestjs/common';
import { z } from 'zod';
import {
  type AgreementVersion,
  CreateAgreementRequest,
  type FirmAgreementDetail,
  type FirmAgreementList,
  type FirmAgreementSummary,
  type IntakeAgreementBlock,
  IntakeAgreementsQuery,
  PublishAgreementVersionRequest,
} from '@firmivra/types';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Public,
  Roles,
} from '../auth/decorators.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { AGREEMENTS_CONFIG, agreementsConfig, AgreementsService } from './agreements.service.js';

const idPipe = new ZodValidationPipe(z.uuid());
/** A version in the path: plain digits ("2", not "02" or "2e0"). */
const versionPipe = new ZodValidationPipe(
  z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/)
    .transform(Number)
    .pipe(z.number().int().positive().max(2_147_483_647)),
);

/**
 * The firm's intake agreements (docs/api/agreements.yaml), Settings > Terms & Privacy.
 * Owner and Admin, also while the firm is Pending Setup; the firm comes from TenantGuard.
 */
@Controller('business/agreements')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<FirmAgreementList> {
    return this.agreements.list(tenant.businessId);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateAgreementRequest))
    body: z.output<typeof CreateAgreementRequest>,
  ): Promise<FirmAgreementSummary> {
    return this.agreements.create(tenant.businessId, auth.userId, body);
  }

  @Get(':agreementId')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
  ): Promise<FirmAgreementDetail> {
    return this.agreements.get(tenant.businessId, agreementId);
  }

  @Get(':agreementId/versions/:version')
  getVersion(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
    @Param('version', versionPipe) version: number,
  ): Promise<AgreementVersion> {
    return this.agreements.getVersion(tenant.businessId, agreementId, version);
  }

  @Post(':agreementId/versions')
  publish(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Param('agreementId', idPipe) agreementId: string,
    @Body(new ZodValidationPipe(PublishAgreementVersionRequest))
    body: z.output<typeof PublishAgreementVersionRequest>,
  ): Promise<AgreementVersion> {
    return this.agreements.publish(tenant.businessId, auth.userId, agreementId, body);
  }

  @Post(':agreementId/archive')
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('agreementId', idPipe) agreementId: string,
  ): Promise<FirmAgreementSummary> {
    return this.agreements.archive(tenant.businessId, agreementId);
  }
}

/** GET /api/v1/portal/{firmSlug}/intake-agreements: public, for Begin Online and portal intake. */
@Controller('portal/:firmSlug/intake-agreements')
export class PublicAgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  @Public()
  block(
    @Param('firmSlug') firmSlug: string,
    @Query(new ZodValidationPipe(IntakeAgreementsQuery))
    query: z.output<typeof IntakeAgreementsQuery>,
  ): Promise<IntakeAgreementBlock> {
    return this.agreements.intakeBlock(firmSlug, query.serviceId);
  }
}

@Module({
  imports: [PortalInfoModule],
  controllers: [AgreementsController, PublicAgreementsController],
  providers: [
    AgreementsService,
    { provide: AGREEMENTS_CONFIG, useFactory: () => agreementsConfig() },
  ],
  exports: [AgreementsService],
})
export class AgreementsModule {}
