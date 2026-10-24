import {
  applyDecorators,
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Put,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import type { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  PORTAL_TAB_LABELS,
  PortalTab,
  type PortalTabs,
  UpdatePortalTabsRequest,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { CurrentAuth, CurrentTenant, FIRM_MANAGERS, Roles } from '../auth/decorators.js';
import type { AuthContext, TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

// Client Portal guide 5 and 7.2 (Rasel, Oct 24: the parts without schema). The firm turns five
// portal tabs on and off with `portal_module_visibility` rows that have no client. The portal API
// refuses a hidden tab as well as the menu hiding it. Nothing is ever deleted: turning a tab back
// on restores it as it was.

/** 403 MODULE_OFF, as a switched-off Firm Sign or calculators (common/modules). */
export const tabOff = (tab: PortalTab) =>
  new ForbiddenException({
    code: 'MODULE_OFF',
    message: `${PORTAL_TAB_LABELS[tab]} is turned off in this portal.`,
  });

type Tabs = Record<PortalTab, boolean>;

@Injectable()
export class PortalTabsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AuditService,
  ) {}

  /** Every tab, on unless the firm switched it off. */
  async tabs(businessId: string): Promise<Tabs> {
    return this.db.withScope({ kind: 'business', businessId }, (tx) => this.read(tx));
  }

  async isOn(businessId: string, tab: PortalTab): Promise<boolean> {
    return (await this.tabs(businessId))[tab];
  }

  async assertOn(businessId: string, tab: PortalTab): Promise<void> {
    if (!(await this.isOn(businessId, tab))) throw tabOff(tab);
  }

  /** Saves the tabs sent; audited with the tabs turned on and off, once each. */
  async update(
    businessId: string,
    actorUserId: string,
    changes: Partial<Tabs>,
  ): Promise<PortalTabs> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      // One save at a time per firm, so two saves never leave two rows for a tab.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`portal-tabs:${businessId}`}))) AS l`;
      const before = await this.read(tx);
      const turnedOn: PortalTab[] = [];
      const turnedOff: PortalTab[] = [];
      for (const tab of PortalTab.options) {
        const visible = changes[tab];
        if (visible === undefined || visible === before[tab]) continue;
        (visible ? turnedOn : turnedOff).push(tab);
        await tx.portalModuleVisibility.deleteMany({ where: { clientId: null, module: tab } });
        await tx.portalModuleVisibility.create({
          data: { businessId, module: tab, visible, changedByUserId: actorUserId },
        });
      }
      if (turnedOn.length + turnedOff.length > 0) {
        await this.audit.logIn(
          tx,
          'portal.tabs_changed',
          { type: 'business', id: businessId },
          { turnedOn, turnedOff },
          { businessId },
        );
      }
      return { tabs: await this.read(tx) };
    });
  }

  private async read(tx: TxClient): Promise<Tabs> {
    const rows = await tx.portalModuleVisibility.findMany({
      where: { clientId: null, module: { in: [...PortalTab.options] } },
      // The newest row wins, should an older one remain.
      orderBy: { updatedAt: 'asc' },
      select: { module: true, visible: true },
    });
    const tabs = Object.fromEntries(PortalTab.options.map((tab) => [tab, true])) as Tabs;
    for (const row of rows) tabs[row.module as PortalTab] = row.visible;
    return tabs;
  }
}

const TAB_KEY = 'firmivra:portal-tab';

/** After the global guards: a signed-in client on a hidden tab's route gets 403 MODULE_OFF. */
@Injectable()
export class PortalTabGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tabs: PortalTabsService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const tab = this.reflector.getAllAndOverride<PortalTab | undefined>(TAB_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
    if (!tab || tenant?.kind !== 'client') return true;
    await this.tabs.assertOn(tenant.businessId, tab);
    return true;
  }
}

/** `@PortalTabRoute('TAX_RETURNS')` on a portal controller. Its module imports PortalTabsModule. */
export const PortalTabRoute = (tab: PortalTab) =>
  applyDecorators(SetMetadata(TAB_KEY, tab), UseGuards(PortalTabGuard));

/** Settings > Client Portal > Features: Owner and Admin. */
@Controller('business/settings/portal-tabs')
@Roles(...FIRM_MANAGERS)
export class PortalTabsController {
  constructor(private readonly tabs: PortalTabsService) {}

  @Get()
  async get(@CurrentTenant() tenant: TenantContext): Promise<PortalTabs> {
    return { tabs: await this.tabs.tabs(tenant.businessId) };
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdatePortalTabsRequest))
    body: z.output<typeof UpdatePortalTabsRequest>,
  ): Promise<PortalTabs> {
    return this.tabs.update(tenant.businessId, auth.userId, body.tabs);
  }
}

/** The portal's menu: which tabs the signed-in client's firm shows. */
@Controller('portal/:firmSlug/me/tabs')
@Roles('CLIENT')
export class MyPortalTabsController {
  constructor(private readonly tabs: PortalTabsService) {}

  @Get()
  async mine(@CurrentTenant() tenant: TenantContext): Promise<PortalTabs> {
    return { tabs: await this.tabs.tabs(tenant.businessId) };
  }
}

@Module({
  controllers: [PortalTabsController, MyPortalTabsController],
  providers: [PortalTabsService, PortalTabGuard],
  exports: [PortalTabsService, PortalTabGuard],
})
export class PortalTabsModule {}
