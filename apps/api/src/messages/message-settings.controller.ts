import { Body, Controller, Get, Patch } from '@nestjs/common';
import type { z } from 'zod';
import { type MessageSettings, UpdateMessageSettingsRequest } from '@firmivra/types';
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
import { MessageSettingsService } from './message-settings.service.js';

/** Messages Settings (MSG-F02): every member reads them; Owner and Admin change them. */
@Controller('business/message-settings')
@Access('MESSAGES')
@Roles(...FIRM_STAFF)
export class MessageSettingsController {
  constructor(private readonly settings: MessageSettingsService) {}

  @Get()
  get(@CurrentTenant() tenant: TenantContext): Promise<MessageSettings> {
    return this.settings.get(tenant.businessId);
  }

  @Patch()
  @Roles(...FIRM_MANAGERS)
  @Access('MESSAGES', 'MANAGE')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdateMessageSettingsRequest))
    body: z.output<typeof UpdateMessageSettingsRequest>,
  ): Promise<MessageSettings> {
    return this.settings.update(tenant.businessId, auth.userId, body);
  }
}
