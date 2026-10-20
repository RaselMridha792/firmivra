import { createHash } from 'node:crypto';
import { BadRequestException, HttpException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  Email,
  MembershipRole,
  ROLES_MANAGED_BY,
  StaffEmploymentType,
  type StaffImportField,
  type StaffImportPreview,
  type StaffImportResult,
  type StaffImportRowError,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import type { StaffImportBody, StaffImportPreviewBody } from './staff-input.js';
import { StaffReadService } from './staff-read.service.js';
import { StaffWriteService } from './staff-write.service.js';
import { requireManager, type StaffActor } from './staff.common.js';

type Out<S extends z.ZodType> = z.output<S>;
type Values = Partial<Record<StaffImportField, string>>;

/** A previewed row the import acts on (staff_import_previews.rows). */
interface PlannedRow {
  row: number;
  action: 'create' | 'update';
  /** The member an update changes. */
  membershipId?: string;
  email: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  role?: MembershipRole;
  departmentId?: string;
  employmentType?: StaffEmploymentType;
  office?: string;
  hireDate?: string;
  employeeId?: string;
}

const expired = () =>
  new BadRequestException({
    code: 'IMPORT_PREVIEW_EXPIRED',
    message: 'This preview has expired. Upload the file again.',
  });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const LIMITS: Partial<Record<StaffImportField, number>> = {
  firstName: 60,
  lastName: 60,
  jobTitle: 100,
  office: 100,
  employeeId: 40,
  phone: 40,
};
/** "Full-time", "full time" and "FULL_TIME" are FULL_TIME; "1099" is FORM_1099. */
const enumKey = (value: string) => {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return key === '1099' ? 'FORM_1099' : key;
};
const validDay = (value: string) => {
  if (!DAY.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(value);
};
/** A stable create key per preview row, so a retried import never makes a second member. */
const rowKey = (previewId: string, row: number) => {
  const h = createHash('sha256').update(`staff-import:${previewId}:${row}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const csvCell = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
const messageOf = (e: unknown) => {
  if (e instanceof HttpException) {
    const body = e.getResponse() as { message?: unknown };
    if (typeof body.message === 'string') return body.message;
  }
  return 'This row could not be saved';
};

/**
 * Bulk Upload Staff (R55): preview, then import. The browser reads the file and sends its rows;
 * the preview keeps the valid ones for an hour in staff_import_previews (R0), and its id is the
 * `previewToken`. The import uses it once, as its own author, and creates and changes members
 * through Create and Edit Staff, so each row is checked, invited and audited as on the screens.
 */
@Injectable()
export class StaffImportService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly write: StaffWriteService,
    private readonly read: StaffReadService,
  ) {}

  async preview(
    actor: StaffActor,
    body: Out<typeof StaffImportPreviewBody>,
  ): Promise<StaffImportPreview> {
    const { businessId } = actor;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const by = await requireManager(tx, actor);
      const [departments, members] = await Promise.all([
        tx.department.findMany({
          where: { businessId, status: 'ACTIVE' },
          select: { id: true, name: true },
        }),
        tx.membership.findMany({
          where: { businessId },
          select: { id: true, role: true, userId: true, user: { select: { email: true } } },
        }),
      ]);
      const deptByName = new Map(departments.map((d) => [d.name.trim().toLowerCase(), d.id]));
      const memberByEmail = new Map(members.map((m) => [m.user.email.toLowerCase(), m]));
      const seen = new Set<string>();
      const errors: StaffImportRowError[] = [];
      const planned: PlannedRow[] = [];
      body.rows.forEach((source, i) => {
        const row = i + 1;
        const v: Values = {};
        for (const [column, field] of Object.entries(body.columnMap)) {
          const value = source[column]?.trim();
          if (value) v[field] = value;
        }
        const rowErrors: StaffImportRowError[] = [];
        const fail = (field: StaffImportField | null, message: string) =>
          rowErrors.push({ row, field, message });
        for (const [field, max] of Object.entries(LIMITS))
          if ((v[field as StaffImportField]?.length ?? 0) > max)
            fail(field as StaffImportField, `Use at most ${max} characters`);

        const email = Email.safeParse(v.email ?? '');
        if (!email.success) fail('email', 'Enter a valid email address');
        const address = email.success ? email.data : '';
        if (address && seen.has(address)) fail('email', 'This email is in the file twice');
        if (address) seen.add(address);
        const existing = address ? memberByEmail.get(address) : undefined;
        if (existing && existing.userId === actor.userId)
          fail('email', 'You cannot change your own access');
        else if (existing && !ROLES_MANAGED_BY[actor.role].includes(existing.role))
          fail('email', 'You cannot change this member');

        let role: MembershipRole | undefined;
        if (v.role) {
          const parsed = MembershipRole.safeParse(enumKey(v.role));
          if (!parsed.success) fail('role', 'Use one of the roles in the template');
          else if (!ROLES_MANAGED_BY[actor.role].includes(parsed.data))
            fail('role', 'You cannot give this role');
          else role = parsed.data;
        }
        let departmentId: string | undefined;
        if (v.department) {
          departmentId = deptByName.get(v.department.toLowerCase());
          if (!departmentId) fail('department', 'No active department has this name');
        }
        let employmentType: StaffEmploymentType | undefined;
        if (v.employmentType) {
          const parsed = StaffEmploymentType.safeParse(enumKey(v.employmentType));
          if (!parsed.success)
            fail('employmentType', 'Use one of the employment types in the template');
          else employmentType = parsed.data;
        }
        if (v.hireDate && !validDay(v.hireDate)) fail('hireDate', 'Use a date like 2026-01-15');
        if (!existing) {
          if (!v.firstName) fail('firstName', 'Enter a first name');
          if (!v.lastName) fail('lastName', 'Enter a last name');
          if (!v.jobTitle) fail('jobTitle', 'Enter a job title');
          if (!v.role) fail('role', 'Choose a role');
          if (!v.department) fail('department', 'Choose a department');
        }
        if (rowErrors.length) {
          errors.push(...rowErrors);
          return;
        }
        planned.push({
          row,
          action: existing ? 'update' : 'create',
          ...(existing ? { membershipId: existing.id } : {}),
          email: address,
          ...(v.firstName ? { firstName: v.firstName } : {}),
          ...(v.lastName ? { lastName: v.lastName } : {}),
          ...(v.jobTitle ? { jobTitle: v.jobTitle } : {}),
          ...(role ? { role } : {}),
          ...(departmentId ? { departmentId } : {}),
          ...(employmentType ? { employmentType } : {}),
          ...(v.office ? { office: v.office } : {}),
          ...(v.hireDate ? { hireDate: v.hireDate } : {}),
          ...(v.employeeId ? { employeeId: v.employeeId } : {}),
        });
      });
      const preview = await tx.staffImportPreview.create({
        data: { businessId, createdById: by, rows: planned as unknown as Prisma.InputJsonValue },
        select: { id: true },
      });
      const invalid = new Set(errors.map((e) => e.row)).size;
      await this.audit.logIn(
        tx,
        'staff.import_previewed',
        { type: 'staff_import_preview', id: preview.id },
        {
          rows: body.rows.length,
          toCreate: planned.filter((p) => p.action === 'create').length,
          toUpdate: planned.filter((p) => p.action === 'update').length,
          invalid,
        },
        { businessId },
      );
      return {
        previewToken: preview.id,
        toCreate: planned.filter((p) => p.action === 'create').length,
        toUpdate: planned.filter((p) => p.action === 'update').length,
        invalid,
        errors,
      };
    });
  }

  /**
   * Imports a preview once, as its author (400 IMPORT_PREVIEW_EXPIRED otherwise, or after an
   * hour). Each row goes through Create Staff (invited when `sendInvitations`, else NOT_SENT) or
   * Edit Staff; a row that fails is counted and listed in the error file, and the rest go on.
   */
  async import(
    tenant: TenantContext,
    actor: StaffActor,
    body: Out<typeof StaffImportBody>,
  ): Promise<StaffImportResult> {
    const { businessId } = actor;
    if (!UUID.test(body.previewToken)) throw expired();
    const previewId = body.previewToken.toLowerCase();
    const rows = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const by = await requireManager(tx, actor);
      const preview = await tx.staffImportPreview.findFirst({
        where: { businessId, id: previewId },
        select: { createdById: true, rows: true },
      });
      if (!preview || preview.createdById !== by) throw expired();
      // Used once: a second import of the same preview finds nothing.
      const { count } = await tx.staffImportPreview.deleteMany({
        where: { businessId, id: previewId },
      });
      if (count !== 1) throw expired();
      return preview.rows as unknown as PlannedRow[];
    });

    let created = 0;
    let updated = 0;
    let invitationsSent = 0;
    const failures: { row: number; email: string; message: string }[] = [];
    for (const r of rows) {
      try {
        if (r.action === 'create') {
          const out = await this.write.create(tenant, actor, {
            idempotencyKey: rowKey(previewId, r.row),
            account: {
              firstName: r.firstName ?? '',
              lastName: r.lastName ?? '',
              email: r.email,
              departmentIds: r.departmentId ? [r.departmentId] : [],
              jobTitle: r.jobTitle ?? '',
              role: r.role ?? 'STAFF',
            },
            details: {
              ...(r.employmentType ? { employmentType: r.employmentType } : {}),
              ...(r.office ? { office: r.office } : {}),
              ...(r.hireDate ? { hireDate: r.hireDate } : {}),
              ...(r.employeeId ? { employeeId: r.employeeId } : {}),
            },
            sendWelcomeEmail: body.sendInvitations,
          });
          created++;
          if (out.invitation.status === 'SENT') invitationsSent++;
        } else if (r.membershipId) {
          const now = await this.read.get(tenant, actor.userId, r.membershipId);
          const departmentIds = r.departmentId
            ? [...new Set([...now.departments.map((d) => d.id), r.departmentId])]
            : undefined;
          await this.write.update(tenant, actor, r.membershipId, {
            version: now.version,
            account: {
              ...(r.jobTitle ? { jobTitle: r.jobTitle } : {}),
              ...(departmentIds ? { departmentIds } : {}),
            },
            details: {
              ...(r.employmentType ? { employmentType: r.employmentType } : {}),
              ...(r.office ? { office: r.office } : {}),
              ...(r.hireDate ? { hireDate: r.hireDate } : {}),
              ...(r.employeeId ? { employeeId: r.employeeId } : {}),
            },
          });
          updated++;
        }
      } catch (e) {
        failures.push({ row: r.row, email: r.email, message: messageOf(e) });
      }
    }
    await this.audit.log(
      'staff.imported',
      { type: 'staff_import_preview', id: previewId },
      { created, updated, failed: failures.length, invitationsSent },
      { businessId },
    );
    const csv = failures.length
      ? `${String.fromCharCode(0xfeff)}row,email,error\r\n${failures
          .map((f) => [String(f.row), f.email, f.message].map(csvCell).join(','))
          .join('\r\n')}\r\n`
      : null;
    return {
      created,
      updated,
      failed: failures.length,
      invitationsSent,
      // Built here and handed to the browser: the failed rows are the firm's own, never stored.
      errorFileUrl: csv ? `data:text/csv;base64,${Buffer.from(csv).toString('base64')}` : null,
    };
  }
}
