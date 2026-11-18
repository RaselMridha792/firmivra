import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Module,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import type { z } from 'zod';
import {
  ContentId,
  type ContentItem,
  type ContentList,
  type MyContentList,
  type OkResponse,
} from '@firmivra/types';
import {
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { CreateBody, ListQuery, MyListQuery, UpdateBody } from './content.input.js';
import { ContentService } from './content.service.js';
import { PortalTabsModule, PortalTabsService, tabOff } from '../client-portal/portal-tabs.js';

const idPipe = new ZodValidationPipe(ContentId);

/**
 * The firm's content editor (R12 step 3; contract in packages/types/src/content): resources,
 * tips and external links. Everyone at the firm reads; Owner and Admin create, edit, publish,
 * unpublish and delete (Staff 403). The firm comes from TenantGuard.
 */
@Controller('business/content')
export class ContentController {
  constructor(private readonly content: ContentService) {}

  @Get()
  @Roles(...FIRM_STAFF)
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(ListQuery)) query: z.output<typeof ListQuery>,
  ): Promise<ContentList> {
    return { items: await this.content.list(tenant.businessId, query) };
  }

  @Post()
  @Roles(...FIRM_MANAGERS)
  create(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreateBody)) body: z.output<typeof CreateBody>,
  ): Promise<ContentItem> {
    return this.content.create(tenant.businessId, auth.userId, body);
  }

  @Patch(':id')
  @Roles(...FIRM_MANAGERS)
  update(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(UpdateBody)) body: z.output<typeof UpdateBody>,
  ): Promise<ContentItem> {
    return this.content.update(tenant.businessId, id, body);
  }

  @Post(':id/publish')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  publish(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ContentItem> {
    return this.content.publish(tenant.businessId, id);
  }

  @Post(':id/unpublish')
  @Roles(...FIRM_MANAGERS)
  @HttpCode(200)
  unpublish(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ContentItem> {
    return this.content.unpublish(tenant.businessId, id);
  }

  @Delete(':id')
  @Roles(...FIRM_MANAGERS)
  remove(
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<OkResponse> {
    return this.content.remove(tenant.businessId, id);
  }
}

/**
 * The firm's published content for the signed-in client (portal). The client comes from the
 * session (TenantGuard's client account), never from the URL; resources and external links are
 * 403 BUSINESS_ONLY unless the client record is a business.
 */
@Controller('portal/:firmSlug/me/content')
@Roles('CLIENT')
export class MyContentController {
  constructor(
    private readonly content: ContentService,
    private readonly tabs: PortalTabsService,
  ) {}

  @Get()
  async list(
    @CurrentTenant() tenant: TenantContext,
    @Query(new ZodValidationPipe(MyListQuery)) query: z.output<typeof MyListQuery>,
  ): Promise<MyContentList> {
    if (tenant.kind !== 'client')
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
    const items = await this.content.mine(tenant.businessId, tenant.clientAccountId, query);
    // CP-5a: with Business Documents & Resources off (the firm's switch or the client's own),
    // its resources and links are 403 MODULE_OFF by address, and a whole list keeps tips only.
    const on = await this.tabs.isClientOn(
      tenant.businessId,
      tenant.clientAccountId,
      'BUSINESS_RESOURCES',
    );
    if (on) return { items };
    if (query.kind && query.kind !== 'TIP') throw tabOff('BUSINESS_RESOURCES');
    return { items: items.filter((item) => item.kind === 'TIP') };
  }
}

@Module({
  imports: [PortalTabsModule],
  controllers: [ContentController, MyContentController],
  providers: [ContentService],
})
export class ContentModule {}
