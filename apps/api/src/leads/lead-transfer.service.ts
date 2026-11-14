import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Post,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Database } from '@firmivra/db';
import {
  CreateLeadRequest,
  ExportLeadsRequest,
  ImportLeadsRequest,
  LEAD_EXPORT_FIELD_LABELS,
  LEAD_STATUS_LABELS,
  type LeadExportField,
  type LeadExportLink,
  type LeadImportResult,
  type LeadImportRowResult,
  type LeadPipelineQuery,
  LeadPriority,
  type LeadRow,
  LeadSource,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { REPORT_FILES, type ReportFiles } from '../reports/report-files.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { pipelineActor } from './lead-pipeline.controller.js';
import { LeadPipelineWriteService } from './lead-pipeline-write.service.js';
import { LeadPipelineService } from './lead-pipeline.service.js';
import { notFound } from './leads.service.js';
import {
  type PipelineActor,
  reach,
  requireCapability,
  rowSelect,
  SOURCE_LABELS,
  toRow,
  visibleLead,
} from './pipeline.shared.js';

const emailKey = (v: string) => v.trim().toLowerCase();
const phoneKey = (v: string | null | undefined) => {
  const digits = (v ?? '').replace(/\D/g, '');
  return digits.length >= 7 ? digits.slice(-10) : null;
};
const norm = (v: string) =>
  v
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
const MAX_EXPORT_ROWS = 5000;

/** A source by its value ("FACEBOOK_AD") or label ("Facebook Ad"), any case; null if neither. */
function sourceOf(text: string): LeadSource | null {
  const key = norm(text);
  return LeadSource.options.find((s) => norm(s) === key || norm(SOURCE_LABELS[s]) === key) ?? null;
}
const priorityOf = (text: string): LeadPriority | null =>
  LeadPriority.options.find((p) => norm(p) === norm(text)) ?? null;

const LABELS: Record<string, string> = {
  firstName: 'First name',
  lastName: 'Last name',
  email: 'Email',
  phone: 'Phone',
  businessName: 'Business name',
  sourceDetail: 'Source details',
};

/**
 * Leads R2 16: bulk import and export. Import checks every row on the server (a dry run first),
 * then creates only the rows that check out as new leads, each as Add New Lead makes one (the
 * firm's assignment rules apply; Staff own what they import). It never updates a lead: a row whose
 * email or phone matches a lead of the firm, or an earlier row, is skipped and listed. Export makes
 * a CSV of the selected leads, the filtered list or all the member reaches, with the chosen
 * columns (never a date of birth or address), cells a spreadsheet would read as formulas quoted.
 * Audited with counts only.
 */
@Injectable()
export class LeadTransferService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(REPORT_FILES) private readonly files: ReportFiles,
    private readonly writes: LeadPipelineWriteService,
    private readonly reads: LeadPipelineService,
    private readonly audit: AuditService,
  ) {}

  async import(
    businessId: string,
    actor: PipelineActor,
    tenant: TenantContext,
    body: z.output<typeof ImportLeadsRequest>,
  ): Promise<LeadImportResult> {
    requireCapability(actor, 'CREATE');
    const db = this.database.forBusiness(businessId);
    const [services, existing] = await Promise.all([
      db.service.findMany({
        where: { businessId, archivedAt: null },
        select: { id: true, name: true },
      }),
      db.lead.findMany({
        where: { businessId, status: { notIn: ['DRAFT', 'EXPIRED'] } },
        select: { id: true, firstName: true, lastName: true, email: true, phone: true },
      }),
    ]);
    if (!services.some((s) => s.id === body.defaultServiceId)) throw notFound();
    const serviceByName = new Map(services.map((s) => [s.name.trim().toLowerCase(), s.id]));
    const byEmail = new Map<string, { id: string; name: string }>();
    const byPhone = new Map<string, { id: string; name: string }>();
    for (const l of existing) {
      const ref = { id: l.id, name: `${l.firstName} ${l.lastName}`.trim() };
      byEmail.set(emailKey(l.email), ref);
      const p = phoneKey(l.phone);
      if (p) byPhone.set(p, ref);
    }
    const seenEmail = new Set<string>();
    const seenPhone = new Set<string>();
    const rows: (LeadImportRowResult & { create?: z.output<typeof CreateLeadRequest> })[] = [];
    for (const [index, raw] of body.rows.entries()) {
      const issues: string[] = [];
      const text = (k: keyof typeof raw) => (raw[k] ?? '').trim();
      const source = text('source') ? sourceOf(text('source')) : 'OTHER';
      if (!source) issues.push(`Lead source: "${text('source')}" is not one of the sources`);
      const priority = text('priority') ? priorityOf(text('priority')) : 'WARM';
      if (!priority) issues.push('Priority: use Hot, Warm or Cold');
      const serviceId = text('service')
        ? serviceByName.get(text('service').toLowerCase())
        : body.defaultServiceId;
      if (!serviceId) issues.push(`Service: no service is named "${text('service')}"`);
      const parsed = CreateLeadRequest.safeParse({
        firstName: text('firstName'),
        lastName: text('lastName'),
        email: text('email'),
        phone: text('phone'),
        businessName: text('businessName'),
        source: source ?? 'OTHER',
        sourceDetail: text('sourceDetail'),
        priority: priority ?? 'WARM',
        serviceIds: [serviceId ?? body.defaultServiceId],
        stage: 'SUBMITTED',
        allowDuplicate: true,
      });
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = String(issue.path[0] ?? '');
          issues.push(`${LABELS[field] ?? field}: ${issue.message}`);
        }
      }
      const result: LeadImportRowResult = {
        row: index + 1,
        status: 'CREATE',
        issues,
        duplicateOf: null,
        leadId: null,
      };
      if (issues.length || !parsed.success) {
        rows.push({ ...result, status: 'INVALID' });
        continue;
      }
      const e = emailKey(parsed.data.email);
      const p = phoneKey(parsed.data.phone);
      const match = byEmail.get(e) ?? (p ? byPhone.get(p) : undefined);
      if (match || seenEmail.has(e) || (p && seenPhone.has(p))) {
        rows.push({
          ...result,
          status: 'DUPLICATE',
          duplicateOf: match ?? null,
          ...(body.duplicates === 'REVIEW' ? { create: parsed.data } : {}),
        });
        continue;
      }
      seenEmail.add(e);
      if (p) seenPhone.add(p);
      rows.push({ ...result, create: parsed.data });
    }
    if (!body.dryRun) {
      for (const r of rows) {
        // A possible duplicate only when asked to add it for Review Duplicates (`create` set).
        if (!r.create) continue;
        try {
          const lead = await this.writes.create(businessId, actor, r.create, tenant);
          r.leadId = lead.id;
        } catch (error) {
          r.status = 'INVALID';
          const message = (error as { response?: { message?: string } }).response?.message;
          r.issues = [message ?? 'This row could not be saved'];
        }
      }
    }
    const out = rows.map(({ create: _create, ...r }) => r);
    const count = (status: LeadImportRowResult['status']) =>
      out.filter((r) => r.status === status).length;
    const result: LeadImportResult = {
      dryRun: body.dryRun,
      created: out.filter((r) => r.leadId !== null).length,
      duplicates: count('DUPLICATE'),
      invalid: count('INVALID'),
      rows: out,
    };
    await this.audit.log(
      body.dryRun ? 'leads.import_checked' : 'leads.imported',
      { type: 'lead' },
      {
        rows: out.length,
        created: result.created,
        duplicates: result.duplicates,
        invalid: result.invalid,
        duplicatesForReview: body.duplicates === 'REVIEW',
      },
    );
    return result;
  }

  async export(
    businessId: string,
    actor: PipelineActor,
    body: z.output<typeof ExportLeadsRequest>,
  ): Promise<LeadExportLink> {
    let leads: LeadRow[] = [];
    if (body.scope === 'SELECTED') {
      const ids = [...new Set(body.ids ?? [])];
      const rows = await this.database.forBusiness(businessId).lead.findMany({
        where: { AND: [visibleLead(businessId), reach(actor), { id: { in: ids } }] },
        select: rowSelect,
      });
      if (rows.length !== ids.length) throw notFound();
      leads = rows.map((r) => toRow(r));
    } else {
      const filters = body.scope === 'FILTERED' ? (body.filters ?? {}) : {};
      for (let page = 1; page <= MAX_EXPORT_ROWS / 100; page++) {
        const part = await this.reads.list(businessId, actor, {
          ...filters,
          page,
          pageSize: 100,
        } as z.output<typeof LeadPipelineQuery>);
        leads.push(...part.items);
        if (page * 100 >= part.total) break;
      }
    }
    const value = (l: LeadRow, f: LeadExportField): string => {
      switch (f) {
        case 'number':
          return l.number;
        case 'name':
          return `${l.firstName} ${l.lastName}`.trim();
        case 'businessName':
          return l.businessName ?? '';
        case 'email':
          return l.email;
        case 'phone':
          return l.phone ?? '';
        case 'source':
          return SOURCE_LABELS[l.source];
        case 'campaign':
          return l.campaign?.name ?? '';
        case 'services':
          return l.services.map((s) => s.name).join('; ');
        case 'priority':
          return l.priority;
        case 'stage':
          return LEAD_STATUS_LABELS[l.stage];
        case 'assignedTo':
          return l.assignedTo?.name ?? '';
        case 'nextAction':
          return l.nextAction ? `${l.nextAction.type} ${l.nextAction.dueAt.slice(0, 10)}` : '';
        case 'lastContact':
          return l.lastContact?.at.slice(0, 10) ?? '';
        case 'tags':
          return l.tags.join('; ');
        case 'createdAt':
          return l.createdAt.slice(0, 10);
      }
    };
    // A cell a spreadsheet would read as a formula starts with a quote (as the Clients export).
    const cell = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
    const quote = (v: string) => `"${cell(v).replace(/"/g, '""')}"`;
    const head = body.fields.map((f) => LEAD_EXPORT_FIELD_LABELS[f]);
    const lines = [head, ...leads.map((l) => body.fields.map((f) => value(l, f)))];
    const csv = `\uFEFF${lines.map((r) => r.map(quote).join(',')).join('\r\n')}\r\n`;
    const key = `tenant/${businessId}/reports/leads-${randomUUID()}.csv`;
    const fileName = `leads-${new Date().toISOString().slice(0, 10)}.csv`;
    let url: string;
    try {
      await this.files.put(key, Buffer.from(csv, 'utf8'), 'text/csv; charset=utf-8');
      url = await this.files.presignDownload({ key, fileName, contentType: 'text/csv' });
    } catch {
      throw new ServiceUnavailableException({
        code: 'FILE_STORE_UNAVAILABLE',
        message: 'The file could not be saved. Try again shortly.',
      });
    }
    await this.audit.log(
      'leads.exported',
      { type: 'lead' },
      { scope: body.scope, rows: leads.length, fields: body.fields },
    );
    return {
      url,
      expiresAt: new Date(Date.now() + 5 * 60_000).toISOString(),
      fileName,
      rowCount: leads.length,
    };
  }
}

@Controller('business/leads')
@Access('LEADS')
@Roles(...FIRM_STAFF)
export class LeadTransferController {
  constructor(
    private readonly transfer: LeadTransferService,
    private readonly grants: PermissionGrantsService,
  ) {}

  /** R2 16: check (`dryRun`) or import the mapped rows (Leads CREATE). */
  @Post('import')
  @HttpCode(200)
  import(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ImportLeadsRequest)) body: z.output<typeof ImportLeadsRequest>,
  ): Promise<LeadImportResult> {
    return this.transfer.import(tenant.businessId, pipelineActor(auth, tenant), tenant, body);
  }

  /** R2 16: a CSV of the leads in scope (the Owner, or Leads EXPORT in the member's grid). */
  @Post('export')
  @HttpCode(200)
  @Access('LEADS', 'EXPORT')
  async export(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Body(new ZodValidationPipe(ExportLeadsRequest)) body: z.output<typeof ExportLeadsRequest>,
  ): Promise<LeadExportLink> {
    if (
      tenant.kind !== 'staff' ||
      (legacyFirmRole(tenant.role) !== 'OWNER' &&
        !(await this.grants.canTenant(tenant, 'LEADS', 'EXPORT')))
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'You do not have access to this action',
      });
    }
    return this.transfer.export(tenant.businessId, pipelineActor(auth, tenant), body);
  }
}
