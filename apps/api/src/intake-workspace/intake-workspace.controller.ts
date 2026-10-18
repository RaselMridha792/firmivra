import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type {
  IntakeFormDetail,
  IntakeFormLibrarySummary,
  IntakeFormList,
  IntakeSettings,
  IntakeSettingsChangeList,
  OkResponse,
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
import { IntakeLibraryService } from './intake-library.service.js';
import { IntakeSettingsService } from './intake-settings.service.js';
import { FormIdParam, FormsQ, ResetSettingsBody, UpdateSettingsBody } from './workspace-input.js';

type Out<S extends z.ZodType> = z.output<S>;

/** The form library (Form Templates). Static routes before ':id'. */
@Controller('business/intake-forms')
@Access('INTAKE_FORMS')
@Roles(...FIRM_STAFF)
export class IntakeFormsController {
  constructor(private readonly library: IntakeLibraryService) {}

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

  @Get(':id')
  get(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(FormIdParam)) id: string,
  ): Promise<IntakeFormDetail> {
    return this.library.detail(tenant, id);
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
  testReminder(@CurrentTenant() tenant: TenantContext): OkResponse {
    return this.settings.testReminder(tenant);
  }
}
