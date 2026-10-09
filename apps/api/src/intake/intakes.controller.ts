import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  type IntakeChoiceList,
  IntakeId,
  IntakeKey,
  type IntakeList,
  type IntakeView,
  RequestIntakeCorrectionRequest,
  SaveIntakeStepRequest,
  SendIntakeRequest,
  StartIntakeRequest,
  SubmitIntakeRequest,
  type UploadTicket,
} from '@firmivra/types';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import { type AuthContext, requestContext, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { FieldEncryptionModule } from '../field-encryption/field-encryption.service.js';
import { DocumentsModule } from '../storage/documents.controller.js';
import { INTAKE_SIGNING, type IntakeSigner, PLACEHOLDER_SIGNING } from './intake-signing.js';
import { type IntakeUploader, IntakeUploadsService } from './intake-uploads.service.js';
import { type IntakeReach, IntakesService } from './intakes.service.js';

const idPipe = new ZodValidationPipe(IntakeId);
const stepPipe = new ZodValidationPipe(IntakeKey);
/** Contract B's body; a portal signature carries no Terms and Privacy acceptance. */
const submitPipe = new ZodValidationPipe(
  SubmitIntakeRequest.refine((b) => b.signature.acceptLegal == null, {
    path: ['signature', 'acceptLegal'],
    message: 'A portal intake takes no Terms and Privacy acceptance',
  }),
);

function staff(auth: AuthContext, tenant: TenantContext): IntakeReach {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { kind: 'staff', actor: { userId: auth.userId, role: tenant.role } };
}

/** The signed-in client's intake forms at one firm; the client from the session. */
@Controller('portal/:firmSlug/me/intakes')
@Roles('CLIENT')
export class MyIntakesController {
  constructor(
    private readonly intakes: IntakesService,
    private readonly files: IntakeUploadsService,
    @Inject(INTAKE_SIGNING) private readonly signer: IntakeSigner,
  ) {}

  private async uploader(auth: AuthContext, tenant: TenantContext): Promise<IntakeUploader> {
    const reach = await this.reach(tenant);
    if (reach.kind !== 'client' || tenant.kind !== 'client') throw new Error('unreachable');
    return {
      businessId: tenant.businessId,
      userId: auth.userId,
      clientAccountId: tenant.clientAccountId,
      clientId: reach.clientId,
    };
  }

  private reach(tenant: TenantContext) {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return this.intakes.clientOf(tenant.businessId, tenant.clientAccountId);
  }

  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<IntakeList> {
    return { items: await this.intakes.list(tenant.businessId, await this.reach(tenant)) };
  }

  @Get('choices')
  async choices(@CurrentTenant() tenant: TenantContext): Promise<IntakeChoiceList> {
    const reach = await this.reach(tenant);
    if (reach.kind !== 'client') throw new Error('unreachable');
    return { items: await this.intakes.choices(tenant.businessId, reach) };
  }

  @Post()
  @HttpCode(200)
  async start(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(StartIntakeRequest)) body: z.output<typeof StartIntakeRequest>,
  ): Promise<IntakeView> {
    return this.intakes.start(tenant.businessId, await this.reach(tenant), body.engagementId);
  }

  @Get(':id')
  async get(@CurrentTenant() tenant: TenantContext, @Param('id', idPipe) id: string) {
    return this.intakes.get(tenant.businessId, await this.reach(tenant), id);
  }

  @Put(':id/steps/:stepKey')
  async saveStep(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('stepKey', stepPipe) stepKey: string,
    @Body(new ZodValidationPipe(SaveIntakeStepRequest))
    body: z.output<typeof SaveIntakeStepRequest>,
  ): Promise<IntakeView> {
    const reach = await this.reach(tenant);
    return this.intakes.saveStep(tenant.businessId, reach, id, stepKey, body.answers);
  }

  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(submitPipe) body: z.output<typeof SubmitIntakeRequest>,
  ): Promise<IntakeView> {
    const who = await this.uploader(auth, tenant);
    const store = requestContext.getStore();
    return this.intakes.submit(
      tenant.businessId,
      { kind: 'client', clientId: who.clientId },
      id,
      { userId: auth.userId, clientAccountId: who.clientAccountId },
      body,
      this.signer,
      { ip: store?.ip ?? null, userAgent: store?.userAgent ?? null },
    );
  }

  @Post(':id/uploads')
  async createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateIntakeUploadRequest))
    body: z.output<typeof CreateIntakeUploadRequest>,
  ): Promise<UploadTicket> {
    return this.files.createUpload(await this.uploader(auth, tenant), id, body);
  }

  @Post(':id/uploads/confirm')
  @HttpCode(200)
  async confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<IntakeView> {
    return this.files.confirmUpload(await this.uploader(auth, tenant), id, body.uploadToken);
  }

  @Delete(':id/uploads/:documentId')
  async removeUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('documentId', idPipe) documentId: string,
  ): Promise<IntakeView> {
    return this.files.removeUpload(await this.uploader(auth, tenant), id, documentId);
  }
}

/** A client's intakes, and sending one for an engagement (firm). */
@Controller('business')
@Roles(...FIRM_STAFF)
export class ClientIntakesController {
  constructor(private readonly intakes: IntakesService) {}

  @Get('clients/:id/intakes')
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) clientId: string,
  ): Promise<IntakeList> {
    return { items: await this.intakes.list(tenant.businessId, staff(auth, tenant), clientId) };
  }

  @Post('engagements/:id/intakes')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) engagementId: string,
    @Body(new ZodValidationPipe(SendIntakeRequest)) body: z.output<typeof SendIntakeRequest>,
  ): Promise<IntakeView> {
    return this.intakes.start(tenant.businessId, staff(auth, tenant), engagementId, {
      ...(body.dueOn ? { dueOn: body.dueOn } : {}),
      userId: auth.userId,
    });
  }
}

/** One intake, as the firm reviews it. */
@Controller('business/intakes')
@Roles(...FIRM_STAFF)
export class IntakesController {
  constructor(private readonly intakes: IntakesService) {}

  @Get(':id')
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntakeView> {
    return this.intakes.get(tenant.businessId, staff(auth, tenant), id);
  }

  @Post(':id/review')
  @HttpCode(200)
  review(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntakeView> {
    return this.intakes.move(tenant.businessId, staff(auth, tenant), id, 'UNDER_REVIEW');
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntakeView> {
    return this.intakes.move(tenant.businessId, staff(auth, tenant), id, 'COMPLETED');
  }

  @Post(':id/request-correction')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  requestCorrection(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(RequestIntakeCorrectionRequest))
    body: z.output<typeof RequestIntakeCorrectionRequest>,
  ): Promise<IntakeView> {
    return this.intakes.reopen(tenant.businessId, staff(auth, tenant), id, body.note);
  }

  @Post(':id/unlock')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  unlock(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<IntakeView> {
    return this.intakes.reopen(tenant.businessId, staff(auth, tenant), id, null);
  }
}

@Module({
  imports: [FieldEncryptionModule, DocumentsModule],
  controllers: [MyIntakesController, ClientIntakesController, IntakesController],
  providers: [IntakesService, IntakeUploadsService, PLACEHOLDER_SIGNING],
  exports: [IntakesService, INTAKE_SIGNING],
})
export class IntakesModule {}
