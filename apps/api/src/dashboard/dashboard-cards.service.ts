import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import {
  type CreateDashboardCardRequest,
  DASHBOARD_CARD_PROBLEMS,
  DASHBOARD_CARD_SLOTS,
  type DashboardCardLink,
  type DashboardCardMetric,
  type DashboardCardPreview,
  type DashboardCardSettings,
  type DashboardCardStatusKey,
  type DashboardCardTemplate,
  type DashboardRange,
  type DashboardServiceCard,
  DEFAULT_DASHBOARD_CARDS,
  dashboardCardProblem,
  type OrderDashboardCardsRequest,
  type PermissionModule,
  type PreviewDashboardCardRequest,
  type ServiceKind,
  TAX_RETURN_IN_PROGRESS_STATUSES,
  type UpdateDashboardCardRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { ClientsActor } from '../clients/clients.service.js';
import { legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { addDays, rangeOf } from './dashboard-math.js';

// D4 and D5 (Octavia's Oct 25 dashboard review): the firm's service cards, one row of R1's
// dashboard_card_templates each. Owner and Admin choose a service, a metric, a status and a label
// together (Settings > Dashboard Cards); the dashboard counts each card and links it to the list
// that shows exactly what it counts. A card is switched off, never removed (the app may not delete
// these rows), and a reorder moves the cards' contents between the slots.

type Metric = z.infer<typeof DashboardCardMetric>;
type Card = {
  serviceId: string | null;
  service: { id: string; name: string; kind: z.infer<typeof ServiceKind> } | null;
  metric: Metric;
  statusKey: DashboardCardStatusKey | null;
};

const ENTITY = 'dashboard_card_template';
const notFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: "We couldn't find that card" });
const serviceNotFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: "We couldn't find that service" });
const stale = () =>
  new ConflictException({
    code: 'STALE_VERSION',
    message: 'This card was changed somewhere else. Reload and try again.',
  });

/** The firm's time zone (business settings), as the dashboard counts its days. */
const zone = (businessId: string) => Prisma.sql`
  SELECT COALESCE(
    (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
    'America/New_York') AS tz`;

const select = {
  id: true,
  slot: true,
  serviceId: true,
  service: { select: { id: true, name: true, kind: true } },
  metric: true,
  statusKey: true,
  label: true,
  enabled: true,
  version: true,
  updatedAt: true,
  updatedBy: { select: { userId: true, user: { select: { name: true } } } },
} satisfies Prisma.DashboardCardTemplateSelect;
type Row = Prisma.DashboardCardTemplateGetPayload<{ select: typeof select }>;

const toCard = (r: Row): DashboardCardTemplate => ({
  id: r.id,
  slot: r.slot,
  service: r.service,
  metric: r.metric,
  statusKey: r.statusKey as DashboardCardStatusKey | null,
  label: r.label,
  enabled: r.enabled,
  version: r.version,
  updatedAt: r.updatedAt.toISOString(),
  updatedBy: { userId: r.updatedBy.userId, name: r.updatedBy.user.name },
});

/** The workflow statuses a `tax:` key counts. */
const taxStatuses = (key: string): string[] =>
  key === 'tax:IN_PROGRESS' ? [...TAX_RETURN_IN_PROGRESS_STATUSES] : [key.slice('tax:'.length)];

@Injectable()
export class DashboardCardsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly grants: PermissionGrantsService,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  // ---------- Settings ----------

  async settings(businessId: string): Promise<DashboardCardSettings> {
    return this.inFirm(businessId, async (tx) => {
      const [rows, services] = await Promise.all([
        tx.dashboardCardTemplate.findMany({
          where: { businessId },
          orderBy: { slot: 'asc' },
          select,
        }),
        tx.service.findMany({
          where: { businessId, archivedAt: null },
          orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
          select: { id: true, name: true, kind: true },
        }),
      ]);
      return { items: rows.map(toCard), usingDefaults: rows.length === 0, services };
    });
  }

  /** The service a card names (one of the firm's, not archived), and that the choices fit. */
  private async checked(
    tx: TxClient,
    businessId: string,
    body: {
      serviceId: string | null;
      metric: Metric;
      statusKey: DashboardCardStatusKey | null;
      label?: string;
    },
  ) {
    const service = body.serviceId
      ? await tx.service.findFirst({
          where: { businessId, id: body.serviceId, archivedAt: null },
          select: { id: true, name: true, kind: true },
        })
      : null;
    if (body.serviceId && !service) throw serviceNotFound();
    const problem = dashboardCardProblem({
      serviceKind: service?.kind ?? null,
      metric: body.metric,
      statusKey: body.statusKey,
      // The preview has no label yet: any label that fits the card's kind.
      label: body.label ?? (body.statusKey?.startsWith('tax:') ? 'Returns' : 'Clients'),
    });
    if (problem) {
      throw new BadRequestException({
        code: problem,
        message: DASHBOARD_CARD_PROBLEMS[problem],
        details: [
          {
            path:
              problem === 'LABEL_MISMATCH'
                ? 'label'
                : problem === 'SERVICE_REQUIRED' || problem === 'STATUS_NOT_FOR_SERVICE'
                  ? 'serviceId'
                  : 'statusKey',
            message: DASHBOARD_CARD_PROBLEMS[problem],
          },
        ],
      });
    }
    return service;
  }

  async create(
    businessId: string,
    userId: string,
    body: z.output<typeof CreateDashboardCardRequest>,
  ): Promise<DashboardCardTemplate> {
    const card = await this.inFirm(businessId, async (tx) => {
      // One add at a time per firm: two at once must not both take the same free slot.
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`dashboard-cards:${businessId}`}))) AS l`;
      await this.checked(tx, businessId, body);
      const taken = new Set(
        (
          await tx.dashboardCardTemplate.findMany({ where: { businessId }, select: { slot: true } })
        ).map((r) => r.slot),
      );
      const slot = Array.from({ length: DASHBOARD_CARD_SLOTS }, (_, i) => i + 1).find(
        (s) => !taken.has(s),
      );
      if (!slot) {
        throw new ConflictException({
          code: 'CARDS_FULL',
          message: 'A dashboard shows six service cards at most. Change or switch off one of them.',
        });
      }
      return tx.dashboardCardTemplate.create({
        data: {
          businessId,
          slot,
          serviceId: body.serviceId,
          metric: body.metric,
          statusKey: body.statusKey,
          label: body.label,
          enabled: body.enabled,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
        select,
      });
    });
    await this.audit.log(
      'dashboard_card.created',
      { type: ENTITY, id: card.id },
      {
        slot: card.slot,
        metric: card.metric,
        statusKey: card.statusKey,
        serviceId: card.serviceId,
      },
    );
    return toCard(card);
  }

  async update(
    businessId: string,
    userId: string,
    id: string,
    body: z.output<typeof UpdateDashboardCardRequest>,
  ): Promise<DashboardCardTemplate> {
    const card = await this.inFirm(businessId, async (tx) => {
      const cur = await tx.dashboardCardTemplate.findFirst({
        where: { businessId, id },
        select: { version: true },
      });
      if (!cur) throw notFound();
      await this.checked(tx, businessId, body);
      const done = await tx.dashboardCardTemplate.updateMany({
        where: { businessId, id, version: body.version },
        data: {
          serviceId: body.serviceId,
          metric: body.metric,
          statusKey: body.statusKey,
          label: body.label,
          enabled: body.enabled,
          version: { increment: 1 },
          updatedByUserId: userId,
        },
      });
      if (done.count === 0) throw stale();
      return tx.dashboardCardTemplate.findFirstOrThrow({ where: { businessId, id }, select });
    });
    await this.audit.log(
      'dashboard_card.updated',
      { type: ENTITY, id },
      {
        slot: card.slot,
        metric: card.metric,
        statusKey: card.statusKey,
        serviceId: card.serviceId,
        enabled: card.enabled,
        version: card.version,
      },
    );
    return toCard(card);
  }

  /**
   * A new order: the cards named first, slot 1 first, then the others as they were. The slots stay
   * where they are (their index is unique, checked row by row) and the cards' contents move between
   * them, each moved one a new version; the ids the answer gives are those of the slots.
   */
  async order(
    businessId: string,
    userId: string,
    body: z.output<typeof OrderDashboardCardsRequest>,
  ): Promise<DashboardCardSettings> {
    await this.inFirm(businessId, async (tx) => {
      await tx.$queryRaw`SELECT 1 AS locked FROM (SELECT pg_advisory_xact_lock(hashtext(${`dashboard-cards:${businessId}`}))) AS l`;
      const rows = await tx.dashboardCardTemplate.findMany({
        where: { businessId },
        orderBy: { slot: 'asc' },
        select: {
          id: true,
          slot: true,
          serviceId: true,
          metric: true,
          statusKey: true,
          label: true,
          enabled: true,
        },
      });
      const named = body.ids.map((i) => i.toLowerCase());
      if (
        new Set(named).size !== named.length ||
        !named.every((i) => rows.some((r) => r.id === i))
      ) {
        throw new BadRequestException({
          code: 'VALIDATION_FAILED',
          message: "Name each of the firm's cards at most once",
          details: [{ path: 'ids', message: "Name each of the firm's cards at most once" }],
        });
      }
      const ids = [...named, ...rows.map((r) => r.id).filter((i) => !named.includes(i))];
      const byId = new Map(rows.map((r) => [r.id, r]));
      for (const [i, row] of rows.entries()) {
        const next = byId.get(ids[i]!)!;
        if (next.id === row.id) continue;
        await tx.dashboardCardTemplate.update({
          where: { id: row.id },
          data: {
            serviceId: next.serviceId,
            metric: next.metric,
            statusKey: next.statusKey,
            label: next.label,
            enabled: next.enabled,
            version: { increment: 1 },
            updatedByUserId: userId,
          },
        });
      }
    });
    await this.audit.log('dashboard_card.reordered', { type: ENTITY }, { count: body.ids.length });
    return this.settings(businessId);
  }

  // ---------- Counting ----------

  /**
   * Whether the member may view a card's list, in the role guard's order: an Owner always; then
   * the member's own change, their custom role's grid, and their role's grid.
   */
  private async mayView(tenant: TenantContext, userId: string, module: PermissionModule) {
    if (tenant.kind !== 'staff') return false;
    if (tenant.role === 'OWNER') return true;
    const own = await this.grants.memberCell(tenant.businessId, userId, module, 'VIEW');
    if (own !== undefined) return own;
    if (tenant.customRoleId) {
      const custom = await this.grants.customCell(
        tenant.businessId,
        tenant.customRoleId,
        module,
        'VIEW',
      );
      if (custom !== undefined) return custom;
    }
    return this.grants.can(tenant.businessId, tenant.role, module, 'VIEW');
  }

  /** The list a card opens, filtered to exactly what it counts. */
  private linkOf(card: Card, range: DashboardRange): DashboardCardLink {
    const key = card.statusKey;
    if (key?.startsWith('tax:')) {
      const query: Record<string, string> =
        key === 'tax:IN_PROGRESS'
          ? { workflowGroup: 'IN_PROGRESS' }
          : { workflowStatus: key.slice('tax:'.length) };
      if (card.metric === 'COMPLETED_IN_PERIOD')
        Object.assign(query, { acceptedFrom: range.from, acceptedTo: range.to });
      if (card.serviceId) query['serviceId'] = card.serviceId;
      return { list: 'tax-returns', query };
    }
    const status = key ? key.slice('engagement:'.length) : 'ACTIVE';
    const query: Record<string, string> = { serviceId: card.serviceId!, engagementStatus: status };
    if (card.metric === 'COMPLETED_IN_PERIOD')
      Object.assign(query, { completedFrom: range.from, completedTo: range.to });
    return { list: 'clients', query };
  }

  /**
   * A card's number for `range` and the period before. Tax cards count tax returns as Tax Returns
   * lists them (Staff: their clients' returns); the others count clients as Clients lists them
   * (Staff: their own clients). A status now is at the end of the period (the history then), or
   * the status today when the period ends today.
   */
  private async countOf(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    card: Card,
    range: DashboardRange,
    today: string,
  ): Promise<{ value: number; previous: number | null }> {
    const at = (day: string) => Prisma.sql`(${day}::date)::timestamp AT TIME ZONE s.tz`;
    const p = Prisma.sql`
      SELECT ${at(range.from)} AS k_start, ${at(addDays(range.to, 1))} AS k_end,
        ${at(range.previousFrom)} AS pk_start, ${at(addDays(range.previousTo, 1))} AS pk_end
      FROM s`;
    const now = range.to === today;
    const key = card.statusKey;
    if (key?.startsWith('tax:')) {
      const reach = legacyFirmRole(actor.role) === 'STAFF' ? actor.userId : null;
      const statuses = Prisma.join(
        taxStatuses(key).map((v) => Prisma.sql`${v}::"TaxReturnWorkflowStatus"`),
      );
      const base = Prisma.sql`
        FROM tax_returns t
        JOIN clients c ON c.business_id = t.business_id AND c.id = t.client_id
        WHERE t.business_id = ${businessId}::uuid AND t.archived_at IS NULL
          AND (${reach}::uuid IS NULL OR c.assigned_user_id = ${reach}::uuid)
          AND (${card.serviceId}::uuid IS NULL OR EXISTS (
            SELECT 1 FROM engagements e WHERE e.business_id = t.business_id
              AND e.id = t.engagement_id AND e.service_id = ${card.serviceId}::uuid))`;
      const statusAt = (instant: string) => Prisma.sql`COALESCE(
        (SELECT h.workflow_status FROM tax_return_history h
          WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
            AND h.changed_at < ${Prisma.raw(instant)} ORDER BY h.seq DESC LIMIT 1),
        'IN_PREPARATION')`;
      const acceptedIn = (start: string, end: string) => Prisma.sql`EXISTS (
        SELECT 1 FROM tax_return_history h
          WHERE h.business_id = t.business_id AND h.tax_return_id = t.id
            AND h.workflow_status = 'ACCEPTED' AND h.changed_at >= ${Prisma.raw(start)}
            AND h.changed_at < ${Prisma.raw(end)})`;
      const [row] =
        card.metric === 'COMPLETED_IN_PERIOD'
          ? await tx.$queryRaw<{ value: number; previous: number }[]>`
              WITH s AS (${zone(businessId)}), p AS (${p})
              SELECT
                (SELECT count(*)::int ${base} AND t.workflow_status = 'ACCEPTED'
                  AND ${acceptedIn('p.k_start', 'p.k_end')}) AS value,
                (SELECT count(*)::int ${base} AND ${acceptedIn('p.pk_start', 'p.pk_end')}) AS previous
              FROM p`
          : await tx.$queryRaw<{ value: number; previous: number }[]>`
              WITH s AS (${zone(businessId)}), p AS (${p})
              SELECT
                (SELECT count(*)::int ${base} AND ${
                  now
                    ? Prisma.sql`t.workflow_status IN (${statuses})`
                    : Prisma.sql`t.created_at < p.k_end AND ${statusAt('p.k_end')} IN (${statuses})`
                }) AS value,
                (SELECT count(*)::int ${base} AND t.created_at < p.pk_end
                  AND ${statusAt('p.pk_end')} IN (${statuses})) AS previous
              FROM p`;
      return { value: row?.value ?? 0, previous: row?.previous ?? 0 };
    }
    // Clients with an engagement of the card's service in the status (as Clients lists them).
    const staff = actor.role === 'STAFF' ? actor.userId : null;
    const status = key ? key.slice('engagement:'.length) : 'ACTIVE';
    const mine = Prisma.sql`(${staff}::uuid IS NULL OR c.assigned_user_id = ${staff}::uuid)`;
    const ofService = Prisma.sql`e.business_id = c.business_id AND e.client_id = c.id
      AND e.service_id = ${card.serviceId}::uuid`;
    const engagementAt = (instant: string) => Prisma.sql`COALESCE(
      (SELECT h.status FROM engagement_status_history h
        WHERE h.business_id = e.business_id AND h.engagement_id = e.id
          AND h.changed_at < ${Prisma.raw(instant)} ORDER BY h.changed_at DESC LIMIT 1),
      e.status)`;
    const clientsAt = (instant: string) => Prisma.sql`c.created_at < ${Prisma.raw(instant)}
      AND (c.archived_at IS NULL OR c.archived_at >= ${Prisma.raw(instant)})`;
    const inStatusAt = (instant: string) => Prisma.sql`${clientsAt(instant)} AND EXISTS (
      SELECT 1 FROM engagements e WHERE ${ofService} AND e.created_at < ${Prisma.raw(instant)}
        AND ${engagementAt(instant)} = ${status}::"EngagementStatus")`;
    const completedIn = (start: string, end: string) => Prisma.sql`EXISTS (
      SELECT 1 FROM engagements e WHERE ${ofService}
        AND e.completed_at >= ${Prisma.raw(start)} AND e.completed_at < ${Prisma.raw(end)})`;
    const [row] =
      card.metric === 'COMPLETED_IN_PERIOD'
        ? await tx.$queryRaw<{ value: number; previous: number }[]>`
            WITH s AS (${zone(businessId)}), p AS (${p})
            SELECT
              (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
                AND c.archived_at IS NULL AND ${mine} AND EXISTS (
                  SELECT 1 FROM engagements e WHERE ${ofService} AND e.status = 'COMPLETED'
                    AND e.completed_at >= p.k_start AND e.completed_at < p.k_end)) AS value,
              (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
                AND c.archived_at IS NULL AND ${mine}
                AND ${completedIn('p.pk_start', 'p.pk_end')}) AS previous
            FROM p`
        : await tx.$queryRaw<{ value: number; previous: number }[]>`
            WITH s AS (${zone(businessId)}), p AS (${p})
            SELECT
              (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
                AND ${mine} AND ${
                  now
                    ? Prisma.sql`c.archived_at IS NULL AND EXISTS (
                        SELECT 1 FROM engagements e WHERE ${ofService}
                          AND e.status = ${status}::"EngagementStatus")`
                    : inStatusAt('p.k_end')
                }) AS value,
              (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
                AND ${mine} AND ${inStatusAt('p.pk_end')}) AS previous
            FROM p`;
    return { value: row?.value ?? 0, previous: row?.previous ?? 0 };
  }

  /**
   * The dashboard's service cards for the global period: the firm's cards switched on (or the
   * defaults while it has none), each whose list the member may view.
   */
  async forSummary(
    tenant: TenantContext,
    actor: ClientsActor,
    range: DashboardRange,
    today: string,
  ): Promise<DashboardServiceCard[]> {
    const { businessId } = tenant;
    const view = {
      'tax-returns': await this.mayView(tenant, actor.userId, 'TAX_RETURNS'),
      clients: await this.mayView(tenant, actor.userId, 'CLIENTS'),
    };
    return this.inFirm(businessId, async (tx) => {
      const rows = await tx.dashboardCardTemplate.findMany({
        where: { businessId },
        orderBy: { slot: 'asc' },
        select,
      });
      const cards: (Card & { slot: number; label: string })[] =
        rows.length === 0
          ? DEFAULT_DASHBOARD_CARDS.map((d) => ({ ...d, serviceId: null, service: null }))
          : rows
              .filter((r) => r.enabled)
              .map((r) => ({
                slot: r.slot,
                label: r.label,
                serviceId: r.serviceId,
                service: r.service,
                metric: r.metric,
                statusKey: r.statusKey as DashboardCardStatusKey | null,
              }));
      const out: DashboardServiceCard[] = [];
      for (const card of cards) {
        const link = this.linkOf(card, range);
        if (!view[link.list]) continue;
        const counted = await this.countOf(tx, businessId, actor, card, range, today);
        out.push({
          slot: card.slot,
          label: card.label,
          metric: card.metric,
          statusKey: card.statusKey,
          service: card.service,
          ...counted,
          link,
        });
      }
      return out;
    });
  }

  /** Settings' live preview: the card for This Month, as the dashboard would show it now. */
  async preview(
    tenant: TenantContext,
    actor: ClientsActor,
    body: z.output<typeof PreviewDashboardCardRequest>,
  ): Promise<DashboardCardPreview> {
    const { businessId } = tenant;
    return this.inFirm(businessId, async (tx) => {
      const service = await this.checked(tx, businessId, body);
      const [day] = await tx.$queryRaw<{ today: string }[]>`
        WITH s AS (${zone(businessId)}) SELECT (now() AT TIME ZONE tz)::date::text AS today FROM s`;
      const today = day!.today;
      const range = rangeOf('THIS_MONTH', today);
      const card: Card = {
        serviceId: body.serviceId,
        service,
        metric: body.metric,
        statusKey: body.statusKey,
      };
      return {
        ...(await this.countOf(tx, businessId, actor, card, range, today)),
        link: this.linkOf(card, range),
      };
    });
  }
}
