import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  IntegrationActivity,
  IntegrationActivityPage,
  IntegrationCard,
  IntegrationConnectionDetail,
  IntegrationConnectionHealth,
  IntegrationHealthCheck,
  IntegrationHistoryPage,
  IntegrationMappings,
  IntegrationMarketplace,
  IntegrationPermissionList,
  IntegrationProvider,
  IntegrationProviderDetail,
  IntegrationRequestRow,
  IntegrationsOverview,
  IntegrationSyncRunDetail,
} from '@firmivra/types';
import type { z } from 'zod';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, notFound } from '../workspaces/common.js';
import { CATEGORY_LABELS } from './catalog.js';
import { ProviderRegistry } from './provider-registry.js';
import {
  type ConnectionRow,
  cardAction,
  cardStatus,
  canManageIntegrations,
  connectionTypeOf,
  guidanceFor,
  maskLast4,
  reasonInfo,
  toRun,
  toSummary,
} from './integrations.common.js';
import type {
  ActivityQuery,
  HistoryQuery,
  IntegrationsQueryInput,
  MarketplaceQuery,
} from './integrations-input.js';

type Overview = z.output<typeof IntegrationsQueryInput>;
type Marketplace = z.output<typeof MarketplaceQuery>;
type Activity = z.output<typeof ActivityQuery>;
type History = z.output<typeof HistoryQuery>;

const DAY = 24 * 60 * 60_000;

const settingsOf = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

const cardOf = (provider: IntegrationProvider, connections: ConnectionRow[]): IntegrationCard => {
  const summaries = connections.map(toSummary);
  const status = cardStatus(summaries);
  return {
    provider: {
      provider: provider.provider,
      name: provider.name,
      category: provider.category,
      summary: provider.summary,
      logo: provider.logo,
      featured: provider.featured,
      badge: provider.badge,
      popularity: provider.popularity,
      comingSoon: provider.comingSoon,
      multipleConnections: provider.multipleConnections,
    },
    status,
    connections: summaries,
    action: cardAction(status, provider),
  };
};

/**
 * Reads of the Integrations module: the main page, the marketplace, a provider's setup
 * definition, a connection's Manage page and its history, mappings and permissions, and the
 * firm's integration requests. Everything is the firm's own (a connection of another firm is NOT
 * FOUND). No secret is ever read here: only the facts the database holds about a connection.
 */
@Injectable()
export class IntegrationsReadService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly registry: ProviderRegistry,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Main page ----------

  overview(businessId: string, tenant: TenantContext, q: Overview): Promise<IntegrationsOverview> {
    return this.inFirm(businessId, async (tx) => {
      const connections = (await tx.integrationConnection.findMany({
        where: { businessId, environment: q.environment },
        orderBy: { createdAt: 'asc' },
      })) as ConnectionRow[];
      const byProvider = new Map<string, ConnectionRow[]>();
      for (const c of connections)
        byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c]);

      // The Live / Test switch: a provider without a sandbox has no test card.
      const scoped = this.registry
        .all()
        .filter(
          (p) =>
            p.environments.includes(q.environment) && (!q.category || p.category === q.category),
        );
      const all = scoped.map((p) => cardOf(p, byProvider.get(p.provider) ?? []));
      const summary = {
        connected: all.filter((c) => c.status === 'CONNECTED' || c.status === 'SYNCING').length,
        needsAttention: all.filter((c) => c.status === 'NEEDS_ATTENTION').length,
        available: all.filter((c) => c.status === 'AVAILABLE' || c.status === 'DISCONNECTED')
          .length,
        paused: all.filter((c) => c.status === 'PAUSED').length,
        total: all.length,
        lastCheckAt:
          connections
            .map((c) => c.lastSyncAt)
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0]
            ?.toISOString() ?? null,
        allOperational: !all.some((c) => c.status === 'NEEDS_ATTENTION'),
      };
      const search = q.search?.toLowerCase();
      const items = all
        .filter((c) =>
          q.tab === 'connected'
            ? c.status === 'CONNECTED' || c.status === 'SYNCING' || c.status === 'PAUSED'
            : q.tab === 'available'
              ? c.status === 'AVAILABLE' || c.status === 'DISCONNECTED'
              : q.tab === 'attention'
                ? c.status === 'NEEDS_ATTENTION'
                : true,
        )
        .filter(
          (c) =>
            !search ||
            [c.provider.name, c.provider.summary, CATEGORY_LABELS[c.provider.category]]
              .join(' ')
              .toLowerCase()
              .includes(search),
        );

      const since = new Date(Date.now() - DAY);
      const [failed, pending, mappings, recent] = await Promise.all([
        tx.integrationSyncRun.count({
          where: { businessId, status: 'FAILED', createdAt: { gte: since } },
        }),
        tx.integrationSyncRun.count({ where: { businessId, status: 'QUEUED' } }),
        tx.integrationFieldMapping.groupBy({
          by: ['scope'],
          where: { businessId },
          _count: { _all: true },
        }),
        this.activity(tx, businessId, { page: 1, pageSize: 10 }),
      ]);
      const authIssues = connections.filter(
        (c) =>
          c.status === 'NEEDS_ATTENTION' &&
          (c.statusReason === 'authorization_expired' ||
            c.statusReason === 'authorization_revoked'),
      ).length;
      return {
        summary,
        items,
        health: {
          operational: connections.filter((c) => c.status === 'CONNECTED' || c.status === 'SYNCING')
            .length,
          authorizationIssues: authIssues,
          failedSyncs: failed,
          recordsPending: pending,
        },
        mapping: mappings.map((m) => ({
          scope: m.scope,
          label: this.scopeLabel(m.scope),
          mappedFields: m._count._all,
        })),
        recent: recent.items.slice(0, 10),
        canManage: canManageIntegrations(tenant),
      };
    });
  }

  private scopeLabel(scope: string): string {
    for (const p of this.registry.all()) {
      const s = p.mappingScopes.find((x) => x.scope === scope);
      if (s) return s.label;
    }
    return `${scope.charAt(0).toUpperCase()}${scope.slice(1)} fields`;
  }

  // ---------- Activity ----------

  activityPage(businessId: string, q: Activity): Promise<IntegrationActivityPage> {
    return this.inFirm(businessId, (tx) => this.activity(tx, businessId, q));
  }

  /**
   * Recent Activity: sync runs (sync, test, webhook, errors) and the audited changes (connect,
   * disconnect, settings), newest first. Ids and sentences only: never record content.
   */
  private async activity(
    tx: TxClient,
    businessId: string,
    q:
      | Activity
      | { page: number; pageSize: number; provider?: string; kind?: IntegrationActivity['kind'] },
  ): Promise<IntegrationActivityPage> {
    const connections = await tx.integrationConnection.findMany({
      where: { businessId, ...(q.provider ? { provider: q.provider } : {}) },
      select: { id: true, provider: true },
    });
    const providerOfConnection = new Map(connections.map((c) => [c.id, c.provider]));
    const ids = connections.map((c) => c.id);
    const take = q.page * q.pageSize;
    const [runs, audits] = await Promise.all([
      tx.integrationSyncRun.findMany({
        where: { businessId, connectionId: { in: ids } },
        orderBy: { createdAt: 'desc' },
        take,
      }),
      tx.auditLog.findMany({
        where: {
          businessId,
          entityType: 'integration_connection',
          entityId: { in: ids },
          action: { startsWith: 'integration.' },
        },
        orderBy: { createdAt: 'desc' },
        take,
      }),
    ]);
    const name = (provider: string) => this.registry.get(provider)?.name ?? provider;
    const items: IntegrationActivity[] = [
      ...runs.map((r): IntegrationActivity => {
        const provider = providerOfConnection.get(r.connectionId) ?? 'unknown';
        const failed = r.status === 'FAILED';
        const kind: IntegrationActivity['kind'] = failed
          ? 'ERROR'
          : r.entity === 'test'
            ? 'TEST'
            : r.entity === 'webhook'
              ? 'WEBHOOK'
              : 'SYNC';
        const what =
          kind === 'TEST'
            ? 'connection test'
            : kind === 'WEBHOOK'
              ? 'webhook delivery'
              : `${r.entity} sync`;
        return {
          id: r.id,
          provider,
          providerName: name(provider),
          kind,
          ok: !failed,
          message: `${name(provider)} ${what} ${failed ? 'failed' : r.status === 'PARTIAL' ? 'finished with errors' : r.status === 'SUCCEEDED' ? 'completed' : 'is queued'}`,
          at: (r.finishedAt ?? r.createdAt).toISOString(),
        };
      }),
      ...audits.map((a): IntegrationActivity => {
        const provider = providerOfConnection.get(a.entityId ?? '') ?? 'unknown';
        const kind: IntegrationActivity['kind'] =
          a.action === 'integration.connected' || a.action === 'integration.reconnected'
            ? 'CONNECT'
            : a.action === 'integration.disconnected'
              ? 'DISCONNECT'
              : 'SETTINGS';
        const verb =
          kind === 'CONNECT'
            ? 'connected'
            : kind === 'DISCONNECT'
              ? 'disconnected'
              : 'settings changed';
        return {
          id: a.id,
          provider,
          providerName: name(provider),
          kind,
          ok: true,
          message: `${name(provider)} ${verb}`,
          at: a.createdAt.toISOString(),
        };
      }),
    ]
      .filter((i) => !q.kind || i.kind === q.kind)
      .sort((a, b) => b.at.localeCompare(a.at));
    const start = (q.page - 1) * q.pageSize;
    return {
      items: items.slice(start, start + q.pageSize),
      total: items.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ---------- Marketplace ----------

  marketplace(businessId: string, q: Marketplace): Promise<IntegrationMarketplace> {
    return this.inFirm(businessId, async (tx) => {
      const connections = (await tx.integrationConnection.findMany({
        where: { businessId },
      })) as ConnectionRow[];
      const byProvider = new Map<string, ConnectionRow[]>();
      for (const c of connections)
        byProvider.set(c.provider, [...(byProvider.get(c.provider) ?? []), c]);
      const search = q.search?.toLowerCase();
      const cards = this.registry
        .all()
        .filter(
          (p) =>
            !search ||
            [p.name, p.summary, CATEGORY_LABELS[p.category]]
              .join(' ')
              .toLowerCase()
              .includes(search),
        )
        .map((p) => cardOf(p, byProvider.get(p.provider) ?? []));
      const items = cards
        .filter((c) => !q.category || c.provider.category === q.category)
        .sort((a, b) =>
          q.sort === 'name'
            ? a.provider.name.localeCompare(b.provider.name)
            : q.sort === 'category'
              ? CATEGORY_LABELS[a.provider.category].localeCompare(
                  CATEGORY_LABELS[b.provider.category],
                ) || a.provider.name.localeCompare(b.provider.name)
              : b.provider.popularity - a.provider.popularity,
        );
      const counts = new Map<string, number>();
      for (const c of cards)
        counts.set(c.provider.category, (counts.get(c.provider.category) ?? 0) + 1);
      return {
        categories: [...counts.entries()].map(([category, count]) => ({
          category: category as IntegrationCard['provider']['category'],
          count,
        })),
        featured: cards
          .filter((c) => c.provider.featured)
          .sort((a, b) => b.provider.popularity - a.provider.popularity),
        items,
        total: items.length,
      };
    });
  }

  // ---------- Provider and connection ----------

  providerDetail(
    businessId: string,
    tenant: TenantContext,
    key: string,
  ): Promise<IntegrationProviderDetail> {
    const provider = this.registry.get(key);
    if (!provider) throw notFound();
    return this.inFirm(businessId, async (tx) => {
      const connections = (await tx.integrationConnection.findMany({
        where: { businessId, provider: key },
        orderBy: { createdAt: 'asc' },
      })) as ConnectionRow[];
      return {
        provider,
        connections: connections.map(toSummary),
        canManage: canManageIntegrations(tenant),
      };
    });
  }

  connection(
    businessId: string,
    tenant: TenantContext,
    id: string,
  ): Promise<IntegrationConnectionDetail> {
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      if (!c) throw notFound();
      const provider = this.registry.get(c.provider);
      if (!provider) throw notFound();
      const [runs, mappings, health, running] = await Promise.all([
        tx.integrationSyncRun.findMany({
          where: { businessId, connectionId: id },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        tx.integrationFieldMapping.findMany({
          where: { businessId, connectionId: id },
          orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }],
          take: 10,
        }),
        this.healthIn(tx, businessId, id),
        tx.integrationSyncRun.count({
          where: { businessId, connectionId: id, status: { in: ['QUEUED', 'RUNNING'] } },
        }),
      ]);
      const names = await memberNames(tx, businessId, [
        c.connectedByUserId,
        ...runs.map((r) => r.requestedByUserId),
      ]);
      const by = c.connectedByUserId ? names.get(c.connectedByUserId) : undefined;
      const settings = settingsOf(c.settings);
      const options = settingsOf(settings.options) as IntegrationConnectionDetail['options'];
      return {
        ...toSummary(c as ConnectionRow),
        accountIdMasked: maskLast4(c.accountIdLast4),
        connectionType: connectionTypeOf(provider),
        connectedBy:
          c.connectedByUserId && by !== undefined
            ? { userId: c.connectedByUserId, name: by }
            : null,
        provider,
        entities: c.entities,
        options,
        syncing: running > 0,
        paused: c.status === 'PAUSED',
        health,
        recentRuns: runs.map((r) => toRun(r, provider, names)),
        mappingPreview: mappings.map((m) => this.pairOf(provider, m)),
        canManage: canManageIntegrations(tenant),
      };
    });
  }

  private pairOf(
    provider: IntegrationProvider,
    m: {
      scope: string;
      localField: string;
      externalField: string;
      direction: 'IMPORT' | 'EXPORT' | 'TWO_WAY';
    },
  ) {
    const scope = provider.mappingScopes.find((s) => s.scope === m.scope);
    return {
      scope: m.scope,
      localField: m.localField,
      localLabel: scope?.localFields.find((f) => f.key === m.localField)?.label ?? m.localField,
      externalField: m.externalField,
      externalLabel:
        scope?.externalFields.find((f) => f.key === m.externalField)?.label ?? m.externalField,
      direction: m.direction,
    };
  }

  health(businessId: string, id: string): Promise<IntegrationConnectionHealth> {
    return this.inFirm(businessId, (tx) => this.healthIn(tx, businessId, id));
  }

  /** Connection Health from what the database knows: its status, its last runs and its permissions. */
  async healthIn(
    tx: TxClient,
    businessId: string,
    id: string,
  ): Promise<IntegrationConnectionHealth> {
    const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
    if (!c) throw notFound();
    const provider = this.registry.get(c.provider);
    const since = new Date(Date.now() - DAY);
    const [recentFailed, last] = await Promise.all([
      tx.integrationSyncRun.count({
        where: { businessId, connectionId: id, status: 'FAILED', createdAt: { gte: since } },
      }),
      tx.integrationSyncRun.findFirst({
        where: {
          businessId,
          connectionId: id,
          entity: { notIn: ['test', 'webhook'] },
          finishedAt: { not: null },
        },
        orderBy: { finishedAt: 'desc' },
        select: { status: true },
      }),
    ]);
    const reason = c.status === 'NEEDS_ATTENTION' ? c.statusReason : null;
    const authBad = reason === 'authorization_expired' || reason === 'authorization_revoked';
    const apiBad = reason === 'provider_outage' || reason === 'rate_limited';
    const granted = new Set<string>(
      Array.isArray(settingsOf(c.settings).granted)
        ? (settingsOf(c.settings).granted as string[])
        : [],
    );
    const missing = (provider?.permissions ?? []).filter(
      (p) =>
        p.required &&
        p.entity !== null &&
        c.entities.includes(p.entity) &&
        granted.size > 0 &&
        !granted.has(p.key),
    );
    const permissionsBad = reason === 'permission_missing' || missing.length > 0;
    const checks: IntegrationHealthCheck[] = [
      {
        key: 'AUTHENTICATION',
        label: 'Authentication valid',
        ok: !authBad && c.status !== 'DISCONNECTED',
        message: authBad ? 'The authorization needs to be renewed' : null,
      },
      {
        key: 'API',
        label: 'API connection healthy',
        ok: !apiBad,
        message: apiBad ? 'The provider is not responding as expected' : null,
      },
      {
        key: 'DATA_SYNC',
        label: 'Data syncing as expected',
        ok: last?.status !== 'FAILED' && reason !== 'sync_failed',
        message: last?.status === 'FAILED' ? 'The last sync failed' : null,
      },
      {
        key: 'RECENT_ERRORS',
        label: 'No recent errors',
        ok: recentFailed === 0,
        message: recentFailed ? `${recentFailed} failed in the last day` : null,
      },
      {
        key: 'PERMISSIONS',
        label: 'Permissions granted',
        ok: !permissionsBad,
        message: permissionsBad ? 'A required permission is missing' : null,
      },
    ];
    const ok = checks.every((x) => x.ok);
    const suggestions = [
      ...(authBad || permissionsBad
        ? ['Reconnect to renew the authorization and approve every permission.']
        : []),
      ...(apiBad ? ['The provider is unavailable. Try again in a moment.'] : []),
      ...(recentFailed > 0 && !authBad
        ? ['Open Sync History to see which sync failed, then run Sync Now.']
        : []),
    ];
    return {
      ok,
      summary: ok
        ? 'Connection is active and working properly.'
        : (reasonInfo(c.statusReason)?.message ?? 'This connection needs attention.'),
      checks,
      suggestions,
      checkedAt: c.lastCheckAt?.toISOString() ?? null,
    };
  }

  // ---------- History, mappings, permissions ----------

  history(businessId: string, id: string, q: History): Promise<IntegrationHistoryPage> {
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({
        where: { businessId, id },
        select: { provider: true },
      });
      if (!c) throw notFound();
      const where: Prisma.IntegrationSyncRunWhereInput = {
        businessId,
        connectionId: id,
        ...(q.status ? { status: q.status } : {}),
        ...(q.entity ? { entity: q.entity } : {}),
        ...(q.manual !== undefined ? { manual: q.manual } : {}),
      };
      const [total, rows] = await Promise.all([
        tx.integrationSyncRun.count({ where }),
        tx.integrationSyncRun.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.requestedByUserId),
      );
      const provider = this.registry.get(c.provider);
      return {
        items: rows.map((r) => toRun(r, provider, names)),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  run(businessId: string, id: string, runId: string): Promise<IntegrationSyncRunDetail> {
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({
        where: { businessId, id },
        select: { provider: true },
      });
      const r = c
        ? await tx.integrationSyncRun.findFirst({
            where: { businessId, connectionId: id, id: runId },
          })
        : null;
      if (!c || !r) throw notFound();
      const names = await memberNames(tx, businessId, [r.requestedByUserId]);
      return {
        ...toRun(r, this.registry.get(c.provider), names),
        guidance: guidanceFor(r.errorCode),
      };
    });
  }

  mappings(businessId: string, id: string): Promise<IntegrationMappings> {
    return this.inFirm(businessId, (tx) => this.mappingsIn(tx, businessId, id));
  }

  async mappingsIn(tx: TxClient, businessId: string, id: string): Promise<IntegrationMappings> {
    const c = await tx.integrationConnection.findFirst({
      where: { businessId, id },
      select: { provider: true },
    });
    const provider = c ? this.registry.get(c.provider) : undefined;
    if (!c || !provider) throw notFound();
    const rows = await tx.integrationFieldMapping.findMany({
      where: { businessId, connectionId: id },
      orderBy: [{ scope: 'asc' }, { sortOrder: 'asc' }],
    });
    return {
      scopes: provider.mappingScopes.map((s) => ({
        ...s,
        pairs: rows.filter((r) => r.scope === s.scope).map((r) => this.pairOf(provider, r)),
      })),
    };
  }

  permissions(businessId: string, id: string): Promise<IntegrationPermissionList> {
    return this.inFirm(businessId, async (tx) => {
      const c = await tx.integrationConnection.findFirst({ where: { businessId, id } });
      const provider = c ? this.registry.get(c.provider) : undefined;
      if (!c || !provider) throw notFound();
      const granted = settingsOf(c.settings).granted;
      // A connection made before grants were recorded has none listed: treat the permissions of its
      // enabled objects as granted, so nothing reads as missing without evidence.
      const known = Array.isArray(granted) ? new Set(granted as string[]) : null;
      const items = provider.permissions
        .filter((p) => p.entity === null || c.entities.includes(p.entity))
        .map((p) => ({ ...p, granted: known === null ? true : known.has(p.key) }));
      return {
        items,
        needsReconnect:
          items.some((p) => p.required && !p.granted) || c.statusReason === 'permission_missing',
      };
    });
  }

  // ---------- Requests ----------

  requests(businessId: string): Promise<IntegrationRequestRow[]> {
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.integrationRequest.findMany({
        where: { businessId },
        orderBy: { createdAt: 'desc' },
        take: 200,
      });
      const names = await memberNames(
        tx,
        businessId,
        rows.map((r) => r.requestedByUserId),
      );
      return rows.map((r) => this.requestRow(r, names));
    });
  }

  requestRow(
    r: {
      id: string;
      providerName: string;
      websiteUrl: string | null;
      category: string | null;
      connectTo: string;
      businessReason: string | null;
      status: IntegrationRequestRow['status'];
      requestedByUserId: string;
      statusChangedAt: Date | null;
      createdAt: Date;
    },
    names: Map<string, string>,
  ): IntegrationRequestRow {
    return {
      id: r.id,
      providerName: r.providerName,
      websiteUrl: r.websiteUrl,
      category: r.category,
      connectTo: r.connectTo,
      businessReason: r.businessReason,
      status: r.status,
      requestedBy: {
        userId: r.requestedByUserId,
        name: names.get(r.requestedByUserId) ?? 'Former member',
      },
      statusChangedAt: r.statusChangedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }
}
