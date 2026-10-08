import { Body, Controller, Get, HttpCode, Patch, Post } from '@nestjs/common';
import type { z } from 'zod';
import {
  type MyProfile,
  type OkResponse,
  RequestNameChangeRequest,
  UpdateMyProfileRequest,
} from '@firmivra/types';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyProfileService } from './my-profile.service.js';

/** The client's account from the session (TenantGuard), never from the URL. */
function accountOf(tenant: TenantContext): string {
  if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
  return tenant.clientAccountId;
}

/**
 * The signed-in client's My Profile at one firm (R10 step 4). Name and date of birth are locked;
 * spouse and authorized logins read it without the date of birth and change nothing.
 */
@Controller('portal/:firmSlug/me/profile')
@Roles('CLIENT')
export class MyProfileController {
  constructor(private readonly profiles: MyProfileService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<MyProfile> {
    return this.profiles.get(tenant.businessId, accountOf(tenant));
  }

  /** PATCH, as the contract client sends it (partial: only the fields given change). */
  @Patch()
  update(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateMyProfileRequest))
    body: z.output<typeof UpdateMyProfileRequest>,
  ): Promise<MyProfile> {
    return this.profiles.update(tenant.businessId, accountOf(tenant), body);
  }

  @Post('name-change')
  @HttpCode(200)
  requestNameChange(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(RequestNameChangeRequest))
    body: z.output<typeof RequestNameChangeRequest>,
  ): Promise<OkResponse> {
    return this.profiles.requestNameChange(tenant.businessId, accountOf(tenant), body);
  }
}
