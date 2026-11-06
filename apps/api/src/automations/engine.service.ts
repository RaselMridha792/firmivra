import { createHash, randomUUID } from 'node:crypto';
import { HttpException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import { zonedDate, zonedInstant } from '../appointments/calendar.js';
import { AuditService } from '../audit/audit.service.js';
import { legacyFirmRole, requestContext, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { MessagesService } from '../messages/messages.service.js';
import { NotesService } from '../messages/notes.service.js';
import { Notifier } from '../notifications/notifier.js';
import { TaskWriteService } from '../tasks/task-write.service.js';
import { day, lockClient } from '../workspaces/common.js';
import { reassignClientTasks } from '../workspaces/tasks.service.js';
import { actionOf } from './catalog.js';
import { mayAct } from './automations.common.js';
import { AutomationsReadService } from './automations-read.service.js';
import { fill, matches, viewOf } from './logic.js';
import { type Candidate, loadCandidates, loadRecordContext } from './matching.js';

type Action = {
  id: string;
  type: string;
  config: Record<string, unknown>;
  delayMinutes: number;
  dependsOn: string | null;
};
type Outcome =
  | { ok: true; kind: string | null; id: string | null; detail: string | null }
  | { ok: false; code: string; retryable: boolean; detail: string };

const DAY = 86_400_000;
const short = (s: string) => s.slice(0, 280);
const addDays = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

const minutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  return h * 60 + m;
};

/** When a quiet window that holds `now` ends (in the firm's zone), or null when `now` is outside it. */
export function quietUntil(
  now: Date,
  timezone: string,
  quiet: { start: string; end: string } | null,
): Date | null {
  if (!quiet) return null;
  const date = zonedDate(timezone, now.getTime());
  const local = Math.round((now.getTime() - zonedInstant(timezone, date, 0)) / 60_000);
  const s = minutes(quiet.start);
  const e = minutes(quiet.end);
  const inside = s < e ? local >= s && local < e : local >= s || local < e;
  if (!inside) return null;
  const endDate = s < e || local < e ? date : addDays(date, 1);
  return new Date(zonedInstant(timezone, endDate, e));
}

/** The run engine: starts runs for the matching records, runs the actions in order, keeps every action once. */
@Injectable()
export class AutomationEngine {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AutomationsReadService,
    private readonly audit: AuditService,
    private readonly tasks: TaskWriteService,
    private readonly messages: MessagesService,
    private readonly notes: NotesService,
    private readonly notifier: Notifier,
  ) {}

  /**
   * Work done by the job, not a request: other modules' services (and the audit log) read the firm
   * and the person from the request context, so it is opened here, as the firm and, for an action,
   * as the person the rule acts for.
   */
  private within<T>(businessId: string, userId: string | null, fn: () => Promise<T>): Promise<T> {
    return requestContext.run(
      {
        requestId: randomUUID(),
        tenant: { businessId, role: 'OWNER', kind: 'staff' },
        ...(userId ? { auth: { userId, cognitoSub: userId, pool: 'STAFF' as const } } : {}),
      },
      fn,
    );
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  private system(tx: TxClient, businessId: string) {
    return this.read.ctx(
      tx,
      businessId,
      { kind: 'staff', role: 'OWNER', businessId } as TenantContext,
      'system',
    );
  }

  // ---------- Starting runs ----------

  /** Every active rule of the firm: ends the ones past their date, starts runs, runs what is due. */
  scanFirm(businessId: string, now = new Date()) {
    return this.within(businessId, null, () => this.doScanFirm(businessId, now));
  }

  private async doScanFirm(businessId: string, now: Date) {
    const totals = { started: 0, duplicates: 0, stopped: 0, expired: 0, executed: 0 };
    const rules = await this.inFirm(businessId, async (tx) => {
      const ctx = await this.system(tx, businessId);
      const list = await tx.automationRule.findMany({
        where: { businessId, status: 'ACTIVE', archivedAt: null },
        select: { id: true, expiresOn: true },
        orderBy: { id: 'asc' },
      });
      const live: string[] = [];
      for (const r of list) {
        if (r.expiresOn && day(r.expiresOn)! < ctx.today) {
          await tx.automationRule.update({
            where: { businessId_id: { businessId, id: r.id } },
            data: { status: 'PAUSED' },
          });
          await this.audit.logIn(
            tx,
            'automation_rule.expired',
            { type: 'automation_rule', id: r.id },
            { ruleId: r.id },
          );
          totals.expired += 1;
        } else live.push(r.id);
      }
      return live;
    });
    for (const id of rules) {
      const r = await this.scanRule(businessId, id, now);
      totals.started += r.started;
      totals.duplicates += r.duplicates;
      totals.stopped += r.stopped ? 1 : 0;
    }
    totals.executed += await this.runDue(businessId, now);
    return totals;
  }

  scanRule(businessId: string, ruleId: string, now = new Date()) {
    return this.within(businessId, null, () => this.doScanRule(businessId, ruleId, now));
  }

  private async doScanRule(businessId: string, ruleId: string, now: Date) {
    const result = { started: 0, duplicates: 0, stopped: false };
    const created = await this.inFirm(businessId, async (tx) => {
      const ctx = await this.system(tx, businessId);
      const rule = await tx.automationRule.findFirst({
        where: { businessId, id: ruleId, status: 'ACTIVE', archivedAt: null },
        include: { currentVersion: true },
      });
      const v = rule?.currentVersion;
      if (!rule || !v) return [];
      const view = viewOf(v);
      const found = await loadCandidates(
        tx,
        v.triggerEvent,
        { timing: v.timing, offsetValue: v.offsetValue, offsetUnit: v.offsetUnit },
        {
          businessId,
          now,
          today: ctx.today,
          since: v.createdAt,
          ...(view.trigger.source ? { source: view.trigger.source } : {}),
        },
      );
      const hit = found.filter((c) =>
        matches(
          c.fields,
          v.matchMode,
          view.conditions.map((c2) => ({ ...c2, value: c2.value ?? undefined })),
        ),
      );
      if (hit.length === 0) return [];
      const threshold = view.settings.safetyThreshold ?? ctx.settings.safetyThreshold;
      // A rule that would act on more records than its threshold does nothing and says so.
      const keys = hit.map((c) => `${v.triggerEvent}:${c.recordId}:${c.occurrence}`);
      const existing = new Set(
        (
          await tx.automationRun.findMany({
            where: { businessId, ruleId, sourceEventKey: { in: keys } },
            select: { sourceEventKey: true },
          })
        ).map((e) => e.sourceEventKey),
      );
      const fresh = hit.filter(
        (c) => !existing.has(`${v.triggerEvent}:${c.recordId}:${c.occurrence}`),
      );
      result.duplicates += hit.length - fresh.length;
      if (fresh.length > threshold) {
        result.stopped = true;
        await this.audit.logIn(
          tx,
          'automation_rule.safety_stop',
          { type: 'automation_rule', id: ruleId },
          { ruleId, matching: fresh.length, threshold },
        );
        return [];
      }
      const window = view.settings.preventDuplicatesDays;
      const recent = window
        ? new Set(
            (
              await tx.automationRun.findMany({
                where: {
                  businessId,
                  ruleId,
                  dryRun: false,
                  recordId: { in: fresh.map((c) => c.recordId) },
                  createdAt: { gte: new Date(now.getTime() - window * DAY) },
                },
                select: { recordId: true },
              })
            ).map((r) => r.recordId),
          )
        : new Set<string | null>();
      const ids: string[] = [];
      for (const c of fresh) {
        if (recent.has(c.recordId)) {
          result.duplicates += 1;
          continue;
        }
        ids.push(
          await this.createRun(
            tx,
            businessId,
            rule.id,
            v.id,
            v.triggerModule,
            v.triggerEvent,
            c,
            view.actions,
            now,
          ),
        );
        result.started += 1;
      }
      if (ids.length) {
        await tx.automationRule.update({
          where: { businessId_id: { businessId, id: ruleId } },
          data: { lastRunAt: now, updatedAt: rule.updatedAt },
        });
      }
      return ids;
    });
    for (const runId of created) await this.advance(businessId, runId, now);
    return result;
  }

  private async createRun(
    tx: TxClient,
    businessId: string,
    ruleId: string,
    versionId: string,
    module: Prisma.AutomationRunUncheckedCreateInput['sourceModule'],
    event: string,
    c: Candidate,
    actions: Action[],
    now: Date,
  ): Promise<string> {
    const run = await tx.automationRun.create({
      data: {
        businessId,
        ruleId,
        ruleVersionId: versionId,
        sourceModule: module,
        sourceEventKey: `${event}:${c.recordId}:${c.occurrence}`,
        clientId: c.clientId,
        recordKind: c.recordKind,
        recordId: c.recordId,
        correlationId: randomUUID(),
      },
      select: { id: true },
    });
    for (const [i, a] of actions.entries()) {
      await tx.automationActionExecution.create({
        data: {
          businessId,
          runId: run.id,
          actionKey: a.id,
          position: i,
          actionType: a.type,
          idempotencyKey: createHash('sha1')
            .update(`${ruleId}|${c.recordId}|${c.occurrence}|${a.id}`)
            .digest('hex'),
          scheduledFor:
            a.delayMinutes > 0 ? new Date(now.getTime() + a.delayMinutes * 60_000) : null,
        },
      });
    }
    return run.id;
  }

  // ---------- Running actions ----------

  /** Runs what can run now, in order, then keeps the run's status in step. */
  async advance(businessId: string, runId: string, now = new Date()): Promise<void> {
    const plan = await this.inFirm(businessId, async (tx) => {
      const run = await tx.automationRun.findFirst({
        where: { businessId, id: runId },
        include: {
          ruleVersion: true,
          rule: { select: { ownerUserId: true } },
          executions: { orderBy: { position: 'asc' } },
        },
      });
      if (!run) return null;
      const ctx = await this.system(tx, businessId);
      const view = viewOf(run.ruleVersion);
      return {
        run,
        actions: view.actions as Action[],
        quiet: view.settings.quietHours ?? ctx.settings.quietHours,
        timezone: ctx.timezone,
        today: ctx.today,
      };
    });
    if (!plan) return;
    const { run } = plan;
    const state = new Map(run.executions.map((e) => [e.actionKey, e.status as string]));
    for (const e of run.executions) {
      if (e.status !== 'PENDING') continue;
      const action = plan.actions.find((a) => a.id === e.actionKey);
      if (!action) continue;
      if (e.scheduledFor && e.scheduledFor > now) continue;
      if (action.dependsOn) {
        const dep = state.get(action.dependsOn);
        if (dep === 'PENDING' || dep === 'RUNNING') continue;
        if (dep !== 'SUCCESS') {
          await this.finish(
            businessId,
            e.id,
            {
              ok: false,
              code: 'DEPENDENCY_FAILED',
              retryable: false,
              detail: 'An earlier action did not succeed',
            },
            'SKIPPED',
          );
          state.set(e.actionKey, 'SKIPPED');
          continue;
        }
      }
      if (actionOf(action.type)?.contactsClient) {
        const until = quietUntil(now, plan.timezone, plan.quiet);
        if (until) {
          await this.inFirm(businessId, (tx) =>
            tx.automationActionExecution.update({
              where: { id: e.id },
              data: { scheduledFor: until },
            }),
          );
          continue;
        }
      }
      const claimed = await this.inFirm(businessId, (tx) =>
        tx.automationActionExecution.updateMany({
          where: { id: e.id, status: 'PENDING' },
          data: { status: 'RUNNING', startedAt: now, attempts: { increment: 1 } },
        }),
      );
      if (claimed.count === 0) continue;
      const outcome = await this.execute(businessId, run, action, plan.today);
      await this.finish(businessId, e.id, outcome);
      state.set(e.actionKey, outcome.ok ? 'SUCCESS' : 'FAILED');
    }
    await this.rollup(businessId, runId, now);
  }

  private async finish(businessId: string, executionId: string, outcome: Outcome, as?: 'SKIPPED') {
    const now = new Date();
    await this.inFirm(businessId, (tx) =>
      tx.automationActionExecution.update({
        where: { id: executionId },
        data: outcome.ok
          ? {
              status: 'SUCCESS',
              finishedAt: now,
              resultKind: outcome.kind,
              resultId: outcome.id,
              detail: outcome.detail,
              errorCode: null,
            }
          : as === 'SKIPPED'
            ? { status: 'SKIPPED', finishedAt: now, detail: outcome.detail, errorCode: null }
            : {
                status: 'FAILED',
                finishedAt: now,
                errorCode: outcome.code,
                retryable: outcome.retryable,
                detail: outcome.detail,
              },
      }),
    );
  }

  /** The run's status from its actions. */
  async rollup(businessId: string, runId: string, now = new Date()): Promise<void> {
    await this.inFirm(businessId, async (tx) => {
      const run = await tx.automationRun.findFirst({
        where: { businessId, id: runId },
        include: { executions: true },
      });
      if (!run) return;
      const ex = run.executions;
      const count = (s: string) => ex.filter((e) => e.status === s).length;
      const open = count('PENDING') + count('RUNNING');
      const started =
        ex
          .map((e) => e.startedAt)
          .filter((d): d is Date => d !== null)
          .sort((a, b) => a.getTime() - b.getTime())[0] ?? null;
      let status: Prisma.AutomationRunUncheckedUpdateInput['status'];
      if (open > 0) status = started || run.startedAt ? 'RUNNING' : 'PENDING';
      else if (count('FAILED') > 0) status = count('SUCCESS') > 0 ? 'PARTIAL_SUCCESS' : 'FAILED';
      else status = count('SUCCESS') > 0 ? 'SUCCESS' : 'SKIPPED';
      const final = !open;
      const failed = ex.find((e) => e.status === 'FAILED');
      const startedAt = run.startedAt ?? started ?? (final && status !== 'SKIPPED' ? now : null);
      await tx.automationRun.update({
        where: { id: runId },
        data: {
          status,
          startedAt,
          finishedAt: final ? (run.finishedAt ?? now) : null,
          durationMs: final && startedAt ? Math.max(0, now.getTime() - startedAt.getTime()) : null,
          errorCode:
            status === 'FAILED' || status === 'PARTIAL_SUCCESS'
              ? (failed?.errorCode ?? 'ACTION_ERROR')
              : status === 'SKIPPED'
                ? (ex.find((e) => e.detail)?.errorCode ?? 'SKIPPED')
                : null,
          message:
            status === 'FAILED' || status === 'PARTIAL_SUCCESS'
              ? short(failed?.detail ?? 'An action failed')
              : status === 'SKIPPED'
                ? 'No action ran'
                : null,
        },
      });
    });
  }

  private async execute(
    businessId: string,
    run: Prisma.AutomationRunGetPayload<{ include: { rule: { select: { ownerUserId: true } } } }>,
    action: Action,
    today: string,
  ): Promise<Outcome> {
    const info = actionOf(action.type);
    if (!info)
      return {
        ok: false,
        code: 'UNKNOWN_ACTION',
        retryable: false,
        detail: 'This action type is no longer offered',
      };
    try {
      const prepared = await this.inFirm(businessId, async (tx) => {
        const member = await this.read.actingMember(tx, businessId, run.rule.ownerUserId);
        if (!member) return { error: 'OWNER_UNAVAILABLE' as const };
        if (!mayAct(member.role, info.module)) return { error: 'NOT_PERMITTED' as const };
        const ctx = run.clientId ? await loadRecordContext(tx, businessId, run.clientId) : null;
        // AU-F18 to F20: only an action that needs no client (Notify staff) runs without one.
        if (info.needsClient && (!run.clientId || !ctx)) return { error: 'NO_CLIENT' as const };
        const found = run.recordId ? await this.labelOf(tx, businessId, run, today) : '';
        const firm = await tx.business.findFirst({
          where: { id: businessId },
          select: { name: true },
        });
        const client = run.clientId
          ? await tx.client.findFirst({
              where: { businessId, id: run.clientId },
              select: { email: true, archivedAt: true, assignedUserId: true },
            })
          : null;
        return {
          member,
          values: {
            'client.name': ctx?.clientName ?? '',
            'client.firstName': ctx?.clientFirstName ?? '',
            'firm.name': firm?.name ?? '',
            'record.label': found,
            'date.today': today,
          } as Record<string, string>,
          client,
        };
      });
      if (prepared.error) {
        const detail = {
          OWNER_UNAVAILABLE: 'The rule’s owner is no longer an active member',
          NOT_PERMITTED: 'The owner may not do this in the module',
          NO_CLIENT: 'The record has no client to act for',
        }[prepared.error];
        return { ok: false, code: prepared.error, retryable: false, detail };
      }
      const { member, values, client } = prepared;
      if (!member || !values)
        return {
          ok: false,
          code: 'ACTION_ERROR',
          retryable: true,
          detail: 'The action could not start',
        };
      const actor = { userId: member.userId, role: legacyFirmRole(member.role) };
      const cfg = action.config;
      const text = (k: string) =>
        typeof cfg[k] === 'string' ? fill(cfg[k] as string, values) : undefined;
      return await this.within(businessId, member.userId, async (): Promise<Outcome> => {
        switch (action.type) {
          case 'CREATE_TASK': {
            const dueIn = typeof cfg.dueInDays === 'number' ? cfg.dueInDays : null;
            const created = await this.tasks.create(businessId, actor, {
              clientId: run.clientId as string,
              title: (text('title') ?? 'Task').slice(0, 200),
              ...(text('details') ? { details: (text('details') as string).slice(0, 2_000) } : {}),
              ...(typeof cfg.priority === 'string'
                ? { priority: cfg.priority as 'LOW' | 'MEDIUM' | 'HIGH' }
                : {}),
              ...(dueIn !== null ? { dueOn: addDays(today, dueIn) } : {}),
              ...(typeof cfg.assigneeUserId === 'string'
                ? { assignedUserId: cfg.assigneeUserId }
                : client?.assignedUserId
                  ? { assignedUserId: client.assignedUserId }
                  : {}),
            });
            return { ok: true, kind: 'task', id: created.id, detail: 'Task created' };
          }
          case 'SEND_CLIENT_MESSAGE': {
            if (client?.archivedAt)
              return {
                ok: false,
                code: 'CLIENT_ARCHIVED',
                retryable: false,
                detail: 'The client is archived',
              };
            if (!client?.email)
              return {
                ok: false,
                code: 'NO_CONTACT',
                retryable: false,
                detail: 'The client has no email address',
              };
            let subject = text('subject');
            let body = text('body');
            if (typeof cfg.templateId === 'string') {
              const t = await this.inFirm(businessId, (tx) =>
                tx.messageTemplate.findFirst({
                  where: {
                    businessId,
                    id: cfg.templateId as string,
                    status: 'ACTIVE',
                    includeInAutomations: true,
                  },
                  select: { subject: true, body: true },
                }),
              );
              if (!t)
                return {
                  ok: false,
                  code: 'TEMPLATE_UNAVAILABLE',
                  retryable: false,
                  detail: 'The template is not active',
                };
              subject ??= t.subject ? fill(t.subject, values) : undefined;
              body ??= fill(t.body, values);
            }
            const thread = await this.messages.create(businessId, actor, run.clientId as string, {
              subject: (subject ?? `A message from ${values['firm.name']}`).slice(0, 200),
              body: (body ?? '').slice(0, 10_000) || 'Hello',
              repliesEnabled: true,
            });
            return { ok: true, kind: 'message_thread', id: thread.id, detail: 'Message sent' };
          }
          // AU-F27 Notify staff: a bell item only, for members of this firm (the Notifier leaves out
          // a Staff member who can't see the client); never an email, a text or the client.
          case 'NOTIFY_STAFF': {
            const chosen = (Array.isArray(cfg.memberUserIds) ? cfg.memberUserIds : []).filter(
              (v): v is string => typeof v === 'string',
            );
            const eventKey = `automation.notice:${run.id}:${action.id}`;
            const sent = await this.notifier.notify({
              businessId,
              event: 'automation.notice',
              recordId: run.id,
              eventKey,
              ...(chosen.length > 0 ? { toUserIds: chosen } : {}),
            });
            if (sent.failed)
              return {
                ok: false,
                code: 'NOTIFY_FAILED',
                retryable: true,
                detail: 'The notice could not be written',
              };
            // A retry after a write that went through finds its own items (the same key).
            const reached =
              sent.written > 0
                ? sent.written
                : await this.inFirm(businessId, (tx) =>
                    tx.notification.count({ where: { businessId, eventKey } }),
                  );
            if (reached === 0)
              return {
                ok: false,
                code: 'NO_RECIPIENT',
                retryable: false,
                detail: 'Nobody in the firm could receive this notice',
              };
            await this.inFirm(businessId, (tx) =>
              this.audit.logIn(
                tx,
                'automation.notice_sent',
                { type: 'automation_run', id: run.id },
                { actionKey: action.id, recipients: reached },
                { businessId, actorUserId: actor.userId },
              ),
            );
            return { ok: true, kind: null, id: null, detail: `${reached} member(s) notified` };
          }
          // AU-F27: the firm's own tags, by id; one archived since the rule was saved fails the step.
          case 'ADD_CLIENT_TAGS':
          case 'REMOVE_CLIENT_TAGS': {
            const wanted = [
              ...new Set(
                (Array.isArray(cfg.tagIds) ? cfg.tagIds : []).filter(
                  (v): v is string => typeof v === 'string',
                ),
              ),
            ];
            const clientId = run.clientId as string;
            const result = await this.inFirm(businessId, async (tx) => {
              const tags = await tx.tag.findMany({
                where: { businessId, archivedAt: null, id: { in: wanted } },
                select: { id: true },
              });
              if (wanted.length === 0 || tags.length < wanted.length) return null;
              const ids = tags.map((t) => t.id);
              const changed =
                action.type === 'ADD_CLIENT_TAGS'
                  ? (
                      await tx.clientTag.createMany({
                        data: ids.map((tagId) => ({
                          businessId,
                          clientId,
                          tagId,
                          addedByUserId: actor.userId,
                        })),
                        skipDuplicates: true,
                      })
                    ).count
                  : (
                      await tx.clientTag.deleteMany({
                        where: { businessId, clientId, tagId: { in: ids } },
                      })
                    ).count;
              // As Clients' own tag change records it (so a rule on tag changes sees it). Nothing
              // changed (the client had them, or didn't): no entry, so no tag-change event.
              if (changed > 0)
                await this.audit.logIn(
                  tx,
                  'client.tags_set',
                  { type: 'client', id: clientId },
                  action.type === 'ADD_CLIENT_TAGS'
                    ? { added: changed, removed: 0 }
                    : { added: 0, removed: changed },
                  { businessId, actorUserId: actor.userId },
                );
              return changed;
            });
            if (result === null)
              return {
                ok: false,
                code: 'UNKNOWN_TAG',
                retryable: false,
                detail: 'A chosen tag was archived or is not one of the firm’s tags',
              };
            return {
              ok: true,
              kind: 'client',
              id: clientId,
              detail:
                action.type === 'ADD_CLIENT_TAGS'
                  ? `${result} tag(s) added`
                  : `${result} tag(s) removed`,
            };
          }
          // AU-F27 Assign or reassign work: the client's assigned member, as Clients changes it (the
          // open tasks the previous assignee held move along; `client.updated` names the field).
          // A Staff member may not reassign a client (Clients refuses it too).
          case 'ASSIGN_CLIENT': {
            if (actor.role === 'STAFF')
              return {
                ok: false,
                code: 'NOT_PERMITTED',
                retryable: false,
                detail: 'A Staff member may not reassign a client',
              };
            const to = typeof cfg.assigneeUserId === 'string' ? cfg.assigneeUserId : null;
            const clientId = run.clientId as string;
            const result = await this.inFirm(businessId, async (tx) => {
              const current = await lockClient(tx, businessId, clientId);
              if (!current || client?.archivedAt) return 'CLIENT_UNAVAILABLE' as const;
              const member = to
                ? await tx.membership.findFirst({
                    where: { businessId, userId: to, status: 'ACTIVE' },
                    select: { id: true },
                  })
                : null;
              if (!to || !member) return 'NOT_A_MEMBER' as const;
              // Already theirs: no change and no entry (so no assignment-change event).
              if (current.assignedUserId === to) return 0;
              await tx.client.update({
                where: { businessId_id: { businessId, id: clientId } },
                data: { assignedUserId: to },
              });
              const moved = await reassignClientTasks(
                tx,
                businessId,
                clientId,
                current.assignedUserId,
                to,
              );
              await this.audit.logIn(
                tx,
                'client.updated',
                { type: 'client', id: clientId },
                { fields: ['assignedUserId'], tasksMoved: moved },
                { businessId, actorUserId: actor.userId },
              );
              return 1;
            });
            if (result === 'CLIENT_UNAVAILABLE')
              return {
                ok: false,
                code: 'CLIENT_UNAVAILABLE',
                retryable: false,
                detail: 'The client is archived or no longer exists',
              };
            if (result === 'NOT_A_MEMBER')
              return {
                ok: false,
                code: 'NOT_A_MEMBER',
                retryable: false,
                detail: 'The person to assign to is not an active member of the firm',
              };
            return {
              ok: true,
              kind: 'client',
              id: clientId,
              detail: result === 0 ? 'Already assigned to them' : 'Client reassigned',
            };
          }
          case 'ADD_CLIENT_NOTE': {
            const note = await this.notes.create(businessId, actor, run.clientId as string, {
              body: (text('body') ?? '').slice(0, 10_000),
            });
            return { ok: true, kind: 'note', id: note.id, detail: 'Note added' };
          }
          default:
            return {
              ok: false,
              code: 'UNKNOWN_ACTION',
              retryable: false,
              detail: 'This action type is no longer offered',
            };
        }
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const status = error.getStatus();
        const code = (error.getResponse() as { code?: unknown })?.code;
        return {
          ok: false,
          code:
            status === 404
              ? 'NOT_FOUND'
              : typeof code === 'string'
                ? code.slice(0, 60)
                : 'REJECTED',
          retryable: false,
          detail: 'The module refused the action',
        };
      }
      return {
        ok: false,
        code: 'ACTION_ERROR',
        retryable: true,
        detail: 'The action failed and can be tried again',
      };
    }
  }

  private async labelOf(
    tx: TxClient,
    businessId: string,
    run: { sourceEventKey: string; recordId: string | null },
    today: string,
  ): Promise<string> {
    const event = run.sourceEventKey.split(':')[0] as string;
    const rows = await loadCandidates(
      tx,
      event,
      { timing: 'IMMEDIATE', offsetValue: null, offsetUnit: null },
      {
        businessId,
        now: new Date(),
        today,
        since: new Date(0),
        recordId: run.recordId ?? undefined,
        limit: 1,
      },
    ).catch(() => []);
    return rows[0]?.label ?? '';
  }

  // ---------- Due actions, pausing, retry ----------

  /** Runs the waiting actions whose time has come. */
  runDue(businessId: string, now = new Date()): Promise<number> {
    return this.within(businessId, null, () => this.doRunDue(businessId, now));
  }

  private async doRunDue(businessId: string, now: Date): Promise<number> {
    const ids = await this.inFirm(businessId, async (tx) => {
      const rows = await tx.automationActionExecution.findMany({
        where: {
          businessId,
          status: 'PENDING',
          OR: [{ scheduledFor: { lte: now } }, { scheduledFor: null }],
          run: { dryRun: false, status: { in: ['PENDING', 'RUNNING'] } },
        },
        select: { runId: true },
        distinct: ['runId'],
        take: 200,
      });
      return rows.map((r) => r.runId);
    });
    for (const id of ids) await this.advance(businessId, id, now);
    return ids.length;
  }

  /** A paused rule's waiting actions are cancelled (skipped). */
  async cancelWaiting(businessId: string, ruleId: string): Promise<number> {
    const now = new Date();
    const runs = await this.inFirm(businessId, async (tx) => {
      const waiting = await tx.automationActionExecution.findMany({
        where: { businessId, status: 'PENDING', run: { ruleId } },
        select: { id: true, runId: true },
      });
      for (const w of waiting)
        await tx.automationActionExecution.update({
          where: { id: w.id },
          data: {
            status: 'SKIPPED',
            finishedAt: now,
            detail: 'The rule was paused',
            errorCode: null,
          },
        });
      return [...new Set(waiting.map((w) => w.runId))];
    });
    for (const id of runs) await this.rollup(businessId, id, now);
    return runs.length;
  }

  /** Puts the chosen failed actions back to waiting, notes the re-run on the run, and runs them. */
  async retry(
    businessId: string,
    runId: string,
    keys: string[],
    by: { userId: string; reason: string },
  ): Promise<void> {
    const now = new Date();
    await this.inFirm(businessId, async (tx) => {
      for (const key of keys)
        await tx.automationActionExecution.updateMany({
          where: { businessId, runId, actionKey: key, status: 'FAILED', retryable: true },
          data: {
            status: 'PENDING',
            finishedAt: null,
            errorCode: null,
            detail: null,
            scheduledFor: null,
          },
        });
      await tx.automationRun.update({
        where: { id: runId },
        data: {
          rerunCount: { increment: 1 },
          lastRerunAt: now,
          lastRerunByUserId: by.userId,
          lastRerunReason: by.reason,
          status: 'RUNNING',
          finishedAt: null,
          durationMs: null,
          errorCode: null,
          message: null,
        },
      });
    });
    await this.advance(businessId, runId, now);
  }
}
