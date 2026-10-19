import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AutomationCatalog,
  AutomationKpi,
  AutomationOverview,
  AutomationSettingsView,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { memberNames, memberRef, notAMember, sentFields } from '../workspaces/common.js';
import { autoErrors } from './automations.common.js';
import {
  type AutoCtx,
  AutomationsReadService,
  ruleInclude,
  runInclude,
} from './automations-read.service.js';
import type { SettingsBody } from './automations-input.js';
import { ACTIONS, EVENTS, MODULES, VARIABLES } from './catalog.js';

type Out<S extends z.ZodType> = z.output<S>;
const DAY = 86_400_000;
const delta = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;
const time = (hhmm: string) => new Date(`1970-01-01T${hhmm}:00.000Z`);

/** The catalog, the overview and the firm's settings. */
@Injectable()
export class AutomationsOverviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
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

  catalog(): AutomationCatalog {
    return {
      modules: Object.entries(MODULES).map(([module, m]) => ({
        module: module as AutomationCatalog['modules'][number]['module'],
        label: m.label,
        destination: m.destination,
      })),
      events: EVENTS,
      actions: ACTIONS,
      variables: VARIABLES,
    };
  }

  overview(businessId: string, tenant: TenantContext, userId: string): Promise<AutomationOverview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      const now = Date.now();
      const since = (days: number) => new Date(now - days * DAY);
      const done = (
        type: string | null,
        from: Date,
        to: Date,
      ): Prisma.AutomationActionExecutionWhereInput => ({
        businessId,
        status: 'SUCCESS',
        finishedAt: { gte: from, lt: to },
        run: { dryRun: false },
        ...(type ? { actionType: type } : {}),
      });
      const count = (type: string | null) =>
        Promise.all([
          tx.automationActionExecution.count({ where: done(type, since(30), new Date(now + 1)) }),
          tx.automationActionExecution.count({ where: done(type, since(60), since(30)) }),
        ]);
      const kpi = (value: number, before: number): AutomationKpi => ({
        value,
        deltaPercent: delta(value, before),
        comparedTo: before > 0 ? 'vs last month' : null,
      });
      const [tasks, messages, all, activeNow, activeBefore, failed, pending, recent, activeRules] =
        await Promise.all([
          count('CREATE_TASK'),
          count('SEND_CLIENT_MESSAGE'),
          count(null),
          tx.automationRule.count({ where: { businessId, status: 'ACTIVE', archivedAt: null } }),
          tx.automationRule.count({
            where: {
              businessId,
              status: 'ACTIVE',
              archivedAt: null,
              createdAt: { lte: since(30) },
            },
          }),
          tx.automationRun.count({
            where: {
              businessId,
              dryRun: false,
              status: { in: ['FAILED', 'PARTIAL_SUCCESS'] },
              createdAt: { gte: since(1) },
            },
          }),
          tx.automationRun.count({
            where: { businessId, dryRun: false, status: { in: ['PENDING', 'RUNNING'] } },
          }),
          tx.automationRun.findMany({
            where: { businessId, dryRun: false },
            include: runInclude,
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            take: 10,
          }),
          tx.automationRule.findMany({
            where: { businessId, status: 'ACTIVE', archivedAt: null },
            include: ruleInclude,
            take: 1_000,
          }),
        ]);
      const attention = [...(await this.read.attention(ctx, activeRules)).values()].filter(
        Boolean,
      ).length;
      const total24 = await tx.automationRun.count({
        where: { businessId, dryRun: false, createdAt: { gte: since(1) } },
      });
      return {
        activeRules: kpi(activeNow, activeBefore),
        tasksCreated: kpi(tasks[0], tasks[1]),
        clientNotifications: kpi(messages[0], messages[1]),
        timeSavedMinutes: kpi(
          all[0] * ctx.settings.minutesSavedPerAction,
          all[1] * ctx.settings.minutesSavedPerAction,
        ),
        health: {
          status:
            failed === 0 && attention === 0
              ? 'HEALTHY'
              : failed > 0 && (failed >= 10 || failed * 2 >= total24)
                ? 'FAILING'
                : 'ATTENTION',
          failedRuns24h: failed,
          rulesNeedingAttention: attention,
          pendingRuns: pending,
        },
        recent: await this.read.runRows(ctx, recent),
        canCreate: ctx.perms.write,
        canManage: ctx.perms.manage,
      };
    });
  }

  // ---------- Settings ----------

  private async settingsView(ctx: AutoCtx): Promise<AutomationSettingsView> {
    const names = await memberNames(ctx.tx, ctx.businessId, ctx.settings.failureAlertUserIds);
    return {
      quietHours: ctx.settings.quietHours,
      defaultDedupeDays: ctx.settings.defaultDedupeDays,
      maxDepth: ctx.settings.maxDepth,
      safetyThreshold: ctx.settings.safetyThreshold,
      failureAlertUsers: ctx.settings.failureAlertUserIds
        .map((id) => memberRef(names, id))
        .filter((m): m is NonNullable<typeof m> => m !== null),
      minutesSavedPerAction: ctx.settings.minutesSavedPerAction,
      logRetentionDays: ctx.settings.logRetentionDays,
      timezone: ctx.timezone,
      updatedAt: ctx.settings.updatedAt?.toISOString() ?? null,
    };
  }

  settings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AutomationSettingsView> {
    return this.run(businessId, tenant, userId, (ctx) => this.settingsView(ctx));
  }

  saveSettings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof SettingsBody>,
  ): Promise<AutomationSettingsView> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.manage) throw autoErrors.forbidden();
      const { tx } = ctx;
      if (body.failureAlertUserIds?.length) {
        const found = await tx.membership.findMany({
          where: {
            businessId,
            userId: { in: body.failureAlertUserIds },
            status: 'ACTIVE',
            joinedAt: { not: null },
          },
          select: { userId: true },
        });
        if (found.length !== new Set(body.failureAlertUserIds).size) throw notAMember();
      }
      const data = {
        ...(body.quietHours !== undefined
          ? body.quietHours
            ? { quietStart: time(body.quietHours.start), quietEnd: time(body.quietHours.end) }
            : { quietStart: null, quietEnd: null }
          : {}),
        ...(body.defaultDedupeDays !== undefined
          ? { defaultDedupeDays: body.defaultDedupeDays }
          : {}),
        ...(body.maxDepth !== undefined ? { maxDepth: body.maxDepth } : {}),
        ...(body.safetyThreshold !== undefined ? { safetyThreshold: body.safetyThreshold } : {}),
        ...(body.failureAlertUserIds !== undefined
          ? { failureAlertUserIds: [...new Set(body.failureAlertUserIds)] }
          : {}),
        ...(body.minutesSavedPerAction !== undefined
          ? { minutesSavedPerAction: body.minutesSavedPerAction }
          : {}),
        ...(body.logRetentionDays !== undefined ? { logRetentionDays: body.logRetentionDays } : {}),
      };
      await tx.automationSettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'automation_settings.updated',
        { type: 'automation_settings' },
        {
          fields: sentFields(body, [
            'quietHours',
            'defaultDedupeDays',
            'maxDepth',
            'safetyThreshold',
            'failureAlertUserIds',
            'minutesSavedPerAction',
            'logRetentionDays',
          ]),
        },
      );
      return this.settingsView(await this.read.ctx(tx, businessId, tenant, userId));
    });
  }
}
