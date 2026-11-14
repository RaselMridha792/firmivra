import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  Put,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import { ClientId, type ClientOffice, SetClientOfficeRequest } from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';

// PRT-1 part 2 (Client Portal guide 2, 7.4 and 9.1, on R1's clients.office_id): the client's local
// office on their profile. Anyone who may see the client sees it; an Owner or Admin changes it to
// one of the firm's active locations, audited with the old and new office.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const notAvailable = () =>
  new BadRequestException({
    code: 'OFFICE_NOT_AVAILABLE',
    message: 'Choose one of the firm’s active locations.',
  });

const OFFICE = {
  id: true,
  name: true,
  status: true,
  archivedAt: true,
  addressLine1: true,
  addressLine2: true,
  city: true,
  state: true,
  postalCode: true,
} as const;
type Office = {
  id: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
};

const text = (value: string | null) => value?.trim() || null;
/** "1 Main St", "Suite 2", "Auburn, GA 30011": only the parts that are set. */
function addressLines(o: Office): string[] {
  const place = [text(o.city), [text(o.state), text(o.postalCode)].filter(Boolean).join(' ')]
    .filter(Boolean)
    .join(', ');
  return [text(o.addressLine1), text(o.addressLine2), place].filter((l): l is string => !!l);
}
const choice = (o: Office) => ({ id: o.id, name: o.name, addressLines: addressLines(o) });

@Injectable()
export class ClientOfficeService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  /** The client as the member may see it (Staff: assigned to them), or 404. */
  private async client(tx: TxClient, tenant: TenantContext, userId: string, clientId: string) {
    const client = await tx.client.findFirst({
      where: {
        businessId: tenant.businessId,
        id: clientId,
        ...(legacyFirmRole(tenant.role) === 'STAFF' ? { assignedUserId: userId } : {}),
      },
      select: { id: true, officeId: true },
    });
    if (!client) throw notFound();
    return client;
  }

  private async read(
    tx: TxClient,
    tenant: TenantContext,
    clientId: string,
    officeId: string | null,
  ) {
    const businessId = tenant.businessId;
    const [current, account, choices] = await Promise.all([
      officeId
        ? tx.firmOffice.findFirst({ where: { businessId, id: officeId }, select: OFFICE })
        : null,
      tx.clientAccount.findFirst({
        where: { businessId, clientId, portalRole: 'PRIMARY', selectedOfficeId: { not: null } },
        select: { selectedOffice: { select: { id: true, name: true } } },
      }),
      tx.firmOffice.findMany({
        where: { businessId, status: 'ACTIVE', archivedAt: null },
        orderBy: [{ isMain: 'desc' }, { name: 'asc' }, { id: 'asc' }],
        take: 200,
        select: OFFICE,
      }),
    ]);
    const role = legacyFirmRole(tenant.role);
    return {
      office: current
        ? { ...choice(current), active: current.status === 'ACTIVE' && !current.archivedAt }
        : null,
      chosenAtSignUp: account?.selectedOffice ?? null,
      choices: choices.map(choice),
      canChange: role === 'OWNER' || role === 'ADMIN',
    } satisfies ClientOffice;
  }

  async get(tenant: TenantContext, userId: string, clientId: string): Promise<ClientOffice> {
    if (tenant.kind !== 'staff') throw new Error('client office is for firm members');
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const client = await this.client(tx, tenant, userId, clientId);
        return this.read(tx, tenant, client.id, client.officeId);
      },
    );
  }

  /** Owner and Admin: one of the active locations, or none. The same office changes nothing. */
  async set(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    officeId: string | null,
  ): Promise<ClientOffice> {
    if (tenant.kind !== 'staff') throw new Error('client office is for firm members');
    const businessId = tenant.businessId;
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const client = await this.client(tx, tenant, userId, clientId);
      if (officeId) {
        const office = await tx.firmOffice.findFirst({
          where: { businessId, id: officeId, status: 'ACTIVE', archivedAt: null },
          select: { id: true },
        });
        if (!office) throw notAvailable();
      }
      if (client.officeId !== officeId) {
        await tx.client.update({ where: { id: client.id }, data: { officeId } });
        await this.audit.logIn(
          tx,
          'client.office_changed',
          { type: 'client', id: client.id },
          { from: client.officeId, to: officeId },
          { businessId },
        );
      }
      return this.read(tx, tenant, client.id, officeId);
    });
  }
}

/** GET and PUT /business/clients/{id}/office (contract in packages/types/src/clients/office.ts). */
@Controller('business/clients')
@Access('CLIENTS')
export class ClientOfficeController {
  constructor(private readonly offices: ClientOfficeService) {}

  @Get(':id/office')
  @Roles(...FIRM_STAFF)
  get(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ): Promise<ClientOffice> {
    return this.offices.get(tenant, auth.userId, id);
  }

  @Put(':id/office')
  @Roles(...FIRM_MANAGERS)
  set(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Body(new ZodValidationPipe(SetClientOfficeRequest)) body: SetClientOfficeRequest,
  ): Promise<ClientOffice> {
    return this.offices.set(tenant, auth.userId, id, body.officeId);
  }
}
