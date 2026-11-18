import {
  applyDecorators,
  Body,
  type CanActivate,
  ConflictException,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
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
import { z } from 'zod';
import type { Database, TxClient } from '@firmivra/db';
import {
  PORTAL_MODULE_LABELS,
  PORTAL_TAB_LABELS,
  PortalModule,
  CreatePortalCustomTab,
  type MyCustomTab,
  PortalTab,
  type PortalCustomTab,
  type PortalCustomTabList,
  type PortalTabLayoutItem,
  type PortalTabs,
  UpdatePortalCustomTab,
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

const customNotFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

const customSelect = {
  id: true,
  label: true,
  module: true,
  enabled: true,
  audience: true,
  targets: {
    select: { tagId: true, clientId: true, client: { select: { displayName: true } } },
  },
} as const;

type CustomRow = {
  id: string;
  label: string | null;
  module: PortalModule;
  enabled: boolean;
  audience: PortalCustomTab['audience'];
  targets: {
    tagId: string | null;
    clientId: string | null;
    client: { displayName: string } | null;
  }[];
};

const toCustom = (r: CustomRow): PortalCustomTab => ({
  id: r.id,
  label: r.label ?? '',
  module: r.module as PortalCustomTab['module'],
  enabled: r.enabled,
  audience: r.audience,
  tagIds: r.targets.flatMap((t) => (t.tagId ? [t.tagId] : [])),
  clients: r.targets
    .flatMap((t) => (t.clientId ? [{ id: t.clientId, name: t.client?.displayName ?? '' }] : []))
    .sort((a, b) => a.name.localeCompare(b.name)),
});
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
      custom: [],
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
      return { tabs: await this.read(tx), layout: await this.layout(tx), custom: [] };
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

  // ---------- Custom tabs (CP-5d, CP-5e) ----------

  /** The firm's live custom tabs, in their order. */
  private async customRows(tx: TxClient): Promise<PortalCustomTab[]> {
    const rows = await tx.portalTab.findMany({
      where: { kind: 'CUSTOM', archivedAt: null },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: customSelect,
      take: 50,
    });
    return rows.map(toCustom);
  }

  async customList(businessId: string): Promise<PortalCustomTabList> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => ({
      items: await this.customRows(tx),
    }));
  }

  /** A name no other live tab (built-in by its current name, or custom) has, ignoring case. */
  private async nameFree(tx: TxClient, label: string, exceptId?: string): Promise<void> {
    const name = label.trim().toLowerCase();
    const builtIn = (await this.layout(tx)).some((i) => i.label.trim().toLowerCase() === name);
    const custom = (await this.customRows(tx)).some(
      (t) => t.id !== exceptId && t.label.trim().toLowerCase() === name,
    );
    if (builtIn || custom) throw duplicateLabel();
  }

  /** Replaces a tab's targets with these (the audience decides which kind). */
  private async setTargets(
    tx: TxClient,
    businessId: string,
    tabId: string,
    targets: { tagIds: string[]; clientIds: string[] },
  ): Promise<void> {
    await tx.portalTabTarget.deleteMany({ where: { portalTabId: tabId } });
    const rows = [
      ...[...new Set(targets.tagIds)].map((tagId) => ({ businessId, portalTabId: tabId, tagId })),
      ...[...new Set(targets.clientIds)].map((clientId) => ({
        businessId,
        portalTabId: tabId,
        clientId,
      })),
    ];
    if (rows.length === 0) return;
    // Another firm's tag or client is not found here (row-level security and the foreign key).
    const [tags, clients] = await Promise.all([
      tx.tag.count({ where: { id: { in: targets.tagIds }, archivedAt: null } }),
      tx.client.count({ where: { id: { in: targets.clientIds } } }),
    ]);
    if (tags !== new Set(targets.tagIds).size || clients !== new Set(targets.clientIds).size)
      throw customNotFound();
    await tx.portalTabTarget.createMany({ data: rows });
  }

  async customCreate(
    businessId: string,
    actorUserId: string,
    body: z.output<typeof CreatePortalCustomTab>,
  ): Promise<PortalCustomTab> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`portal-tabs:${businessId}`}))) AS l`;
      await this.nameFree(tx, body.label);
      const last = await tx.portalTab.aggregate({ _max: { sortOrder: true } });
      const created = await tx.portalTab.create({
        data: {
          businessId,
          kind: 'CUSTOM',
          module: body.module,
          label: body.label,
          sortOrder: Math.min(999, Math.max(6, (last._max.sortOrder ?? 5) + 1)),
          audience: body.audience,
          updatedByUserId: actorUserId,
        },
        select: { id: true },
      });
      await this.setTargets(tx, businessId, created.id, body);
      await this.audit.logIn(
        tx,
        'portal.custom_tab_created',
        { type: 'portal_tab', id: created.id },
        {
          module: body.module,
          audience: body.audience,
          tags: body.tagIds.length,
          clients: body.clientIds.length,
        },
        { businessId },
      );
      return toCustom(
        await tx.portalTab.findUniqueOrThrow({ where: { id: created.id }, select: customSelect }),
      );
    });
  }

  async customUpdate(
    businessId: string,
    actorUserId: string,
    id: string,
    body: z.output<typeof UpdatePortalCustomTab>,
  ): Promise<PortalCustomTab> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`portal-tabs:${businessId}`}))) AS l`;
      const found = await tx.portalTab.findFirst({
        where: { id, kind: 'CUSTOM', archivedAt: null },
        select: customSelect,
      });
      if (!found) throw customNotFound();
      const before = toCustom(found);
      if (body.label !== undefined) await this.nameFree(tx, body.label, id);
      await tx.portalTab.update({
        where: { id },
        data: {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(body.audience !== undefined ? { audience: body.audience } : {}),
          updatedByUserId: actorUserId,
        },
      });
      if (body.audience !== undefined) {
        await this.setTargets(tx, businessId, id, {
          tagIds: body.tagIds ?? [],
          clientIds: body.clientIds ?? [],
        });
      }
      const after = toCustom(
        await tx.portalTab.findUniqueOrThrow({ where: { id }, select: customSelect }),
      );
      await this.audit.logIn(
        tx,
        'portal.custom_tab_updated',
        { type: 'portal_tab', id },
        {
          renamed: before.label !== after.label,
          ...(before.enabled !== after.enabled ? { enabled: after.enabled } : {}),
          ...(body.audience !== undefined ? { audience: after.audience } : {}),
        },
        { businessId },
      );
      return after;
    });
  }

  /** Hides a custom tab for good; files uploaded through it stay with their client. */
  async customArchive(
    businessId: string,
    actorUserId: string,
    id: string,
  ): Promise<PortalCustomTabList> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const found = await tx.portalTab.findFirst({
        where: { id, kind: 'CUSTOM', archivedAt: null },
        select: { id: true },
      });
      if (!found) throw customNotFound();
      await tx.portalTab.update({
        where: { id },
        data: { archivedAt: new Date(), updatedByUserId: actorUserId },
      });
      await this.audit.logIn(
        tx,
        'portal.custom_tab_archived',
        { type: 'portal_tab', id },
        {},
        { businessId },
      );
      return { items: await this.customRows(tx) };
    });
  }

  /**
   * CP-5e: the custom tabs a client sees: only in a business portal (guide 9.3), on, live, and
   * for everyone, or targeted (TAGS or CLIENTS) at one of the client's tags or at the client.
   */
  async customFor(tx: TxClient, clientId: string, business: boolean): Promise<MyCustomTab[]> {
    if (!business) return [];
    const tags = (
      await tx.clientTag.findMany({ where: { clientId }, select: { tagId: true } })
    ).map((t) => t.tagId);
    const rows = await tx.portalTab.findMany({
      where: {
        kind: 'CUSTOM',
        archivedAt: null,
        enabled: true,
        OR: [
          { audience: 'ALL' },
          {
            audience: { in: ['TAGS', 'CLIENTS'] },
            targets: {
              some: { OR: [{ clientId }, ...(tags.length ? [{ tagId: { in: tags } }] : [])] },
            },
          },
        ],
      },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      select: { id: true, label: true, module: true },
      take: 50,
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label ?? '',
      module: r.module as MyCustomTab['module'],
    }));
  }

  /** The custom tab a signed-in client asks for, if they see it (404 otherwise). */
  async customTabOf(
    businessId: string,
    clientAccountId: string,
    tabId: string,
  ): Promise<MyCustomTab> {
    const mine = await this.forClientAccount(businessId, clientAccountId);
    const tab = mine.custom.find((t) => t.id === tabId);
    if (!tab) throw customNotFound();
    return tab;
  }

  /** What a signed-in client sees: each area on only when the firm's and their own are. */
  async forClientAccount(businessId: string, clientAccountId: string): Promise<PortalTabs> {
    return this.db.withScope({ kind: 'business', businessId }, async (tx) => {
      const account = await tx.clientAccount.findUnique({
        where: { id: clientAccountId },
        select: { clientId: true },
      });
      if (!account?.clientId)
        return {
          tabs: await this.read(tx),
          layout: await this.layout(tx),
          custom: [],
          businessPortal: false,
        };
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
        custom: await this.customFor(tx, account.clientId, client?.accountType === 'BUSINESS'),
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

/** A custom tab's id in a path. */
const CUSTOM_ID = z.uuid().transform((v) => v.toLowerCase());

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

  /** CP-5d, CP-5e: the firm's custom tabs. */
  @Get('custom')
  customList(@CurrentTenant() tenant: TenantContext): Promise<PortalCustomTabList> {
    return this.tabs.customList(tenant.businessId);
  }

  @Post('custom')
  customCreate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(CreatePortalCustomTab))
    body: z.output<typeof CreatePortalCustomTab>,
  ): Promise<PortalCustomTab> {
    return this.tabs.customCreate(tenant.businessId, auth.userId, body);
  }

  @Patch('custom/:id')
  customUpdate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(CUSTOM_ID)) id: string,
    @Body(new ZodValidationPipe(UpdatePortalCustomTab))
    body: z.output<typeof UpdatePortalCustomTab>,
  ): Promise<PortalCustomTab> {
    return this.tabs.customUpdate(tenant.businessId, auth.userId, id, body);
  }

  @Post('custom/:id/archive')
  @HttpCode(200)
  customArchive(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(CUSTOM_ID)) id: string,
  ): Promise<PortalCustomTabList> {
    return this.tabs.customArchive(tenant.businessId, auth.userId, id);
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
