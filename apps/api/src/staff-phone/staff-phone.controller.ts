import { Body, Controller, Get, HttpCode, Module, Post, Put } from '@nestjs/common';
import {
  SetStaffPhoneRequest,
  type StaffPhoneState,
  VerifyStaffPhoneRequest,
} from '@firmivra/types';
import { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { MyProfileController, MyProfileService } from './my-profile.js';
import { type PhoneOwner, StaffPhoneService } from './staff-phone.service.js';

const emptyPipe = new ZodValidationPipe(z.strictObject({}));
const verifyPipe = new ZodValidationPipe(VerifyStaffPhoneRequest);
const setPipe = new ZodValidationPipe(SetStaffPhoneRequest);

/** The signed-in member in the firm the request acts in: never from the URL or the body. */
function ownerOf(auth: AuthContext | undefined, tenant: TenantContext | undefined): PhoneOwner {
  if (!auth || !tenant || tenant.kind === 'client') {
    throw new Error('staff phone routes need a signed-in member in a firm');
  }
  return { businessId: tenant.businessId, userId: auth.userId, role: tenant.role };
}

/**
 * The member's own mobile number (R60's column requests 9 and 13): its state, Send Code and
 * Verify, and (Overview guide 20) setting or removing it on My Profile. Every firm role, for
 * themselves only; administrators also set it in the staff record.
 */
@Controller('business/me/phone')
@Access('DASHBOARD', 'VIEW')
@Roles(...FIRM_STAFF)
export class StaffPhoneController {
  constructor(private readonly phones: StaffPhoneService) {}

  @Get()
  state(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
  ): Promise<StaffPhoneState> {
    return this.phones.state(ownerOf(auth, tenant));
  }

  @Put()
  set(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(setPipe) body: z.output<typeof SetStaffPhoneRequest>,
  ): Promise<StaffPhoneState> {
    return this.phones.setPhone(ownerOf(auth, tenant), body.phone);
  }

  @Post('code')
  @HttpCode(200)
  sendCode(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(emptyPipe) _body: Record<string, never>,
  ): Promise<StaffPhoneState> {
    return this.phones.sendCode(ownerOf(auth, tenant));
  }

  @Post('verify')
  @HttpCode(200)
  verify(
    @CurrentAuth() auth: AuthContext | undefined,
    @CurrentTenant() tenant: TenantContext | undefined,
    @Body(verifyPipe) body: z.output<typeof VerifyStaffPhoneRequest>,
  ): Promise<StaffPhoneState> {
    return this.phones.verify(ownerOf(auth, tenant), body.code);
  }
}

@Module({
  controllers: [StaffPhoneController, MyProfileController],
  providers: [StaffPhoneService, MyProfileService],
})
export class StaffPhoneModule {}
