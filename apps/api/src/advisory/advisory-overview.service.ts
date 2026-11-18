import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import {
  ADVISORY_RESOURCE_FORMAT_LABELS,
  type AdvisoryKpi,
  type AdvisoryMeetingPage,
  type AdvisoryMeetingRow,
  type AdvisoryOverview,
  type AdvisoryResource,
  type AdvisoryResourcePreview,
  type AdvisoryServiceOption,
  type AdvisorySettingsView,
  type OkResponse,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { DATABASE } from '../database/database.module.js';
import { MessagesService } from '../messages/messages.service.js';
import { memberNames, memberRef, notAMember, notFound } from '../workspaces/common.js';
import {
  type AdvisoryCtx,
  AdvisoryReadService,
  advisoryAppointment,
  clientInclude,
} from './advisory-read.service.js';
import type {
  MeetingsQuery,
  ResourcesQuery,
  SendResourceBody,
  SettingsBody,
} from './advisory-input.js';
import { RESOURCES, resourceOf, toResource } from './catalog.js';
import { advErrors, clientRef, clientRefSelect, DISCLAIMER, iso } from './advisory.common.js';
import { FACTORS, FACTOR_KEYS } from './health.js';
import { withClient } from '../appointments/appointment-party.js';

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
const delta = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;
const ACTIVE_PLAN_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'FINALIZED',
  'AWAITING_CLIENT_APPROVAL',
  'SENT',
  'IN_PROGRESS',
] as const;

/** The overview, services, meetings, resources and the firm's advisory settings. */
@Injectable()
export class AdvisoryOverviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AdvisoryReadService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private run<T>(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    fn: (ctx: AdvisoryCtx) => Promise<T>,
  ): Promise<T> {
    return this.read.inFirm(businessId, async (tx) =>
      fn(await this.read.ctx(tx, businessId, tenant, userId)),
    );
  }

  // ---------- Services ----------

  async serviceOptions(ctx: AdvisoryCtx): Promise<AdvisoryServiceOption[]> {
    const { tx, businessId } = ctx;
    const services = await tx.service.findMany({
      where: { businessId, kind: 'BUSINESS_DEVELOPMENT', archivedAt: null, status: 'ACTIVE' },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }, { id: 'asc' }],
      select: { id: true, name: true, description: true },
    });
    const items = await tx.servicePackageItem.findMany({
      where: {
        businessId,
        serviceId: { in: services.map((s) => s.id) },
        included: true,
        package: { archivedAt: null, status: 'ACTIVE' },
      },
      select: { serviceId: true, package: { select: { name: true } } },
    });
    const byService = new Map<string, string[]>();
    for (const i of items)
      byService.set(i.serviceId, [...(byService.get(i.serviceId) ?? []), i.package.name]);
    return services.map((s) => ({
      serviceId: s.id,
      name: s.name,
      description: s.description,
      packages: [...new Set(byService.get(s.id) ?? [])].sort(),
      // Nothing in the catalog marks a regulated need yet (see the notes).
      referralOnly: false,
    }));
  }

  services(
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AdvisoryServiceOption[]> {
    return this.run(businessId, tenant, userId, (ctx) => this.serviceOptions(ctx));
  }

  // ---------- Meetings ----------

  private meetingWhere(ctx: AdvisoryCtx, clientId?: string): Prisma.AppointmentWhereInput {
    return {
      businessId: ctx.businessId,
      ...advisoryAppointment,
      client: {
        advisoryRecords: { some: { archivedAt: null, ...(clientId ? { id: clientId } : {}) } },
        ...(ctx.reachOnly ? { assignedUserId: ctx.actor.userId } : {}),
      },
    };
  }

  private async meetingRows(
    ctx: AdvisoryCtx,
    where: Prisma.AppointmentWhereInput,
    order: 'asc' | 'desc',
    skip: number,
    take: number,
  ): Promise<{ rows: AdvisoryMeetingRow[]; total: number }> {
    const { tx, businessId } = ctx;
    const [total, appts] = await Promise.all([
      tx.appointment.count({ where }),
      tx.appointment.findMany({
        where,
        orderBy: [{ startsAt: order }, { id: 'asc' }],
        skip,
        take,
        select: {
          id: true,
          startsAt: true,
          endsAt: true,
          staffUserId: true,
          locationKind: true,
          locationDetails: true,
          type: { select: { name: true } },
          client: { select: { ...clientRefSelect, profile: { select: { businessName: true } } } },
        },
      }),
    ]);
    const names = await memberNames(
      tx,
      businessId,
      appts.map((a) => a.staffUserId),
    );
    const rows = appts.map((a) => {
      // P4-1: an advisory meeting is a client's (the query reads advisory clients only).
      const { client } = withClient(a);
      const details = a.locationDetails;
      const isUrl = details !== null && /^https?:\/\//i.test(details);
      return {
        appointmentId: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        client: clientRef(client),
        businessName:
          client.profile?.businessName ??
          (client.accountType === 'BUSINESS' ? client.displayName : null),
        meetingType: a.type?.name ?? null,
        joinUrl: a.locationKind === 'VIDEO' && isUrl ? details : null,
        location: isUrl ? null : details,
        advisor: memberRef(names, a.staffUserId),
      };
    });
    return { rows, total };
  }

  meetings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    q: Out<typeof MeetingsQuery>,
  ): Promise<AdvisoryMeetingPage> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      let clientId: string | undefined;
      if (q.advisoryClientId) {
        const c = await this.read.loadClient(ctx, q.advisoryClientId);
        clientId = c.id;
      }
      const now = new Date();
      const base = this.meetingWhere(ctx, clientId);
      const where: Prisma.AppointmentWhereInput = {
        ...base,
        ...(q.when === 'upcoming'
          ? { status: 'SCHEDULED', startsAt: { gte: now } }
          : q.when === 'past'
            ? { status: { not: 'CANCELLED' }, startsAt: { lt: now } }
            : { status: { not: 'CANCELLED' } }),
      };
      const { rows, total } = await this.meetingRows(
        ctx,
        where,
        q.when === 'past' ? 'desc' : 'asc',
        (q.page - 1) * q.pageSize,
        q.pageSize,
      );
      return { items: rows, total, page: q.page, pageSize: q.pageSize };
    });
  }

  // ---------- Overview ----------

  overview(businessId: string, tenant: TenantContext, userId: string): Promise<AdvisoryOverview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const { tx } = ctx;
      const now = new Date();
      const reach = this.read.reach(ctx);
      const live: Prisma.AdvisoryClientWhereInput = {
        businessId,
        ...reach,
        archivedAt: null,
        status: { notIn: ['COMPLETED', 'ARCHIVED'] },
      };
      const planWhere: Prisma.AdvisoryPlanWhereInput = {
        businessId,
        advisoryClient: reach,
        archivedAt: null,
        status: { in: [...ACTIVE_PLAN_STATUSES] },
      };
      const [clientsNow, clientsBefore, plansNow, plansBefore, inProgress, apptNow, apptBefore] =
        await Promise.all([
          tx.advisoryClient.count({ where: live }),
          tx.advisoryClient.count({
            where: { ...live, createdAt: { lte: new Date(now.getTime() - 90 * DAY) } },
          }),
          tx.advisoryPlan.count({ where: planWhere }),
          tx.advisoryPlan.count({
            where: { ...planWhere, createdAt: { lte: new Date(now.getTime() - 90 * DAY) } },
          }),
          tx.advisoryPlan.count({
            where: {
              businessId,
              advisoryClient: reach,
              archivedAt: null,
              actions: { some: { status: 'IN_PROGRESS' } },
            },
          }),
          tx.appointment.count({
            where: {
              ...this.meetingWhere(ctx),
              status: 'SCHEDULED',
              startsAt: { gte: now, lte: new Date(now.getTime() + 30 * DAY) },
            },
          }),
          tx.appointment.count({
            where: {
              ...this.meetingWhere(ctx),
              status: { not: 'CANCELLED' },
              startsAt: { gte: new Date(now.getTime() - 30 * DAY), lt: now },
            },
          }),
        ]);
      const kpi = (value: number, before: number | null, label: string | null): AdvisoryKpi => ({
        value,
        deltaPercent: before === null ? null : delta(value, before),
        comparedTo: before === null ? null : label,
      });
      const recent = await tx.advisoryClient.findMany({
        where: { businessId, ...reach, archivedAt: null },
        include: clientInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        take: 5,
      });
      const goals = await tx.advisoryGoal.findMany({
        where: {
          businessId,
          advisoryClient: { ...reach, archivedAt: null },
          archivedAt: null,
          status: { notIn: ['COMPLETED', 'CANCELLED'] },
        },
        include: {
          advisoryClient: { select: { client: { select: clientRefSelect } } },
          milestones: { select: { status: true } },
        },
        orderBy: [{ targetDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
        take: 5,
      });
      const meetings = await this.meetingRows(
        ctx,
        { ...this.meetingWhere(ctx), status: 'SCHEDULED', startsAt: { gte: now } },
        'asc',
        0,
        5,
      );
      return {
        activeClients: kpi(clientsNow, clientsBefore, 'vs last quarter'),
        activePlans: kpi(plansNow, plansBefore, 'vs last quarter'),
        upcomingMeetings: kpi(apptNow, apptBefore, 'vs the last 30 days'),
        actionPlansInProgress: kpi(inProgress, null, null),
        recentClients: await this.read.clientRows(ctx, recent),
        goals: await this.read.goalRows(ctx, goals),
        meetings: meetings.rows,
        resources: RESOURCES.slice(0, 5).map(toResource),
        serviceOptions: await this.serviceOptions(ctx),
        disclaimer: DISCLAIMER,
        canCreatePlan: ctx.perms.createPlans,
        canManageGoals: ctx.perms.manageGoals,
        canSend: ctx.perms.send,
      };
    });
  }

  // ---------- Resources ----------

  resources(q: Out<typeof ResourcesQuery>): AdvisoryResource[] {
    const search = q.search?.toLowerCase();
    return RESOURCES.filter(
      (r) =>
        (!search || r.title.toLowerCase().includes(search)) &&
        (!q.category || r.category.toLowerCase() === q.category.toLowerCase()) &&
        (q.clientFacing === undefined || r.clientFacing === q.clientFacing),
    ).map(toResource);
  }

  /**
   * B28 (Business Advisory review §18): what the client would receive, and every check that
   * refuses it, in the order Send answers them: the client archived, a staff-only resource, a
   * format the resource doesn't offer, no active portal login (both formats open in the portal
   * after sign-in, and the email goes to the login's address).
   */
  private async compose(ctx: AdvisoryCtx, key: string, body: Out<typeof SendResourceBody>) {
    if (!ctx.perms.send) throw advErrors.forbidden();
    const resource = resourceOf(key);
    if (!resource) throw notFound();
    const c = await this.read.loadClient(ctx, body.advisoryClientId);
    const format = body.format ?? 'SECURE_LINK';
    const [login, firm] = await Promise.all([
      ctx.tx.clientAccount.findFirst({
        where: {
          businessId: ctx.businessId,
          clientId: c.clientId,
          status: 'ACTIVE',
          portalRole: 'PRIMARY',
        },
        select: { email: true },
      }),
      ctx.tx.business.findFirst({ where: { id: ctx.businessId }, select: { slug: true } }),
    ]);
    const name = c.client.displayName;
    const problems: AdvisoryResourcePreview['problems'] = [];
    if (c.archivedAt)
      problems.push({ code: 'CLIENT_ARCHIVED', message: 'Restore the advisory client first.' });
    if (!resource.clientFacing)
      problems.push({
        code: 'RESOURCE_NOT_CLIENT_FACING',
        message: 'This resource is for staff and cannot be sent.',
      });
    if (!resource.formats.includes(format))
      problems.push({
        code: 'FORMAT_NOT_AVAILABLE',
        message: `This resource can't be sent as ${ADVISORY_RESOURCE_FORMAT_LABELS[format]}: choose ${resource.formats.map((f) => ADVISORY_RESOURCE_FORMAT_LABELS[f]).join(' or ')}.`,
      });
    if (!login)
      problems.push({
        code: 'NO_PORTAL_LOGIN',
        message: `${name} has no active portal login yet, so the resource would not reach them: it opens only after they sign in to the portal. Send them a portal invitation first.`,
      });
    const link = `${this.env.PORTAL_BASE_URL.replace(/\/+$/, '')}/${firm?.slug ?? ''}/services/advisory#${key}`;
    const text = [
      resource.summary,
      '',
      format === 'PDF'
        ? `A PDF copy is ready to download in your portal (sign in first): ${link}`
        : `Open it in your portal (sign in first): ${link}`,
      ...(body.message ? ['', body.message] : []),
    ].join('\n');
    return { resource, client: c, format, login, problems, subject: resource.title, text };
  }

  /** B28: the preview of a send; nothing is sent, so nothing is audited. */
  previewResource(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Out<typeof SendResourceBody>,
  ): Promise<AdvisoryResourcePreview> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const m = await this.compose(ctx, key, body);
      return {
        channel: body.channel,
        format: m.format,
        to: { name: m.client.client.displayName, email: m.login?.email ?? null },
        subject: m.subject,
        body: m.text,
        eligible: m.problems.length === 0,
        problems: m.problems,
      };
    });
  }

  sendResource(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Out<typeof SendResourceBody>,
  ): Promise<OkResponse> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      const m = await this.compose(ctx, key, body);
      const first = m.problems[0];
      if (first?.code === 'CLIENT_ARCHIVED') throw advErrors.clientArchived();
      if (first?.code === 'RESOURCE_NOT_CLIENT_FACING') throw advErrors.notClientFacing();
      if (first?.code === 'FORMAT_NOT_AVAILABLE') throw advErrors.formatNotAvailable(first.message);
      if (first) throw advErrors.noPortalLogin(first.message);
      await this.messages.create(businessId, ctx.actor, m.client.clientId, {
        subject: m.subject,
        body: m.text,
        repliesEnabled: true,
        // B28: by email, the email carries the text (where the platform allows message text).
        ...(body.channel === 'EMAIL' ? { delivery: { emailIncludesBody: true } } : {}),
      });
      await this.audit.logIn(
        ctx.tx,
        'advisory_resource.sent',
        { type: 'advisory_client', id: m.client.id },
        {
          advisoryClientId: m.client.id,
          resourceKey: key,
          channel: body.channel,
          format: m.format,
        },
      );
      return { ok: true };
    });
  }

  // ---------- Settings ----------

  private async settingsView(ctx: AdvisoryCtx): Promise<AdvisorySettingsView> {
    const names = await memberNames(ctx.tx, ctx.businessId, [ctx.settings.defaultAdvisorId]);
    return {
      healthFormula: ctx.settings.formula.map((f) => {
        const def = FACTORS.find((x) => x.factor === f.factor);
        return {
          factor: f.factor,
          label: def?.label ?? f.factor,
          weight: f.weight,
          explanation: def?.explanation ?? '',
        };
      }),
      availableFactors: FACTORS.map(({ factor, label, explanation }) => ({
        factor,
        label,
        explanation,
      })),
      staleFinancialsDays: ctx.settings.staleFinancialsDays,
      defaultAdvisor: memberRef(names, ctx.settings.defaultAdvisorId),
      updatedAt: iso(ctx.settings.updatedAt),
    };
  }

  settings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
  ): Promise<AdvisorySettingsView> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.advisoryAdmin) throw advErrors.forbidden();
      return this.settingsView(ctx);
    });
  }

  saveSettings(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    body: Out<typeof SettingsBody>,
  ): Promise<AdvisorySettingsView> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.advisoryAdmin) throw advErrors.forbidden();
      const { tx } = ctx;
      body.healthFormula?.forEach((f, i) => {
        if (!FACTOR_KEYS.has(f.factor))
          throw advErrors.invalid(`healthFormula.${i}.factor`, 'This factor cannot be calculated');
      });
      if (body.defaultAdvisorUserId) {
        const m = await tx.membership.findFirst({
          where: {
            businessId,
            userId: body.defaultAdvisorUserId,
            status: 'ACTIVE',
            joinedAt: { not: null },
          },
          select: { userId: true },
        });
        if (!m) throw notAMember();
      }
      const data = {
        ...(body.healthFormula !== undefined
          ? { healthFormula: body.healthFormula as unknown as Prisma.InputJsonValue }
          : {}),
        ...(body.staleFinancialsDays !== undefined
          ? { staleFinancialsDays: body.staleFinancialsDays }
          : {}),
        ...(body.defaultAdvisorUserId !== undefined
          ? { defaultAdvisorId: body.defaultAdvisorUserId }
          : {}),
        updatedByUserId: userId,
      };
      await tx.advisorySettings.upsert({
        where: { businessId },
        create: { businessId, ...data },
        update: data,
      });
      await this.audit.logIn(
        tx,
        'advisory_settings.updated',
        { type: 'advisory_settings' },
        { fields: Object.keys(body).sort() },
      );
      return this.settingsView(await this.read.ctx(tx, businessId, tenant, userId));
    });
  }
}
