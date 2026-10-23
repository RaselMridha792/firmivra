import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type {
  IntakeFormDetail,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeSettings,
  IntakeSettingsChangeList,
  OkResponse,
  PublicLink,
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
import { IntakeBuilderService } from './intake-builder.service.js';
import { IntakeLibraryService } from './intake-library.service.js';
import { IntakeSettingsService } from './intake-settings.service.js';
import {
  DuplicateFormBody,
  FormIdParam,
  FormsQ,
  ResetSettingsBody,
  SaveExistingFormBody,
  SaveFormBody,
  UpdateSettingsBody,
} from './workspace-input.js';

type Out<S extends z.ZodType> = z.output<S>;
const formIdPipe = new ZodValidationPipe(FormIdParam);

/** The form library (Form Templates) and the builder. Static routes before ':id'. */
@Controller('business/intake-forms')
@Access('INTAKE_FORMS')
@Roles(...FIRM_STAFF)
export class IntakeFormsController {
  constructor(
    private readonly library: IntakeLibraryService,
    private readonly builder: IntakeBuilderService,
  ) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(FormsQ)) q: Out<typeof FormsQ>,
  ): Promise<IntakeFormList> {
    return this.library.list(tenant, q);
  }

  @Get('summary')
  summary(@CurrentTenant() tenant: TenantContext): Promise<IntakeFormLibrarySummary> {
    return this.library.summary(tenant);
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveFormBody)) body: Out<typeof SaveFormBody>,
  ): Promise<IntakeFormDetail> {
    return this.builder.create(tenant, auth.userId, body);
  }

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
  ): Promise<IntakeFormDetail> {
    return this.library.detail(tenant, id);
  }

  /** A main form's link and embed code (its Begin Online page); 404 for any other form. */
  @Get(':id/public-link')
  publicLink(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
  ): Promise<PublicLink> {
    return this.library.publicLink(tenant, id);
  }

  @Put(':id')
  @Roles(...FIRM_MANAGERS)
  save(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
    @Body(new ZodValidationPipe(SaveExistingFormBody)) body: Out<typeof SaveExistingFormBody>,
  ): Promise<IntakeFormDetail> {
    return this.builder.save(tenant, auth.userId, id, body);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  publish(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
  ): Promise<IntakeFormDetail> {
    return this.builder.publish(tenant, id);
  }

  @Post(':id/duplicate')
  @Roles(...FIRM_MANAGERS)
  duplicate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
    @Body(new ZodValidationPipe(DuplicateFormBody)) body: Out<typeof DuplicateFormBody>,
  ): Promise<IntakeFormDetail> {
    return this.builder.duplicate(tenant, auth.userId, id, body.asTemplate);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  archive(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', formIdPipe) id: string,
  ): Promise<IntakeFormDetail> {
    return this.builder.archive(tenant, id);
  }
}

/** The firm's Intake Forms settings. Owner and Admin change them. */
@Controller('business/intake-settings')
@Access('INTAKE_FORMS')
@Roles(...FIRM_STAFF)
export class IntakeSettingsController {
  constructor(private readonly settings: IntakeSettingsService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<IntakeSettings> {
    return this.settings.get(tenant);
  }

  @Get('changes')
  changes(@CurrentTenant() tenant: TenantContext): Promise<IntakeSettingsChangeList> {
    return this.settings.changes(tenant);
  }

  @Put()
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateSettingsBody)) body: Out<typeof UpdateSettingsBody>,
  ): Promise<IntakeSettings> {
    return this.settings.update(tenant, auth.userId, body);
  }

  @Post('reset')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  reset(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ResetSettingsBody)) body: Out<typeof ResetSettingsBody>,
  ): Promise<IntakeSettings> {
    return this.settings.reset(tenant, auth.userId, body);
  }

  @Post('test-reminder')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  testReminder(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<OkResponse> {
    return this.settings.testReminder(tenant, auth.userId);
  }
}
