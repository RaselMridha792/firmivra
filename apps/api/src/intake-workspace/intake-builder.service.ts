import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import {
  type FormCategory,
  type IntakeFormDetail,
  IntakeFormKey,
  type ServiceKind,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { conflict, notFound } from '../workspaces/common.js';
import { publishable, toDefinition } from './form-builder.js';
import { IntakeLibraryService } from './intake-library.service.js';
import type { SaveExistingFormBody, SaveFormBody } from './workspace-input.js';

type Out<S extends z.ZodType> = z.output<S>;
type Body = Out<typeof SaveFormBody>;

/** The service kind behind a category tab, for a form saved without a service. */
const KIND_OF: Partial<Record<FormCategory, ServiceKind>> = {
  PERSONAL_TAX: 'ANNUAL_TAX',
  BUSINESS_TAX: 'QUARTERLY_TAX',
  BOOKKEEPING: 'BOOKKEEPING',
  PAYROLL: 'PAYROLL',
  TAX_PLANNING: 'TAX_PLANNING',
  ADVISORY: 'BUSINESS_DEVELOPMENT',
};

const invalid = (message: string) =>
  new BadRequestException({ code: 'VALIDATION_FAILED', message });
const invalidStatus = (message: string) => conflict('INVALID_STATUS', message);

const versionSelect = {
  id: true,
  version: true,
  title: true,
  status: true,
  definition: true,
} satisfies Prisma.IntakeFormSelect;

/**
 * The form builder (Frame 1): a form is a template with numbered versions (intake_forms). Saving
 * edits the newest draft version, or starts the next one over a published version (sent forms
 * keep the version they were sent with). Publishing checks the definition with the form engine's
 * schema, retires the version that was live and freezes the new one. Templates are archived,
 * never deleted. Owner and Admin (the controller's roles).
 */
@Injectable()
export class IntakeBuilderService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly library: IntakeLibraryService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  /** The form's template, locked until the change commits; 404 when the firm has none. */
  private async lockTemplate(tx: TxClient, businessId: string, id: string) {
    await tx.$executeRaw`SELECT 1 FROM intake_templates
      WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
    const t = await tx.intakeTemplate.findFirst({
      where: { businessId, id },
      select: {
        id: true,
        serviceId: true,
        serviceDefault: true,
        archivedAt: true,
        internalNotes: true,
        service: { select: { kind: true } },
        forms: { select: versionSelect, orderBy: { version: 'desc' }, take: 1 },
      },
    });
    if (!t) throw notFound();
    return t;
  }

  /** The service a new form belongs to: the one named, or the firm's service of the category. */
  private async serviceFor(tx: TxClient, businessId: string, body: Body) {
    const service = await tx.service.findFirst({
      where: body.serviceId
        ? { businessId, id: body.serviceId, archivedAt: null }
        : { businessId, archivedAt: null, kind: KIND_OF[body.category] ?? 'OTHER' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, kind: true },
    });
    if (!service) {
      if (body.serviceId) throw notFound();
      throw invalid('Choose the service this form is for');
    }
    if (!IntakeFormKey.safeParse(service.kind).success) {
      throw invalid('This service has no intake form type: choose another service');
    }
    return service;
  }

  /** Whether the service has a live default template (the "Save as Template" one). */
  private async hasDefault(tx: TxClient, businessId: string, serviceId: string, except?: string) {
    const found = await tx.intakeTemplate.findFirst({
      where: {
        businessId,
        serviceId,
        serviceDefault: true,
        archivedAt: null,
        ...(except ? { id: { not: except } } : {}),
      },
      select: { id: true },
    });
    return found !== null;
  }

  /** The newest version's definition of a firm's form, to start from. */
  private async sourceDefinition(tx: TxClient, businessId: string, templateId: string) {
    const v = await tx.intakeForm.findFirst({
      where: { businessId, templateId },
      orderBy: { version: 'desc' },
      select: { definition: true, title: true },
    });
    if (!v) throw notFound();
    return v;
  }

  /** POST /business/intake-forms: Save as Draft on a new form or template. */
  async create(tenant: TenantContext, userId: string, body: Body): Promise<IntakeFormDetail> {
    const businessId = tenant.businessId;
    const id = await this.inFirm(tenant, async (tx) => {
      const service = await this.serviceFor(tx, businessId, body);
      const from =
        body.startFrom && body.startFrom.kind !== 'SCRATCH'
          ? await this.sourceDefinition(tx, businessId, body.startFrom.formId)
          : null;
      const definition = toDefinition(
        {
          title: body.name,
          description: body.description,
          sections: body.sections,
          settings: body.settings,
        },
        from?.definition ?? null,
      );
      // Held so two first templates of a service agree on which one is its default.
      await tx.$executeRaw`SELECT 1 FROM services
        WHERE business_id = ${businessId}::uuid AND id = ${service.id}::uuid FOR UPDATE`;
      const template = await tx.intakeTemplate.create({
        data: {
          businessId,
          serviceId: service.id,
          serviceDefault: body.isTemplate && !(await this.hasDefault(tx, businessId, service.id)),
          internalNotes: body.internalNotes ?? null,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: service.id,
          templateId: template.id,
          version: 1,
          title: body.name,
          definition: definition as unknown as Prisma.InputJsonValue,
          status: 'DRAFT',
          createdByUserId: userId,
        },
      });
      return template.id;
    });
    await this.audit.log(
      'intake_form.created',
      { type: 'intake_form', id },
      { startFrom: body.startFrom?.kind ?? 'SCRATCH', sourceId: startId(body) },
    );
    return this.library.detail(tenant, id);
  }

  /** PUT /business/intake-forms/{id}: save the draft (a new draft version over a published one). */
  async save(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Out<typeof SaveExistingFormBody>,
  ): Promise<IntakeFormDetail> {
    const businessId = tenant.businessId;
    const fields = await this.inFirm(tenant, async (tx) => {
      const t = await this.lockTemplate(tx, businessId, id);
      if (t.archivedAt) throw invalidStatus('This form is archived');
      if (body.serviceId && body.serviceId !== t.serviceId) {
        throw invalid("A form's service cannot change: duplicate it for another service");
      }
      const newest = t.forms[0];
      const definition = toDefinition(
        {
          title: body.name,
          description: body.description,
          sections: body.sections,
          settings: body.settings,
        },
        newest?.definition ?? null,
      ) as unknown as Prisma.InputJsonValue;
      if (newest?.status === 'DRAFT') {
        await tx.intakeForm.update({
          where: { id: newest.id },
          data: { title: body.name, definition },
        });
      } else {
        await tx.intakeForm.create({
          data: {
            businessId,
            serviceId: t.serviceId,
            templateId: t.id,
            version: (newest?.version ?? 0) + 1,
            title: body.name,
            definition,
            status: 'DRAFT',
            createdByUserId: userId,
          },
        });
      }
      const makeDefault =
        body.isTemplate && !t.serviceDefault
          ? !(await this.hasDefault(tx, businessId, t.serviceId, t.id))
          : body.isTemplate;
      await tx.intakeTemplate.update({
        where: { id: t.id },
        data: {
          ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes } : {}),
          serviceDefault: makeDefault,
        },
      });
      return [
        'name',
        ...(body.description !== undefined ? ['description'] : []),
        ...(body.internalNotes !== undefined ? ['internalNotes'] : []),
        ...(body.sections ? ['sections'] : []),
        ...(body.settings ? ['settings'] : []),
        ...(makeDefault !== t.serviceDefault ? ['isTemplate'] : []),
      ];
    });
    await this.audit.log('intake_form.saved', { type: 'intake_form', id }, { fields });
    return this.library.detail(tenant, id);
  }

  /** POST /business/intake-forms/{id}/publish: the newest draft becomes the live version. */
  async publish(tenant: TenantContext, id: string): Promise<IntakeFormDetail> {
    const businessId = tenant.businessId;
    const version = await this.inFirm(tenant, async (tx) => {
      const t = await this.lockTemplate(tx, businessId, id);
      if (t.archivedAt) throw invalidStatus('This form is archived');
      const newest = t.forms[0];
      if (newest?.status === 'PUBLISHED') return null;
      if (newest?.status !== 'DRAFT') throw invalidStatus('This form has no draft to publish');
      const definition = publishable(newest.definition, {
        key: IntakeFormKey.parse(t.service.kind),
        version: newest.version,
        title: newest.title,
      });
      await tx.intakeForm.updateMany({
        where: { businessId, templateId: t.id, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      });
      await tx.intakeForm.update({
        where: { id: newest.id },
        data: {
          status: 'PUBLISHED',
          publishedAt: new Date(),
          definition: definition as unknown as Prisma.InputJsonValue,
        },
      });
      return newest.version;
    });
    if (version !== null) {
      await this.audit.log('intake_form.published', { type: 'intake_form', id }, { version });
    }
    return this.library.detail(tenant, id);
  }

  /** POST /business/intake-forms/{id}/duplicate: a draft copy with a new id. */
  async duplicate(
    tenant: TenantContext,
    userId: string,
    id: string,
    asTemplate: boolean,
  ): Promise<IntakeFormDetail> {
    const businessId = tenant.businessId;
    const copy = await this.inFirm(tenant, async (tx) => {
      const t = await this.lockTemplate(tx, businessId, id);
      const source = await this.sourceDefinition(tx, businessId, t.id);
      await tx.$executeRaw`SELECT 1 FROM services
        WHERE business_id = ${businessId}::uuid AND id = ${t.serviceId}::uuid FOR UPDATE`;
      const template = await tx.intakeTemplate.create({
        data: {
          businessId,
          serviceId: t.serviceId,
          serviceDefault: asTemplate && !(await this.hasDefault(tx, businessId, t.serviceId)),
          internalNotes: t.internalNotes,
          createdByUserId: userId,
        },
        select: { id: true },
      });
      const title = `Copy of ${source.title}`.slice(0, 120);
      const definition = { ...((source.definition ?? {}) as object), title };
      delete (definition as { key?: unknown }).key;
      delete (definition as { version?: unknown }).version;
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: t.serviceId,
          templateId: template.id,
          version: 1,
          title,
          definition: definition as Prisma.InputJsonValue,
          status: 'DRAFT',
          createdByUserId: userId,
        },
      });
      return template.id;
    });
    await this.audit.log(
      'intake_form.duplicated',
      { type: 'intake_form', id: copy },
      { sourceId: id, asTemplate },
    );
    return this.library.detail(tenant, copy);
  }

  /** POST /business/intake-forms/{id}/archive: hidden from the library, no longer sendable. */
  async archive(tenant: TenantContext, id: string): Promise<IntakeFormDetail> {
    const businessId = tenant.businessId;
    const changed = await this.inFirm(tenant, async (tx) => {
      const t = await this.lockTemplate(tx, businessId, id);
      if (t.archivedAt) return false;
      // Sent forms keep their version; nothing new is sent from an archived form.
      await tx.intakeForm.updateMany({
        where: { businessId, templateId: t.id, status: 'PUBLISHED' },
        data: { status: 'RETIRED' },
      });
      await tx.intakeTemplate.update({
        where: { id: t.id },
        data: { archivedAt: new Date(), serviceDefault: false },
      });
      return true;
    });
    if (changed) await this.audit.log('intake_form.archived', { type: 'intake_form', id });
    return this.library.detail(tenant, id);
  }
}

const startId = (body: Body) =>
  body.startFrom && body.startFrom.kind !== 'SCRATCH' ? body.startFrom.formId : null;
