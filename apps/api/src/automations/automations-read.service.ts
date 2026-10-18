import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  AutomationCheck,
  AutomationPreview,
  AutomationRuleDetail,
  AutomationRuleRow,
  AutomationRunRow,
} from '@firmivra/types';
import { firmTimeZone } from '../appointments/calendar-data.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { day, memberNames, memberRef, notFound } from '../workspaces/common.js';
import { actionOf, eventOf } from './catalog.js';
import { type Perms, autoErrors, hhmm, iso, mayAct, permsOf } from './automations.common.js';
import {
  actionSummary,
  actionsSummary,
  appliesTo,
  type Def,
  defOf,
  loopProblems,
  matches,
  missingSettings,
  triggerSummary,
  viewOf,
} from './logic.js';
import { loadCandidates } from './matching.js';

export interface AutoCtx {
  tx: TxClient;
  businessId: string;
  tenant: TenantContext;
  timezone: string;
  today: string;
  actor: { userId: string; role: 'OWNER' | 'ADMIN' | 'STAFF' };
  perms: Perms;
  settings: {
    quietHours: { start: string; end: string } | null;
    defaultDedupeDays: number;
    maxDepth: number;
    safetyThreshold: number;
    failureAlertUserIds: string[];
    minutesSavedPerAction: number;
    logRetentionDays: number;
    updatedAt: Date | null;
  };
}

export const ruleInclude = {
  currentVersion: true,
  owner: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.AutomationRuleInclude;
export type RuleShape = Prisma.AutomationRuleGetPayload<{ include: typeof ruleInclude }>;

const todayIn = (timezone: string, now = new Date()) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

/** Reads and checks for Automations: one shape for every list, detail and dry run. */
@Injectable()
export class AutomationsReadService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async ctx(
    tx: TxClient,
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AutoCtx> {
    const role = tenant.kind === 'staff' ? legacyFirmRole(tenant.role) : 'STAFF';
    const [timezone, s] = await Promise.all([
      firmTimeZone(tx, businessId),
      tx.automationSettings.findUnique({ where: { businessId } }),
    ]);
    return {
      tx,
      businessId,
      tenant,
      timezone,
      today: todayIn(timezone),
      actor: { userId, role },
      perms: permsOf(tenant),
      settings: {
        quietHours:
          s?.quietStart && s.quietEnd
            ? { start: hhmm(s.quietStart) as string, end: hhmm(s.quietEnd) as string }
            : null,
        defaultDedupeDays: s?.defaultDedupeDays ?? 7,
        maxDepth: s?.maxDepth ?? 3,
        safetyThreshold: s?.safetyThreshold ?? 500,
        failureAlertUserIds: s?.failureAlertUserIds ?? [],
        minutesSavedPerAction: s?.minutesSavedPerAction ?? 5,
        logRetentionDays: s?.logRetentionDays ?? 365,
        updatedAt: s?.updatedAt ?? null,
      },
    };
  }

  async load(ctx: AutoCtx, id: string): Promise<RuleShape> {
    const r = await ctx.tx.automationRule.findFirst({
      where: { businessId: ctx.businessId, id },
      include: ruleInclude,
    });
    if (!r) throw notFound();
    return r;
  }

  // ---------- Checks and dry runs ----------

  /** Every person named is an active member of the firm (409 NOT_A_MEMBER otherwise). */
  async requireMembers(ctx: AutoCtx, ids: string[]): Promise<void> {
    const wanted = [...new Set(ids)];
    if (wanted.length === 0) return;
    const found = await ctx.tx.membership.findMany({
      where: {
        businessId: ctx.businessId,
        userId: { in: wanted },
        status: 'ACTIVE',
        joinedAt: { not: null },
      },
      select: { userId: true },
    });
    if (found.length !== wanted.length) throw autoErrors.notAMember();
  }

  /** The member who acts for a rule: its owner, else the firm's first Owner. */
  async actingMember(tx: TxClient, businessId: string, ownerUserId: string | null) {
    const m = await tx.membership.findFirst({
      where: ownerUserId
        ? { businessId, userId: ownerUserId, status: 'ACTIVE', joinedAt: { not: null } }
        : { businessId, role: 'OWNER', status: 'ACTIVE', joinedAt: { not: null } },
      orderBy: { createdAt: 'asc' },
      select: { userId: true, role: true },
    });
    return m;
  }

  /** What stops a definition being active (BLOCK) or deserves a look (WARN), apart from the sample. */
  async checks(
    ctx: AutoCtx,
    def: Def,
    rule: { id: string | null; name: string; ownerUserId: string | null; expiresOn: Date | null },
  ): Promise<AutomationCheck[]> {
    const { tx, businessId } = ctx;
    const out: AutomationCheck[] = [];
    for (const p of missingSettings(def))
      out.push({
        code: 'INVALID_ACTION_CONFIG',
        severity: 'BLOCK',
        message: p.message,
        path: p.path,
      });
    if (rule.expiresOn && day(rule.expiresOn)! < ctx.today)
      out.push({
        code: 'EXPIRED',
        severity: 'BLOCK',
        message: 'The rule’s end date has passed',
        path: null,
      });

    // Templates a send action names.
    for (const [i, a] of def.actions.entries()) {
      const templateId = a.config.templateId;
      if (typeof templateId !== 'string') continue;
      const t = await tx.messageTemplate.findFirst({
        where: { businessId, id: templateId },
        select: { status: true, includeInAutomations: true },
      });
      const path = `actions.${i}.config.templateId`;
      if (!t)
        out.push({
          code: 'MISSING_TEMPLATE',
          severity: 'BLOCK',
          message: 'The message template was not found',
          path,
        });
      else if (t.status !== 'ACTIVE' || !t.includeInAutomations)
        out.push({
          code: 'MISSING_TEMPLATE',
          severity: 'WARN',
          message: 'The message template is not active or not offered to Automations',
          path,
        });
      const assignee = a.config.assigneeUserId;
      if (typeof assignee === 'string') {
        const m = await this.actingMember(tx, businessId, assignee);
        if (!m)
          out.push({
            code: 'INVALID_ACTION_CONFIG',
            severity: 'BLOCK',
            message: 'The person to assign to is not an active member of the firm',
            path: `actions.${i}.config.assigneeUserId`,
          });
      }
    }

    // The person it acts as may do what the actions do (their own module permissions).
    const acting = await this.actingMember(tx, businessId, rule.ownerUserId);
    if (!acting)
      out.push({
        code: 'MISSING_PERMISSION',
        severity: 'BLOCK',
        message: 'The rule’s owner is not an active member of the firm',
        path: null,
      });
    else
      for (const [i, a] of def.actions.entries()) {
        const info = actionOf(a.type);
        if (info && !mayAct(acting.role, info.module))
          out.push({
            code: 'MISSING_PERMISSION',
            severity: 'BLOCK',
            message: `The owner may not act in ${info.module} (${info.label})`,
            path: `actions.${i}`,
          });
      }

    // Loops among the firm's active rules.
    const others = await tx.automationRule.findMany({
      where: { businessId, status: 'ACTIVE', ...(rule.id ? { id: { not: rule.id } } : {}) },
      select: {
        id: true,
        name: true,
        currentVersion: { select: { triggerEvent: true, actions: true } },
      },
    });
    const node = (id: string, name: string, event: string, actions: unknown) => ({
      id,
      name,
      event,
      actions: (Array.isArray(actions) ? actions : []).map((a) => ({
        type: (a as { type: string }).type,
        config: ((a as { config?: Record<string, unknown> }).config ?? {}) as Record<
          string,
          unknown
        >,
      })),
    });
    const problems = loopProblems(
      node(rule.id ?? 'new', rule.name, def.trigger.event, def.actions),
      others
        .filter((o) => o.currentVersion)
        .map((o) => node(o.id, o.name, o.currentVersion!.triggerEvent, o.currentVersion!.actions)),
      ctx.settings.maxDepth,
    );
    for (const p of problems)
      out.push({ code: p.code, severity: 'BLOCK', message: p.message, path: null });
    return out;
  }

  /** A dry run: the matching count and sample, the planned actions, and the checks. Nothing is created or sent. */
  async preview(
    ctx: AutoCtx,
    def: Def,
    rule: { id: string | null; name: string; ownerUserId: string | null; expiresOn: Date | null },
    sample: number,
    since: Date,
  ): Promise<AutomationPreview> {
    const { tx, businessId } = ctx;
    const event = eventOf(def.trigger.event);
    const now = new Date();
    const found = await loadCandidates(
      tx,
      def.trigger.event,
      {
        timing: def.trigger.timing,
        offsetValue: def.trigger.offsetValue ?? null,
        offsetUnit: def.trigger.offsetUnit ?? null,
      },
      { businessId, now, today: ctx.today, since },
    );
    const hit = found.filter((c) => matches(c.fields, def.matchMode, def.conditions));
    const clientIds = [
      ...new Set(
        hit
          .slice(0, Math.max(sample, 25))
          .map((c) => c.clientId)
          .filter((x): x is string => !!x),
      ),
    ];
    const clients = await tx.client.findMany({
      where: { businessId, id: { in: clientIds } },
      select: { id: true, displayName: true, email: true },
    });
    const byId = new Map(clients.map((c) => [c.id, c]));
    const checks = await this.checks(ctx, def, rule);
    if (hit.length === 0)
      checks.push({
        code: 'NO_MATCHES',
        severity: 'WARN',
        message: 'No record matches right now',
        path: null,
      });
    const threshold = def.settings.safetyThreshold ?? ctx.settings.safetyThreshold;
    if (hit.length > threshold)
      checks.push({
        code: 'HIGH_VOLUME',
        severity: 'WARN',
        message: `${hit.length} records match; a run stops at ${threshold}`,
        path: 'settings.safetyThreshold',
      });
    if (
      def.actions.some((a) => actionOf(a.type)?.contactsClient) &&
      hit
        .slice(0, 200)
        .some((c) => c.clientId && !byId.get(c.clientId)?.email && clientIds.includes(c.clientId))
    )
      checks.push({
        code: 'BAD_CONTACT_DATA',
        severity: 'WARN',
        message: 'Some matching clients have no email address; their messages will fail',
        path: null,
      });
    const templateIds = def.actions
      .map((a) => a.config.templateId)
      .filter((x): x is string => typeof x === 'string');
    const templates = templateIds.length
      ? await tx.messageTemplate.findMany({
          where: { businessId, id: { in: templateIds } },
          select: { id: true, name: true, kind: true, status: true },
        })
      : [];
    return {
      triggerPreview: `${triggerSummary({
        event: def.trigger.event,
        timing: def.trigger.timing,
        offsetValue: def.trigger.offsetValue ?? null,
        offsetUnit: def.trigger.offsetUnit ?? null,
      })}${event ? `: ${event.example}` : ''}`,
      matchCount: hit.length,
      sample: hit.slice(0, sample).map((c) => ({
        recordKind: c.recordKind,
        recordId: c.recordId,
        label: c.label,
        client: c.clientId
          ? { id: c.clientId, name: byId.get(c.clientId)?.displayName ?? '' }
          : null,
      })),
      plannedActions: def.actions.map((a) => ({
        id: a.id,
        type: a.type,
        label: actionOf(a.type)?.label ?? a.type,
        delayMinutes: a.delayMinutes,
        summary: actionSummary(a),
      })),
      templates: templates.map((t) => ({
        id: t.id,
        name: t.name,
        kind: t.kind,
        active: t.status === 'ACTIVE',
      })),
      integrations: [],
      checks,
      canActivate: !checks.some((c) => c.severity === 'BLOCK'),
    };
  }

  // ---------- Rules ----------

  async attention(ctx: AutoCtx, rules: RuleShape[]): Promise<Map<string, boolean>> {
    const { tx, businessId } = ctx;
    const out = new Map<string, boolean>();
    const live = rules.filter((r) => r.status === 'ACTIVE' || r.status === 'PAUSED');
    const ids = new Set<string>();
    const members = new Set<string>();
    for (const r of live) {
      for (const a of (Array.isArray(r.currentVersion?.actions)
        ? r.currentVersion.actions
        : []) as { config?: Record<string, unknown> }[])
        if (typeof a.config?.templateId === 'string') ids.add(a.config.templateId);
      if (r.ownerUserId) members.add(r.ownerUserId);
    }
    const [templates, active] = await Promise.all([
      ids.size
        ? tx.messageTemplate.findMany({
            where: { businessId, id: { in: [...ids] } },
            select: { id: true, status: true, includeInAutomations: true },
          })
        : [],
      members.size
        ? tx.membership.findMany({
            where: { businessId, userId: { in: [...members] }, status: 'ACTIVE' },
            select: { userId: true },
          })
        : [],
    ]);
    const okTemplate = new Set(
      templates.filter((t) => t.status === 'ACTIVE' && t.includeInAutomations).map((t) => t.id),
    );
    const okMember = new Set(active.map((m) => m.userId));
    for (const r of rules) {
      let bad = false;
      if (r.status === 'ACTIVE') {
        for (const a of (Array.isArray(r.currentVersion?.actions)
          ? r.currentVersion.actions
          : []) as { config?: Record<string, unknown> }[])
          if (typeof a.config?.templateId === 'string' && !okTemplate.has(a.config.templateId))
            bad = true;
        if (r.ownerUserId && !okMember.has(r.ownerUserId)) bad = true;
        if (r.expiresOn && day(r.expiresOn)! < ctx.today) bad = true;
      }
      out.set(r.id, bad);
    }
    return out;
  }

  async rows(ctx: AutoCtx, rules: RuleShape[]): Promise<AutomationRuleRow[]> {
    if (rules.length === 0) return [];
    const [attention, last] = await Promise.all([
      this.attention(ctx, rules),
      ctx.tx.automationRun.findMany({
        where: {
          businessId: ctx.businessId,
          ruleId: { in: rules.map((r) => r.id) },
          dryRun: false,
        },
        orderBy: [{ ruleId: 'asc' }, { createdAt: 'desc' }],
        distinct: ['ruleId'],
        select: { ruleId: true, status: true },
      }),
    ]);
    const lastStatus = new Map(last.map((l) => [l.ruleId, l.status]));
    return rules.map((r) => {
      const v = r.currentVersion;
      const def = v ? viewOf(v) : null;
      return {
        id: r.id,
        name: r.name,
        description: r.description,
        category: r.category,
        priority: r.priority,
        status: r.status,
        owner: r.owner ? { userId: r.owner.userId, name: r.owner.user.name } : null,
        triggerSummary: def ? triggerSummary(def.trigger) : 'Not set up yet',
        appliesTo: def
          ? appliesTo(def.trigger.event, defOf(def).conditions, def.matchMode)
          : 'All records',
        actionsSummary: def ? actionsSummary(def.actions) : 'None yet',
        currentVersion: v?.version ?? null,
        lastRunAt: iso(r.lastRunAt),
        lastRunStatus: lastStatus.get(r.id) ?? null,
        expiresOn: day(r.expiresOn),
        needsAttention: attention.get(r.id) ?? false,
        archived: r.archivedAt !== null,
        updatedAt: r.updatedAt.toISOString(),
      };
    });
  }

  async detail(ctx: AutoCtx, rule: RuleShape): Promise<AutomationRuleDetail> {
    const { tx, businessId } = ctx;
    const [[row], versions, byVersion, byStatus] = await Promise.all([
      this.rows(ctx, [rule]),
      tx.automationRuleVersion.findMany({
        where: { businessId, ruleId: rule.id },
        orderBy: { version: 'desc' },
      }),
      tx.automationRun.groupBy({
        by: ['ruleVersionId'],
        where: { businessId, ruleId: rule.id, dryRun: false },
        _count: { _all: true },
      }),
      tx.automationRun.groupBy({
        by: ['status'],
        where: { businessId, ruleId: rule.id, dryRun: false },
        _count: { _all: true },
      }),
    ]);
    const names = await memberNames(
      tx,
      businessId,
      versions.map((v) => v.createdByUserId),
    );
    const counts = new Map(byVersion.map((b) => [b.ruleVersionId, b._count._all]));
    const n = (s: string) => byStatus.find((b) => b.status === s)?._count._all ?? 0;
    const def = rule.currentVersion ? viewOf(rule.currentVersion) : null;
    const blockers = def
      ? (
          await this.checks(ctx, defOf(def), {
            id: rule.id,
            name: rule.name,
            ownerUserId: rule.ownerUserId,
            expiresOn: rule.expiresOn,
          })
        )
          .filter((c) => c.severity === 'BLOCK')
          .map((c) => c.message)
      : ['The rule has no definition yet'];
    return {
      ...(row as AutomationRuleRow),
      definition: def,
      versions: versions.map((v) => ({
        version: v.version,
        createdBy: memberRef(names, v.createdByUserId),
        createdAt: v.createdAt.toISOString(),
        runCount: counts.get(v.id) ?? 0,
      })),
      stats: {
        runs: byStatus.reduce((s, b) => s + b._count._all, 0),
        succeeded: n('SUCCESS') + n('PARTIAL_SUCCESS'),
        failed: n('FAILED'),
        skipped: n('SKIPPED'),
      },
      activationBlockers: blockers,
      createdAt: rule.createdAt.toISOString(),
      canEdit: ctx.perms.write && rule.archivedAt === null,
      canActivate: ctx.perms.activate && rule.archivedAt === null,
      etag: rule.updatedAt.toISOString(),
    };
  }

  async runRows(
    ctx: AutoCtx,
    runs: Prisma.AutomationRunGetPayload<{
      include: {
        rule: { select: { id: true; name: true } };
        ruleVersion: {
          select: {
            version: true;
            triggerEvent: true;
            timing: true;
            offsetValue: true;
            offsetUnit: true;
          };
        };
        client: { select: { id: true; displayName: true } };
        executions: { select: { status: true } };
      };
    }>[],
  ): Promise<AutomationRunRow[]> {
    return runs.map((r) => ({
      id: r.id,
      rule: { id: r.rule.id, name: r.rule.name },
      ruleVersion: r.ruleVersion.version,
      trigger: triggerSummary({
        event: r.ruleVersion.triggerEvent,
        timing: r.ruleVersion.timing,
        offsetValue: r.ruleVersion.offsetValue,
        offsetUnit: r.ruleVersion.offsetUnit,
      }),
      triggerModule: r.sourceModule,
      client: r.client ? { id: r.client.id, name: r.client.displayName } : null,
      recordKind: r.recordKind,
      recordId: r.recordId,
      status: r.status,
      dryRun: r.dryRun,
      actionCount: r.executions.length,
      actionsSucceeded: r.executions.filter((e) => e.status === 'SUCCESS').length,
      actionsFailed: r.executions.filter((e) => e.status === 'FAILED').length,
      durationMs: r.durationMs,
      startedAt: iso(r.startedAt),
      createdAt: r.createdAt.toISOString(),
    }));
  }
}

export const runInclude = {
  rule: { select: { id: true, name: true } },
  ruleVersion: {
    select: {
      version: true,
      triggerEvent: true,
      timing: true,
      offsetValue: true,
      offsetUnit: true,
    },
  },
  client: { select: { id: true, displayName: true } },
  executions: { select: { status: true } },
} satisfies Prisma.AutomationRunInclude;
