import { Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  type ReportCatalog,
  type ReportDataSource,
  type ReportDatePreset,
  type ReportDefinitionView,
  type ReportInsight,
  type ReportLookupList,
  type ReportRange,
  type ReportResult,
  type ReportSettingsView,
  type ReportsDashboard,
  type ReportsKpiCard,
  type ReportsCategoryCard,
  type RecentReportPage,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { memberNames, notFound } from '../workspaces/common.js';
import {
  type Computed,
  type DateSpec,
  type Filters,
  checkDefinition,
  compute,
  comparisonOf,
  rangeOf,
  todayIn,
} from './engine.js';
import {
  CATEGORY_LABELS,
  EMPTY_FILTERS,
  SYSTEM_REPORTS,
  canExport,
  canSeeRestricted,
  canWrite,
  isAdmin,
  reportErrors,
  systemReport,
  toView,
} from './reports.common.js';
import type {
  LookupQuery,
  RecentQuery,
  RunBody,
  SettingsBody,
  DashboardQuery,
} from './reports-input.js';
import { scheduleInclude, toScheduleRows } from './schedule-rows.js';
import { MAX_ROWS, type Row, SOURCES, type SourceDef, sourceOf, toCatalog } from './sources.js';
import type { z } from 'zod';

type Run = z.output<typeof RunBody>;
type Lookup = z.output<typeof LookupQuery>;
type Recent = z.output<typeof RecentQuery>;
type Settings = z.output<typeof SettingsBody>;
type Dashboard = z.output<typeof DashboardQuery>;

/** What a caller is, for every report request: the firm's zone and metric settings, and their reach. */
export interface Ctx {
  tx: TxClient;
  businessId: string;
  tenant: TenantContext;
  timezone: string;
  settings: {
    revenueBasis: 'COLLECTED' | 'INVOICED';
    includeTaxDefault: boolean;
    defaultDatePreset: ReportDatePreset;
    staleAfterMinutes: number;
  };
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
  /** Loads only the clients assigned to the caller (Staff). */
  reachOnly: boolean;
  /** Money and team data, and sensitive fields. */
  restricted: boolean;
}

export interface Resolved {
  title: string;
  category: ReportDefinitionView['category'];
  def: ReportDefinitionView;
  source: SourceDef;
  target: ReportResult['target'];
  definitionId: string | null;
  systemKey: string | null;
}

const DEFAULT_PRESET: ReportDatePreset = 'this_year';

const specOf = (d: ReportDefinitionView['date']): DateSpec =>
  d.rule === 'ROLLING'
    ? { rule: 'ROLLING', preset: d.preset }
    : { rule: 'FIXED', from: d.from, to: d.to };

/**
 * Runs reports: one path for the dashboard cards, the quick reports, saved reports, the builder's
 * preview and Run, exports and schedules, so a number is the same wherever it shows. Every query
 * is the firm's own (the caller's transaction is in its scope) and a caller who reaches only some
 * clients loads only theirs.
 */
@Injectable()
export class ReportsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async ctx(tx: TxClient, businessId: string, tenant: TenantContext, userId: string): Promise<Ctx> {
    const [row, timezone] = await Promise.all([
      tx.reportSettings.findUnique({ where: { businessId } }),
      firmTimeZone(tx, businessId),
    ]);
    const role = tenant.kind === 'staff' ? legacyFirmRole(tenant.role) : 'STAFF';
    return {
      tx,
      businessId,
      tenant,
      timezone,
      settings: {
        revenueBasis: row?.revenueBasis ?? 'COLLECTED',
        includeTaxDefault: row?.includeTaxDefault ?? false,
        defaultDatePreset:
          (row?.defaultDatePreset as ReportDatePreset | undefined) ?? DEFAULT_PRESET,
        staleAfterMinutes: row?.staleAfterMinutes ?? 60,
      },
      actor: { userId, role },
      reachOnly: role === 'STAFF',
      restricted: canSeeRestricted(tenant),
    };
  }

  // ---------- Catalog, sources, lookups ----------

  catalog(tenant: TenantContext): ReportCatalog {
    const restricted = canSeeRestricted(tenant);
    const categories = new Map<string, ReportCatalog['categories'][number]>();
    for (const r of SYSTEM_REPORTS) {
      if (sourceOf(r.dataSource)?.restricted && !restricted) continue;
      const entry = categories.get(r.category) ?? {
        category: r.category,
        label: CATEGORY_LABELS[r.category],
        reports: [],
      };
      entry.reports.push({
        key: r.key,
        name: r.name,
        description: r.description,
        category: r.category,
        dataSource: r.dataSource,
      });
      categories.set(r.category, entry);
    }
    return { categories: [...categories.values()] };
  }

  sources(tenant: TenantContext): ReportDataSource[] {
    const restricted = canSeeRestricted(tenant);
    return SOURCES.filter((s) => !s.restricted || restricted).map((s) => toCatalog(s, restricted));
  }

  lookups(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Lookup,
  ): Promise<ReportLookupList['items']> {
    return this.inFirm(businessId, async (tx) => {
      const search = q.search ?? '';
      const contains = { contains: search, mode: 'insensitive' as const };
      switch (q.kind) {
        case 'SERVICE': {
          const rows = await tx.service.findMany({
            where: { businessId, archivedAt: null, ...(search ? { name: contains } : {}) },
            orderBy: { name: 'asc' },
            take: q.limit,
            select: { id: true, name: true },
          });
          return rows.map((r) => ({ id: r.id, label: r.name }));
        }
        case 'SERVICE_CATEGORY': {
          const rows = await tx.serviceCategory.findMany({
            where: { businessId, ...(search ? { name: contains } : {}) },
            orderBy: { name: 'asc' },
            take: q.limit,
            select: { id: true, name: true },
          });
          return rows.map((r) => ({ id: r.id, label: r.name }));
        }
        case 'CLIENT': {
          const role = tenant.kind === 'staff' ? legacyFirmRole(tenant.role) : 'STAFF';
          const rows = await tx.client.findMany({
            where: {
              businessId,
              archivedAt: null,
              ...(search ? { displayName: contains } : {}),
              ...(role === 'STAFF' ? { assignedUserId: userId } : {}),
            },
            orderBy: { displayName: 'asc' },
            take: q.limit,
            select: { id: true, displayName: true },
          });
          return rows.map((r) => ({ id: r.id, label: r.displayName }));
        }
        case 'TEAM_MEMBER': {
          if (!canSeeRestricted(tenant)) return [];
          const rows = await tx.membership.findMany({
            where: {
              businessId,
              joinedAt: { not: null },
              ...(search ? { user: { name: contains } } : {}),
            },
            take: q.limit,
            select: { userId: true, user: { select: { name: true } } },
          });
          return rows
            .map((r) => ({ id: r.userId, label: r.user.name }))
            .sort((a, b) => a.label.localeCompare(b.label));
        }
        case 'LEAD_SOURCE': {
          const field = sourceOf('leads')!.fields.find((f) => f.key === 'source')!;
          return field.options
            .filter((o) => !search || o.label.toLowerCase().includes(search.toLowerCase()))
            .slice(0, q.limit)
            .map((o) => ({ id: o.value, label: o.label }));
        }
        case 'CAMPAIGN': {
          const rows = await tx.communication.findMany({
            where: { businessId, ...(search ? { name: contains } : {}) },
            orderBy: { createdAt: 'desc' },
            take: q.limit,
            select: { id: true, name: true },
          });
          return rows.map((r) => ({ id: r.id, label: r.name }));
        }
      }
    });
  }

  // ---------- Resolving a target ----------

  async resolve(ctx: Ctx, target: Run['target']): Promise<Resolved> {
    if (target.kind === 'SYSTEM') {
      const sys = systemReport(target.key);
      const source = sys ? sourceOf(sys.dataSource) : undefined;
      if (!sys || !source) throw notFound();
      if (source.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
      return {
        title: sys.name,
        category: sys.category,
        def: {
          ...sys.definition,
          category: sys.category,
          dataSource: sys.dataSource,
          date: { rule: 'ROLLING', preset: ctx.settings.defaultDatePreset },
        },
        source,
        target: { kind: 'SYSTEM', key: sys.key },
        definitionId: null,
        systemKey: sys.key,
      };
    }
    if (target.kind === 'SAVED') {
      const row = await ctx.tx.reportDefinition.findFirst({
        where: { businessId: ctx.businessId, id: target.id, ...this.visible(ctx) },
      });
      if (!row) throw notFound();
      const source = sourceOf(row.dataSource);
      if (!source)
        throw reportErrors.invalidDefinition([
          { path: 'dataSource', message: 'This report’s data source no longer exists' },
        ]);
      if (source.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
      return {
        title: row.name,
        category: row.category,
        def: toView(row),
        source,
        target: { kind: 'SAVED', id: row.id },
        definitionId: row.id,
        systemKey: null,
      };
    }
    const d = target.definition;
    const source = sourceOf(d.dataSource);
    if (!source)
      throw reportErrors.invalidDefinition([
        { path: 'dataSource', message: `There is no data source “${d.dataSource}”` },
      ]);
    if (source.restricted && !ctx.restricted) throw reportErrors.fieldNotAllowed([source.key]);
    if (source.category !== d.category)
      throw reportErrors.invalidDefinition([
        {
          path: 'category',
          message: `${source.label} is a ${source.category.toLowerCase()} data source`,
        },
      ]);
    return {
      title: 'Custom report',
      category: d.category,
      def: {
        category: d.category,
        dataSource: d.dataSource,
        columns: d.columns,
        filters: {
          logic: d.filters.logic,
          conditions: d.filters.conditions as Filters['conditions'],
          groups: d.filters.groups as Filters['groups'],
        },
        groupBy: d.groupBy ?? null,
        sortBy: d.sortBy ?? null,
        sortDescending: d.sortDescending,
        showTotals: d.showTotals,
        showPercentage: d.showPercentage,
        compareTo: d.compareTo,
        date: d.date as ReportDefinitionView['date'],
        chartType: d.chartType,
        showDataLabels: d.showDataLabels,
        includeTaxRevenue: d.includeTaxRevenue,
      },
      source,
      target: { kind: 'DEFINITION' },
      definitionId: null,
      systemKey: null,
    };
  }

  /** The saved reports the caller may open: their own, the company's, selected roles and people; Owner and Admin all. */
  visible(ctx: Pick<Ctx, 'actor' | 'tenant'>) {
    if (isAdmin(ctx.tenant)) return {};
    return {
      OR: [
        { ownerUserId: ctx.actor.userId },
        { visibility: 'COMPANY' as const },
        { visibility: 'SELECTED' as const, shares: { some: { userId: ctx.actor.userId } } },
        { visibility: 'SELECTED' as const, sharedRoles: { has: ctx.actor.role } },
      ],
    };
  }

  /** Throws the contract's errors for a definition the source does not allow. */
  validate(ctx: Ctx, r: Resolved): void {
    const { problems, forbidden } = checkDefinition(
      { ...r.def, filters: r.def.filters as Filters },
      r.source,
      ctx.restricted,
    );
    if (forbidden.length > 0) throw reportErrors.fieldNotAllowed(forbidden);
    if (problems.length > 0) throw reportErrors.invalidDefinition(problems);
  }

  // ---------- Running ----------

  private async rows(ctx: Ctx, source: SourceDef, range: ReportRange): Promise<Row[]> {
    const rows = await source.load({
      tx: ctx.tx,
      businessId: ctx.businessId,
      timezone: ctx.timezone,
      actor: ctx.actor,
      reachOnly: ctx.reachOnly,
      from: range.from,
      to: range.to,
    });
    if (rows.length > MAX_ROWS)
      throw reportErrors.invalidRange(
        'That is more rows than a report can load. Narrow the date range or add filters.',
      );
    return rows;
  }

  /** A record named in the quick filters is the firm's own (and, for a client, one the caller reaches): else NOT_FOUND, as an unknown id. */
  private async checkQuickIds(ctx: Ctx, q: Run['quick']): Promise<void> {
    if (!q) return;
    const { tx, businessId } = ctx;
    const exists = async (found: Promise<unknown>) => {
      if (!(await found)) throw notFound();
    };
    if (q.serviceId)
      await exists(
        tx.service.findFirst({ where: { businessId, id: q.serviceId }, select: { id: true } }),
      );
    if (q.serviceCategoryId)
      await exists(
        tx.serviceCategory.findFirst({
          where: { businessId, id: q.serviceCategoryId },
          select: { id: true },
        }),
      );
    if (q.staffUserId)
      await exists(
        tx.membership.findFirst({
          where: { businessId, userId: q.staffUserId, joinedAt: { not: null } },
          select: { userId: true },
        }),
      );
    if (q.clientId) {
      await exists(
        tx.client.findFirst({
          where: {
            businessId,
            id: q.clientId,
            ...(ctx.reachOnly ? { assignedUserId: ctx.actor.userId } : {}),
          },
          select: { id: true },
        }),
      );
    }
  }

  /** Quick filters of the detail view as conditions, with a notice for what does not apply here. */
  private quick(
    source: SourceDef,
    q: Run['quick'],
    notices: string[],
  ): { filters: Filters; clientId: string | null } {
    const conditions: Filters['conditions'] = [];
    const fields = new Map(source.fields.map((f) => [f.key, f]));
    if (q?.clientType && q.clientType !== 'ALL') {
      const status = fields.get('status');
      const has = (v: string) => status?.options.some((o) => o.value === v);
      if (q.clientType === 'ACTIVE' && has('ACTIVE'))
        conditions.push({ field: 'status', op: 'IS', value: 'ACTIVE' });
      else if (q.clientType === 'INACTIVE' && has('INACTIVE'))
        conditions.push({ field: 'status', op: 'IS', value: 'INACTIVE' });
      else if (q.clientType === 'NEW' && has('NEW'))
        conditions.push({ field: 'status', op: 'IS', value: 'NEW' });
      else if (q.clientType === 'EXISTING' && has('NEW'))
        conditions.push({ field: 'status', op: 'IS_NONE_OF', value: ['NEW'] });
      else notices.push('Client type does not apply to this report.');
    }
    if (q?.serviceId || q?.serviceCategoryId)
      notices.push('The service filter does not apply to this report.');
    if (q?.staffUserId) notices.push('The staff filter does not apply to this report.');
    return { filters: { logic: 'AND', conditions, groups: [] }, clientId: q?.clientId ?? null };
  }

  /** One report run now: loads the rows once per range and computes everything from them. */
  async execute(
    ctx: Ctx,
    r: Resolved,
    o: Pick<
      Run,
      | 'date'
      | 'compareTo'
      | 'quick'
      | 'extraFilters'
      | 'sort'
      | 'search'
      | 'chartType'
      | 'showDataLabels'
      | 'includeTaxRevenue'
    > & { page: number; pageSize: number; preview: boolean; hiddenColumns?: string[] },
  ): Promise<{
    result: Omit<ReportResult, 'runId' | 'title' | 'target'>;
    computed: Computed;
    range: ReportRange;
  }> {
    const def: ReportDefinitionView = {
      ...r.def,
      compareTo: o.compareTo ?? r.def.compareTo,
      chartType: o.chartType ?? r.def.chartType,
      showDataLabels: o.showDataLabels ?? r.def.showDataLabels,
      includeTaxRevenue: o.includeTaxRevenue ?? r.def.includeTaxRevenue,
      date: (o.date as ReportDefinitionView['date'] | undefined) ?? r.def.date,
    };
    const extra: Filters | null = o.extraFilters
      ? {
          logic: o.extraFilters.logic,
          conditions: o.extraFilters.conditions as Filters['conditions'],
          groups: o.extraFilters.groups as Filters['groups'],
        }
      : null;
    // Everything the caller can add is checked as the definition is: fields, operators, values.
    if (o.sort) {
      const f = r.source.fields.find((x) => x.key === o.sort!.field);
      if (!f)
        throw reportErrors.invalidDefinition([
          { path: 'sort.field', message: `“${o.sort.field}” is not a field of ${r.source.label}` },
        ]);
      if (f.sensitive && !ctx.restricted) throw reportErrors.fieldNotAllowed([f.key]);
      if (!f.sortable)
        throw reportErrors.invalidDefinition([
          { path: 'sort.field', message: `${f.label} cannot be sorted` },
        ]);
    }
    this.validate(ctx, {
      ...r,
      def: {
        ...def,
        filters: {
          logic: 'AND',
          conditions: [...def.filters.conditions, ...(extra?.conditions ?? [])],
          groups: [...def.filters.groups, ...(extra?.groups ?? [])],
        },
      },
    });
    await this.checkQuickIds(ctx, o.quick);
    const spec = specOf(def.date);
    const range = rangeOf(spec, ctx.timezone);
    const notices: string[] = [];
    const cmpRange = def.compareTo === 'NONE' ? null : comparisonOf(range, spec, def.compareTo);
    const quick = this.quick(r.source, o.quick, notices);

    let rows = await this.rows(ctx, r.source, range);
    let compareRows = cmpRange ? await this.rows(ctx, r.source, cmpRange) : null;
    if (quick.clientId) {
      const only = (list: Row[]) =>
        list.filter((x) => x.links.some((l) => l.kind === 'CLIENT' && l.id === quick.clientId));
      rows = only(rows);
      compareRows = compareRows ? only(compareRows) : null;
    }
    const filters = [def.filters as Filters, ...(extra ? [extra] : []), quick.filters].filter(
      (f) => f.conditions.length > 0 || f.groups.length > 0,
    );
    const computed = compute({
      source: r.source,
      def,
      rows,
      compareRows,
      range,
      comparisonRange: cmpRange,
      filters: filters.length > 0 ? filters : [EMPTY_FILTERS],
      search: o.search,
      sort: o.sort,
      includeTax: def.includeTaxRevenue || ctx.settings.includeTaxDefault,
      page: o.page,
      pageSize: o.pageSize,
      preview: o.preview,
      ...(o.hiddenColumns ? { hiddenColumns: o.hiddenColumns } : {}),
    });
    const fields = new Map(r.source.fields.map((f) => [f.key, f]));
    const chips = [
      ...def.filters.conditions,
      ...def.filters.groups.flatMap((g) => g.conditions),
      ...(extra?.conditions ?? []),
      ...quick.filters.conditions,
    ].map((c) => ({
      field: c.field,
      label: fields.get(c.field)?.label ?? c.field,
      value: `${c.op.toLowerCase().replace(/_/g, ' ')}${c.value === undefined ? '' : ` ${Array.isArray(c.value) ? c.value.join(', ') : typeof c.value === 'object' ? JSON.stringify(c.value) : String(c.value)}`}`,
    }));
    if (def.compareTo !== 'NONE' && !cmpRange)
      notices.push('Comparison is not available for this range.');
    const insights: ReportInsight[] = computed.insights.map((i) => ({
      ...i,
      range,
      target: {
        kind: 'REPORT',
        reportKey:
          r.systemKey ??
          SYSTEM_REPORTS.find((s) => s.dataSource === r.source.key)?.key ??
          'revenue_summary',
      },
    }));
    return {
      computed,
      range,
      result: {
        category: r.category,
        definition: def,
        range,
        comparisonRange: cmpRange,
        notices: [...computed.notices, ...notices],
        kpis: computed.kpis,
        chart: computed.chart,
        breakdown: computed.breakdown,
        chips,
        table: {
          columns: computed.columns,
          rows: computed.rows,
          totals: computed.totals,
          total: computed.total,
          page: o.page,
          pageSize: o.pageSize,
        },
        insights,
        preview: o.preview,
        generatedAt: new Date().toISOString(),
        stale: false,
      },
    };
  }

  /** POST /reports/run. A saved or built-in report's run is recorded (Recent Reports); a preview or an unsaved one is not. */
  run(businessId: string, tenant: TenantContext, userId: string, body: Run): Promise<ReportResult> {
    return this.inFirm(businessId, async (tx) => {
      const ctx = await this.ctx(tx, businessId, tenant, userId);
      const resolved = await this.resolve(ctx, body.target);
      const out = await this.execute(ctx, resolved, { ...body });
      let runId: string | null = null;
      if (!body.preview && (resolved.definitionId || resolved.systemKey)) {
        const now = new Date();
        const row = await tx.reportRun.create({
          data: {
            businessId,
            definitionId: resolved.definitionId,
            systemKey: resolved.systemKey,
            kind: 'VIEW',
            status: 'SUCCEEDED',
            requestedByUserId: userId,
            rangeFrom: new Date(`${out.range.from}T00:00:00.000Z`),
            rangeTo: new Date(`${out.range.to}T00:00:00.000Z`),
            definitionSnapshot: {
              title: resolved.title,
              category: resolved.category,
              source: resolved.source.key,
              definition: out.result.definition,
            } as never,
            rowCount: out.computed.total,
            startedAt: now,
            finishedAt: now,
          },
          select: { id: true },
        });
        runId = row.id;
      }
      return { title: resolved.title, target: resolved.target, ...out.result, runId };
    });
  }

  // ---------- The dashboard ----------

  dashboard(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Dashboard,
  ): Promise<ReportsDashboard> {
    return this.inFirm(businessId, async (tx) => {
      const ctx = await this.ctx(tx, businessId, tenant, userId);
      const spec: DateSpec =
        q.from && q.to
          ? { rule: 'FIXED', from: q.from, to: q.to }
          : { rule: 'ROLLING', preset: q.preset ?? ctx.settings.defaultDatePreset };
      if (spec.rule === 'FIXED' && spec.from > spec.to)
        throw reportErrors.invalidRange('The start date must be on or before the end date');
      const range = rangeOf(spec, ctx.timezone);
      const compareTo = q.compareTo ?? 'NONE';
      const cmp = comparisonOf(range, spec, compareTo);
      const date =
        spec.rule === 'ROLLING'
          ? ({ rule: 'ROLLING', preset: spec.preset } as const)
          : ({ rule: 'FIXED', from: spec.from, to: spec.to } as const);

      const summarize = async (key: string) => {
        const sys = systemReport(key)!;
        const source = sourceOf(sys.dataSource)!;
        if (source.restricted && !ctx.restricted) return null;
        const resolved = await this.resolve(ctx, { kind: 'SYSTEM', key });
        const out = await this.execute(ctx, resolved, {
          date,
          compareTo,
          page: 1,
          pageSize: 1,
          preview: false,
        });
        return { out, sys, source };
      };

      const kpiOf = (s: Awaited<ReturnType<typeof summarize>>, key: string) =>
        s?.out.computed.kpis.find((k) => k.key === key) ?? null;
      const revenue = await summarize(
        ctx.settings.revenueBasis === 'COLLECTED' ? 'revenue_summary' : 'outstanding_invoices',
      );
      const newClients = await summarize('new_clients');
      const filed = await summarize('returns_filed');
      const leads = await summarize('lead_pipeline');
      const tasks = await summarize('task_workload');
      const totalClients = await tx.client.count({
        where: {
          businessId,
          archivedAt: null,
          ...(ctx.reachOnly ? { assignedUserId: userId } : {}),
        },
      });

      const kpis: ReportsKpiCard[] = [
        {
          key: 'total_clients',
          label: 'Total Clients',
          type: 'NUMBER',
          value: totalClients,
          previous: null,
          deltaPercent: null,
          definition: 'Clients that are not archived.',
          reportKey: 'clients_by_status',
        },
      ];
      const nc = kpiOf(newClients, 'count');
      if (nc)
        kpis.push({
          ...nc,
          key: 'new_clients',
          label: 'New Clients',
          definition: 'Clients created in the range.',
          reportKey: 'new_clients',
        });
      if (ctx.restricted) {
        const rv = ctx.settings.revenueBasis === 'COLLECTED' ? kpiOf(revenue, 'amount') : null;
        kpis.push(
          rv
            ? {
                ...rv,
                key: 'total_revenue',
                label: 'Total Revenue',
                definition: 'Payments received in the range (collected).',
                reportKey: 'revenue_summary',
              }
            : {
                key: 'total_revenue',
                label: 'Total Revenue',
                type: 'MONEY',
                value: null,
                previous: null,
                deltaPercent: null,
                definition: 'Invoiced revenue: see Outstanding Invoices.',
                reportKey: 'revenue_summary',
              },
        );
      }
      const rf = kpiOf(filed, 'count');
      if (rf)
        kpis.push({
          ...rf,
          key: 'returns_filed',
          label: 'Returns Filed',
          definition: 'Returns filed in the range.',
          reportKey: 'returns_filed',
        });

      const card = (
        category: ReportsCategoryCard['category'],
        s: Awaited<ReturnType<typeof summarize>>,
        key: string,
        kpiKey: string,
        label: string,
      ): ReportsCategoryCard => ({
        category,
        label: CATEGORY_LABELS[category],
        headline: s
          ? (() => {
              const k = kpiOf(s, kpiKey);
              return k ? { ...k, label } : null;
            })()
          : null,
        chart: s?.out.computed.chart ?? null,
        reportKey: key,
        allowed: s !== null,
      });
      const categories: ReportsCategoryCard[] = [
        card('FINANCIAL', revenue, 'revenue_summary', 'amount', 'Revenue'),
        card('CLIENT', newClients, 'new_clients', 'count', 'New Clients'),
        card('TAX', filed, 'returns_filed', 'count', 'Returns Filed'),
        card('LEADS', leads, 'lead_pipeline', 'count', 'Leads'),
        card('TEAM_PRODUCTIVITY', tasks, 'task_workload', 'count', 'Tasks'),
      ];

      const today = todayIn(ctx.timezone);
      const insights = await this.dashboardInsights(ctx, range, today);

      const recent = await this.recentRows(tx, businessId, userId, {
        page: 1,
        pageSize: 5,
        sort: 'at',
        direction: 'desc',
      });
      const scheduled = await toScheduleRows(
        tx,
        businessId,
        await tx.reportSchedule.findMany({
          where: { businessId, deletedAt: null },
          orderBy: [{ nextRunAt: 'asc' }, { id: 'asc' }],
          take: 5,
          include: scheduleInclude,
        }),
      );

      return {
        range,
        comparisonRange: cmp,
        kpis,
        categories,
        quickReports: this.catalog(tenant).categories.flatMap((c) => c.reports),
        recent: recent.items,
        scheduled,
        insights,
        generatedAt: new Date().toISOString(),
        stale: false,
        canCreate: canWrite(tenant),
        canExport: canExport(tenant),
      };
    });
  }

  /** Deterministic observations over the firm's real numbers, each with the report it comes from. */
  private async dashboardInsights(
    ctx: Ctx,
    range: ReportRange,
    today: string,
  ): Promise<ReportInsight[]> {
    const out: ReportInsight[] = [];
    if (ctx.restricted) {
      const overdue = await ctx.tx.invoice.aggregate({
        where: {
          businessId: ctx.businessId,
          status: 'OPEN',
          dueOn: { lt: new Date(`${today}T00:00:00.000Z`) },
        },
        _sum: { totalCents: true },
        _count: { _all: true },
      });
      if (overdue._count._all > 0) {
        out.push({
          key: 'overdue_invoices',
          message: `${overdue._count._all} open invoice${overdue._count._all === 1 ? ' is' : 's are'} past due.`,
          metric: 'overdue_invoice_total',
          value: overdue._sum.totalCents ?? 0,
          threshold: 'due date before today',
          range,
          target: { kind: 'REPORT', reportKey: 'outstanding_invoices' },
        });
      }
    }
    const cutoff = new Date(Date.now() - 2 * 86_400_000);
    const waiting = await ctx.tx.lead.count({
      where: {
        businessId: ctx.businessId,
        status: 'SUBMITTED',
        archivedAt: null,
        submittedAt: { lt: cutoff },
        ...(ctx.reachOnly ? { assignedUserId: ctx.actor.userId } : {}),
      },
    });
    if (waiting > 0) {
      out.push({
        key: 'uncontacted_leads',
        message: `${waiting} lead${waiting === 1 ? ' has' : 's have'} waited more than 2 days without a first contact.`,
        metric: 'uncontacted_leads',
        value: waiting,
        threshold: '2 days',
        range,
        target: { kind: 'MODULE', module: 'leads', query: { status: 'SUBMITTED' } },
      });
    }
    return out;
  }

  // ---------- Recent ----------

  recent(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Recent,
  ): Promise<RecentReportPage> {
    void tenant;
    return this.inFirm(businessId, (tx) => this.recentRows(tx, businessId, userId, q));
  }

  async recentRows(
    tx: TxClient,
    businessId: string,
    userId: string,
    q: Pick<Recent, 'page' | 'pageSize' | 'sort' | 'direction'> & Partial<Recent>,
  ): Promise<RecentReportPage> {
    const where = {
      businessId,
      requestedByUserId: userId,
      kind: q.kind ?? ('VIEW' as const),
    };
    const rows = await tx.reportRun.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 500,
      include: {
        definition: { select: { id: true, name: true, category: true, ownerUserId: true } },
      },
    });
    const names = await memberNames(
      tx,
      businessId,
      rows.map((r) => r.requestedByUserId),
    );
    const mapped = rows.flatMap((r) => {
      const snap = (r.definitionSnapshot ?? {}) as { title?: string; category?: string };
      const name = r.definition?.name ?? snap.title ?? 'Report';
      const category = (r.definition?.category ??
        snap.category ??
        'FINANCIAL') as RecentReportPage['items'][number]['category'];
      const row: RecentReportPage['items'][number] = {
        runId: r.id,
        name,
        category,
        kind: r.kind,
        savedReportId: r.definitionId,
        systemKey: r.systemKey,
        saved: r.definitionId !== null,
        owner:
          r.requestedByUserId && names.get(r.requestedByUserId)
            ? { userId: r.requestedByUserId, name: names.get(r.requestedByUserId)! }
            : null,
        at: r.createdAt.toISOString(),
      };
      return [row];
    });
    const filtered = mapped
      .filter((m) => !q.category || m.category === q.category)
      .filter((m) => !q.search || m.name.toLowerCase().includes(q.search.toLowerCase()));
    const dir = q.direction === 'asc' ? 1 : -1;
    filtered.sort(
      (a, b) =>
        dir *
        (q.sort === 'name'
          ? a.name.localeCompare(b.name)
          : q.sort === 'category'
            ? a.category.localeCompare(b.category)
            : a.at.localeCompare(b.at)),
    );
    const start = (q.page - 1) * q.pageSize;
    return {
      items: filtered.slice(start, start + q.pageSize),
      total: filtered.length,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  // ---------- Settings ----------

  settings(businessId: string, tenant: TenantContext, userId: string): Promise<ReportSettingsView> {
    return this.inFirm(businessId, async (tx) => {
      const ctx = await this.ctx(tx, businessId, tenant, userId);
      const row = await tx.reportSettings.findUnique({ where: { businessId } });
      return {
        revenueBasis: ctx.settings.revenueBasis,
        includeTaxDefault: ctx.settings.includeTaxDefault,
        defaultDatePreset: ctx.settings.defaultDatePreset,
        staleAfterMinutes: ctx.settings.staleAfterMinutes,
        timezone: ctx.timezone,
        updatedAt: row?.updatedAt.toISOString() ?? null,
      };
    });
  }

  async saveSettings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Settings,
  ): Promise<ReportSettingsView> {
    if (!isAdmin(tenant)) throw reportErrors.forbidden();
    await this.inFirm(businessId, async (tx) => {
      await tx.reportSettings.upsert({
        where: { businessId },
        create: { businessId, ...body, updatedByUserId: userId },
        update: { ...body, updatedByUserId: userId },
      });
      await this.audit.logIn(
        tx,
        'report_settings.updated',
        { type: 'report_settings', id: businessId },
        { fields: Object.keys(body) },
        { businessId, actorUserId: userId },
      );
    });
    return this.settings(businessId, tenant, userId);
  }
}
