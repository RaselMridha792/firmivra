import { Body, Controller, Get, Post } from '@nestjs/common';
import {
  CreateProfileChangeRequest,
  type ProfileChange,
  type ProfileChangeList,
} from '@firmivra/types';
import type { z } from 'zod';
import {
  AllowBusinessStatuses,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ProfileChangesService } from './profile-changes.service.js';

/**
 * Company Profile's Request Change (`api.profileChanges`): the legal name, the EIN and the
 * licensing details, changed only by Firmivra. Owner and Admin, also while Pending Setup.
 */
@Controller('business/settings/profile/change-requests')
@Roles(...FIRM_MANAGERS)
@AllowBusinessStatuses('PENDING_SETUP', 'ACTIVE')
export class ProfileChangesController {
  constructor(private readonly changes: ProfileChangesService) {}

  @Get()
  list(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
  ): Promise<ProfileChangeList> {
    return this.changes.list(tenant.businessId, auth.userId);
  }

  @Post()
  create(
    @CurrentTenant() tenant: TenantContext,
    @CurrentAuth() auth: AuthContext,
    @Body(new ZodValidationPipe(CreateProfileChangeRequest))
    body: z.output<typeof CreateProfileChangeRequest>,
  ): Promise<ProfileChange> {
    return this.changes.create(tenant.businessId, auth.userId, body);
  }
}
