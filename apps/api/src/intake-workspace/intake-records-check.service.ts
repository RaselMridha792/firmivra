import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import type { IntakeRecordsCheck } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';

/** Statuses that count as submitted: the client has handed the form in. */
const SUBMITTED = ['SUBMITTED', 'NEEDS_CORRECTION', 'UNDER_REVIEW', 'COMPLETED'];

interface Tally {
  assigned: number;
  submitted: number;
  archivedAssigned: number;
}

/**
 * Intake Forms Review Two 18c: the records check. Read-only and tenant-scoped (the firm's own
 * client), Owner and Admin only. It counts what is stored, per template and version, so the
 * counts on the screens can be checked against the database, and names any record whose identity
 * does not hold together. It never returns form content or a client's name, and the audit entry
 * holds counts only.
 */
@Injectable()
export class IntakeRecordsCheckService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  async check(tenant: TenantContext): Promise<IntakeRecordsCheck> {
    if (tenant.role !== 'OWNER' && tenant.role !== 'ADMIN') {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
    }
    const { businessId } = tenant;
    const db = this.database.forBusiness(businessId);
    const [templates, forms, counts] = await Promise.all([
      db.intakeTemplate.findMany({
        where: { businessId },
        select: { id: true, archivedAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      db.intakeForm.findMany({
        where: { businessId },
        select: { id: true, templateId: true, version: true, status: true, title: true },
        orderBy: [{ templateId: 'asc' }, { version: 'asc' }],
      }),
      db.intake.groupBy({
        by: ['formId', 'status'],
        where: { businessId },
        _count: { _all: true },
      }),
    ]);

    const issues: string[] = [];
    const tally = new Map<string, Tally>();
    for (const c of counts) {
      const row = tally.get(c.formId) ?? { assigned: 0, submitted: 0, archivedAssigned: 0 };
      row.assigned += c._count._all;
      if (SUBMITTED.includes(c.status)) row.submitted += c._count._all;
      if (c.status === 'ARCHIVED') row.archivedAssigned += c._count._all;
      tally.set(c.formId, row);
    }
    const formIds = new Set(forms.map((f) => f.id));
    for (const id of tally.keys()) {
      if (!formIds.has(id)) {
        issues.push(`Assigned forms point at a version that does not exist (${id}).`);
      }
    }

    const rows: IntakeRecordsCheck['templates'] = templates.map((t) => {
      const own = forms.filter((f) => f.templateId === t.id);
      const versions = own.map((f) => ({
        id: f.id,
        version: f.version,
        status: f.status,
        ...(tally.get(f.id) ?? { assigned: 0, submitted: 0, archivedAssigned: 0 }),
      }));
      const numbers = versions.map((v) => v.version);
      for (let n = 1; n <= Math.max(0, ...numbers); n += 1) {
        if (!numbers.includes(n)) {
          issues.push(`Template ${t.id}: version ${n} is missing from its run.`);
        }
      }
      if (new Set(numbers).size !== numbers.length) {
        issues.push(`Template ${t.id}: a version number is used twice.`);
      }
      const sum = (key: keyof Tally) => versions.reduce((s, v) => s + v[key], 0);
      return {
        id: t.id,
        name: own.at(-1)?.title ?? '',
        archived: t.archivedAt !== null,
        versions,
        assigned: sum('assigned'),
        submitted: sum('submitted'),
        archivedAssigned: sum('archivedAssigned'),
      };
    });

    const versionsWithoutTemplate = forms.filter((f) => f.templateId === null).length;
    if (versionsWithoutTemplate > 0) {
      issues.push(`${versionsWithoutTemplate} version(s) belong to no template.`);
    }
    const assignedForms = [...tally.values()].reduce((s, t) => s + t.assigned, 0);
    const perTemplate = rows.reduce((s, r) => s + r.assigned, 0);
    const withoutTemplate = [...tally.entries()]
      .filter(([id]) => forms.find((f) => f.id === id)?.templateId === null)
      .reduce((s, [, t]) => s + t.assigned, 0);
    const result: IntakeRecordsCheck = {
      checkedAt: new Date().toISOString(),
      totals: {
        templates: rows.length,
        liveTemplates: rows.filter((r) => !r.archived).length,
        archivedTemplates: rows.filter((r) => r.archived).length,
        versions: forms.length,
        assignedForms,
        archivedAssignedForms: [...tally.values()].reduce((s, t) => s + t.archivedAssigned, 0),
        deleted: 0,
        reconciled: perTemplate + withoutTemplate === assignedForms,
      },
      templates: rows,
      versionsWithoutTemplate,
      issues,
    };
    await this.audit.log(
      'intake_records.checked',
      { type: 'business', id: businessId },
      {
        templates: result.totals.templates,
        versions: result.totals.versions,
        assignedForms,
        issues: issues.length,
      },
    );
    return result;
  }
}
