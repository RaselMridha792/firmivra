import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  ComplianceLog,
  ComplianceLogPage,
  ComplianceLogsQuery,
  ComplianceSettings,
  UpdateComplianceSettingsRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE, TenantPrisma } from '../database/database.module.js';
import { memberNames } from '../workspaces/common.js';
import {
  type ComplianceActor,
  loadSettings,
  memberRefOf,
  reachWhere,
  txOf,
} from './compliance.mappers.js';
import { errors, inFirm, parseDay, addDays } from './compliance.shared.js';

/**
 * The firm's Compliance settings (the Settings button) and the compliance log (Frame 3, Logs):
 * imports, verification, publishing, rollbacks, generation, due-date overrides and errors, newest
 * first. The log holds ids and counts only. Staff read; Owner and Admin change the settings.
 */
@Injectable()
export class ComplianceSettingsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly tenantPrisma: TenantPrisma,
    private readonly audit: AuditService,
  ) {}

  settings(businessId: string): Promise<ComplianceSettings> {
    return loadSettings(txOf(this.tenantPrisma.db), businessId);
  }

  async update(
    businessId: string,
    body: z.output<typeof UpdateComplianceSettingsRequest>,
  ): Promise<ComplianceSettings> {
    return inFirm(this.database, businessId, async (tx) => {
      // The templates a type defaults to must be the firm's own, and live.
      if (body.taskTemplates && body.taskTemplates.length > 0) {
        const ids = [...new Set(body.taskTemplates.map((t) => t.taskTemplateId))];
        const found = await tx.taskTemplate.count({
          where: { businessId, id: { in: ids }, archivedAt: null },
        });
        if (found !== ids.length) throw errors.templateNotFound();
      }
      const current = await loadSettings(tx, businessId);
      const next = {
        dueSoonDays: body.dueSoonDays ?? current.dueSoonDays,
        atRiskDays: body.atRiskDays ?? current.atRiskDays,
        staleCalendarDays: body.staleCalendarDays ?? current.staleCalendarDays,
        defaultReminders: (body.defaultReminders ?? current.defaultReminders).map((r) => ({
          daysBefore: r.daysBefore,
          inApp: r.inApp,
          channels: r.channels,
        })) as Prisma.InputJsonValue,
        sendPastDueNotice: body.sendPastDueNotice ?? current.sendPastDueNotice,
        escalateToManager: body.escalateToManager ?? current.escalateToManager,
        escalateAfterDays: body.escalateAfterDays ?? current.escalateAfterDays,
        taskTemplates: Object.fromEntries(
          (body.taskTemplates ?? current.taskTemplates).map((t) => [t.type, t.taskTemplateId]),
        ) as Prisma.InputJsonValue,
      };
      await tx.complianceSettings.upsert({
        where: { businessId },
        create: { businessId, ...next },
        update: next,
      });
      await this.audit.logIn(
        tx,
        'compliance.settings.updated',
        { type: 'compliance_settings', id: businessId },
        { fields: Object.keys(body).sort() },
      );
      return loadSettings(tx, businessId);
    });
  }

  async logs(
    businessId: string,
    actor: ComplianceActor,
    q: z.output<typeof ComplianceLogsQuery>,
  ): Promise<ComplianceLogPage> {
    const db = this.tenantPrisma.db;
    const reach = reachWhere(actor);
    // CD-F16 (Octavia, Oct 28): a record's ID, or its name or the event's text. A deadline's name
    // is searched only among the deadlines the viewer reaches.
    const term = q.search;
    const byId =
      !!term && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term);
    const contains = { contains: term ?? '', mode: 'insensitive' as const };
    const where: Prisma.ComplianceLogWhereInput = {
      businessId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.calendarId ? { calendarId: q.calendarId } : {}),
      ...(q.deadlineId ? { deadlineId: q.deadlineId } : {}),
      ...(q.recurrenceId ? { recurrenceId: q.recurrenceId } : {}),
      ...(q.actorUserId ? { actorUserId: q.actorUserId.toLowerCase() } : {}),
      ...(term
        ? {
            OR: byId
              ? [
                  { deadlineId: term.toLowerCase() },
                  { recurrenceId: term.toLowerCase() },
                  { calendarId: term.toLowerCase() },
                ]
              : [
                  { message: contains },
                  { calendar: { is: { name: contains } } },
                  { recurrence: { is: { name: contains } } },
                  { deadline: { is: { AND: [reach, { name: contains }] } } },
                ],
          }
        : {}),
      ...(q.from || q.to
        ? {
            createdAt: {
              ...(q.from ? { gte: parseDay(q.from) } : {}),
              ...(q.to ? { lt: addDays(parseDay(q.to), 1) } : {}),
            },
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.complianceLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      db.complianceLog.count({ where }),
    ]);
    const names = await memberNames(
      db as never,
      businessId,
      rows.map((r) => r.actorUserId),
    );
    // The records' names: a deadline's only where the viewer reaches it.
    const idsOf = (pick: (r: (typeof rows)[number]) => string | null) => [
      ...new Set(rows.map(pick).filter((x): x is string => !!x)),
    ];
    const detailsOf = (r: (typeof rows)[number]) => (r.details ?? {}) as Record<string, unknown>;
    const ruleIds = idsOf((r) => {
      const id = detailsOf(r)['ruleId'];
      return typeof id === 'string' ? id : null;
    });
    const [deadlines, recurrences, calendars, rules] = await Promise.all([
      db.complianceDeadline.findMany({
        where: { AND: [{ businessId, id: { in: idsOf((r) => r.deadlineId) } }, reach] },
        select: { id: true, name: true },
      }),
      db.complianceRecurrence.findMany({
        where: { businessId, id: { in: idsOf((r) => r.recurrenceId) } },
        select: { id: true, name: true },
      }),
      db.complianceCalendar.findMany({
        where: { businessId, id: { in: idsOf((r) => r.calendarId) } },
        select: { id: true, name: true },
      }),
      db.complianceApplicabilityRule.findMany({
        where: { businessId, id: { in: ruleIds } },
        select: { id: true, name: true },
      }),
    ]);
    const named = (list: { id: string; name: string }[]) =>
      new Map(list.map((x) => [x.id, x.name]));
    const deadlineName = named(deadlines);
    const recurrenceName = named(recurrences);
    const calendarName = named(calendars);
    const ruleName = named(rules);
    const recordOf = (r: (typeof rows)[number]): ComplianceLog['record'] =>
      r.deadlineId
        ? { kind: 'DEADLINE', id: r.deadlineId, name: deadlineName.get(r.deadlineId) ?? null }
        : r.recurrenceId
          ? {
              kind: 'RECURRENCE',
              id: r.recurrenceId,
              name: recurrenceName.get(r.recurrenceId) ?? null,
            }
          : r.calendarId
            ? { kind: 'CALENDAR', id: r.calendarId, name: calendarName.get(r.calendarId) ?? null }
            : null;
    const ruleOf = (r: (typeof rows)[number]): ComplianceLog['rule'] => {
      const d = detailsOf(r);
      const id = typeof d['ruleId'] === 'string' ? d['ruleId'] : null;
      const name = id ? ruleName.get(id) : undefined;
      if (!id || name === undefined) return null;
      const version = d['ruleVersion'];
      return { id, name, version: typeof version === 'number' ? version : null };
    };
    const items: ComplianceLog[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      outcome: r.outcome,
      message: r.message,
      calendarId: r.calendarId,
      deadlineId: r.deadlineId,
      recurrenceId: r.recurrenceId,
      details: detailsOf(r),
      record: recordOf(r),
      rule: ruleOf(r),
      actor: memberRefOf(names, r.actorUserId),
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
