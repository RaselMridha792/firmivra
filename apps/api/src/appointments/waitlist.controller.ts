import { Body, Controller, Get, HttpCode, Param, Post, Put, Query } from '@nestjs/common';
import type {
  MyWaitlist,
  MyWaitlistEntry,
  WaitlistEntry,
  WaitlistEntryList,
  WaitlistSettings,
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
import { PortalTabRoute } from '../client-portal/portal-tabs.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { firmActor, portalLogin } from './request-actors.js';
import {
  JoinWaitlistBody,
  SaveWaitlistSettingsBody,
  WaitlistEntryParam,
  WaitlistListQuery,
} from './waitlist.input.js';
import { AppointmentWaitlistService } from './waitlist.service.js';

const entryPipe = new ZodValidationPipe(WaitlistEntryParam);

/**
 * Appointments A3 (R55): the firm's waitlist for earlier times. Everyone at the firm lists it
 * (Staff: the entries of appointments they see in full) and decides requests; Owner and Admin set
 * the switch and the mode.
 */
@Controller('business/appointment-waitlist')
@Access('APPOINTMENTS')
@Roles(...FIRM_STAFF)
export class AppointmentWaitlistController {
  constructor(private readonly waitlist: AppointmentWaitlistService) {}

  @Get()
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(WaitlistListQuery)) q: z.output<typeof WaitlistListQuery>,
  ): Promise<WaitlistEntryList> {
    return this.waitlist.list(tenant.businessId, firmActor(auth, tenant), q);
  }

  @Get('settings')
  @Roles(...FIRM_MANAGERS)
  settings(@CurrentTenant() tenant: TenantContext): Promise<WaitlistSettings> {
    return this.waitlist.settings(tenant.businessId);
  }

  @Put('settings')
  @Roles(...FIRM_MANAGERS)
  saveSettings(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(SaveWaitlistSettingsBody))
    body: z.output<typeof SaveWaitlistSettingsBody>,
  ): Promise<WaitlistSettings> {
    return this.waitlist.saveSettings(tenant.businessId, body);
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', entryPipe) id: string,
  ): Promise<WaitlistEntry> {
    return this.waitlist.approve(tenant.businessId, firmActor(auth, tenant), id);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', entryPipe) id: string,
  ): Promise<WaitlistEntry> {
    return this.waitlist.reject(tenant.businessId, firmActor(auth, tenant), id);
  }
}

/**
 * The signed-in client's waitlist entries at one firm (portal). The firm comes from the slug and
 * the client from the session, never from the URL; another client's entry is 404.
 */
@Controller('portal/:firmSlug/me/appointment-waitlist')
@Roles('CLIENT')
@PortalTabRoute('APPOINTMENTS')
export class MyWaitlistController {
  constructor(private readonly waitlist: AppointmentWaitlistService) {}

  @Get()
  list(@CurrentTenant() tenant: TenantContext): Promise<MyWaitlist> {
    const me = portalLogin(tenant);
    return this.waitlist.mine(me.businessId, me.clientAccountId);
  }

  @Post()
  join(
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(JoinWaitlistBody)) body: z.output<typeof JoinWaitlistBody>,
  ): Promise<MyWaitlistEntry> {
    const me = portalLogin(tenant);
    return this.waitlist.join(me.businessId, me.clientAccountId, body.appointmentId);
  }

  @Post(':id/accept')
  @HttpCode(200)
  accept(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', entryPipe) id: string,
  ): Promise<MyWaitlistEntry> {
    const me = portalLogin(tenant);
    return this.waitlist.accept(me.businessId, me.clientAccountId, id);
  }

  @Post(':id/decline')
  @HttpCode(200)
  decline(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', entryPipe) id: string,
  ): Promise<MyWaitlistEntry> {
    const me = portalLogin(tenant);
    return this.waitlist.decline(me.businessId, me.clientAccountId, id);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', entryPipe) id: string,
  ): Promise<MyWaitlistEntry> {
    const me = portalLogin(tenant);
    return this.waitlist.leave(me.businessId, me.clientAccountId, id);
  }
}
