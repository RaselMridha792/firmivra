import { Body, Controller, Get, Module, Param, Post, Put } from '@nestjs/common';
import type { z } from 'zod';
import {
  ClientId,
  type ClientTags,
  CreateTagRequest,
  type FirmTag,
  type FirmTagList,
  SetClientTagsRequest,
} from '@firmivra/types';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { type TagsActor, TagsService } from './tags.service.js';

type Out<S extends z.ZodType> = z.output<S>;
const idPipe = new ZodValidationPipe(ClientId);

/** The signed-in member as the tag rules need them. Firm roles only (see @Roles). */
function actorOf(auth: AuthContext, tenant: TenantContext): TagsActor {
  if (tenant.kind !== 'staff') throw new Error('tag routes are for firm members');
  return { userId: auth.userId, role: legacyFirmRole(tenant.role) };
}

/** The firm's tags (L5, L6): every member reads them; Owner and Admin add one. */
@Controller('business/tags')
export class TagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  @Roles(...FIRM_STAFF)
  list(@CurrentTenant() tenant: TenantContext): Promise<FirmTagList> {
    return this.tags.list(tenant.businessId);
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateTagRequest)) body: Out<typeof CreateTagRequest>,
  ): Promise<FirmTag> {
    return this.tags.create(tenant.businessId, actorOf(auth, tenant), body);
  }
}

/** A client's tags (L5): read and replaced by the members who reach the client. */
@Controller('business/clients/:id/tags')
@Access('CLIENTS')
@Roles(...FIRM_STAFF)
export class ClientTagsController {
  constructor(private readonly tags: TagsService) {}

  @Get()
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientTags> {
    return this.tags.clientTags(tenant.businessId, actorOf(auth, tenant), id);
  }

  @Put()
  set(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(SetClientTagsRequest)) body: Out<typeof SetClientTagsRequest>,
  ): Promise<ClientTags> {
    return this.tags.setClientTags(tenant.businessId, actorOf(auth, tenant), id, body);
  }
}

@Module({
  controllers: [TagsController, ClientTagsController],
  providers: [TagsService],
})
export class TagsModule {}
