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
  RUN_ORDER,
  STALE_AFTER_MS,
  entityLabelOf,
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
      // I-R2-02: every number comes from the connections whose cards this environment shows (a
      // provider without this environment shows no card, so its connections count nowhere).
      const shown = new Set(all.map((c) => c.provider.provider));
      const visible = connections.filter((c) => shown.has(c.provider));
      const visibleIds = visible.map((c) => c.id);
      const summary = {
        connected: all.filter((c) => c.status === 'CONNECTED' || c.status === 'SYNCING').length,
        needsAttention: all.filter((c) => c.status === 'NEEDS_ATTENTION').length,
        // IN-Y01: Ready to connect counts only what the firm can connect now; a provider that is
        // not enabled yet is counted apart, never as ready.
        available: all.filter(
          (c) =>
            (c.status === 'AVAILABLE' || c.status === 'DISCONNECTED') && !c.provider.comingSoon,
        ).length,
        comingSoon: all.filter((c) => c.connections.length === 0 && c.provider.comingSoon).length,
        paused: all.filter((c) => c.status === 'PAUSED').length,
        total: all.length,
        // The last time one of them was checked: a connection test or a sync.
        lastCheckAt:
          visible
            .flatMap((c) => [c.lastCheckAt, c.lastSyncAt])
            .filter((d): d is Date => d !== null)
            .sort((a, b) => b.getTime() - a.getTime())[0]
            ?.toISOString() ?? null,
        allOperational: false,
      };
      // IN-F01: success only when something is connected, it was checked, and nothing needs
      // attention; with no connections nothing was checked, so nothing is reported as working.
      summary.allOperational =
        summary.connected > 0 && summary.lastCheckAt !== null && summary.needsAttention === 0;
      const search = q.search?.toLowerCase();
      const items = all
        // IN-Y03: readiness, apart from connection status.
        .filter((c) =>
          q.readiness === 'connectable'
            ? !c.provider.comingSoon
            : q.readiness === 'coming_soon'
              ? c.provider.comingSoon
              : true,
        )
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
      const mine = { businessId, connectionId: { in: visibleIds } };
      const [failed, pending, mappings, recent] = await Promise.all([
        tx.integrationSyncRun.count({
          where: { ...mine, status: 'FAILED', createdAt: { gte: since } },
        }),
        tx.integrationSyncRun.count({ where: { ...mine, status: 'QUEUED' } }),
        tx.integrationFieldMapping.groupBy({
          by: ['scope'],
          where: mine,
          _count: { _all: true },
        }),
        this.activity(tx, businessId, { page: 1, pageSize: 10, connectionIds: visibleIds }),
      ]);
      const authIssues = visible.filter(
        (c) =>
          c.status === 'NEEDS_ATTENTION' &&
          (c.statusReason === 'authorization_expired' ||
            c.statusReason === 'authorization_revoked'),
      ).length;
      return {
        summary,
        items,
        health: {
          operational: visible.filter((c) => c.status === 'CONNECTED' || c.status === 'SYNCING')
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
      | {
          page: number;
          pageSize: number;
          provider?: string;
          kind?: IntegrationActivity['kind'];
          /** I-R2-02: only these connections (the overview's environment). */
          connectionIds?: string[];
        },
  ): Promise<IntegrationActivityPage> {
    const only = 'connectionIds' in q && q.connectionIds ? q.connectionIds : undefined;
    const connections = await tx.integrationConnection.findMany({
      where: {
        businessId,
        ...(q.provider ? { provider: q.provider } : {}),
        ...(only ? { id: { in: only } } : {}),
      },
      select: { id: true, provider: true },
    });
    const providerOfConnection = new Map(connections.map((c) => [c.id, c.provider]));
    const ids = connections.map((c) => c.id);
    const take = q.page * q.pageSize;
    const [runs, audits] = await Promise.all([
      tx.integrationSyncRun.findMany({
        where: { businessId, connectionId: { in: ids } },
        orderBy: [...RUN_ORDER],
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
      // I-R2-02: the connections of one environment, as the overview's Live / Test switch.
      const connections = (await tx.integrationConnection.findMany({
        where: { businessId, environment: q.environment },
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
        // IN-Y06: the featured row follows the category, as the search already filters it.
        featured: cards
          .filter((c) => c.provider.featured && (!q.category || c.provider.category === q.category))
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
          orderBy: [...RUN_ORDER],
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
    const syncs = { businessId, connectionId: id, entity: { notIn: ['test', 'webhook'] } };
    const [recentFailed, last, lastOk] = await Promise.all([
      tx.integrationSyncRun.count({
        where: { businessId, connectionId: id, status: 'FAILED', createdAt: { gte: since } },
      }),
      tx.integrationSyncRun.findFirst({
        where: { ...syncs, finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        select: { status: true, finishedAt: true },
      }),
      tx.integrationSyncRun.findFirst({
        where: { ...syncs, status: 'SUCCEEDED', finishedAt: { not: null } },
        orderBy: { finishedAt: 'desc' },
        select: { finishedAt: true },
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
    const disconnected = c.status === 'DISCONNECTED';
    // I-R2-01: what is known comes from a connection test or a finished sync; before either,
    // nothing is "working" yet.
    const evidence = [c.lastCheckAt, last?.finishedAt ?? null].filter((d): d is Date => !!d);
    const checkedAt = evidence.length
      ? new Date(Math.max(...evidence.map((d) => d.getTime())))
      : null;
    const known = checkedAt !== null && !disconnected;
    type CheckState = 'OK' | 'FAIL' | 'UNKNOWN';
    const LABEL: Record<IntegrationHealthCheck['key'], Record<CheckState, string>> = {
      AUTHENTICATION: {
        OK: 'Authentication valid',
        FAIL: disconnected ? 'Disconnected' : 'Authentication needs renewing',
        UNKNOWN: 'Authentication not checked yet',
      },
      API: {
        OK: 'API connection healthy',
        FAIL: 'The provider is not responding',
        UNKNOWN: 'API connection not checked yet',
      },
      DATA_SYNC: {
        OK: 'Data syncing as expected',
        FAIL: 'Data sync is failing',
        UNKNOWN: 'No sync has finished yet',
      },
      RECENT_ERRORS: {
        OK: 'No recent errors',
        FAIL: 'Recent errors',
        UNKNOWN: 'No recent activity to check',
      },
      PERMISSIONS: {
        OK: 'Permissions granted',
        FAIL: 'A required permission is missing',
        UNKNOWN: 'Permissions not checked yet',
      },
    };
    const check = (
      key: IntegrationHealthCheck['key'],
      state: CheckState,
      message: string | null,
    ): IntegrationHealthCheck => ({
      key,
      label: LABEL[key][state],
      ok: state === 'OK',
      state,
      message: state === 'FAIL' ? message : null,
    });
    const checks: IntegrationHealthCheck[] = [
      check(
        'AUTHENTICATION',
        disconnected || authBad ? 'FAIL' : known ? 'OK' : 'UNKNOWN',
        disconnected
          ? 'Reconnect to authorize Firmivra again'
          : 'The authorization needs to be renewed',
      ),
      check(
        'API',
        apiBad ? 'FAIL' : known ? 'OK' : 'UNKNOWN',
        'The provider is not responding as expected',
      ),
      check(
        'DATA_SYNC',
        last?.status === 'FAILED' || reason === 'sync_failed'
          ? 'FAIL'
          : last && !disconnected
            ? 'OK'
            : 'UNKNOWN',
        'The last sync failed',
      ),
      check(
        'RECENT_ERRORS',
        recentFailed > 0 ? 'FAIL' : known ? 'OK' : 'UNKNOWN',
        `${recentFailed} failed in the last day`,
      ),
      check(
        'PERMISSIONS',
        permissionsBad ? 'FAIL' : known ? 'OK' : 'UNKNOWN',
        'A required permission is missing',
      ),
    ];
    const failing = c.status === 'NEEDS_ATTENTION' || checks.some((x) => x.state === 'FAIL');
    const state = disconnected
      ? 'DISCONNECTED'
      : failing
        ? 'FAILING'
        : !checkedAt
          ? 'UNKNOWN'
          : Date.now() - checkedAt.getTime() > STALE_AFTER_MS
            ? 'STALE'
            : 'HEALTHY';
    const suggestions =
      state === 'DISCONNECTED'
        ? ['Reconnect this integration to sync again.']
        : state === 'UNKNOWN'
          ? ['Run a connection test to check it.']
          : state === 'STALE'
            ? ['Run a connection test to check it again.']
            : state === 'HEALTHY'
              ? []
              : [
                  ...(authBad || permissionsBad
                    ? ['Reconnect to renew the authorization and approve every permission.']
                    : []),
                  ...(apiBad ? ['The provider is unavailable. Try again in a moment.'] : []),
                  ...(recentFailed > 0 || last?.status === 'FAILED'
                    ? ['Open Sync History to see which sync failed, then run Sync Now.']
                    : []),
                  ...(authBad ||
                  permissionsBad ||
                  apiBad ||
                  recentFailed > 0 ||
                  last?.status === 'FAILED'
                    ? []
                    : ['Open Sync History, or run a connection test to see what needs attention.']),
                ];
    const summary = {
      HEALTHY: 'Connection is active and working properly.',
      UNKNOWN: 'No check has run yet: run a connection test to check it.',
      STALE: `Last checked over a week ago: run a connection test to check it again.`,
      DISCONNECTED: 'This integration is disconnected. Reconnect it to sync again.',
      FAILING: reasonInfo(c.statusReason)?.message ?? 'This connection needs attention.',
    }[state];
    return {
      ok: state === 'HEALTHY',
      state,
      lastSuccessAt: lastOk?.finishedAt?.toISOString() ?? null,
      lastAttemptAt: last?.finishedAt?.toISOString() ?? null,
      summary,
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
      const [total, rows, seen] = await Promise.all([
        tx.integrationSyncRun.count({ where }),
        tx.integrationSyncRun.findMany({
          where,
          orderBy: [...RUN_ORDER],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        // I-R2-05: the objects of every run of the connection, for the Object filter.
        tx.integrationSyncRun.findMany({
          where: { businessId, connectionId: id, entity: { notIn: ['test', 'webhook'] } },
          distinct: ['entity'],
          select: { entity: true },
          orderBy: { entity: 'asc' },
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
        entities: seen.map((r) => ({ key: r.entity, label: entityLabelOf(provider, r.entity) })),
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
    const listed = new Set(provider.mappingScopes.map((s) => s.scope));
    // I-R2-03: a saved pair whose scope the provider no longer lists is shown read-only.
    const unlisted = [...new Set(rows.map((r) => r.scope).filter((s) => !listed.has(s)))];
    return {
      scopes: [
        ...provider.mappingScopes.map((s) => ({
          ...s,
          pairs: rows.filter((r) => r.scope === s.scope).map((r) => this.pairOf(provider, r)),
          readOnly: false,
        })),
        ...unlisted.map((scope) => ({
          scope,
          label: scope.charAt(0).toUpperCase() + scope.slice(1).replace(/_/g, ' '),
          localFields: [],
          externalFields: [],
          pairs: rows.filter((r) => r.scope === scope).map((r) => this.pairOf(provider, r)),
          readOnly: true,
        })),
      ],
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
