import { Body, Controller, Get, HttpCode, Module, Param, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { z } from 'zod';
import {
  ClientId,
  type ClientPortalAccess,
  type OpenedPortalInvitation,
  OpenPortalInvitationRequest,
  SendPortalInvitationRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_STAFF,
  Public,
  Roles,
} from '../auth/decorators.js';
import { poolSecrets } from '../auth/sealed.js';
import { PortalInfoModule } from '../client-auth/portal-info.controller.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import {
  INVITATION_SEALS,
  type InvitationActor,
  PortalInvitationSeals,
  PortalInvitationsService,
} from './portal-invitations.service.js';

const idPipe = new ZodValidationPipe(ClientId);

function actorOf(auth: AuthContext, tenant: TenantContext): InvitationActor {
  if (tenant.kind !== 'staff') throw new Error('portal invitation routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}

/**
 * A client's portal access and the invitation to it (contract in
 * packages/types/src/client-invitations). Owner, Admin and the client's assigned Staff (others
 * 404), as on the client's record; the firm comes from TenantGuard.
 */
@Controller('business/clients/:id')
@Access('CLIENTS')
export class PortalInvitationsController {
  constructor(private readonly invitations: PortalInvitationsService) {}

  @Get('portal-access')
  @Roles(...FIRM_STAFF)
  access(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientPortalAccess> {
    return this.invitations.access(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('portal-invitation')
  @Roles(...FIRM_STAFF)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  send(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SendPortalInvitationRequest))
    _body: z.output<typeof SendPortalInvitationRequest>,
  ): Promise<ClientPortalAccess> {
    return this.invitations.send(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Post('portal-invitation/revoke')
  @Roles(...FIRM_STAFF)
  @HttpCode(200)
  revoke(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientPortalAccess> {
    return this.invitations.revoke(tenant.businessId, actorOf(auth, tenant), id);
  }
}

/** The signed-out invitation page on the firm's portal; the firm comes from the slug. */
@Controller('portal/:firmSlug/invitation')
export class PortalInvitationOpenController {
  constructor(private readonly invitations: PortalInvitationsService) {}

  @Post()
  @Public()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  open(
    @Param('firmSlug') slug: string,
    @Body(new ZodValidationPipe(OpenPortalInvitationRequest))
    body: z.output<typeof OpenPortalInvitationRequest>,
  ): Promise<OpenedPortalInvitation> {
    return this.invitations.open(slug, body.token);
  }
}

@Module({
  imports: [PortalInfoModule],
  controllers: [PortalInvitationsController, PortalInvitationOpenController],
  providers: [
    PortalInvitationsService,
    {
      provide: INVITATION_SEALS,
      inject: [ENV],
      useFactory: (env: Env) => new PortalInvitationSeals(poolSecrets(env)),
    },
  ],
})
export class PortalInvitationsModule {}
