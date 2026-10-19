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
import { loadSettings, memberRefOf, txOf } from './compliance.mappers.js';
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
    q: z.output<typeof ComplianceLogsQuery>,
  ): Promise<ComplianceLogPage> {
    const db = this.tenantPrisma.db;
    const where: Prisma.ComplianceLogWhereInput = {
      businessId,
      ...(q.kind ? { kind: q.kind } : {}),
      ...(q.outcome ? { outcome: q.outcome } : {}),
      ...(q.calendarId ? { calendarId: q.calendarId } : {}),
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
    const items: ComplianceLog[] = rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      outcome: r.outcome,
      message: r.message,
      calendarId: r.calendarId,
      deadlineId: r.deadlineId,
      recurrenceId: r.recurrenceId,
      details: (r.details ?? {}) as Record<string, unknown>,
      actor: memberRefOf(names, r.actorUserId),
      createdAt: r.createdAt.toISOString(),
    }));
    return { items, total, page: q.page, pageSize: q.pageSize };
  }
}
