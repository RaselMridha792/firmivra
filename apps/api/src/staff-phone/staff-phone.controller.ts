import { Body, Controller, Get, HttpCode, Module, Post } from '@nestjs/common';
import { type StaffPhoneState, VerifyStaffPhoneRequest } from '@firmivra/types';
import { z } from 'zod';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type PhoneOwner, StaffPhoneService } from './staff-phone.service.js';

const emptyPipe = new ZodValidationPipe(z.strictObject({}));
const verifyPipe = new ZodValidationPipe(VerifyStaffPhoneRequest);

/** The signed-in member in the firm the request acts in: never from the URL or the body. */
function ownerOf(auth: AuthContext | undefined, tenant: TenantContext | undefined): PhoneOwner {
  if (!auth || !tenant || tenant.kind === 'client') {
    throw new Error('staff phone routes need a signed-in member in a firm');
  }
  return { businessId: tenant.businessId, userId: auth.userId };
}

/**
 * The member's own mobile number (R60's column requests 9 and 13): its state, Send Code and
 * Verify. Every firm role, for themselves only; the number itself is set in the staff record.
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

@Module({ controllers: [StaffPhoneController], providers: [StaffPhoneService] })
export class StaffPhoneModule {}
