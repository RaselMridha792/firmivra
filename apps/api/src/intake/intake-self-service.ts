import {
  Controller,
  ForbiddenException,
  Get,
  GoneException,
  HttpCode,
  HttpException,
  Inject,
  Injectable,
  Param,
  Post,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  INTAKE_LINK_ERRORS,
  IntakeFormKey,
  type IntakeStatus,
  type MyIntake,
  PortalIntakeForm,
  IntakeShareToken,
} from '@firmivra/types';
import { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { CurrentTenant, Roles } from '../auth/decorators.js';
import { hashToken } from '../begin-online/drafts.js';
import type { TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { PortalTabRoute } from '../client-portal/portal-tabs.js';
import { notFound } from '../workspaces/common.js';
import { OPEN_STATUSES } from './intake-step.js';
import { IntakesService, type PortalClient } from './intakes.service.js';

/** A service has at most one live intake (as the firm's send keeps it). */
const LIVE: IntakeStatus[] = [...OPEN_STATUSES, 'SUBMITTED', 'UNDER_REVIEW', 'COMPLETED'];
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
const linkInvalid = () =>
  new GoneException({ code: 'LINK_INVALID', message: INTAKE_LINK_ERRORS.LINK_INVALID });

/**
 * INTAKE-ACCESS-02 part B (decisions 1a and 3, Nov 15): a client starts a form on their own. A form
 * the firm published in the client portal is listed for every client of the firm (`forms`); a
 * signed-in client may also start a form by its share link (`startShared`), published in the
 * portal or not. Starting gives the client's open form of that template if there is one; else the
 * form on the client's service of it that has none live (ACTIVE or PENDING), or on a new PENDING
 * service (for the firm to review, as Begin Online makes); the client then fills it as any form
 * the firm sent (MyIntakesController), files included (a PENDING service takes files only into its
 * open intake, as the database insists). Only the primary login starts (403 otherwise). Audited
 * with ids only.
 */
@Injectable()
export class IntakeSelfService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly intakes: IntakesService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  /** The firm's forms published in the client portal, with the client's open one of each. */
  async forms(businessId: string, who: PortalClient): Promise<PortalIntakeForm[]> {
    return this.inFirm(businessId, async (tx) => {
      const templates = await tx.intakeTemplate.findMany({
        where: {
          businessId,
          portalPublished: true,
          archivedAt: null,
          service: { archivedAt: null, status: 'ACTIVE' },
          forms: { some: { status: 'PUBLISHED' } },
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 100,
        select: {
          id: true,
          service: { select: { name: true, kind: true } },
          forms: {
            where: { status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            take: 1,
            select: { title: true },
          },
        },
      });
      const open = await tx.intake.findMany({
        where: {
          businessId,
          engagement: { clientId: who.clientId },
          status: { in: OPEN_STATUSES },
          form: { templateId: { in: templates.map((t) => t.id) } },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true, form: { select: { templateId: true } } },
      });
      return templates.flatMap((t) => {
        const form = IntakeFormKey.safeParse(t.service.kind);
        const live = t.forms[0];
        if (!form.success || !live) return [];
        return [
          PortalIntakeForm.parse({
            templateId: t.id,
            title: live.title,
            form: form.data,
            serviceName: t.service.name,
            intakeId: open.find((i) => i.form.templateId === t.id)?.id ?? null,
          }),
        ];
      });
    });
  }

  /** A portal-published form: the client's open one, or a new one (see the class). */
  start(businessId: string, who: PortalClient, templateId: string): Promise<MyIntake> {
    return this.startTemplate(businessId, who, { id: templateId, portalPublished: true }, 'portal');
  }

  /** The same through the form's share link; 410 LINK_INVALID for a link that isn't live. */
  async startShared(businessId: string, who: PortalClient, token: string): Promise<MyIntake> {
    const t = await this.inFirm(businessId, (tx) =>
      tx.intakeTemplate.findFirst({
        where: { businessId, shareTokenHash: hashToken(token), archivedAt: null },
        select: { id: true },
      }),
    );
    if (!t) throw linkInvalid();
    return this.startTemplate(businessId, who, { id: t.id }, 'link').catch((error: unknown) => {
      // A shared form that can't be started (unpublished, its service inactive) says so as a link.
      if (error instanceof HttpException && error.getStatus() === 404) throw linkInvalid();
      throw error;
    });
  }

  private async startTemplate(
    businessId: string,
    who: PortalClient,
    where: { id: string; portalPublished?: true },
    via: 'portal' | 'link',
  ): Promise<MyIntake> {
    if (!who.primary) throw forbidden();
    const started = await this.inFirm(businessId, async (tx) => {
      const t = await tx.intakeTemplate.findFirst({
        where: {
          businessId,
          ...where,
          archivedAt: null,
          service: { archivedAt: null, status: 'ACTIVE' },
        },
        select: {
          id: true,
          serviceId: true,
          service: { select: { name: true, kind: true } },
          forms: {
            where: { status: 'PUBLISHED' },
            orderBy: { version: 'desc' },
            take: 1,
            select: { id: true },
          },
        },
      });
      const live = t?.forms[0];
      if (!t || !live || !IntakeFormKey.safeParse(t.service.kind).success) throw notFound();
      // One start of a form per client at a time: a double click finds the first one.
      const lock = `intake-self-start:${who.clientId}:${t.id}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lock}, 0))`;
      const open = await tx.intake.findFirst({
        where: {
          businessId,
          engagement: { clientId: who.clientId },
          status: { in: OPEN_STATUSES },
          form: { templateId: t.id },
        },
        orderBy: { createdAt: 'desc' },
        select: { id: true },
      });
      if (open) return { intakeId: open.id, engagementId: null, created: false };
      const engagement =
        (await tx.engagement.findFirst({
          where: {
            businessId,
            clientId: who.clientId,
            serviceId: t.serviceId,
            status: { in: ['ACTIVE', 'PENDING'] },
            intakes: { none: { status: { in: LIVE } } },
          },
          orderBy: { createdAt: 'desc' },
          select: { id: true },
        })) ??
        (await tx.engagement.create({
          data: {
            businessId,
            clientId: who.clientId,
            serviceId: t.serviceId,
            title: t.service.name,
            status: 'PENDING',
          },
          select: { id: true },
        }));
      const intake = await tx.intake.create({
        data: { businessId, formId: live.id, engagementId: engagement.id, status: 'SENT' },
        select: { id: true },
      });
      await tx.intakeSubmission.create({ data: { businessId, intakeId: intake.id, version: 1 } });
      return { intakeId: intake.id, engagementId: engagement.id, created: true };
    });
    if (started.created) {
      await this.audit.log(
        'intake.self_started',
        { type: 'intake', id: started.intakeId },
        { templateId: where.id, engagementId: started.engagementId, via },
      );
    }
    return this.intakes.getMine(businessId, who, started.intakeId);
  }
}

const shareTokenPipe = new ZodValidationPipe(IntakeShareToken);

/**
 * `api.myIntakes(slug).forms() / startForm(id) / startShared(token)`: the signed-in client's
 * forms to start on their own (INTAKE-ACCESS-02 part B), the client from the session.
 */
@Controller('portal/:firmSlug/me/intake-forms')
@Roles('CLIENT')
@PortalTabRoute('INTAKE_FORMS')
export class MyIntakeFormsController {
  constructor(
    private readonly intakes: IntakesService,
    private readonly self: IntakeSelfService,
  ) {}

  private client(tenant: TenantContext): Promise<PortalClient> {
    if (tenant.kind !== 'client') throw new Error('portal routes are for client logins');
    return this.intakes.clientOf(tenant.businessId, tenant.clientAccountId);
  }

  /** `forms()` */
  @Get()
  async forms(@CurrentTenant() tenant: TenantContext): Promise<{ items: PortalIntakeForm[] }> {
    return { items: await this.self.forms(tenant.businessId, await this.client(tenant)) };
  }

  /** `startShared(token)` */
  @Post('shared/:token/start')
  @HttpCode(200)
  async startShared(
    @CurrentTenant() tenant: TenantContext,
    @Param('token', shareTokenPipe) token: string,
  ): Promise<MyIntake> {
    return this.self.startShared(tenant.businessId, await this.client(tenant), token);
  }

  /** `startForm(templateId)` */
  @Post(':templateId/start')
  @HttpCode(200)
  async start(
    @CurrentTenant() tenant: TenantContext,
    @Param('templateId', new ZodValidationPipe(z.uuid())) templateId: string,
  ): Promise<MyIntake> {
    return this.self.start(tenant.businessId, await this.client(tenant), templateId);
  }
}
