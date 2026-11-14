import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  ClientId,
  type ClientPortalAccessResult,
  type ClientPortalDocumentsSummary,
  type ClientPortalFormsSummary,
  type ClientPortalVisibility,
  PortalModule,
  UpdateClientPortalVisibilityRequest,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import {
  Access,
  CurrentAuth,
  CurrentTenant,
  FIRM_MANAGERS,
  FIRM_STAFF,
  Roles,
} from '../auth/decorators.js';
import { IDENTITY_PROVIDER, type IdentityProvider } from '../auth/identity/identity-provider.js';
import { SignInModule } from '../auth/sign-in.controller.js';
import {
  type AuthContext,
  legacyFirmRole,
  requestContext,
  type TenantContext,
} from '../common/request-context.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { DATABASE } from '../database/database.module.js';
import { recordStaffActivity } from './portal-activity.js';
import { PortalTabsModule, PortalTabsService } from './portal-tabs.js';

// The Client Portal module, API part 2 (Client Portal developer instructions 15, 16, 18, 20 and
// 26): Portal Content & Visibility, Deactivate and Reactivate Portal, Reset Client Access, MFA
// reset, and the Documents and Intake Forms tabs' KPIs. Every change is Owner and Admin, audited
// and shown in the client's portal activity; reads are anyone who may see the client (Staff: their
// own). Nothing is ever deleted: a hidden area, a deactivated login and their records stay.

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Not found' });
const DEACTIVATED = 'client_portal.deactivated';

@Injectable()
export class PortalAccessService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(IDENTITY_PROVIDER) private readonly identity: IdentityProvider,
    private readonly audit: AuditService,
    private readonly tabs: PortalTabsService,
  ) {}

  async visibility(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalVisibility> {
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      return this.areas(tx, tenant, clientId);
    });
  }

  /** Only the areas sent change; the same value again writes nothing. */
  async setVisibility(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    changes: Partial<Record<PortalModule, boolean>>,
  ): Promise<ClientPortalVisibility> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId, true);
      const before = await this.tabs.areasIn(tx, clientId);
      const shown: PortalModule[] = [];
      const hidden: PortalModule[] = [];
      for (const module of PortalModule.options) {
        const visible = changes[module];
        if (visible === undefined || visible === before[module].clientOn) continue;
        (visible ? shown : hidden).push(module);
        await tx.portalModuleVisibility.deleteMany({ where: { clientId, module } });
        await tx.portalModuleVisibility.create({
          data: { businessId, clientId, module, visible, changedByUserId: userId },
        });
      }
      if (shown.length + hidden.length > 0) {
        await this.audit.logIn(
          tx,
          'client_portal.visibility_changed',
          { type: 'client', id: clientId },
          { shown, hidden },
          { businessId },
        );
        await this.activity(tx, tenant, clientId, userId, 'portal.visibility_changed');
      }
      return this.areas(tx, tenant, clientId);
    });
  }

  /** Every ACTIVE login DISABLED at once: refused at sign-in and on every portal request. */
  async deactivate(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalAccessResult> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId, true);
      const active = await tx.clientAccount.findMany({
        where: { clientId, status: 'ACTIVE' },
        select: { id: true },
      });
      if (active.length === 0) {
        throw new ConflictException({
          code: 'NO_ACTIVE_LOGIN',
          message: 'This client has no active portal login.',
        });
      }
      const ids = active.map((a) => a.id);
      await tx.clientAccount.updateMany({
        where: { id: { in: ids } },
        data: { status: 'DISABLED' },
      });
      await this.audit.logIn(
        tx,
        DEACTIVATED,
        { type: 'client', id: clientId },
        { clientAccountIds: ids },
        { businessId },
      );
      await this.activity(tx, tenant, clientId, userId, 'portal.deactivated');
      return { changed: ids.length };
    });
  }

  /** The logins the latest Deactivate Portal turned off, ACTIVE again (never a declined one). */
  async reactivate(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalAccessResult> {
    const businessId = tenant.businessId;
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId, true);
      const last = await tx.auditLog.findFirst({
        where: { businessId, action: DEACTIVATED, entityType: 'client', entityId: clientId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { metadata: true },
      });
      const listed = (last?.metadata as { clientAccountIds?: unknown } | null)?.clientAccountIds;
      const ids = Array.isArray(listed)
        ? listed.filter((id): id is string => typeof id === 'string')
        : [];
      const { count } = ids.length
        ? await tx.clientAccount.updateMany({
            where: { id: { in: ids }, clientId, status: 'DISABLED' },
            data: { status: 'ACTIVE' },
          })
        : { count: 0 };
      if (count === 0) {
        throw new ConflictException({
          code: 'NOT_DEACTIVATED',
          message: 'This client’s portal was not deactivated here.',
        });
      }
      await this.audit.logIn(
        tx,
        'client_portal.reactivated',
        { type: 'client', id: clientId },
        { count },
        { businessId },
      );
      await this.activity(tx, tenant, clientId, userId, 'portal.reactivated');
      return { changed: count };
    });
  }

  /** Each active login gets the portal's password reset code by email, as from Forgot Password. */
  async resetAccess(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalAccessResult> {
    const subs = await this.activeLogins(tenant, userId, clientId);
    for (const sub of subs) await this.identity.forgotPassword('CLIENT', sub);
    await this.record(
      tenant,
      userId,
      clientId,
      'client_portal.access_reset',
      'portal.access_reset',
      {
        count: subs.length,
      },
    );
    return { changed: subs.length };
  }

  /** Forgets the active logins' authenticator apps; their sessions end. */
  async resetMfa(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalAccessResult> {
    const subs = await this.activeLogins(tenant, userId, clientId);
    for (const sub of subs) await this.identity.resetMfa('CLIENT', sub);
    await this.record(tenant, userId, clientId, 'client_portal.mfa_reset', 'portal.mfa_reset', {
      count: subs.length,
    });
    return { changed: subs.length };
  }

  async documentsSummary(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalDocumentsSummary> {
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const live = { clientId, trashedAt: null, archivedAt: null, supersededAt: null };
      const [total, clientUploaded, firmShared, pendingReview, requested] = await Promise.all([
        tx.document.count({ where: live }),
        tx.document.count({ where: { ...live, direction: 'CLIENT_TO_FIRM' } }),
        tx.document.count({ where: { ...live, direction: 'FIRM_TO_CLIENT' } }),
        tx.document.count({
          where: { ...live, reviewStatus: { in: ['NEEDS_REVIEW', 'IN_REVIEW'] } },
        }),
        tx.documentRequest.count({
          where: { clientId, status: { in: ['REQUESTED', 'REJECTED'] } },
        }),
      ]);
      return { total, clientUploaded, firmShared, pendingReview, requested };
    });
  }

  async formsSummary(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<ClientPortalFormsSummary> {
    return this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      const rows = await tx.intake.groupBy({
        by: ['status'],
        where: { engagement: { clientId }, status: { not: 'DRAFT' } },
        _count: { _all: true },
      });
      const n = (...s: string[]) =>
        rows.filter((r) => s.includes(r.status)).reduce((sum, r) => sum + r._count._all, 0);
      return {
        total: rows.reduce((sum, r) => sum + r._count._all, 0),
        completed: n('COMPLETED'),
        needsReview: n('SUBMITTED', 'UNDER_REVIEW'),
        inProgress: n('IN_PROGRESS', 'NEEDS_CORRECTION'),
        notStarted: n('SENT', 'EXPIRED'),
        archived: n('ARCHIVED'),
      };
    });
  }

  private inFirm<T>(tenant: TenantContext, fn: (tx: TxClient) => Promise<T>): Promise<T> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, fn);
  }

  private manager(tenant: TenantContext): boolean {
    const role = legacyFirmRole(tenant.role);
    return role === 'OWNER' || role === 'ADMIN';
  }

  /** The client as the member may see it (Staff: assigned to them), else 404; held to change. */
  private async client(
    tx: TxClient,
    tenant: TenantContext,
    userId: string,
    clientId: string,
    hold = false,
  ): Promise<void> {
    const staff = legacyFirmRole(tenant.role) === 'STAFF';
    const found = hold
      ? await tx.$queryRaw<{ id: string }[]>`
          SELECT id FROM clients WHERE id = ${clientId}::uuid
            AND (${!staff} OR assigned_user_id = ${userId}::uuid) FOR UPDATE`
      : await tx.client.findMany({
          where: { id: clientId, ...(staff ? { assignedUserId: userId } : {}) },
          select: { id: true },
        });
    if (found.length === 0) throw notFound();
  }

  private async areas(
    tx: TxClient,
    tenant: TenantContext,
    clientId: string,
  ): Promise<ClientPortalVisibility> {
    const areas = await this.tabs.areasIn(tx, clientId);
    return {
      areas: PortalModule.options.map((module) => ({
        module,
        firmOn: areas[module].firmOn,
        clientOn: areas[module].clientOn,
        visible: areas[module].firmOn && areas[module].clientOn,
      })),
      canChange: this.manager(tenant),
    };
  }

  /** The active logins' identity subs, or 409 NO_ACTIVE_LOGIN. */
  private async activeLogins(
    tenant: TenantContext,
    userId: string,
    clientId: string,
  ): Promise<string[]> {
    const accounts = await this.inFirm(tenant, async (tx) => {
      await this.client(tx, tenant, userId, clientId);
      return tx.clientAccount.findMany({
        where: { clientId, status: 'ACTIVE' },
        select: { user: { select: { cognitoSub: true } } },
      });
    });
    if (accounts.length === 0) {
      throw new ConflictException({
        code: 'NO_ACTIVE_LOGIN',
        message: 'This client has no active portal login.',
      });
    }
    return accounts.map((a) => a.user.cognitoSub);
  }

  private record(
    tenant: TenantContext,
    userId: string,
    clientId: string,
    action: string,
    type: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    return this.inFirm(tenant, async (tx) => {
      await this.audit.logIn(tx, action, { type: 'client', id: clientId }, metadata, {
        businessId: tenant.businessId,
      });
      await this.activity(tx, tenant, clientId, userId, type);
    });
  }

  private activity(
    tx: TxClient,
    tenant: TenantContext,
    clientId: string,
    userId: string,
    type: string,
  ): Promise<void> {
    return recordStaffActivity(tx, {
      businessId: tenant.businessId,
      clientId,
      userId,
      type,
      ip: requestContext.getStore()?.ip ?? null,
    });
  }
}

/** The Client Portal module's access actions (contract: packages/types client-portal/visibility.ts). */
@Controller('business/client-portal/clients')
@Access('CLIENT_PORTAL')
export class PortalAccessController {
  constructor(private readonly access: PortalAccessService) {}

  @Get(':id/visibility')
  @Roles(...FIRM_STAFF)
  visibility(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.visibility(tenant, auth.userId, id);
  }

  @Put(':id/visibility')
  @Roles(...FIRM_MANAGERS)
  setVisibility(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
    @Body(new ZodValidationPipe(UpdateClientPortalVisibilityRequest))
    body: z.output<typeof UpdateClientPortalVisibilityRequest>,
  ) {
    return this.access.setVisibility(tenant, auth.userId, id, body.areas);
  }

  @Post(':id/deactivate')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  deactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.deactivate(tenant, auth.userId, id);
  }

  @Post(':id/reactivate')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  reactivate(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.reactivate(tenant, auth.userId, id);
  }

  @Post(':id/reset-access')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  resetAccess(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.resetAccess(tenant, auth.userId, id);
  }

  @Post(':id/mfa/reset')
  @HttpCode(200)
  @Roles(...FIRM_MANAGERS)
  resetMfa(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.resetMfa(tenant, auth.userId, id);
  }

  @Get(':id/documents/summary')
  @Roles(...FIRM_STAFF)
  documentsSummary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.documentsSummary(tenant, auth.userId, id);
  }

  @Get(':id/forms/summary')
  @Roles(...FIRM_STAFF)
  formsSummary(
    @CurrentAuth() auth: AuthContext,
    @CurrentTenant() tenant: TenantContext,
    @Param('id', new ZodValidationPipe(ClientId)) id: string,
  ) {
    return this.access.formsSummary(tenant, auth.userId, id);
  }
}

@Module({
  imports: [SignInModule, PortalTabsModule],
  controllers: [PortalAccessController],
  providers: [PortalAccessService],
})
export class PortalAccessModule {}
