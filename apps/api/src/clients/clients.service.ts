import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Database, Prisma, type TxClient } from '@firmivra/db';
import type {
  BulkClientsRequest,
  BulkClientsResponse,
  ClientListItem,
  ClientListRow,
  ClientProfile,
  ClientRecord,
  ClientServiceRef,
  ClientsSummary,
  CreateClientRequest,
  ListClientsQuery,
  ListClientsResponse,
  UpdateClientProfileRequest,
  UpdateClientRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { lockClientEmails } from '../client-auth/client-records.js';
import { FieldEncryption } from '../field-encryption/field-encryption.service.js';
import { reassignClientTasks } from '../workspaces/tasks.service.js';
import { uuidv7 } from './client-ids.js';
import {
  changedFields,
  type DateOfBirthView,
  readDateOfBirth,
  secretColumns,
} from './client-secrets.js';

type ListQuery = z.output<typeof ListClientsQuery>;
type CreateBody = z.output<typeof CreateClientRequest>;
type UpdateBody = z.output<typeof UpdateClientRequest>;
type ProfileBody = z.output<typeof UpdateClientProfileRequest>;
type BulkBody = z.output<typeof BulkClientsRequest>;

/** The firm's time zone (business settings), so days and months are the firm's. */
const zone = (businessId: string) => Prisma.sql`
  SELECT COALESCE(
    (SELECT timezone FROM business_settings WHERE business_id = ${businessId}::uuid),
    'America/New_York') AS tz`;

interface SummaryCounts {
  total_now: number;
  total_before: number;
  new_now: number;
  new_before: number;
  active: number;
  stage_new: number;
  pending_docs: number;
  balances: number;
  inactive: number;
}

/** Who acts: the signed-in member and their role in this firm (from TenantGuard). */
export interface ClientsActor {
  userId: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF';
}

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const forbidden = () =>
  new ForbiddenException({ code: 'FORBIDDEN', message: 'This action is not permitted' });
const duplicateEmail = () =>
  new ConflictException({ code: 'DUPLICATE_EMAIL', message: 'Another client has this email' });
const archived = () =>
  new ConflictException({ code: 'CLIENT_ARCHIVED', message: 'Restore the client first' });

/** LIKE wildcards in a search term are plain characters (Prisma's `contains` does not escape). */
export function likeEscape(term: string): string {
  return term.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** The opaque paging cursor: the last row's creation time and id. */
export function encodeCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(`${row.createdAt.toISOString()}|${row.id}`).toString('base64url');
}

export function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  const [at, id] = Buffer.from(cursor, 'base64url').toString().split('|');
  const createdAt = new Date(at ?? '');
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!id || !uuid.test(id) || Number.isNaN(createdAt.getTime())) {
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'The cursor is not valid',
    });
  }
  return { createdAt, id };
}

const listSelect = {
  id: true,
  accountType: true,
  displayName: true,
  email: true,
  phone: true,
  archivedAt: true,
  createdAt: true,
  assignedMember: { select: { userId: true, user: { select: { name: true } } } },
  accounts: { where: { portalRole: 'PRIMARY' }, take: 1, select: { status: true } },
} satisfies Prisma.ClientSelect;

const recordSelect = {
  ...listSelect,
  updatedAt: true,
  profile: true,
  accounts: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, portalRole: true, status: true },
  },
} satisfies Prisma.ClientSelect;

type ListRow = Prisma.ClientGetPayload<{ select: typeof listSelect }>;
type RecordRow = Prisma.ClientGetPayload<{ select: typeof recordSelect }>;

const iso = (d: Date | null) => d?.toISOString() ?? null;

function toListItem(row: ListRow): ClientListItem {
  return {
    id: row.id,
    accountType: row.accountType,
    displayName: row.displayName,
    email: row.email,
    phone: row.phone,
    assignedTo: row.assignedMember
      ? { userId: row.assignedMember.userId, name: row.assignedMember.user.name }
      : null,
    portalStatus: row.accounts[0]?.status ?? null,
    archivedAt: iso(row.archivedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** `dob`: decrypted by the caller (firm staff see it in full), or flagged unavailable. */
function toRecord(row: RecordRow, dob: DateOfBirthView): ClientRecord {
  const p = row.profile;
  const primary = row.accounts.find((a) => a.portalRole === 'PRIMARY');
  return {
    ...toListItem({ ...row, accounts: primary ? [primary] : [] }),
    profile: {
      firstName: p?.firstName ?? null,
      middleName: p?.middleName ?? null,
      lastName: p?.lastName ?? null,
      preferredName: p?.preferredName ?? null,
      businessName: p?.businessName ?? null,
      entityType: p?.entityType ?? null,
      ...dob,
      ssnLast4: p?.ssnLast4 ?? null,
      einLast4: p?.einLast4 ?? null,
      address: {
        line1: p?.addressLine1 ?? null,
        line2: p?.addressLine2 ?? null,
        city: p?.city ?? null,
        state: p?.state ?? null,
        postalCode: p?.postalCode ?? null,
        country: p?.country ?? 'US',
      },
      preferredContactMethod: p?.preferredContactMethod ?? null,
      referralSource: p?.referralSource ?? null,
      additionalInfo: p?.additionalInfo ?? null,
      updatedAt: iso(p?.updatedAt ?? null),
    },
    portalLogins: row.accounts.map((a) => ({
      clientAccountId: a.id,
      email: a.email,
      portalRole: a.portalRole,
      status: a.status,
    })),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/** The plain profile columns of a request; SSN, EIN and date of birth go through `secretColumns`. */
function profileData(body: ProfileBody): Prisma.ClientProfileUncheckedUpdateInput {
  const { address, ssn: _s, ein: _e, dateOfBirth: _d, ...rest } = body;
  const data: Record<string, unknown> = { ...rest };
  if (address) {
    data['addressLine1'] = address.line1;
    data['addressLine2'] = address.line2;
    data['city'] = address.city;
    data['state'] = address.state;
    data['postalCode'] = address.postalCode;
    data['country'] = address.country;
  }
  return Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
}

/**
 * The firm's clients (R10 step 3; contract in packages/types/src/clients). Every query runs in
 * the firm's business scope with `businessId` from TenantGuard. Owner and Admin reach every
 * client; Staff only those assigned to them (others are 404). Every read and change is audited
 * with ids and field names only, never names, emails or other values.
 */
@Injectable()
export class ClientsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly fe: FieldEncryption,
  ) {}

  /**
   * The record as the firm sees it: SSN and EIN as last 4 only, the date of birth in full (or null
   * with `dateOfBirthUnavailable` when it can't be read). After a write that set the date of birth
   * (`written.dateOfBirth`), the one just written, without decrypting it again.
   */
  private async record(
    businessId: string,
    row: RecordRow,
    written?: { dateOfBirth?: string | null },
  ): Promise<ClientRecord> {
    if (written?.dateOfBirth !== undefined) {
      return toRecord(row, { dateOfBirth: written.dateOfBirth, dateOfBirthUnavailable: false });
    }
    return toRecord(row, await readDateOfBirth(this.fe, businessId, row.id, row.profile?.dobEnc));
  }

  /** Which clients the actor may reach. */
  private reach(actor: ClientsActor): Prisma.ClientWhereInput {
    return actor.role === 'STAFF' ? { assignedUserId: actor.userId } : {};
  }

  private inFirm<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId }, fn);
  }

  async list(businessId: string, actor: ClientsActor, q: ListQuery): Promise<ListClientsResponse> {
    if (actor.role === 'STAFF' && q.assignedUserId) throw forbidden();
    const after = q.cursor ? decodeCursor(q.cursor) : undefined;
    const term = q.search ? likeEscape(q.search) : undefined;
    const days = await this.dayBounds(businessId, q.lastActivityFrom, q.lastActivityTo);
    const filters: Prisma.ClientWhereInput[] = [
      { businessId },
      this.reach(actor),
      q.status === 'active' ? { archivedAt: null } : {},
      q.status === 'archived' ? { archivedAt: { not: null } } : {},
      q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
      q.clientStatus ? { status: q.clientStatus } : {},
      q.serviceId
        ? {
            engagements: {
              some: { serviceId: q.serviceId, status: { in: ['PENDING', 'ACTIVE'] } },
            },
          }
        : {},
      days ? { lastActivityAt: { gte: days.start, lt: days.end } } : {},
      term
        ? {
            OR: [
              { displayName: { contains: term, mode: 'insensitive' } },
              { email: { contains: term, mode: 'insensitive' } },
              { phone: { contains: term, mode: 'insensitive' } },
            ],
          }
        : {},
    ];
    const db = this.database.forBusiness(businessId);
    const where: Prisma.ClientWhereInput = {
      AND: [
        ...filters,
        after
          ? {
              OR: [
                { createdAt: { lt: after.createdAt } },
                { createdAt: after.createdAt, id: { lt: after.id } },
              ],
            }
          : {},
      ],
    };
    const [rows, total] = await Promise.all([
      db.client.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        ...(q.page ? { skip: (q.page - 1) * q.limit, take: q.limit } : { take: q.limit + 1 }),
        select: { ...listSelect, status: true, lastActivityAt: true },
      }),
      db.client.count({ where: { AND: filters } }),
    ]);
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    const work = await this.workOf(
      businessId,
      page.map((r) => r.id),
    );
    await this.audit.log('clients.listed', { type: 'client' }, { count: page.length });
    return {
      items: page.map((row): ClientListRow => ({
        ...toListItem(row),
        status: row.status,
        lastActivityAt: iso(row.lastActivityAt),
        services: work.services.get(row.id) ?? [],
        missingDocuments: work.missing.get(row.id) ?? 0,
        balanceDueCents: work.balance.get(row.id) ?? 0,
        nextAppointmentAt: iso(work.next.get(row.id) ?? null),
      })),
      nextCursor: !q.page && rows.length > q.limit && last ? encodeCursor(last) : null,
      total,
    };
  }

  /** The firm's calendar days `from` to `to` (both included) as instants; null without either. */
  private async dayBounds(
    businessId: string,
    from: string | undefined,
    to: string | undefined,
  ): Promise<{ start: Date | undefined; end: Date | undefined } | null> {
    if (!from && !to) return null;
    const [row] = await this.inFirm(
      businessId,
      (tx) => tx.$queryRaw<{ start: Date | null; end: Date | null }[]>`
        WITH s AS (${zone(businessId)})
        SELECT (${from ?? null}::date::timestamp AT TIME ZONE s.tz) AS start,
          ((${to ?? null}::date + 1)::timestamp AT TIME ZONE s.tz) AS "end"
        FROM s`,
    );
    return { start: row?.start ?? undefined, end: row?.end ?? undefined };
  }

  /**
   * The work around a page of clients, in the firm's scope: open engagements' services, document
   * requests still owed (REQUESTED or REJECTED), the balance on OPEN invoices and the next
   * SCHEDULED appointment.
   */
  private async workOf(businessId: string, ids: string[]) {
    const services = new Map<string, ClientServiceRef[]>();
    const missing = new Map<string, number>();
    const balance = new Map<string, number>();
    const next = new Map<string, Date>();
    if (ids.length === 0) return { services, missing, balance, next };
    const db = this.database.forBusiness(businessId);
    const [engagements, requests, appointments, owed] = await Promise.all([
      db.engagement.findMany({
        where: { businessId, clientId: { in: ids }, status: { in: ['PENDING', 'ACTIVE'] } },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { clientId: true, service: { select: { id: true, name: true, kind: true } } },
      }),
      db.documentRequest.groupBy({
        by: ['clientId'],
        where: { businessId, clientId: { in: ids }, status: { in: ['REQUESTED', 'REJECTED'] } },
        _count: { _all: true },
      }),
      db.appointment.groupBy({
        by: ['clientId'],
        where: {
          businessId,
          clientId: { in: ids },
          status: 'SCHEDULED',
          startsAt: { gt: new Date() },
        },
        _min: { startsAt: true },
      }),
      this.inFirm(
        businessId,
        (tx) => tx.$queryRaw<{ clientId: string; cents: number }[]>`
          SELECT i.client_id::text AS "clientId",
            COALESCE(sum(GREATEST(0, i.total_cents - app_invoice_paid_cents(i.id))), 0)::float8 AS cents
          FROM invoices i
          WHERE i.business_id = ${businessId}::uuid AND i.client_id = ANY(${ids}::uuid[])
            AND i.status = 'OPEN'
          GROUP BY i.client_id`,
      ),
    ]);
    for (const e of engagements) {
      const list = services.get(e.clientId) ?? [];
      if (!list.some((s) => s.id === e.service.id)) list.push(e.service);
      services.set(e.clientId, list);
    }
    for (const r of requests) missing.set(r.clientId, r._count._all);
    for (const a of appointments) if (a._min.startsAt) next.set(a.clientId, a._min.startsAt);
    for (const o of owed) balance.set(o.clientId, Math.round(o.cents));
    return { services, missing, balance, next };
  }

  /**
   * The list's KPI cards and tab counts (GET /business/clients/summary), in the firm's scope and
   * time zone. Staff count only the clients assigned to them, as their list shows.
   */
  async summary(businessId: string, actor: ClientsActor): Promise<ClientsSummary> {
    const staff = actor.role === 'STAFF' ? actor.userId : null;
    const mine = Prisma.sql`(${staff}::uuid IS NULL OR c.assigned_user_id = ${staff}::uuid)`;
    const live = Prisma.sql`c.business_id = ${businessId}::uuid AND c.archived_at IS NULL AND ${mine}`;
    const { counts, byService } = await this.inFirm(businessId, async (tx) => {
      const [counts] = await tx.$queryRaw<SummaryCounts[]>`
        WITH s AS (${zone(businessId)}),
        p AS (
          SELECT date_trunc('month', now() AT TIME ZONE tz) AT TIME ZONE tz AS month_start,
            (date_trunc('month', now() AT TIME ZONE tz) - interval '1 month') AT TIME ZONE tz AS last_month_start
          FROM s)
        SELECT
          (SELECT count(*)::int FROM clients c WHERE ${live}) AS total_now,
          (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
            AND c.created_at < p.month_start
            AND (c.archived_at IS NULL OR c.archived_at >= p.month_start) AND ${mine}) AS total_before,
          (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
            AND c.created_at >= p.month_start AND ${mine}) AS new_now,
          (SELECT count(*)::int FROM clients c WHERE c.business_id = ${businessId}::uuid
            AND c.created_at >= p.last_month_start AND c.created_at < p.month_start
            AND ${mine}) AS new_before,
          (SELECT count(*)::int FROM clients c WHERE ${live}
            AND c.status IN ('ACTIVE', 'IN_PROGRESS')) AS active,
          (SELECT count(*)::int FROM clients c WHERE ${live} AND c.status = 'NEW') AS stage_new,
          (SELECT count(*)::int FROM clients c WHERE ${live} AND EXISTS (
            SELECT 1 FROM document_requests d WHERE d.business_id = c.business_id
              AND d.client_id = c.id AND d.status IN ('REQUESTED', 'REJECTED'))) AS pending_docs,
          (SELECT count(*)::int FROM clients c WHERE ${live} AND EXISTS (
            SELECT 1 FROM invoices i WHERE i.business_id = c.business_id AND i.client_id = c.id
              AND i.status = 'OPEN' AND i.total_cents > app_invoice_paid_cents(i.id))) AS balances,
          (SELECT count(*)::int FROM clients c WHERE ${live} AND c.status = 'INACTIVE') AS inactive
        FROM p`;
      const byService = await tx.$queryRaw<(ClientServiceRef & { count: number })[]>`
        SELECT sv.id::text AS id, sv.name, sv.kind::text AS kind,
          count(DISTINCT c.id)::int AS count
        FROM services sv
        LEFT JOIN engagements e ON e.business_id = sv.business_id AND e.service_id = sv.id
          AND e.status IN ('PENDING', 'ACTIVE')
        LEFT JOIN clients c ON c.business_id = e.business_id AND c.id = e.client_id
          AND c.archived_at IS NULL AND ${mine}
        WHERE sv.business_id = ${businessId}::uuid AND sv.archived_at IS NULL
        GROUP BY sv.id, sv.name, sv.kind
        ORDER BY sv.name, sv.id
        LIMIT 100`;
      if (!counts) throw new Error('clients summary returned no row');
      return { counts, byService };
    });
    await this.audit.log('clients.summary_viewed', { type: 'client' });
    const c = counts;
    const kpi = (value: number, previous: number | null) => ({ value, previous });
    return {
      kpis: {
        totalClients: kpi(c.total_now, c.total_before),
        newClients: kpi(c.new_now, c.new_before),
        activeClients: kpi(c.active, null),
        pendingDocuments: kpi(c.pending_docs, null),
        balancesDue: kpi(c.balances, null),
        inactiveClients: kpi(c.inactive, null),
      },
      counts: {
        all: c.total_now,
        active: c.active,
        new: c.stage_new,
        inactive: c.inactive,
        byService,
      },
    };
  }

  /**
   * Owner and Admin (the route says so): assign, archive or restore up to 100 clients. Each one
   * goes through the same path as a single change (its lock, checks and audit entry); one whose
   * state refuses the change (CLIENT_ARCHIVED for ASSIGN) is skipped with its code and the rest
   * still change. An id that is not one of the firm's clients, or a new assignee who is not an
   * active member of the firm, refuses the whole request (404) before anything changes, and the
   * answer never says which id.
   */
  async bulk(
    businessId: string,
    actor: ClientsActor,
    body: BulkBody,
  ): Promise<BulkClientsResponse> {
    if (actor.role === 'STAFF') throw forbidden();
    const ids = [...new Set(body.clientIds)];
    const reachable = await this.database.forBusiness(businessId).client.count({
      where: { AND: [{ businessId, id: { in: ids } }, this.reach(actor)] },
    });
    if (reachable !== ids.length) throw notFound();
    if (body.action === 'ASSIGN' && body.assignedUserId) {
      const userId = body.assignedUserId;
      await this.inFirm(businessId, (tx) => this.activeMember(tx, businessId, userId));
    }
    let updated = 0;
    const skipped: BulkClientsResponse['skipped'] = [];
    for (const id of ids) {
      try {
        if (body.action === 'ASSIGN') {
          await this.update(businessId, actor, id, { assignedUserId: body.assignedUserId });
        } else {
          await this.setArchived(businessId, actor, id, body.action === 'ARCHIVE');
        }
        updated += 1;
      } catch (e) {
        if (!(e instanceof NotFoundException) && !(e instanceof ConflictException)) throw e;
        const code = (e.getResponse() as { code?: string }).code ?? 'CONFLICT';
        skipped.push({ clientId: id, code });
      }
    }
    await this.audit.log(
      'clients.bulk_changed',
      { type: 'client' },
      { action: body.action, updated, skipped: skipped.length },
    );
    return { updated, skipped };
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<ClientRecord> {
    const row = await this.inFirm(businessId, (tx) => this.find(tx, businessId, actor, id));
    await this.audit.log('client.viewed', { type: 'client', id });
    return this.record(businessId, row);
  }

  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<ClientRecord> {
    if (actor.role === 'STAFF' && body.assignedUserId) throw forbidden();
    const profile = body.profile ? profileData(body.profile) : {};
    const assignedUserId = actor.role === 'STAFF' ? actor.userId : (body.assignedUserId ?? null);
    // Sealed before the transaction, to the id the client is then created with.
    const id = uuidv7();
    const secrets = body.profile ? await secretColumns(this.fe, businessId, id, body.profile) : {};
    const row = await this.write(businessId, async (tx) => {
      if (assignedUserId) await this.activeMember(tx, businessId, assignedUserId);
      await this.uniqueEmail(tx, businessId, body.email ?? null);
      const client = await tx.client.create({
        data: {
          id,
          businessId,
          accountType: body.accountType,
          displayName: body.displayName,
          email: body.email ?? null,
          phone: body.phone ?? null,
          assignedUserId,
        },
        select: { id: true },
      });
      await tx.clientProfile.create({
        data: {
          businessId,
          clientId: client.id,
          ...profile,
          ...secrets,
        } as Prisma.ClientProfileUncheckedCreateInput,
      });
      return this.find(tx, businessId, actor, client.id);
    });
    await this.audit.log(
      'client.created',
      { type: 'client', id: row.id },
      {
        fields: Object.keys(body).sort(),
        profileFields: changedFields(body.profile ?? {}),
      },
    );
    return this.record(businessId, row, { dateOfBirth: body.profile?.dateOfBirth ?? null });
  }

  async update(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: UpdateBody,
  ): Promise<ClientRecord> {
    if (actor.role === 'STAFF' && body.assignedUserId !== undefined) throw forbidden();
    const data = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined));
    const row = await this.write(businessId, async (tx) => {
      const current = await this.findForChange(tx, businessId, actor, id);
      if (current.archivedAt) throw archived();
      if (body.assignedUserId) await this.activeMember(tx, businessId, body.assignedUserId);
      if (body.email !== undefined && body.email !== current.email) {
        await this.uniqueEmail(tx, businessId, body.email);
      }
      await tx.client.update({ where: { businessId_id: { businessId, id } }, data });
      // A new assignee: the open tasks the previous Staff assignee held move along (R12).
      const before = current.assignedMember?.userId ?? null;
      const reassigned = body.assignedUserId !== undefined && body.assignedUserId !== before;
      const tasksMoved = reassigned
        ? await reassignClientTasks(tx, businessId, id, before, body.assignedUserId ?? null)
        : undefined;
      return { row: await this.find(tx, businessId, actor, id), tasksMoved };
    });
    await this.audit.log(
      'client.updated',
      { type: 'client', id },
      {
        fields: Object.keys(data).sort(),
        ...(row.tasksMoved === undefined ? {} : { tasksMoved: row.tasksMoved }),
      },
    );
    return this.record(businessId, row.row, {});
  }

  /**
   * The firm's edit of the client's profile. SSN, EIN and date of birth are stored only through
   * the field-encryption helper; the response has SSN and EIN as their last 4 digits and the
   * date of birth in full. The audit names the fields, never a value.
   */
  async updateProfile(
    businessId: string,
    actor: ClientsActor,
    id: string,
    body: ProfileBody,
  ): Promise<ClientProfile> {
    // Reach and archive first; seal outside any transaction; then write under the client's lock
    // (checked again there: an archive or reassignment may have committed meanwhile).
    const reachable = await this.inFirm(businessId, (tx) => this.find(tx, businessId, actor, id));
    if (reachable.archivedAt) throw archived();
    const secrets = await secretColumns(this.fe, businessId, reachable.id, body);
    const row = await this.inFirm(businessId, async (tx) => {
      const current = await this.findForChange(tx, businessId, actor, id);
      if (current.archivedAt) throw archived();
      const data = { ...profileData(body), ...secrets };
      await tx.clientProfile.upsert({
        where: { clientId: current.id },
        create: {
          businessId,
          clientId: current.id,
          ...data,
        } as Prisma.ClientProfileUncheckedCreateInput,
        update: data,
      });
      return this.find(tx, businessId, actor, id);
    });
    await this.audit.log(
      'client.profile_updated',
      { type: 'client', id },
      { fields: changedFields(body) },
    );
    return (await this.record(businessId, row, { dateOfBirth: body.dateOfBirth })).profile;
  }

  /** Owner and Admin (the route says so). Hidden from the default list; never deleted. */
  async archive(businessId: string, actor: ClientsActor, id: string): Promise<ClientRecord> {
    return this.setArchived(businessId, actor, id, true);
  }

  async restore(businessId: string, actor: ClientsActor, id: string): Promise<ClientRecord> {
    return this.setArchived(businessId, actor, id, false);
  }

  private async setArchived(
    businessId: string,
    actor: ClientsActor,
    id: string,
    archive: boolean,
  ): Promise<ClientRecord> {
    const { row, changed } = await this.inFirm(businessId, async (tx) => {
      const current = await this.findForChange(tx, businessId, actor, id);
      if (!!current.archivedAt === archive) return { row: current, changed: false };
      await tx.client.update({
        where: { businessId_id: { businessId, id } },
        data: { archivedAt: archive ? new Date() : null },
      });
      return { row: await this.find(tx, businessId, actor, id), changed: true };
    });
    // Nothing changed: the answer is still a read of the client's record (its date of birth).
    if (!changed) {
      await this.audit.log('client.viewed', { type: 'client', id });
      return this.record(businessId, row);
    }
    await this.audit.log(archive ? 'client.archived' : 'client.restored', { type: 'client', id });
    return this.record(businessId, row, {});
  }

  /** A change in the firm's scope; a unique email collision becomes 409 DUPLICATE_EMAIL. */
  private async write<T>(businessId: string, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    try {
      return await this.inFirm(businessId, fn);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw duplicateEmail();
      throw e;
    }
  }

  private async find(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<RecordRow> {
    const row = await tx.client.findFirst({
      where: { AND: [{ businessId, id }, this.reach(actor)] },
      select: recordSelect,
    });
    if (!row) throw notFound();
    return row;
  }

  /**
   * `find` for a change: the client's row is locked first, so an archive or a reassignment at
   * the same time waits for this change (or has committed and is seen here). Without it, a
   * change read before an archive or reassignment could still land after it. FOR NO KEY UPDATE,
   * not FOR UPDATE: it does not conflict with the FOR KEY SHARE that adding a row under the
   * client takes (the foreign key check), so neither waits for the other.
   */
  private async findForChange(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<RecordRow> {
    await tx.$queryRaw`
      SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR NO KEY UPDATE`;
    return this.find(tx, businessId, actor, id);
  }

  /** The assignee is an active member of this firm (another firm's or a former member is 404). */
  private async activeMember(tx: TxClient, businessId: string, userId: string): Promise<void> {
    const member = await tx.membership.findFirst({
      where: { businessId, userId, status: 'ACTIVE' },
      select: { id: true },
    });
    if (!member) throw notFound();
  }

  /**
   * One email per firm, archived clients included (the unique index from R0 is the last line).
   * Changes to a firm's client emails run one at a time, so two at once cannot both pass.
   */
  private async uniqueEmail(tx: TxClient, businessId: string, email: string | null): Promise<void> {
    if (!email) return;
    await lockClientEmails(tx, businessId);
    const taken = await tx.client.findFirst({ where: { businessId, email }, select: { id: true } });
    if (taken) throw duplicateEmail();
  }
}
