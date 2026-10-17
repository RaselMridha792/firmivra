import { randomUUID } from 'node:crypto';
import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AutomationLogExport,
  AutomationRunDetail,
  AutomationRunPage,
  AutomationRunsSummary,
} from '@firmivra/types';
import type { z } from 'zod';
import { zonedInstant } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import { likeEscape } from '../clients/clients.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notFound } from '../workspaces/common.js';
import { AUTOMATION_FILES, type AutomationFiles } from './automation-files.js';
import { autoErrors, iso } from './automations.common.js';
import { type AutoCtx, AutomationsReadService, runInclude } from './automations-read.service.js';
import type { ExportBody, RerunBody, RunsQuery } from './automations-input.js';
import { actionOf } from './catalog.js';
import { AutomationEngine } from './engine.service.js';
import { matches, viewOf } from './logic.js';
import { loadCandidates } from './matching.js';

type Out<S extends z.ZodType> = z.output<S>;

const MAX_EXPORT_ROWS = 50_000;
const BOM = String.fromCharCode(0xfeff);
const URL_SECONDS = 300;
const TABS: Record<string, Prisma.AutomationRunWhereInput> = {
  all: {},
  success: { status: { in: ['SUCCESS', 'PARTIAL_SUCCESS'] } },
  failed: { status: 'FAILED' },
  skipped: { status: 'SKIPPED' },
  pending: { status: { in: ['PENDING', 'RUNNING'] } },
};

const REMEDIATION: Record<string, string> = {
  NO_CONTACT: 'Add an email address to the client, then retry.',
  TEMPLATE_UNAVAILABLE: 'Activate the message template or choose another, then retry.',
  OWNER_UNAVAILABLE: 'Choose a new owner for the rule.',
  NOT_PERMITTED: 'Give the rule’s owner access to the module, or change the owner.',
  NO_CLIENT: 'The record has no client; change the rule’s trigger.',
  CLIENT_ARCHIVED: 'Restore the client, then retry.',
  ACTION_ERROR: 'Try again; if it keeps failing, contact support.',
};

/** The logs: runs with their action log, details, re-run and export. */
@Injectable()
export class RunsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(AUTOMATION_FILES) private readonly files: AutomationFiles,
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
    private readonly engine: AutomationEngine,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: AutoCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  private where(
    ctx: AutoCtx,
    q: Omit<Out<typeof RunsQuery>, 'page' | 'pageSize'>,
    withTab = true,
  ): Prisma.AutomationRunWhereInput {
    const search = q.search ? likeEscape(q.search) : undefined;
    return {
      businessId: ctx.businessId,
      dryRun: q.dryRun ?? false,
      ...(withTab ? (TABS[q.tab] ?? {}) : {}),
      ...(q.ruleId ? { ruleId: q.ruleId } : {}),
      ...(q.module ? { sourceModule: q.module } : {}),
      ...(q.clientId ? { clientId: q.clientId } : {}),
      // The legacy Staff role sees the runs of its own clients and those with none.
      ...(ctx.actor.role === 'STAFF'
        ? { OR: [{ clientId: null }, { client: { assignedUserId: ctx.actor.userId } }] }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: new Date(zonedInstant(ctx.timezone, q.from, 0)) } : {}),
              ...(q.to ? { lt: new Date(zonedInstant(ctx.timezone, q.to, 1_440)) } : {}),
            },
          }
        : {}),
      ...(search
        ? {
            AND: [
              {
                OR: [
                  { rule: { name: { contains: search, mode: 'insensitive' } } },
                  { client: { displayName: { contains: search, mode: 'insensitive' } } },
                ],
              },
            ],
          }
        : {}),
    };
  }

  list(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof RunsQuery>,
  ): Promise<AutomationRunPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const where = this.where(ctx, q);
      const [total, rows] = await Promise.all([
        ctx.tx.automationRun.count({ where }),
        ctx.tx.automationRun.findMany({
          where,
          include: runInclude,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
      ]);
      return {
        items: await this.read.runRows(ctx, rows),
        total,
        page: q.page,
        pageSize: q.pageSize,
      };
    });
  }

  summary(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof RunsQuery>,
  ): Promise<AutomationRunsSummary> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const grouped = await ctx.tx.automationRun.groupBy({
        by: ['status'],
        where: this.where(ctx, q, false),
        _count: { _all: true },
      });
      const n = (...s: string[]) =>
        grouped.filter((g) => s.includes(g.status)).reduce((t, g) => t + g._count._all, 0);
      return {
        total: grouped.reduce((t, g) => t + g._count._all, 0),
        success: n('SUCCESS', 'PARTIAL_SUCCESS'),
        failed: n('FAILED'),
        skipped: n('SKIPPED'),
        pending: n('PENDING', 'RUNNING'),
      };
    });
  }

  private async load(ctx: AutoCtx, id: string) {
    const r = await ctx.tx.automationRun.findFirst({
      where: {
        businessId: ctx.businessId,
        id,
        ...(ctx.actor.role === 'STAFF'
          ? { OR: [{ clientId: null }, { client: { assignedUserId: ctx.actor.userId } }] }
          : {}),
      },
      include: {
        ...runInclude,
        executions: { orderBy: { position: 'asc' } },
        ruleVersion: true,
        rule: { select: { id: true, name: true, currentVersionId: true } },
      },
    });
    if (!r) throw notFound();
    return r;
  }

  private async detailOf(
    ctx: AutoCtx,
    run: Awaited<ReturnType<RunsService['load']>>,
  ): Promise<AutomationRunDetail> {
    const [row] = await this.read.runRows(ctx, [run as never]);
    const names = await memberNames(ctx.tx, ctx.businessId, [run.lastRerunByUserId]);
    const view = viewOf(run.ruleVersion);
    const retryable = run.executions
      .filter((e) => e.status === 'FAILED' && e.retryable)
      .map((e) => e.actionKey);
    return {
      ...(row as NonNullable<typeof row>),
      sourceEventKey: run.sourceEventKey,
      correlationId: run.correlationId,
      depth: run.depth,
      parentRunId: run.parentRunId,
      finishedAt: iso(run.finishedAt),
      error:
        run.errorCode &&
        (run.status === 'FAILED' || run.status === 'PARTIAL_SUCCESS' || run.status === 'SKIPPED')
          ? {
              code: run.errorCode,
              message: run.message ?? 'The run did not finish',
              remediation: REMEDIATION[run.errorCode] ?? null,
            }
          : null,
      actions: run.executions.map((e) => ({
        actionKey: e.actionKey,
        position: e.position,
        type: e.actionType,
        label: actionOf(e.actionType)?.label ?? e.actionType,
        status: e.status,
        attempts: e.attempts,
        retryable: e.retryable,
        errorCode: e.errorCode,
        detail: e.detail,
        scheduledFor: iso(e.scheduledFor),
        result: e.resultKind && e.resultId ? { kind: e.resultKind, id: e.resultId } : null,
        startedAt: iso(e.startedAt),
        finishedAt: iso(e.finishedAt),
      })),
      ruleSnapshot: view,
      ruleChanged: run.rule.currentVersionId !== run.ruleVersionId,
      related: [
        ...(run.recordKind && run.recordId
          ? [{ kind: run.recordKind, id: run.recordId, label: run.recordKind }]
          : []),
        ...run.executions
          .filter((e) => e.resultKind && e.resultId)
          .map((e) => ({
            kind: e.resultKind as string,
            id: e.resultId as string,
            label: e.resultKind as string,
          })),
      ],
      rerun: {
        count: run.rerunCount,
        lastAt: iso(run.lastRerunAt),
        lastBy: memberRef(names, run.lastRerunByUserId),
        lastReason: run.lastRerunReason,
      },
      retryableActionKeys: retryable,
      canRerun: ctx.perms.write && retryable.length > 0,
    };
  }

  async get(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
  ): Promise<AutomationRunDetail> {
    const out = await this.run(businessId, tenant, userId, async (ctx) =>
      this.detailOf(ctx, await this.load(ctx, id)),
    );
    await this.audit.log('automation_run.viewed', { type: 'automation_run', id }, { runId: id });
    return out;
  }

  // ---------- Re-run ----------

  async rerun(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof RerunBody>,
  ): Promise<AutomationRunDetail> {
    const plan = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.write) throw autoErrors.forbidden();
      if (body.force && !ctx.perms.manage) throw autoErrors.forbidden();
      const run = await this.load(ctx, id);
      if (run.dryRun) throw autoErrors.rerunNotAllowed('A test run cannot be run again');
      const failed = run.executions.filter((e) => e.status === 'FAILED' && e.retryable);
      const keys = body.actionKeys ?? failed.map((e) => e.actionKey);
      if (keys.some((k) => !failed.some((e) => e.actionKey === k)) || keys.length === 0)
        throw autoErrors.rerunNotAllowed('Only failed actions that can be retried are run again');
      if (run.rule.currentVersionId !== run.ruleVersionId && !body.confirmRuleChanged)
        throw autoErrors.rerunNotAllowed(
          'The rule changed since this run; confirm to run it again',
        );
      // The condition has to hold still, unless an Automation Admin forces it.
      let stillMatches = true;
      if (!body.force && run.recordId) {
        const view = viewOf(run.ruleVersion);
        const found = await loadCandidates(
          ctx.tx,
          run.ruleVersion.triggerEvent,
          { timing: 'IMMEDIATE', offsetValue: null, offsetUnit: null },
          {
            businessId,
            now: new Date(),
            today: ctx.today,
            since: new Date(0),
            recordId: run.recordId,
            limit: 1,
          },
        );
        stillMatches =
          found.length > 0 &&
          matches(
            found[0]!.fields,
            view.matchMode,
            view.conditions.map((c) => ({ ...c, value: c.value ?? undefined })),
          );
      }
      if (!stillMatches) {
        const now = new Date();
        for (const e of failed)
          await ctx.tx.automationActionExecution.update({
            where: { id: e.id },
            data: {
              status: 'SKIPPED',
              finishedAt: now,
              errorCode: null,
              detail: 'The record no longer matches the rule',
            },
          });
      }
      await this.audit.logIn(
        ctx.tx,
        'automation_run.rerun',
        { type: 'automation_run', id },
        {
          runId: id,
          ruleId: run.ruleId,
          actionKeys: keys,
          reason: body.reason,
          force: body.force,
          skipped: !stillMatches,
        },
      );
      return { keys, stillMatches };
    });
    if (plan.stillMatches)
      await this.engine.retry(businessId, id, plan.keys, { userId, reason: body.reason });
    else await this.engine.rollup(businessId, id);
    return this.run(businessId, tenant, userId, async (ctx) =>
      this.detailOf(ctx, await this.load(ctx, id)),
    );
  }

  // ---------- Export ----------

  async export(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof ExportBody>,
  ): Promise<AutomationLogExport> {
    const made = await this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.export) throw autoErrors.forbidden();
      if (body.filter.ruleId) await this.read.load(ctx, body.filter.ruleId);
      if (body.filter.clientId) {
        const c = await ctx.tx.client.findFirst({
          where: { businessId, id: body.filter.clientId },
          select: { id: true },
        });
        if (!c) throw notFound();
      }
      const where = this.where(ctx, body.filter);
      const total = await ctx.tx.automationRun.count({ where });
      if (total > MAX_EXPORT_ROWS) throw autoErrors.tooManyRows();
      const rows = await ctx.tx.automationRun.findMany({
        where,
        include: runInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      const cell = (v: string | number | null) => {
        if (v === null) return '""';
        let s = String(v);
        if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
        return `"${s.replace(/"/g, '""')}"`;
      };
      const header = [
        'Run',
        'Rule',
        'Version',
        'Status',
        'Module',
        'Record kind',
        'Record',
        'Client',
        'Actions',
        'Succeeded',
        'Failed',
        'Started',
        'Created',
      ];
      const lines = rows.map((r) =>
        [
          r.id,
          r.rule.id,
          r.ruleVersion.version,
          r.status,
          r.sourceModule,
          r.recordKind,
          r.recordId,
          r.clientId,
          r.executions.length,
          r.executions.filter((e) => e.status === 'SUCCESS').length,
          r.executions.filter((e) => e.status === 'FAILED').length,
          iso(r.startedAt),
          r.createdAt.toISOString(),
        ]
          .map((v) => cell(v as string | number | null))
          .join(','),
      );
      const csv = Buffer.from(
        `${BOM}${[header.map((h) => cell(h)).join(','), ...lines].join('\r\n')}\r\n`,
        'utf8',
      );
      const key = `tenant/${businessId}/automations/exports/${randomUUID()}.csv`;
      const fileName = `automation-logs-${ctx.today}.csv`;
      await this.audit.logIn(
        ctx.tx,
        'automation_logs.exported',
        { type: 'automation_logs' },
        { rows: rows.length, tab: body.filter.tab },
      );
      return { key, fileName, csv, rowCount: rows.length };
    });
    let url: string;
    try {
      await this.files.put(made.key, made.csv, 'text/csv');
      url = await this.files.presignDownload({
        key: made.key,
        fileName: made.fileName,
        contentType: 'text/csv',
      });
    } catch {
      throw new ServiceUnavailableException({
        code: 'FILE_STORE_UNAVAILABLE',
        message: 'The file could not be saved. Try again shortly.',
      });
    }
    return {
      url,
      expiresAt: new Date(Date.now() + URL_SECONDS * 1_000).toISOString(),
      rowCount: made.rowCount,
      fileName: made.fileName,
    };
  }
}
