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
  ClientId,
  ConfirmUploadRequest,
  CreateIntakeUploadRequest,
  EngagementId,
  IntakeId,
  IntakeKey,
  type IntakeList,
  type IntakeUpload,
  IntakeUploadId,
  type IntakeView,
  type MyIntake,
  type MyIntakeListItem,
  type OkResponse,
  RequestIntakeCorrectionRequest,
  type SavedIntakeStep,
  SaveIntakeStepRequest,
  SendIntakeRequest,
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
import { AgreementsModule } from '../agreements/agreements.controller.js';
import { NotificationsModule } from '../notifications/notifications.controller.js';
import { INTAKE_SIGNING, INTAKE_SIGNING_PROVIDER, type IntakeSigner } from './intake-signing.js';
import { type IntakeUploader, IntakeUploadsService } from './intake-uploads.service.js';
import { type IntakeReach, IntakesService, type PortalClient } from './intakes.service.js';

const idPipe = new ZodValidationPipe(IntakeId);
const clientIdPipe = new ZodValidationPipe(ClientId);
const engagementIdPipe = new ZodValidationPipe(EngagementId);
const uploadIdPipe = new ZodValidationPipe(IntakeUploadId);
const stepPipe = new ZodValidationPipe(IntakeKey);
/** Contract B's body; a portal signature carries no Terms and Privacy acceptance. */
const submitPipe = new ZodValidationPipe(
  SubmitIntakeRequest.refine((b) => b.signature.acceptLegal == null, {
    path: ['signature', 'acceptLegal'],
    message: 'A portal intake takes no Terms and Privacy acceptance',
  }),
);

function staff(auth: AuthContext, tenant: TenantContext): IntakeReach & { kind: 'staff' } {
  if (tenant.kind !== 'staff') throw new Error('firm routes are for firm members');
  return { kind: 'staff', actor: { userId: auth.userId, role: tenant.role } };
}

/**
 * Contract B (`api.myIntakes(slug)`, packages/types/src/intake/client.ts): the signed-in
 * client's intake forms at one firm, the client from the session. Every login of the client
 * reads; only the PRIMARY one changes (403 FORBIDDEN otherwise).
 */
@Controller('portal/:firmSlug/me/intakes')
@Roles('CLIENT')
export class MyIntakesController {
  constructor(
    private readonly intakes: IntakesService,
    private readonly files: IntakeUploadsService,
    @Inject(INTAKE_SIGNING) private readonly signer: IntakeSigner,
  ) {}

  private client(tenant: TenantContext): Promise<PortalClient> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return this.intakes.clientOf(tenant.businessId, tenant.clientAccountId);
  }

  private async uploader(auth: AuthContext, tenant: TenantContext): Promise<IntakeUploader> {
    const who = await this.client(tenant);
    if (tenant.kind !== 'client') throw new Error('unreachable');
    return {
      businessId: tenant.businessId,
      userId: auth.userId,
      clientAccountId: tenant.clientAccountId,
      clientId: who.clientId,
      primary: who.primary,
    };
  }

  /** `list()`. */
  @Get()
  async list(@CurrentTenant() tenant: TenantContext): Promise<{ items: MyIntakeListItem[] }> {
    return { items: await this.intakes.listMine(tenant.businessId, await this.client(tenant)) };
  }

  /** `get(id)`. */
  @Get(':id')
  async get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<MyIntake> {
    return this.intakes.getMine(tenant.businessId, await this.client(tenant), id);
  }

  /** `saveStep(id, step, body)`. */
  @Put(':id/steps/:stepKey')
  async saveStep(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('stepKey', stepPipe) stepKey: string,
    @Body(new ZodValidationPipe(SaveIntakeStepRequest))
    body: z.output<typeof SaveIntakeStepRequest>,
  ): Promise<SavedIntakeStep> {
    const who = await this.client(tenant);
    return this.intakes.saveStep(tenant.businessId, who, id, stepKey, body.answers);
  }

  /** `submit(id, body)`. */
  @Post(':id/submit')
  @HttpCode(200)
  async submit(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(submitPipe) body: z.output<typeof SubmitIntakeRequest>,
  ): Promise<MyIntake> {
    const who = await this.uploader(auth, tenant);
    const store = requestContext.getStore();
    return this.intakes.submit(
      tenant.businessId,
      { kind: 'client', clientId: who.clientId, primary: who.primary },
      id,
      { userId: auth.userId, clientAccountId: who.clientAccountId },
      body,
      this.signer,
      { ip: store?.ip ?? null, userAgent: store?.userAgent ?? null },
    );
  }

  /** `createUpload(id, body)`. */
  @Post(':id/uploads')
  @HttpCode(200)
  async createUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(CreateIntakeUploadRequest))
    body: z.output<typeof CreateIntakeUploadRequest>,
  ): Promise<UploadTicket> {
    return this.files.createUpload(await this.uploader(auth, tenant), id, body);
  }

  /** `confirmUpload(id, body)`. */
  @Post(':id/uploads/confirm')
  @HttpCode(200)
  async confirmUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(ConfirmUploadRequest)) body: z.output<typeof ConfirmUploadRequest>,
  ): Promise<IntakeUpload> {
    return this.files.confirmUpload(await this.uploader(auth, tenant), id, body.uploadToken);
  }

  /** `removeUpload(id, uploadId)`. */
  @Delete(':id/uploads/:uploadId')
  async removeUpload(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('uploadId', uploadIdPipe) uploadId: string,
  ): Promise<OkResponse> {
    return this.files.removeUpload(await this.uploader(auth, tenant), id, uploadId);
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
    @Param('id', clientIdPipe) clientId: string,
  ): Promise<IntakeList> {
    return { items: await this.intakes.list(tenant.businessId, staff(auth, tenant), clientId) };
  }

  @Post('engagements/:id/intakes')
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', engagementIdPipe) engagementId: string,
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
  imports: [FieldEncryptionModule, DocumentsModule, AgreementsModule, NotificationsModule],
  controllers: [MyIntakesController, ClientIntakesController, IntakesController],
  providers: [IntakesService, IntakeUploadsService, INTAKE_SIGNING_PROVIDER],
  exports: [IntakesService, INTAKE_SIGNING],
})
export class IntakesModule {}
