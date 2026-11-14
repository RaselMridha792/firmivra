import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { databaseErrorCode, type Database, type TxClient } from '@firmivra/db';
import {
  AddClientLinkRequest,
  ClientId,
  type ClientLink,
  type ClientLinkList,
  type OkResponse,
  UpdateClientLinkRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

// Clients Review 2 (G9, the lead's approval of Nov 14): linked client profiles. A link joins two
// clients of the firm, e.g. a Business and its owner's Personal profile; one row per pair, both
// profiles list it. Staff reach a link only when both clients are assigned to them (404
// otherwise). Each change is audited with ids and the role only, never a name or the note.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const conflict = (code: string, message: string) => new ConflictException({ code, message });

const OTHER = {
  id: true,
  displayName: true,
  accountType: true,
  clientNumber: true,
  archivedAt: true,
} as const;
const LINK = {
  id: true,
  clientId: true,
  linkedClientId: true,
  role: true,
  note: true,
  createdAt: true,
  client: { select: OTHER },
  linkedClient: { select: OTHER },
} as const;

type Row = {
  id: string;
  clientId: string;
  linkedClientId: string;
  role: ClientLink['role'];
  note: string | null;
  createdAt: Date;
  client: Other;
  linkedClient: Other;
};
type Other = {
  id: string;
  displayName: string;
  accountType: ClientLink['other']['accountType'];
  clientNumber: number;
  archivedAt: Date | null;
};

/** The link as `clientId`'s profile reads it. */
function toLink(row: Row, clientId: string): ClientLink {
  const added = row.clientId === clientId;
  const other = added ? row.linkedClient : row.client;
  return {
    id: row.id,
    other: {
      id: other.id,
      displayName: other.displayName,
      accountType: other.accountType,
      clientNumber: `CL-${other.clientNumber}`,
      archived: !!other.archivedAt,
    },
    role: row.role,
    side: added ? 'LINKED' : 'ADDED_TO',
    note: row.note,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class ClientLinksService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    if (tenant.kind !== 'staff') throw new Error('client links are for firm members');
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  /** Which clients the member reaches: Staff, their own; Owner and Admin, all of the firm's. */
  private reach(tenant: TenantContext, userId: string) {
    return legacyFirmRole(tenant.role) === 'STAFF' ? { assignedUserId: userId } : {};
  }

  private async client(tx: TxClient, tenant: TenantContext, userId: string, id: string) {
    const row = await tx.client.findFirst({
      where: { businessId: tenant.businessId, id, ...this.reach(tenant, userId) },
      select: { id: true, archivedAt: true },
    });
    if (!row) throw notFound();
    return row;
  }

  /** The link on this client, with the other client also in reach, or 404. */
  private async link(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    clientId: string,
    linkId: string,
  ): Promise<Row> {
    const reach = this.reach(tenant, userId);
    const row = await tx.clientLink.findFirst({
      where: {
        businessId: tenant.businessId,
        id: linkId,
        OR: [{ clientId }, { linkedClientId: clientId }],
        client: reach,
        linkedClient: reach,
      },
      select: LINK,
    });
    if (!row) throw notFound();
    return row;
  }

  async list(tenant: TenantContext, userId: string, clientId: string): Promise<ClientLinkList> {
    const items = await this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const reach = this.reach(tenant, userId);
      // Staff see only the links whose other client is theirs too.
      const rows = await tx.clientLink.findMany({
        where: {
          businessId: tenant.businessId,
          OR: [
            { clientId, linkedClient: reach },
            { linkedClientId: clientId, client: reach },
          ],
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 200,
        select: LINK,
      });
      return rows.map((r) => toLink(r, clientId));
    });
    await this.audit.log(
      'client.links_viewed',
      { type: 'client', id: clientId },
      { count: items.length },
    );
    return { items };
  }

  async add(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    body: z.output<typeof AddClientLinkRequest>,
  ): Promise<ClientLink> {
    if (body.linkedClientId === clientId) {
      throw new BadRequestException({
        code: 'SELF_LINK',
        message: 'A client cannot be linked to itself',
      });
    }
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const [one, other] = [
        await this.client(tx, tenant, userId, clientId),
        await this.client(tx, tenant, userId, body.linkedClientId),
      ];
      if (one.archivedAt || other.archivedAt) {
        throw conflict('CLIENT_ARCHIVED', 'Restore the archived client first');
      }
      const created = await tx.clientLink
        .create({
          data: {
            businessId,
            clientId,
            linkedClientId: body.linkedClientId,
            role: body.role,
            note: body.note ?? null,
            createdByUserId: userId,
          },
          select: LINK,
        })
        .catch((error: unknown) => {
          // The pair index: one link per pair, whichever side added it.
          if (databaseErrorCode(error) === '23505') {
            throw conflict('ALREADY_LINKED', 'These clients are already linked');
          }
          throw error;
        });
      await this.audit.logIn(
        tx,
        'client.link_added',
        { type: 'client', id: clientId },
        { linkId: created.id, linkedClientId: body.linkedClientId, role: body.role },
        { businessId },
      );
      return toLink(created, clientId);
    });
  }

  async update(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    linkId: string,
    body: z.output<typeof UpdateClientLinkRequest>,
  ): Promise<ClientLink> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const row = await this.link(tx, tenant, userId, clientId, linkId);
      const note = body.note === undefined ? undefined : body.note || null;
      const updated = await tx.clientLink.update({
        where: { id: row.id },
        data: {
          ...(body.role ? { role: body.role } : {}),
          ...(note !== undefined ? { note } : {}),
        },
        select: LINK,
      });
      await this.audit.logIn(
        tx,
        'client.link_changed',
        { type: 'client', id: clientId },
        {
          linkId: row.id,
          fields: [body.role ? 'role' : null, note !== undefined ? 'note' : null].filter(Boolean),
          ...(body.role ? { from: row.role, to: body.role } : {}),
        },
        { businessId },
      );
      return toLink(updated, clientId);
    });
  }

  async remove(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    linkId: string,
  ): Promise<OkResponse> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      const row = await this.link(tx, tenant, userId, clientId, linkId);
      await tx.clientLink.delete({ where: { id: row.id } });
      await this.audit.logIn(
        tx,
        'client.link_removed',
        { type: 'client', id: clientId },
        {
          linkId: row.id,
          linkedClientId: row.clientId === clientId ? row.linkedClientId : row.clientId,
          role: row.role,
        },
        { businessId },
      );
      return { ok: true as const };
    });
  }
}

const idPipe = new ZodValidationPipe(ClientId);

/** /business/clients/{id}/links (contract in packages/types/src/clients/links.ts). */
@Controller('business/clients')
@Access('CLIENTS')
@Roles(...FIRM_STAFF)
export class ClientLinksController {
  constructor(private readonly links: ClientLinksService) {}

  @Get(':id/links')
  list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
  ): Promise<ClientLinkList> {
    return this.links.list(tenant, auth.userId, id);
  }

  @Post(':id/links')
  add(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Body(new ZodValidationPipe(AddClientLinkRequest))
    body: z.output<typeof AddClientLinkRequest>,
  ): Promise<ClientLink> {
    return this.links.add(tenant, auth.userId, id, body);
  }

  @Patch(':id/links/:linkId')
  update(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('linkId', idPipe) linkId: string,
    @Body(new ZodValidationPipe(UpdateClientLinkRequest))
    body: z.output<typeof UpdateClientLinkRequest>,
  ): Promise<ClientLink> {
    return this.links.update(tenant, auth.userId, id, linkId, body);
  }

  @Delete(':id/links/:linkId')
  remove(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', idPipe) id: string,
    @Param('linkId', idPipe) linkId: string,
  ): Promise<OkResponse> {
    return this.links.remove(tenant, auth.userId, id, linkId);
  }
}
