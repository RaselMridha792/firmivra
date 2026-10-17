import { Inject, Injectable } from '@nestjs/common';
import type { Database, Prisma } from '@firmivra/db';
import type {
  AdvisoryKpi,
  AdvisoryMeetingPage,
  AdvisoryMeetingRow,
  AdvisoryOverview,
  AdvisoryResource,
  AdvisoryServiceOption,
  AdvisorySettingsView,
  OkResponse,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
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

type Out<S extends z.ZodType> = z.output<S>;

const DAY = 86_400_000;
const delta = (now: number, before: number): number | null =>
  before > 0 ? Math.round(((now - before) / before) * 100) : null;
const ACTIVE_PLAN_STATUSES = ['DRAFT', 'IN_REVIEW', 'FINALIZED', 'SENT', 'IN_PROGRESS'] as const;

/** The overview, services, meetings, resources and the firm's advisory settings. */
@Injectable()
export class AdvisoryOverviewService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly read: AdvisoryReadService,
    private readonly audit: AuditService,
    private readonly messages: MessagesService,
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
      const details = a.locationDetails;
      const isUrl = details !== null && /^https?:\/\//i.test(details);
      return {
        appointmentId: a.id,
        startsAt: a.startsAt.toISOString(),
        endsAt: a.endsAt.toISOString(),
        client: clientRef(a.client),
        businessName:
          a.client.profile?.businessName ??
          (a.client.accountType === 'BUSINESS' ? a.client.displayName : null),
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

  sendResource(
    businessId: string,
    tenant: TenantContext,
    userId: string,
    key: string,
    body: Out<typeof SendResourceBody>,
  ): Promise<OkResponse> {
    return this.run(businessId, tenant, userId, async (ctx) => {
      if (!ctx.perms.send) throw advErrors.forbidden();
      const resource = resourceOf(key);
      if (!resource) throw notFound();
      const c = await this.read.loadClient(ctx, body.advisoryClientId);
      if (c.archivedAt) throw advErrors.clientArchived();
      if (!resource.clientFacing) throw advErrors.notClientFacing();
      await this.messages.create(businessId, ctx.actor, c.clientId, {
        subject: resource.title,
        body: [resource.summary, ...(body.message ? ['', body.message] : [])].join('\n'),
        repliesEnabled: true,
      });
      await this.audit.logIn(
        ctx.tx,
        'advisory_resource.sent',
        { type: 'advisory_client', id: c.id },
        { advisoryClientId: c.id, resourceKey: key, channel: body.channel },
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
