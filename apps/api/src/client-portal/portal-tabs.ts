import {
  applyDecorators,
  Body,
  type CanActivate,
  ConflictException,
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
  PORTAL_MODULE_LABELS,
  PORTAL_TAB_LABELS,
  PortalModule,
  PortalTab,
  type PortalTabLayoutItem,
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
export const tabOff = (area: PortalModule) =>
  new ForbiddenException({
    code: 'MODULE_OFF',
    message: `${(PORTAL_TAB_LABELS as Partial<Record<PortalModule, string>>)[area] ?? PORTAL_MODULE_LABELS[area]} is turned off in this portal.`,
  });

/**
 * CP-4f (lead decision 1b): Settings > Client Portal > Contact Information's Allow Secure Messages
 * is a rule, not only a button: off, a client cannot start a conversation (403 MESSAGES_CLOSED);
 * a reply in a thread the firm started still goes through.
 */
export const messagesClosed = () =>
  new ForbiddenException({
    code: 'MESSAGES_CLOSED',
    message: "Your firm doesn't take new messages through the portal. Please call or email them.",
  });

type Tabs = Record<PortalTab, boolean>;
type LayoutChange = NonNullable<z.output<typeof UpdatePortalTabsRequest>['layout']>;

/** 409 DUPLICATE_LABEL: two tabs would share a name (CP-5b). */
const duplicateLabel = () =>
  new ConflictException({
    code: 'DUPLICATE_LABEL',
    message: 'Another tab already has this name. Choose a different one.',
  });
/** Each portal area: the firm's switch (on where it has none) and this client's own. */
export type ClientAreas = Record<PortalModule, { firmOn: boolean; clientOn: boolean }>;
const isTab = (m: PortalModule): m is PortalTab => (PortalTab.options as string[]).includes(m);

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

  /** The firm's switches and layout (Settings > Client Portal > Features). */
  async firm(businessId: string): Promise<PortalTabs> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => ({
      tabs: await this.read(tx),
      layout: await this.layout(tx),
    }));
  }

  /**
   * CP-5b, CP-5c: the six built-in tabs in the firm's order (a tab with no row keeps its default
   * place), each under the firm's name for it or its default name.
   */
  async layout(tx: TxClient): Promise<PortalTabLayoutItem[]> {
    const rows = await tx.portalTab.findMany({
      where: { kind: 'BUILT_IN' },
      select: { module: true, label: true, sortOrder: true },
    });
    const byTab = new Map(rows.map((r) => [r.module, r]));
    return PortalTab.options
      .map((tab, index) => {
        const row = byTab.get(tab);
        return {
          tab,
          label: row?.label ?? PORTAL_TAB_LABELS[tab],
          renamed: row?.label != null,
          at: row?.sortOrder ?? index,
          index,
        };
      })
      .sort((a, b) => a.at - b.at || a.index - b.index)
      .map(({ tab, label, renamed }) => ({ tab, label, renamed }));
  }

  /** CP-5b, CP-5c: saves the whole order and each tab's name; audited by what changed. */
  private async arrange(
    tx: TxClient,
    businessId: string,
    actorUserId: string,
    layout: LayoutChange,
  ): Promise<void> {
    const names = layout.map((i) => (i.label ?? PORTAL_TAB_LABELS[i.tab]).trim().toLowerCase());
    if (new Set(names).size !== names.length) throw duplicateLabel();
    const before = await this.layout(tx);
    const rows = await tx.portalTab.findMany({
      where: { kind: 'BUILT_IN' },
      select: { id: true, module: true },
    });
    const ids = new Map(rows.map((r) => [r.module, r.id]));
    try {
      for (const [sortOrder, item] of layout.entries()) {
        const id = ids.get(item.tab);
        const data = { label: item.label, sortOrder, updatedByUserId: actorUserId };
        if (id) await tx.portalTab.update({ where: { id }, data });
        else
          await tx.portalTab.create({
            data: { businessId, kind: 'BUILT_IN', module: item.tab, ...data },
          });
      }
    } catch (error) {
      // A custom tab's name (portal_tabs_live_label).
      if ((error as { code?: unknown }).code === 'P2002') throw duplicateLabel();
      throw error;
    }
    const after = await this.layout(tx);
    const moved = after.map((i) => i.tab).join() !== before.map((i) => i.tab).join();
    const renamed = after
      .filter((i) => i.label !== before.find((b) => b.tab === i.tab)?.label)
      .map((i) => i.tab);
    if (moved || renamed.length > 0) {
      await this.audit.logIn(
        tx,
        'portal.tabs_arranged',
        { type: 'business', id: businessId },
        { order: after.map((i) => i.tab), moved, renamed },
        { businessId },
      );
    }
  }

  /** CP-4f: 403 MESSAGES_CLOSED when the firm turned Allow Secure Messages off (on by default). */
  async assertNewThreadsOpen(businessId: string): Promise<void> {
    const row = await this.db.withScope({ kind: 'business', businessId }, (tx) =>
      tx.clientPortalSettings.findUnique({
        where: { businessId },
        select: { allowSecureMessage: true },
      }),
    );
    if (row && !row.allowSecureMessage) throw messagesClosed();
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
    layout?: LayoutChange,
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
      if (layout) await this.arrange(tx, businessId, actorUserId, layout);
      return { tabs: await this.read(tx), layout: await this.layout(tx) };
    });
  }

  /**
   * The Client Portal module's switches for one client (rows with the client's id) on top of
   * the firm's. In the caller's firm transaction.
   */
  async areasIn(tx: TxClient, clientId: string): Promise<ClientAreas> {
    const firm = await this.read(tx);
    const rows = await tx.portalModuleVisibility.findMany({
      where: { clientId },
      orderBy: { updatedAt: 'asc' },
      select: { module: true, visible: true },
    });
    const own = new Map(rows.map((r) => [r.module, r.visible]));
    return Object.fromEntries(
      PortalModule.options.map((m) => [
        m,
        { firmOn: isTab(m) ? firm[m] : true, clientOn: own.get(m) ?? true },
      ]),
    ) as ClientAreas;
  }

  /** What a signed-in client sees: each area on only when the firm's and their own are. */
  async forClientAccount(businessId: string, clientAccountId: string): Promise<PortalTabs> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const account = await tx.clientAccount.findUnique({
        where: { id: clientAccountId },
        select: { clientId: true },
      });
      if (!account?.clientId)
        return { tabs: await this.read(tx), layout: await this.layout(tx), businessPortal: false };
      const areas = await this.areasIn(tx, account.clientId);
      const on = (m: PortalModule) => areas[m].firmOn && areas[m].clientOn;
      // CP-9.3: a Personal portal lists no business-only tab (content.service's rule).
      const client = await tx.client.findUnique({
        where: { id: account.clientId },
        select: { accountType: true },
      });
      return {
        tabs: Object.fromEntries(PortalTab.options.map((t) => [t, on(t)])) as Tabs,
        more: {
          APPOINTMENTS: on('APPOINTMENTS'),
          TASKS_REQUESTS: on('TASKS_REQUESTS'),
          REPORTS: on('REPORTS'),
        },
        layout: await this.layout(tx),
        businessPortal: client?.accountType === 'BUSINESS',
      };
    });
  }

  /** Whether a signed-in client may open an area: the firm's switch and their own. */
  async isClientOn(
    businessId: string,
    clientAccountId: string,
    area: PortalModule,
  ): Promise<boolean> {
    const mine = await this.forClientAccount(businessId, clientAccountId);
    return isTab(area) ? mine.tabs[area] : (mine.more?.[area as keyof typeof mine.more] ?? true);
  }

  /** A signed-in client's route of a hidden area: 403 MODULE_OFF. */
  async assertClientOn(
    businessId: string,
    clientAccountId: string,
    area: PortalModule,
  ): Promise<void> {
    const mine = await this.forClientAccount(businessId, clientAccountId);
    const on = isTab(area)
      ? mine.tabs[area]
      : (mine.more?.[area as keyof typeof mine.more] ?? true);
    if (!on) throw tabOff(area);
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
    const area = this.reflector.getAllAndOverride<PortalModule | undefined>(TAB_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const tenant = ctx.switchToHttp().getRequest<Request>().tenant;
    if (!area || tenant?.kind !== 'client') return true;
    // The firm's switch and the client's own (Client Portal module, Portal Content).
    await this.tabs.assertClientOn(tenant.businessId, tenant.clientAccountId, area);
    return true;
  }
}

/** `@PortalTabRoute('TAX_RETURNS')` on a portal controller. Its module imports PortalTabsModule. */
export const PortalTabRoute = (area: PortalModule) =>
  applyDecorators(SetMetadata(TAB_KEY, area), UseGuards(PortalTabGuard));

/** Settings > Client Portal > Features: Owner and Admin. */
@Controller('business/settings/portal-tabs')
@Roles(...FIRM_MANAGERS)
export class PortalTabsController {
  constructor(private readonly tabs: PortalTabsService) {}

  @Get()
  async get(@CurrentTenant() tenant: TenantContext): Promise<PortalTabs> {
    return this.tabs.firm(tenant.businessId);
  }

  @Put()
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(UpdatePortalTabsRequest))
    body: z.output<typeof UpdatePortalTabsRequest>,
  ): Promise<PortalTabs> {
    return this.tabs.update(tenant.businessId, auth.userId, body.tabs ?? {}, body.layout);
  }
}

/** The portal's menu: which tabs the signed-in client's firm shows. */
@Controller('portal/:firmSlug/me/tabs')
@Roles('CLIENT')
export class MyPortalTabsController {
  constructor(private readonly tabs: PortalTabsService) {}

  @Get()
  async mine(@CurrentTenant() tenant: TenantContext): Promise<PortalTabs> {
    if (tenant.kind !== 'client') return this.tabs.firm(tenant.businessId);
    return this.tabs.forClientAccount(tenant.businessId, tenant.clientAccountId);
  }
}

@Module({
  controllers: [PortalTabsController, MyPortalTabsController],
  providers: [PortalTabsService, PortalTabGuard],
  exports: [PortalTabsService, PortalTabGuard],
})
export class PortalTabsModule {}
