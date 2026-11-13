import { Controller, Get, Inject, Injectable, NotFoundException, Param } from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  ClientId,
  type ClientService,
  type ClientServiceList,
  type ClientServiceWorkspace,
  type ServiceKind,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { Access, CurrentAuth, CurrentTenant, FIRM_STAFF, Roles } from '../auth/decorators.js';
import { type AuthContext, legacyFirmRole, type TenantContext } from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { memberNames, memberRef } from '../workspaces/common.js';

// Octavia's E4 (Clients review, Oct 25): the client's services on the profile, each with the
// module record that opens it, so the Services tab, Overview's Active Services and the service
// tabs (Tax Returns, Bookkeeping, Payroll, Tax Planning, Advisory) come "by enrollment,
// configuration and permission". Read only; Staff reach the clients assigned to them.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });

type Module = ClientServiceWorkspace['module'];
const MODULE: Partial<Record<ServiceKind, Module>> = {
  ANNUAL_TAX: 'TAX_RETURNS',
  QUARTERLY_TAX: 'TAX_RETURNS',
  BOOKKEEPING: 'BOOKKEEPING',
  PAYROLL: 'PAYROLL',
  TAX_PLANNING: 'TAX_PLANNING',
  BUSINESS_DEVELOPMENT: 'BUSINESS_ADVISORY',
};
/** An advisory workstream the client is enrolled in (Octavia's E3). */
const ENROLLED = ['ACCEPTED', 'IN_PROGRESS', 'AWAITING_CLIENT', 'ON_HOLD'] as const;

@Injectable()
export class ClientServicesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  async list(tenant: TenantContext, userId: string, clientId: string): Promise<ClientService[]> {
    if (tenant.kind !== 'staff') throw new Error('client services are for firm members');
    const businessId = tenant.businessId;
    const role = legacyFirmRole(tenant.role);
    // The member's own grid decides which modules open (one check per module).
    const allowed = new Map<Module, boolean>();
    const may = async (m: Module) => {
      if (!allowed.has(m)) allowed.set(m, await this.grants.canTenant(tenant, m, 'VIEW'));
      return allowed.get(m)!;
    };
    const items = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const client = await tx.client.findFirst({
        where: {
          businessId,
          id: clientId,
          ...(role === 'STAFF' ? { assignedUserId: userId } : {}),
        },
        select: { id: true },
      });
      if (!client) throw notFound();
      const engagements = await tx.engagement.findMany({
        where: { businessId, clientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          assignedUserId: true,
          service: { select: { id: true, name: true, kind: true } },
        },
      });
      const ids = engagements.map((e) => e.id);
      const [returns, books, payroll, advisory, plan] = await Promise.all([
        tx.taxReturn.findMany({
          where: { businessId, clientId, engagementId: { in: ids }, archivedAt: null },
          orderBy: [{ taxYear: 'desc' }, { createdAt: 'desc' }],
          select: { id: true, engagementId: true },
        }),
        tx.bookkeepingProfile.findMany({
          where: { businessId, engagementId: { in: ids } },
          select: { id: true, engagementId: true },
        }),
        tx.payrollClient.findMany({
          where: { businessId, engagementId: { in: ids }, archivedAt: null },
          select: { id: true, engagementId: true },
        }),
        tx.advisoryClient.findFirst({
          where: { businessId, clientId, archivedAt: null },
          select: {
            id: true,
            workstreams: {
              where: { status: { in: [...ENROLLED] } },
              orderBy: { createdAt: 'desc' },
              select: {
                id: true,
                createdAt: true,
                service: { select: { id: true, name: true, kind: true } },
              },
            },
          },
        }),
        tx.taxPlan.findFirst({
          where: { businessId, clientId, archivedAt: null },
          orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
          select: { id: true },
        }),
      ]);
      const first = <T extends { engagementId: string | null }>(rows: T[], id: string) =>
        rows.find((r) => r.engagementId === id);
      const recordOf = (module: Module, engagementId: string | null): string | null => {
        if (module === 'TAX_RETURNS')
          return engagementId ? (first(returns, engagementId)?.id ?? null) : null;
        if (module === 'BOOKKEEPING')
          return engagementId ? (first(books, engagementId)?.id ?? null) : null;
        if (module === 'PAYROLL')
          return engagementId ? (first(payroll, engagementId)?.id ?? null) : null;
        if (module === 'BUSINESS_ADVISORY') return advisory?.id ?? null;
        if (module === 'TAX_PLANNING') return plan?.id ?? null;
        return null;
      };
      const workspace = async (kind: ServiceKind, engagementId: string | null) => {
        const module = MODULE[kind];
        if (!module || !(await may(module))) return null;
        return { module, id: recordOf(module, engagementId) };
      };
      const names = await memberNames(
        tx,
        businessId,
        engagements.map((e) => e.assignedUserId),
      );
      const out: ClientService[] = [];
      for (const e of engagements) {
        out.push({
          id: e.id,
          service: e.service,
          title: e.title,
          status: e.status,
          since: e.createdAt.toISOString(),
          assignedTo: memberRef(names, e.assignedUserId),
          workspace: await workspace(e.service.kind, e.id),
        });
      }
      // E3: an advisory enrollment counts as the service, unless an engagement already shows it.
      const shown = new Set(engagements.map((e) => e.service.id));
      for (const w of advisory?.workstreams ?? []) {
        if (shown.has(w.service.id)) continue;
        shown.add(w.service.id);
        out.push({
          id: w.id,
          service: w.service,
          title: w.service.name,
          status: 'ACTIVE',
          since: w.createdAt.toISOString(),
          assignedTo: null,
          workspace: await workspace(w.service.kind, null),
        });
      }
      return out;
    });
    await this.audit.log('client_services.viewed', { type: 'client', id: clientId });
    return items;
  }
}

/** GET /business/clients/{id}/services (contract in packages/types/src/clients/services.ts). */
@Controller('business/clients')
@Access('CLIENTS')
export class ClientServicesController {
  constructor(private readonly services: ClientServicesService) {}

  @Get(':id/services')
  @Roles(...FIRM_STAFF)
  async list(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ): Promise<ClientServiceList> {
    return { items: await this.services.list(tenant, auth.userId, id) };
  }
}
