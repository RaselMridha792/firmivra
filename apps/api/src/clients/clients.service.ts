import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Database, Prisma, TxClient } from '@firmivra/db';
import type {
  ClientListItem,
  ClientRecord,
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

type ListQuery = z.output<typeof ListClientsQuery>;
type CreateBody = z.output<typeof CreateClientRequest>;
type UpdateBody = z.output<typeof UpdateClientRequest>;
type ProfileBody = z.output<typeof UpdateClientProfileRequest>;

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

/** SSN, EIN and date of birth are stored through the field-encryption helper from step 4. */
const sensitiveNotReady = () =>
  new HttpException(
    {
      code: 'NOT_IMPLEMENTED',
      message:
        'SSN, EIN and date of birth can be saved soon. Save the client without them for now.',
    },
    HttpStatus.NOT_IMPLEMENTED,
  );

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

function toRecord(row: RecordRow): ClientRecord {
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
      // Decrypted through the field-encryption helper from R10 step 4; nothing stores it before.
      dateOfBirth: null,
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

/** The profile columns of a request, without the encrypted fields (step 4). */
function profileData(body: ProfileBody): Prisma.ClientProfileUncheckedUpdateInput {
  if (body.ssn !== undefined || body.ein !== undefined || body.dateOfBirth !== undefined) {
    throw sensitiveNotReady();
  }
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
  ) {}

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
    const where: Prisma.ClientWhereInput = {
      AND: [
        { businessId },
        this.reach(actor),
        q.status === 'active' ? { archivedAt: null } : {},
        q.status === 'archived' ? { archivedAt: { not: null } } : {},
        q.assignedUserId ? { assignedUserId: q.assignedUserId } : {},
        term
          ? {
              OR: [
                { displayName: { contains: term, mode: 'insensitive' } },
                { email: { contains: term, mode: 'insensitive' } },
                { phone: { contains: term, mode: 'insensitive' } },
              ],
            }
          : {},
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
    const rows = await this.database.forBusiness(businessId).client.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: q.limit + 1,
      select: listSelect,
    });
    const page = rows.slice(0, q.limit);
    const last = page.at(-1);
    await this.audit.log('clients.listed', { type: 'client' }, { count: page.length });
    return {
      items: page.map(toListItem),
      nextCursor: rows.length > q.limit && last ? encodeCursor(last) : null,
    };
  }

  async get(businessId: string, actor: ClientsActor, id: string): Promise<ClientRecord> {
    const row = await this.inFirm(businessId, (tx) => this.find(tx, businessId, actor, id));
    await this.audit.log('client.viewed', { type: 'client', id });
    return toRecord(row);
  }

  async create(businessId: string, actor: ClientsActor, body: CreateBody): Promise<ClientRecord> {
    if (actor.role === 'STAFF' && body.assignedUserId) throw forbidden();
    const profile = body.profile ? profileData(body.profile) : {};
    const assignedUserId = actor.role === 'STAFF' ? actor.userId : (body.assignedUserId ?? null);
    const row = await this.write(businessId, async (tx) => {
      if (assignedUserId) await this.activeMember(tx, businessId, assignedUserId);
      await this.uniqueEmail(tx, businessId, body.email ?? null);
      const client = await tx.client.create({
        data: {
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
        } as Prisma.ClientProfileUncheckedCreateInput,
      });
      return this.find(tx, businessId, actor, client.id);
    });
    await this.audit.log(
      'client.created',
      { type: 'client', id: row.id },
      {
        fields: Object.keys(body).sort(),
        profileFields: Object.keys(profile).sort(),
      },
    );
    return toRecord(row);
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
      return this.find(tx, businessId, actor, id);
    });
    await this.audit.log(
      'client.updated',
      { type: 'client', id },
      { fields: Object.keys(data).sort() },
    );
    return toRecord(row);
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
    if (changed) {
      await this.audit.log(archive ? 'client.archived' : 'client.restored', { type: 'client', id });
    }
    return toRecord(row);
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
   * change read before an archive or reassignment could still land after it.
   */
  private async findForChange(
    tx: TxClient,
    businessId: string,
    actor: ClientsActor,
    id: string,
  ): Promise<RecordRow> {
    await tx.$queryRaw`
      SELECT 1 FROM clients WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid
      FOR UPDATE`;
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
