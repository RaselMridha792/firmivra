import { Injectable } from '@nestjs/common';
import type { Prisma } from '@firmivra/db';
import type {
  AdminExportJob,
  AdminIntegrationAuditEntry,
  AdminIntegrationLog,
  AdminLogFacets,
  AdminLogRecord,
  AdminUsageDay,
  AdminUsageQuery,
  AdminUsageReport,
  AdminUsageSubject,
  AdminUsageTotals,
  ExportAdminLogsRequest,
  ListAdminIntegrationAuditQuery,
  ListAdminIntegrationAuditResponse,
  ListAdminIntegrationLogsQuery,
  ListAdminIntegrationLogsResponse,
} from '@firmivra/types';
import type { z } from 'zod';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { auditIn } from './integration-records.js';
import { failure, invalid } from './integrations.rules.js';
import { providerFor } from './providers.js';

type LogRow = Prisma.PlatformIntegrationLogGetPayload<{
  include: { integration: { select: { name: true; provider: true } } };
}>;
type UsageRow = Prisma.PlatformIntegrationUsageDailyGetPayload<object>;
type LogFilters = Omit<z.output<typeof ListAdminIntegrationLogsQuery>, 'page' | 'pageSize'>;

const DAY_MS = 86_400_000;
const include = { integration: { select: { name: true, provider: true } } } as const;
const dayKey = (d: Date) => d.toISOString().slice(0, 10);
const dayOf = (key: string) => new Date(`${key}T00:00:00.000Z`);

/** The columns an integration log export writes (B1 keeps the list with the job). */
export const LOG_EXPORT_COLUMNS = [
  'logId',
  'timestampUtc',
  'integration',
  'source',
  'environment',
  'severity',
  'eventType',
  'action',
  'outcome',
  'errorCode',
  'message',
  'requestId',
  'correlationId',
  'firm',
  'actor',
] as const;

/** Labels for the stored action codes; others read from the code. */
const ACTION_LABELS: Record<string, string> = {
  test_connection: 'Test connection',
  set_credentials: 'Credentials saved',
  rotate_credentials: 'Credentials rotated',
  update_configuration: 'Configuration updated',
  change_environment: 'Environment changed',
  activate: 'Integration activated',
  disable: 'Integration disabled',
  enable: 'Integration enabled',
  remove: 'Integration removed',
  sync: 'Synchronization requested',
  issue_api_key: 'API key issued',
  rotate_api_key: 'API key rotated',
  revoke_api_key: 'API key revoked',
  redeliver: 'Webhook redelivery requested',
};
const humanize = (code: string) => {
  const text = code.replace(/[._]/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
};
export const actionLabel = (action: string | null, eventType: string) =>
  action ? (ACTION_LABELS[action] ?? humanize(action)) : humanize(eventType);

/** Audit actions as the module's trail shows them. */
const AUDIT_LABELS: Record<string, string> = {
  'integrations.platform.created': 'Created integration draft',
  'integrations.platform.updated': 'Updated integration',
  'integrations.platform.environment_changed': 'Changed integration environment',
  'integrations.platform.activated': 'Activated integration',
  'integrations.platform.disabled': 'Disabled integration',
  'integrations.platform.enabled': 'Enabled integration',
  'integrations.platform.removed': 'Removed integration',
  'integrations.credentials.set': 'Set integration credentials',
  'integrations.credentials.rotated': 'Rotated integration credentials',
  'integrations.catalog.created': 'Added catalog integration',
  'integrations.catalog.updated': 'Updated catalog integration',
  'integrations.catalog.access_changed': 'Changed catalog availability',
  'integrations.catalog.plan_added': 'Added plan access',
  'integrations.catalog.plan_removed': 'Removed plan access',
  'integrations.catalog.firm_access_set': 'Set firm access',
  'integrations.catalog.firm_access_cleared': 'Cleared firm access rule',
  'integrations.api_key.created': 'Issued API key',
  'integrations.api_key.rotated': 'Rotated API key',
  'integrations.api_key.revoked': 'Revoked API key',
  'integrations.webhook.created': 'Created webhook endpoint',
  'integrations.webhook.updated': 'Updated webhook endpoint',
  'integrations.webhook.secret_rotated': 'Rotated webhook signing secret',
  'integrations.webhook.redelivered': 'Redelivered webhook event',
  'export.created': 'Exported integration logs',
};
const TARGET_TYPES: Record<string, AdminIntegrationAuditEntry['target']['type']> = {
  platform_integration: 'PLATFORM_INTEGRATION',
  integration_catalog: 'CATALOG_ITEM',
  platform_api_key: 'API_KEY',
  platform_webhook: 'WEBHOOK',
  platform_export_job: 'LOG_EXPORT',
};

/** The rollup's totals over some rows; `sameUnit` false leaves the volume out. */
export function totalsOf(rows: readonly UsageRow[], sameUnit: boolean): AdminUsageTotals {
  const sum = (pick: (r: UsageRow) => number | null) => {
    const values = rows.map(pick).filter((v): v is number => v !== null);
    return values.length ? values.reduce((n, v) => n + v, 0) : null;
  };
  const requests = rows.reduce((n, r) => n + r.requests, 0);
  const successes = rows.reduce((n, r) => n + r.successes, 0);
  const failures = rows.reduce((n, r) => n + r.failures, 0);
  const timed = rows.filter((r) => r.avgLatencyMs !== null && r.requests > 0);
  const timedRequests = timed.reduce((n, r) => n + r.requests, 0);
  const lastDay = rows.reduce<number | null>(
    (latest, r) => (latest === null || r.day.getTime() > latest ? r.day.getTime() : latest),
    null,
  );
  const lastRows = rows.filter((r) => r.day.getTime() === lastDay);
  const lastSum = (pick: (r: UsageRow) => number | null) => {
    const values = lastRows.map(pick).filter((v): v is number => v !== null);
    return values.length ? values.reduce((n, v) => n + v, 0) : null;
  };
  return {
    requests,
    successes,
    failures,
    successRate: requests ? Math.round((successes / requests) * 10_000) / 100 : null,
    avgLatencyMs: timedRequests
      ? Math.round(
          timed.reduce((n, r) => n + (r.avgLatencyMs ?? 0) * r.requests, 0) / timedRequests,
        )
      : null,
    volume: sameUnit ? sum((r) => (r.volume === null ? null : Number(r.volume))) : null,
    costCents: sum((r) => r.costCents),
    connectedFirms: lastSum((r) => r.connectedFirms),
    activeFirms: lastSum((r) => r.activeFirms),
    connects: sum((r) => r.connects),
    disconnects: sum((r) => r.disconnects),
  };
}

/** The report's days: `to` today (UTC) and the 30 days up to it unless chosen, a year at most. */
export function usageRange(from: string | undefined, to: string | undefined, now = new Date()) {
  const end = to ?? dayKey(now);
  const start = from ?? dayKey(new Date(dayOf(end).getTime() - 29 * DAY_MS));
  if (start > end) throw invalid('The start date must be on or before the end date.');
  if (dayOf(end).getTime() - dayOf(start).getTime() > 366 * DAY_MS)
    throw invalid('Choose a range of a year or less.');
  return { from: start, to: end };
}

/**
 * The central integration log, its export, the usage report and the module's audit trail (R0
 * stage B8 `platform_integration_logs`, `platform_integration_usage_daily`; B1
 * `platform_export_jobs`; `audit_logs`). Admin scope, reads only, but the export request. Numbers
 * come from the daily rollup only; with no rows they are null, never invented.
 */
@Injectable()
export class IntegrationInsightsService {
  constructor(private readonly admin: AdminPrisma) {}

  // ---------- The log ----------

  async listLogs(
    q: z.output<typeof ListAdminIntegrationLogsQuery>,
  ): Promise<ListAdminIntegrationLogsResponse> {
    const where = await this.logWhere(q);
    const order = q.descending ? ('desc' as const) : ('asc' as const);
    const db = this.admin.db;
    const [rows, total] = await Promise.all([
      db.platformIntegrationLog.findMany({
        where,
        include,
        orderBy: [{ createdAt: order }, { id: order }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.platformIntegrationLog.count({ where }),
    ]);
    return { items: await this.shapeLogs(rows), total, page: q.page, pageSize: q.pageSize };
  }

  async facets(): Promise<AdminLogFacets> {
    const db = this.admin.db;
    const [integrations, events, firms] = await Promise.all([
      db.platformIntegrationLog.findMany({
        where: { integrationId: { not: null } },
        distinct: ['integrationId'],
        select: { integrationId: true, integration: { select: { id: true, name: true } } },
      }),
      db.platformIntegrationLog.findMany({ distinct: ['eventType'], select: { eventType: true } }),
      db.platformIntegrationLog.findMany({
        where: { subjectBusinessId: { not: null } },
        distinct: ['subjectBusinessId'],
        select: { subjectBusinessId: true },
      }),
    ]);
    const firmIds = firms.flatMap((f) => (f.subjectBusinessId ? [f.subjectBusinessId] : []));
    const names = await this.firmNames(firmIds);
    const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name);
    return {
      integrations: integrations
        .flatMap((i) => (i.integration ? [i.integration] : []))
        .sort(byName),
      eventTypes: events.map((e) => e.eventType).sort(),
      firms: firmIds.map((id) => ({ id, name: names.get(id) ?? 'Removed firm' })).sort(byName),
    };
  }

  /** One record, the events with its correlation id, the integration now, and its neighbours. */
  async getLog(id: string): Promise<AdminLogRecord> {
    const db = this.admin.db;
    const row = await db.platformIntegrationLog.findUnique({ where: { id }, include });
    if (!row) throw failure('NOT_FOUND');
    const at = row.createdAt;
    const [related, integration, newer, older] = await Promise.all([
      row.correlationId
        ? db.platformIntegrationLog.findMany({
            where: { correlationId: row.correlationId, id: { not: id } },
            include,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 50,
          })
        : [],
      row.integrationId
        ? db.platformIntegration.findUnique({
            where: { id: row.integrationId },
            select: { id: true, name: true, status: true },
          })
        : null,
      db.platformIntegrationLog.findFirst({
        where: { OR: [{ createdAt: { gt: at } }, { createdAt: at, id: { gt: id } }] },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      }),
      db.platformIntegrationLog.findFirst({
        where: { OR: [{ createdAt: { lt: at } }, { createdAt: at, id: { lt: id } }] },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      }),
    ]);
    const [log, ...others] = await this.shapeLogs([row, ...related]);
    return {
      log: log as AdminIntegrationLog,
      related: others,
      integration,
      previousId: newer?.id ?? null,
      nextId: older?.id ?? null,
    };
  }

  /** A B1 export job of the rows the filters find; R1's export worker makes the file. */
  async exportLogs(b: z.output<typeof ExportAdminLogsRequest>): Promise<AdminExportJob> {
    const query: LogFilters = {
      ...b.query,
      platformOnly: b.query?.platformOnly ?? false,
      descending: b.query?.descending ?? true,
    };
    const rows = await this.admin.db.platformIntegrationLog.count({
      where: await this.logWhere(query),
    });
    const filters = Object.fromEntries(Object.entries(query).filter(([, v]) => v !== undefined));
    const job = await this.admin.transaction(async (tx) => {
      const created = await tx.platformExportJob.create({
        data: {
          requestedByUserId: this.admin.adminUserId,
          module: 'INTEGRATION_LOGS',
          format: 'CSV',
          title: `Integration logs, ${dayKey(new Date())}`,
          filters: filters as Prisma.InputJsonValue,
          columns: [...LOG_EXPORT_COLUMNS],
        },
      });
      await auditIn(tx, {
        action: 'export.created',
        entity: { type: 'platform_export_job', id: created.id },
        label: created.title,
        metadata: {
          module: 'INTEGRATION_LOGS',
          format: 'CSV',
          fields: Object.keys(filters),
          rowsAtRequest: rows,
        },
        severity: 'MEDIUM',
      });
      return created;
    });
    return this.shapeJob(job);
  }

  /** My recent integration log exports, newest first. */
  async exports(): Promise<AdminExportJob[]> {
    const rows = await this.admin.db.platformExportJob.findMany({
      where: { requestedByUserId: this.admin.adminUserId, module: 'INTEGRATION_LOGS' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 20,
    });
    return rows.map((r) => this.shapeJob(r));
  }

  // ---------- Usage ----------

  async usage(q: z.output<typeof AdminUsageQuery>): Promise<AdminUsageReport> {
    const { from, to } = usageRange(q.from, q.to);
    const subjects = await this.subjects(q.scope);
    const subject = q.subject ?? null;
    if (subject && !subjects.some((s) => s.key === subject)) throw failure('NOT_FOUND');
    const chosen = subject ? subjects.filter((s) => s.key === subject) : subjects;
    const keys = chosen.map((s) => s.key);
    const rows = keys.length
      ? await this.admin.db.platformIntegrationUsageDaily.findMany({
          where: {
            scope: q.scope,
            subjectKey: { in: keys },
            day: { gte: dayOf(from), lte: dayOf(to) },
          },
          orderBy: { day: 'asc' },
        })
      : [];
    const units = new Set(chosen.map((s) => s.volumeUnit));
    const sameUnit = units.size === 1 && !units.has(null);
    const byDay = new Map<string, UsageRow[]>();
    for (const r of rows) byDay.set(dayKey(r.day), [...(byDay.get(dayKey(r.day)) ?? []), r]);
    const series: AdminUsageDay[] = [];
    for (let at = dayOf(from).getTime(); at <= dayOf(to).getTime(); at += DAY_MS) {
      const day = dayKey(new Date(at));
      const { successRate: _rate, ...t } = totalsOf(byDay.get(day) ?? [], sameUnit);
      series.push({ day, ...t });
    }
    const breakdown: AdminUsageSubject[] = chosen
      .map((s) => ({
        ...s,
        ...totalsOf(
          rows.filter((r) => r.subjectKey === s.key),
          s.volumeUnit !== null,
        ),
      }))
      .filter((s) => s.requests > 0 || s.connectedFirms !== null)
      .sort((a, b) => b.requests - a.requests);
    return {
      scope: q.scope,
      subject,
      from,
      to,
      series,
      totals: totalsOf(rows, sameUnit),
      subjects: breakdown,
      // The rollup has no per-plan counts, and thresholds have no table (R0): both stay empty.
      planDistribution: [],
      alerts: [],
    };
  }

  // ---------- The module's audit trail ----------

  async auditTrail(
    q: z.output<typeof ListAdminIntegrationAuditQuery>,
  ): Promise<ListAdminIntegrationAuditResponse> {
    const where: Prisma.AuditLogWhereInput = {
      businessId: null,
      OR: [
        { action: { startsWith: 'integrations.' } },
        {
          action: 'export.created',
          entityType: 'platform_export_job',
          metadata: { path: ['module'], equals: 'INTEGRATION_LOGS' },
        },
      ],
      ...(q.targetId ? { entityId: q.targetId } : {}),
    };
    const db = this.admin.db;
    const [rows, total] = await Promise.all([
      db.auditLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.auditLog.count({ where }),
    ]);
    const names = await this.userNames(rows.map((r) => r.actorUserId));
    return {
      items: rows.map((r) => {
        const fields = (r.metadata as { fields?: unknown } | null)?.fields;
        return {
          id: r.id,
          at: r.createdAt.toISOString(),
          actor: {
            id: r.actorUserId,
            name: r.actorUserId
              ? (names.get(r.actorUserId) ?? 'Firmivra team')
              : 'Firmivra platform',
            role: r.actorRole ?? 'Super Admin',
          },
          action: r.action,
          label: AUDIT_LABELS[r.action] ?? humanize(r.action.replace(/^integrations\./, '')),
          category: r.category === 'SECURITY' ? 'SECURITY' : 'INTEGRATION',
          target: {
            type: TARGET_TYPES[r.entityType] ?? 'PLATFORM_INTEGRATION',
            id: r.entityId ?? '',
            name: r.targetLabel ?? '',
          },
          changes: Array.isArray(fields)
            ? fields
                .filter((f): f is string => typeof f === 'string')
                .map((field) => ({ field, before: null, after: 'changed' }))
            : [],
          result: r.outcome === 'FAILURE' || r.outcome === 'DENIED' ? 'FAILED' : 'SUCCESS',
          ip: r.ip,
        };
      }),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ---------- Helpers ----------

  private async logWhere(q: LogFilters): Promise<Prisma.PlatformIntegrationLogWhereInput> {
    const and: Prisma.PlatformIntegrationLogWhereInput[] = [];
    if (q.integrationId) and.push({ integrationId: q.integrationId });
    if (q.platformOnly) and.push({ source: 'PLATFORM_INTEGRATION' });
    if (q.source) and.push({ source: q.source });
    if (q.severity) and.push({ severity: q.severity });
    if (q.eventType) and.push({ eventType: q.eventType });
    if (q.environment) and.push({ environment: q.environment });
    if (q.outcome) and.push({ succeeded: q.outcome === 'SUCCESS' });
    if (q.requestId) and.push({ OR: [{ requestId: q.requestId }, { correlationId: q.requestId }] });
    if (q.firmId) and.push({ subjectBusinessId: q.firmId });
    if (q.from) and.push({ createdAt: { gte: new Date(q.from) } });
    if (q.to) and.push({ createdAt: { lte: new Date(q.to) } });
    if (q.from && q.to && q.from > q.to) throw invalid('The start must be on or before the end.');
    if (q.search) {
      const text = { contains: q.search, mode: 'insensitive' as const };
      const firms = await this.admin.db.business.findMany({
        where: { name: text },
        select: { id: true },
        take: 50,
      });
      and.push({
        OR: [
          { message: text },
          { action: text },
          { eventType: text },
          { errorCode: text },
          { requestId: text },
          { correlationId: text },
          { integration: { name: text } },
          ...(firms.length ? [{ subjectBusinessId: { in: firms.map((f) => f.id) } }] : []),
        ],
      });
    }
    return and.length ? { AND: and } : {};
  }

  private async firmNames(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const firms = await this.admin.db.business.findMany({
      where: { id: { in: [...new Set(ids)] } },
      select: { id: true, name: true },
    });
    return new Map(firms.map((f) => [f.id, f.name]));
  }

  private async userNames(ids: (string | null)[]): Promise<Map<string, string>> {
    const unique = [...new Set(ids.filter((id): id is string => !!id))];
    if (!unique.length) return new Map();
    const users = await this.admin.db.user.findMany({
      where: { id: { in: unique } },
      select: { id: true, name: true },
    });
    return new Map(users.map((u) => [u.id, u.name]));
  }

  private async shapeLogs(rows: LogRow[]): Promise<AdminIntegrationLog[]> {
    if (!rows.length) return [];
    const [firms, users] = await Promise.all([
      this.firmNames(rows.flatMap((r) => (r.subjectBusinessId ? [r.subjectBusinessId] : []))),
      this.userNames(rows.map((r) => r.actorUserId)),
    ]);
    return rows.map((r) => {
      const details =
        r.details && typeof r.details === 'object' && !Array.isArray(r.details)
          ? Object.entries(r.details as Record<string, unknown>)
              .filter(([, v]) => v !== null && v !== undefined && typeof v !== 'object')
              .map(([k, v]) => ({
                label: humanize(k.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()),
                value: String(v),
              }))
          : [];
      const endpoint = (r.details as { endpoint?: unknown } | null)?.endpoint;
      return {
        id: r.id,
        at: r.createdAt.toISOString(),
        source: r.source,
        integrationId: r.integrationId,
        integrationName: r.integration?.name ?? null,
        provider: r.provider,
        environment: r.environment,
        severity: r.severity,
        eventType: r.eventType,
        action: actionLabel(r.action, r.eventType),
        succeeded: r.succeeded,
        errorCode: r.errorCode ? r.errorCode.toUpperCase().replace(/\./g, '_') : null,
        message: r.message,
        details,
        requestId: r.requestId,
        correlationId: r.correlationId,
        firm: r.subjectBusinessId
          ? { id: r.subjectBusinessId, name: firms.get(r.subjectBusinessId) ?? 'Removed firm' }
          : null,
        actor: r.actorUserId
          ? { type: 'USER', id: r.actorUserId, name: users.get(r.actorUserId) ?? 'Firmivra team' }
          : { type: 'SYSTEM', id: null, name: 'Firmivra platform' },
        endpoint: typeof endpoint === 'string' ? endpoint : null,
        resolution: this.resolutionOf(r),
      };
    });
  }

  /** A next step for a failure, linking an admin page or the provider's status page. */
  private resolutionOf(r: LogRow): AdminIntegrationLog['resolution'] {
    if (r.succeeded) return null;
    const page = r.integrationId ? `/integrations/platform/${r.integrationId}` : null;
    if (r.source === 'WEBHOOK')
      return { action: 'VIEW_WEBHOOK', label: 'View Webhook', href: '/integrations/api-webhooks' };
    if (!page) return null;
    if (r.errorCode === 'provider_unavailable')
      return {
        action: 'VIEW_PROVIDER_STATUS',
        label: 'View Provider Status',
        href: providerFor(r.provider ?? r.integration?.provider ?? '').statusUrl,
      };
    if (
      r.errorCode &&
      ['auth_failed', 'missing_configuration', 'credentials_required'].includes(r.errorCode)
    )
      return { action: 'UPDATE_CREDENTIAL', label: 'Update Credential', href: page };
    if (r.eventType.startsWith('sync.'))
      return { action: 'RETRY_SYNC', label: 'Retry Sync', href: page };
    return { action: 'VIEW_INTEGRATION', label: 'View Integration', href: page };
  }

  private shapeJob(r: Prisma.PlatformExportJobGetPayload<object>): AdminExportJob {
    return {
      id: r.id,
      title: r.title,
      format: 'CSV',
      status: r.status,
      rowCount: r.rowCount,
      errorCode: r.errorCode,
      createdAt: r.createdAt.toISOString(),
      finishedAt: r.finishedAt?.toISOString() ?? null,
      expiresAt: r.expiresAt?.toISOString() ?? null,
    };
  }

  /** The scope's subjects, with names and units for the breakdown. */
  private async subjects(
    scope: z.output<typeof AdminUsageQuery>['scope'],
  ): Promise<Omit<AdminUsageSubject, keyof AdminUsageTotals>[]> {
    const db = this.admin.db;
    if (scope === 'PLATFORM_INTEGRATION') {
      const rows = await db.platformIntegration.findMany({
        select: { id: true, name: true, category: true, provider: true },
        orderBy: { createdAt: 'asc' },
      });
      return rows.map((r) => {
        const p = providerFor(r.provider);
        return {
          key: r.id,
          name: r.name,
          category: r.category,
          volumeUnit: p.volumeUnit,
          volumeLabel: p.volumeLabel,
          requestLabel: p.requestLabel,
        };
      });
    }
    if (scope === 'CATALOG') {
      const rows = await db.platformIntegrationCatalog.findMany({
        select: { provider: true, name: true, category: true },
        orderBy: { sortOrder: 'asc' },
      });
      return rows.map((r) => ({
        key: r.provider,
        name: r.name,
        category: r.category,
        volumeUnit: null,
        volumeLabel: null,
        requestLabel: 'Firm Requests',
      }));
    }
    const keys = await db.platformApiKey.findMany({
      select: { id: true, name: true, prefix: true, lastFour: true },
      orderBy: { createdAt: 'asc' },
    });
    return keys.map((k) => ({
      key: k.id,
      name: `${k.name} (${k.prefix}…${k.lastFour})`,
      category: null,
      volumeUnit: null,
      volumeLabel: null,
      requestLabel: 'API Calls',
    }));
  }
}
