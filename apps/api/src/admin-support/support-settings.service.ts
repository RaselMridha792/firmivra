import { Injectable } from '@nestjs/common';
import type { TxClient } from '@firmivra/db';
import {
  type AddSupportHolidayRequest,
  type SaveSupportBusinessHoursRequest,
  type SaveSupportCannedResponseRequest,
  type SaveSupportCategoryRequest,
  type SaveSupportPriorityRequest,
  type SupportAssignmentRules,
  type SupportBusinessHours,
  type SupportCannedResponse,
  type SupportCategory,
  type SupportChannel,
  type SupportEscalationRules,
  type SupportHoliday,
  type SupportNotificationRecipient,
  type SupportNotificationSettings,
  type SupportPermissionGrid,
  type SupportPriority,
  type SupportSettings,
  SupportChannel as ChannelEnum,
  SupportNotificationEvent,
  SupportPermission,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { AdminPrisma } from '../firm-applications/admin-prisma.js';
import { COLOR_HEX, storedMinutes, targetOf } from './sla.js';
import {
  CHANNEL_ORDER,
  EVENT_KEYS,
  hhmm,
  invalid,
  isClientEvent,
  isoOfDay,
  loadContext,
  need,
  notFound,
  RECIPIENT_KEYS,
  ROLE_CODES,
  ruleOf,
  SUPPORT_KEYS,
  type SupportContext,
  supportError,
} from './support-context.js';

type In<S> = S extends z.ZodType ? z.output<S> : S;

const time = (hhmmValue: string) => new Date(`1970-01-01T${hhmmValue}:00.000Z`);
const sameName = (a: string, b: string) =>
  a.toLocaleLowerCase('en-US') === b.toLocaleLowerCase('en-US');
const duplicate = (what: string) =>
  supportError(409, 'DUPLICATE_NAME', `A ${what} with this name exists`);

/** A priority code from its name: upper case, letters first, unique. */
function codeFor(name: string, taken: ReadonlySet<string>): string {
  const base =
    `P_${name}`
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^P_(?=[A-Z])/, '')
      .replace(/_+$/g, '')
      .slice(0, 26) || 'PRIORITY';
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}_${n}`;
  return code;
}

/**
 * Support Settings (R60 on R0's B2): categories, priorities and their response targets, business
 * hours and holidays, assignment, escalation and notification rules, canned responses and the
 * permission grid. Every change needs EDIT_SETTINGS (canned responses MANAGE_CANNED) and writes a
 * platform audit row; nothing here touches a firm's data.
 */
@Injectable()
export class SupportSettingsService {
  constructor(
    private readonly admin: AdminPrisma,
    private readonly audit: AuditService,
  ) {}

  private run<T>(fn: (tx: TxClient, ctx: SupportContext) => Promise<T>): Promise<T> {
    return this.admin.transaction(async (tx) =>
      fn(tx, await loadContext(tx, this.admin.adminUserId)),
    );
  }

  private log(
    tx: TxClient,
    action: string,
    entity: { type: string; id?: string },
    metadata?: Record<string, unknown>,
  ) {
    return this.audit.logIn(tx, action, entity, metadata, { businessId: null });
  }

  settings(): Promise<SupportSettings> {
    return this.run((tx, ctx) => this.read(tx, ctx));
  }

  async read(tx: TxClient, ctx: SupportContext): Promise<SupportSettings> {
    const [holidays, canned, rules] = await Promise.all([
      tx.supportHoliday.findMany({ orderBy: { date: 'asc' } }),
      tx.supportCannedResponse.findMany({ orderBy: [{ title: 'asc' }, { createdAt: 'asc' }] }),
      tx.supportNotificationRule.findMany(),
    ]);
    return {
      categories: ctx.categories.map((c) => ({ ...c })),
      priorities: ctx.priorities.map(priorityView),
      businessHours: {
        ...hoursView(ctx),
        holidays: holidays.map((h) => ({
          id: h.id,
          date: h.date.toISOString().slice(0, 10),
          name: h.name,
        })),
      },
      assignment: assignmentView(ctx),
      escalation: this.escalationView(ctx),
      cannedResponses: canned.map((c) => cannedView(c, ctx)),
      notifications: notificationsView(rules),
      permissions: ctx.grid,
    };
  }

  private escalationView(ctx: SupportContext): SupportEscalationRules {
    const first = ctx.priorities[0]?.id ?? '00000000-0000-4000-8000-000000000000';
    const breach = ruleOf(ctx, 'SLA_BREACH');
    const high = ruleOf(ctx, 'HIGH_PRIORITY_UNRESOLVED');
    const critical = ruleOf(ctx, 'CRITICAL_IMMEDIATE');
    return {
      slaBreach: {
        enabled: breach?.isActive ?? false,
        notify: breach?.notifyUserId ? 'LEAD' : 'ADMINS',
      },
      highPriority: {
        enabled: high?.isActive ?? false,
        priorityId: high?.priorityId ?? first,
        target: targetOf(high?.thresholdMinutes ?? 480),
      },
      critical: {
        enabled: critical?.isActive ?? false,
        priorityId: critical?.priorityId ?? first,
        channels: channelsOf(critical?.channels ?? []),
      },
    };
  }

  // ---------- Categories ----------

  saveCategory(
    id: string | undefined,
    body: In<typeof SaveSupportCategoryRequest>,
  ): Promise<SupportCategory> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      if (id && !ctx.categories.some((c) => c.id === id)) throw notFound('Category');
      if (ctx.categories.some((c) => c.id !== id && sameName(c.name, body.name)))
        throw duplicate('category');
      const description = body.description || null;
      const row = id
        ? await tx.supportCategory.update({ where: { id }, data: { name: body.name, description } })
        : await tx.supportCategory.create({
            data: { name: body.name, description, sortOrder: ctx.categories.length + 1 },
          });
      await this.log(tx, id ? 'support.category_updated' : 'support.category_created', {
        type: 'support_category',
        id: row.id,
      });
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        active: row.isActive,
      };
    });
  }

  setCategoryActive(id: string, active: boolean): Promise<SupportCategory> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      if (!ctx.categories.some((c) => c.id === id)) throw notFound('Category');
      const row = await tx.supportCategory.update({ where: { id }, data: { isActive: active } });
      await this.log(tx, active ? 'support.category_activated' : 'support.category_deactivated', {
        type: 'support_category',
        id,
      });
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? '',
        active: row.isActive,
      };
    });
  }

  // ---------- Priorities ----------

  savePriority(
    id: string | undefined,
    body: In<typeof SaveSupportPriorityRequest>,
  ): Promise<SupportPriority> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const existing = id ? ctx.priorities.find((p) => p.id === id) : undefined;
      if (id && !existing) throw notFound('Priority');
      if (ctx.priorities.some((p) => p.id !== id && sameName(p.name, body.name)))
        throw duplicate('priority');
      const minutes = storedMinutes(body.target);
      const fields = {
        name: body.name,
        description: body.description || null,
        color: COLOR_HEX[body.color],
        responseTargetMinutes: minutes,
      };
      let rowId: string;
      if (existing) {
        const resolution = existing.resolutionTargetMinutes;
        await tx.supportPriority.update({
          where: { id: existing.id },
          data: {
            ...fields,
            // The database keeps resolution at or after the response target.
            ...(resolution !== null && resolution < minutes
              ? { resolutionTargetMinutes: minutes }
              : {}),
          },
        });
        rowId = existing.id;
      } else {
        const row = await tx.supportPriority.create({
          data: {
            ...fields,
            code: codeFor(body.name, new Set(ctx.priorities.map((p) => p.code))),
            sortOrder: ctx.priorities.length + 1,
          },
        });
        rowId = row.id;
      }
      await this.log(tx, id ? 'support.priority_updated' : 'support.priority_created', {
        type: 'support_priority',
        id: rowId,
      });
      return priorityView(
        (await loadContext(tx, this.admin.adminUserId)).priorities.find((p) => p.id === rowId)!,
      );
    });
  }

  setPriorityActive(id: string, active: boolean): Promise<SupportPriority> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const priority = ctx.priorities.find((p) => p.id === id);
      if (!priority) throw notFound('Priority');
      if (!active && priority.active && ctx.priorities.filter((p) => p.active).length === 1)
        throw supportError(422, 'LAST_ACTIVE_PRIORITY', 'Keep at least one active priority');
      await tx.supportPriority.update({ where: { id }, data: { isActive: active } });
      await this.log(tx, active ? 'support.priority_activated' : 'support.priority_deactivated', {
        type: 'support_priority',
        id,
      });
      return priorityView({ ...priority, active });
    });
  }

  // ---------- Business hours and holidays ----------

  saveBusinessHours(
    body: In<typeof SaveSupportBusinessHoursRequest>,
  ): Promise<SupportBusinessHours> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const days = new Map(body.days.map((d) => [d.day, d]));
      if (days.size !== 7) throw invalid('Set all seven days');
      const open = body.days.filter((d) => d.open);
      if (open.length === 0) throw invalid('Open at least one day');
      for (const d of open)
        if (d.end <= d.start) throw invalid('Each day must close after it opens');
      const first = open[0]!;
      if (open.some((d) => d.start !== first.start || d.end !== first.end))
        throw supportError(422, 'NOT_SUPPORTED_YET', 'Every open day uses the same hours for now');
      await tx.supportSettings.upsert({
        where: { id: 1 },
        create: {
          id: 1,
          workingDays: open.map((d) => isoOfDay(d.day)).sort(),
          opensAt: time(first.start),
          closesAt: time(first.end),
          timeZone: body.timeZone,
          slaMode: body.clock === 'CALENDAR' ? 'CALENDAR' : 'BUSINESS_HOURS',
          updatedByUserId: ctx.me.id,
        },
        update: {
          workingDays: open.map((d) => isoOfDay(d.day)).sort(),
          opensAt: time(first.start),
          closesAt: time(first.end),
          timeZone: body.timeZone,
          slaMode: body.clock === 'CALENDAR' ? 'CALENDAR' : 'BUSINESS_HOURS',
          updatedByUserId: ctx.me.id,
        },
      });
      await this.log(
        tx,
        'support.business_hours_updated',
        { type: 'support_settings' },
        {
          timeZone: body.timeZone,
          clock: body.clock,
        },
      );
      const fresh = await loadContext(tx, ctx.me.id);
      const holidays = await tx.supportHoliday.findMany({ orderBy: { date: 'asc' } });
      return {
        ...hoursView(fresh),
        holidays: holidays.map((h) => ({
          id: h.id,
          date: h.date.toISOString().slice(0, 10),
          name: h.name,
        })),
      };
    });
  }

  addHoliday(body: In<typeof AddSupportHolidayRequest>): Promise<SupportHoliday> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const date = new Date(`${body.date}T00:00:00.000Z`);
      const taken = await tx.supportHoliday.findUnique({ where: { date } });
      if (taken) throw supportError(409, 'DUPLICATE_NAME', 'That date is already a holiday');
      const row = await tx.supportHoliday.create({ data: { date, name: body.name } });
      await this.log(
        tx,
        'support.holiday_added',
        { type: 'support_holiday', id: row.id },
        { date: body.date },
      );
      return { id: row.id, date: body.date, name: row.name };
    });
  }

  removeHoliday(id: string): Promise<{ ok: true }> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const { count } = await tx.supportHoliday.deleteMany({ where: { id } });
      if (count === 0) throw notFound('Holiday');
      await this.log(tx, 'support.holiday_removed', { type: 'support_holiday', id });
      return { ok: true as const };
    });
  }

  // ---------- Assignment and escalation ----------

  saveAssignment(body: SupportAssignmentRules): Promise<SupportAssignmentRules> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      if (!body.defaultQueue)
        throw supportError(
          422,
          'NOT_SUPPORTED_YET',
          'New tickets without an assignee always wait in the queue for now',
        );
      const data = {
        roundRobin: body.roundRobin,
        reassignAfterMinutes: body.reassign ? body.reassignAfterHours * 60 : null,
        updatedByUserId: ctx.me.id,
      };
      await tx.supportSettings.upsert({
        where: { id: 1 },
        create: { id: 1, ...data },
        update: data,
      });
      await this.log(
        tx,
        'support.assignment_updated',
        { type: 'support_settings' },
        {
          roundRobin: body.roundRobin,
          reassign: body.reassign,
        },
      );
      return { ...body, reassignAfterHours: body.reassignAfterHours };
    });
  }

  saveEscalation(body: SupportEscalationRules): Promise<SupportEscalationRules> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const known = (id: string) => ctx.priorities.some((p) => p.id === id);
      if (!known(body.highPriority.priorityId))
        throw invalid('Choose the priority for the high-priority rule');
      if (!known(body.critical.priorityId))
        throw invalid('Choose the priority for the critical rule');
      let notifyUserId: string | null = null;
      if (body.slaBreach.notify === 'LEAD') {
        const current = ruleOf(ctx, 'SLA_BREACH')?.notifyUserId;
        const leads = ctx.agents.filter((a) => a.role === 'LEAD' && a.active);
        const lead = leads.find((a) => a.id === current) ?? leads[0];
        if (!lead)
          throw supportError(409, 'NO_SUPPORT_LEAD', 'There is no active Support Lead to notify');
        notifyUserId = lead.id;
      }
      const write = async (
        kind: 'SLA_BREACH' | 'HIGH_PRIORITY_UNRESOLVED' | 'CRITICAL_IMMEDIATE',
        data: {
          isActive: boolean;
          priorityId?: string | null;
          thresholdMinutes?: number | null;
          notifyUserId?: string | null;
          channels?: string[];
        },
      ) => {
        const rule = ruleOf(ctx, kind);
        if (rule) await tx.supportEscalationRule.update({ where: { id: rule.id }, data });
        else await tx.supportEscalationRule.create({ data: { kind, ...data } });
      };
      await write('SLA_BREACH', { isActive: body.slaBreach.enabled, notifyUserId });
      await write('HIGH_PRIORITY_UNRESOLVED', {
        isActive: body.highPriority.enabled,
        priorityId: body.highPriority.priorityId,
        thresholdMinutes: storedMinutes(body.highPriority.target),
      });
      await write('CRITICAL_IMMEDIATE', {
        isActive: body.critical.enabled,
        priorityId: body.critical.priorityId,
        channels: channelsOf(body.critical.channels),
      });
      await this.log(
        tx,
        'support.escalation_updated',
        { type: 'support_escalation_rules' },
        {
          slaBreach: body.slaBreach.enabled,
          highPriority: body.highPriority.enabled,
          critical: body.critical.enabled,
        },
      );
      return this.escalationView(await loadContext(tx, ctx.me.id));
    });
  }

  // ---------- Canned responses ----------

  saveCanned(
    id: string | undefined,
    body: In<typeof SaveSupportCannedResponseRequest>,
  ): Promise<SupportCannedResponse> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'MANAGE_CANNED');
      if (body.categoryId && !ctx.categories.some((c) => c.id === body.categoryId))
        throw invalid('Choose a category');
      const data = { title: body.title, body: body.body, categoryId: body.categoryId };
      let row;
      if (id) {
        const { count } = await tx.supportCannedResponse.updateMany({ where: { id }, data });
        if (count === 0) throw notFound('Response');
        row = await tx.supportCannedResponse.findUniqueOrThrow({ where: { id } });
      } else {
        row = await tx.supportCannedResponse.create({
          data: { ...data, createdByUserId: ctx.me.id },
        });
      }
      await this.log(tx, id ? 'support.canned_updated' : 'support.canned_created', {
        type: 'support_canned_response',
        id: row.id,
      });
      return cannedView(row, ctx);
    });
  }

  setCannedActive(id: string, active: boolean): Promise<SupportCannedResponse> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'MANAGE_CANNED');
      const { count } = await tx.supportCannedResponse.updateMany({
        where: { id },
        data: { isActive: active },
      });
      if (count === 0) throw notFound('Response');
      await this.log(tx, active ? 'support.canned_activated' : 'support.canned_deactivated', {
        type: 'support_canned_response',
        id,
      });
      return cannedView(await tx.supportCannedResponse.findUniqueOrThrow({ where: { id } }), ctx);
    });
  }

  // ---------- Notifications and permissions ----------

  saveNotifications(body: SupportNotificationSettings): Promise<SupportNotificationSettings> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      const channels = channelsOf(body.channels);
      for (const rule of body.rules) {
        const recipients = new Set(rule.recipients);
        const keys = (['ADMINS', 'LEAD', 'CLIENT'] as const)
          .filter((r) => recipients.has(r) && (r !== 'CLIENT' || isClientEvent(rule.event)))
          .map((r) => RECIPIENT_KEYS[r]);
        const data = {
          notifyAssignee: recipients.has('ASSIGNEE'),
          notifyRoleKeys: keys,
          channels,
          isActive: recipients.size > 0 && channels.length > 0,
        };
        await tx.supportNotificationRule.upsert({
          where: { event: EVENT_KEYS[rule.event] },
          create: { event: EVENT_KEYS[rule.event], ...data },
          update: data,
        });
      }
      await this.log(
        tx,
        'support.notifications_updated',
        { type: 'support_notification_rules' },
        {
          channels,
          events: body.rules.length,
        },
      );
      return notificationsView(await tx.supportNotificationRule.findMany());
    });
  }

  savePermissions(body: SupportPermissionGrid): Promise<SupportPermissionGrid> {
    return this.run(async (tx, ctx) => {
      need(ctx, 'EDIT_SETTINGS');
      if (!body.OWNER.includes('EDIT_SETTINGS'))
        throw supportError(
          422,
          'OWNER_KEEPS_SETTINGS',
          'The Owner must keep the right to edit settings',
        );
      const roles = await tx.platformRoleDefinition.findMany({
        where: { code: { in: Object.values(ROLE_CODES).flat() } },
        select: { id: true, code: true },
      });
      for (const role of ['OWNER', 'LEAD', 'AGENT'] as const) {
        const defs = roles.filter((r) => ROLE_CODES[role].includes(r.code));
        if (defs.length === 0)
          throw supportError(
            422,
            'NOT_SUPPORTED_YET',
            'The support roles are not set up in the team yet',
          );
        const allowed = new Set(body[role]);
        for (const def of defs) {
          for (const perm of SupportPermission.options) {
            const state = allowed.has(perm) ? 'ALLOW' : 'DENY';
            await tx.platformRolePermission.upsert({
              where: {
                roleDefinitionId_permissionKey: {
                  roleDefinitionId: def.id,
                  permissionKey: SUPPORT_KEYS[perm],
                },
              },
              create: { roleDefinitionId: def.id, permissionKey: SUPPORT_KEYS[perm], state },
              update: { state },
            });
          }
        }
      }
      await this.log(
        tx,
        'support.permissions_updated',
        { type: 'platform_role_permissions' },
        {
          owner: body.OWNER.length,
          lead: body.LEAD.length,
          agent: body.AGENT.length,
        },
      );
      return (await loadContext(tx, ctx.me.id)).grid;
    });
  }
}

// ---------- Views ----------

export function priorityView(p: SupportContext['priorities'][number]): SupportPriority {
  return {
    id: p.id,
    name: p.name,
    description: p.description,
    color: p.color,
    target: targetOf(p.targetMinutes),
    active: p.active,
    rank: p.rank,
  };
}

function hoursView(ctx: SupportContext): Omit<SupportBusinessHours, 'holidays'> {
  return {
    timeZone: ctx.hours.timeZone,
    days: ctx.hours.days.map((d) => ({ ...d })),
    clock: ctx.hours.clock,
  };
}

function assignmentView(ctx: SupportContext): SupportAssignmentRules {
  return {
    defaultQueue: true,
    roundRobin: ctx.roundRobin,
    reassign: ctx.reassignAfterMinutes !== null,
    reassignAfterHours: ctx.reassignAfterMinutes
      ? Math.min(72, Math.max(1, Math.round(ctx.reassignAfterMinutes / 60)))
      : 4,
  };
}

function channelsOf(values: readonly string[]): SupportChannel[] {
  return CHANNEL_ORDER.filter((c) => values.includes(c) && ChannelEnum.safeParse(c).success);
}

function cannedView(
  c: {
    id: string;
    title: string;
    body: string;
    categoryId: string | null;
    isActive: boolean;
    createdByUserId: string;
    updatedAt: Date;
  },
  ctx: SupportContext,
): SupportCannedResponse {
  return {
    id: c.id,
    title: c.title,
    body: c.body,
    categoryId: c.categoryId,
    active: c.isActive,
    createdBy: ctx.nameOf(c.createdByUserId),
    updatedAt: c.updatedAt.toISOString(),
  };
}

function notificationsView(
  rows: {
    event: string;
    notifyAssignee: boolean;
    notifyRoleKeys: string[];
    channels: string[];
    isActive: boolean;
  }[],
): SupportNotificationSettings {
  const byEvent = new Map(rows.map((r) => [r.event, r]));
  const used = new Set<string>();
  const rules = SupportNotificationEvent.options.map((event) => {
    const row = byEvent.get(EVENT_KEYS[event]);
    const recipients: SupportNotificationRecipient[] = [];
    if (row?.isActive) {
      if (row.notifyAssignee) recipients.push('ASSIGNEE');
      for (const r of ['LEAD', 'ADMINS', 'CLIENT'] as const)
        if (
          row.notifyRoleKeys.includes(RECIPIENT_KEYS[r]) &&
          (r !== 'CLIENT' || isClientEvent(event))
        )
          recipients.push(r);
      for (const c of row.channels) used.add(c);
    }
    return { event, recipients };
  });
  return { channels: channelsOf([...used]), rules };
}

export { hhmm };
