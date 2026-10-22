import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import { databaseErrorCode, type Database, type TxClient } from '@firmivra/db';
import {
  type CustomRole,
  type CustomRoleDetail,
  DEFAULT_ROLE_PERMISSIONS,
  FIRM_ROLE_LABELS,
  type MembershipRole,
  PermissionCapability,
  PermissionModule,
  type PermissionGrant,
  ROLES_MANAGED_BY,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { notFound } from '../workspaces/common.js';
import { PermissionGrantsService } from './permission-grants.service.js';
import type { CreateCustomRoleBody, UpdateCustomRoleBody } from './roles-input.js';

type Create = z.output<typeof CreateCustomRoleBody>;
type Update = z.output<typeof UpdateCustomRoleBody>;
type Row = {
  id: string;
  name: string;
  description: string | null;
  basedOn: MembershipRole;
  archivedAt: Date | null;
  updatedAt: Date;
};

const MODULES = PermissionModule.options;
const CAPABILITIES = PermissionCapability.options;
const key = (m: string, c: string) => `${m}:${c}`;
/** What Roles & Permissions itself needs: read, save and reset a grid. */
const ROLE_PAGE: PermissionCapability[] = ['VIEW', 'EDIT', 'DELETE'];
const ROW = {
  id: true,
  name: true,
  description: true,
  basedOn: true,
  archivedAt: true,
  updatedAt: true,
} as const;

const conflict = (code: string, message: string) => new ConflictException({ code, message });

/** A built-in role's grid in this firm: the default with the firm's changes (role_permissions). */
async function roleGrid(
  tx: TxClient,
  businessId: string,
  role: MembershipRole,
): Promise<Map<string, boolean>> {
  const rows = await tx.rolePermission.findMany({
    where: { businessId, role },
    select: { module: true, capability: true, granted: true },
  });
  const changed = new Map(rows.map((r) => [key(r.module, r.capability), r.granted]));
  const grid = new Map<string, boolean>();
  for (const m of MODULES)
    for (const c of CAPABILITIES)
      grid.set(
        key(m, c),
        changed.get(key(m, c)) ?? DEFAULT_ROLE_PERMISSIONS[role][m]?.includes(c) ?? false,
      );
  return grid;
}

/** A custom role's whole grid (custom_role_permissions). */
async function customGrid(
  tx: TxClient,
  businessId: string,
  customRoleId: string,
): Promise<Map<string, boolean>> {
  const rows = await tx.customRolePermission.findMany({
    where: { businessId, customRoleId },
    select: { module: true, capability: true, granted: true },
  });
  return new Map(rows.map((r) => [key(r.module, r.capability), r.granted]));
}

/** 400 PERMISSION_NEEDS_VIEW: any capability needs View in its module. */
function assertViewFirst(grid: Map<string, boolean>) {
  for (const m of MODULES) {
    const others = CAPABILITIES.some((c) => c !== 'VIEW' && grid.get(key(m, c)));
    if (others && !grid.get(key(m, 'VIEW')))
      throw new BadRequestException({
        code: 'PERMISSION_NEEDS_VIEW',
        message: 'Give View before the other capabilities',
        details: [{ path: 'grants', module: m }],
      });
  }
}

/** The database's rules as the contract's errors. */
function mapDbError(e: unknown): unknown {
  const code = databaseErrorCode(e) ?? (e as { code?: string } | null)?.code;
  if (code === 'P2002' || code === '23505')
    return conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');
  if (code === '23514')
    return new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: 'Some of the values are not allowed',
    });
  return e;
}

/**
 * A firm's own roles (Settings > Users & Roles: Create Custom Role, Set Permissions, Edit
 * Permissions, Archive; contract in packages/types/src/staff/roles.ts; R1's schema #995). A custom
 * role starts from a built-in role, which never changes, and keeps its own whole grid. A member
 * with it keeps that built-in role, so every check by role stays as it is; the guard reads the
 * custom grid in place of the role's. Owner and Admin only. Audited with counts, never cells.
 */
@Injectable()
export class CustomRolesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly grants: PermissionGrantsService,
    private readonly audit: AuditService,
  ) {}

  private assertCanChange(actor: TenantContext) {
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN')
      throw new ForbiddenException({ code: 'CANNOT_GRANT', message: 'You cannot change roles' });
  }

  /** 409 ROLE_NAME_TAKEN: a built-in role's name, or a live custom role's (any case). */
  private async assertNameFree(tx: TxClient, businessId: string, name: string, except?: string) {
    const wanted = name.trim().toLowerCase();
    const taken =
      Object.values(FIRM_ROLE_LABELS).some((label) => label.toLowerCase() === wanted) ||
      (await tx.customRole.count({
        where: {
          businessId,
          archivedAt: null,
          name: { equals: name.trim(), mode: 'insensitive' },
          ...(except ? { id: { not: except } } : {}),
        },
      })) > 0;
    if (taken) throw conflict('ROLE_NAME_TAKEN', 'A role with this name already exists');
  }

  /** People with each role, not counting inactive ones. */
  private async counts(tx: TxClient, businessId: string, ids: string[]) {
    if (!ids.length) return new Map<string, number>();
    const rows = await tx.membership.groupBy({
      by: ['customRoleId'],
      where: { businessId, customRoleId: { in: ids }, status: { not: 'DEACTIVATED' } },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.customRoleId as string, r._count._all]));
  }

  private toRole(row: Row, memberCount: number): CustomRole {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      basedOn: row.basedOn,
      memberCount,
      archivedAt: row.archivedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  /** The firm's live custom roles by name (Roles list, the Role filter, the Roles count). */
  async live(tx: TxClient, businessId: string): Promise<CustomRole[]> {
    const rows = await tx.customRole.findMany({
      where: { businessId, archivedAt: null },
      select: ROW,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
    const n = await this.counts(
      tx,
      businessId,
      rows.map((r) => r.id),
    );
    return rows.map((r) => this.toRole(r, n.get(r.id) ?? 0));
  }

  /** The live custom roles this person may give (their built-in role is one the actor manages). */
  async givable(tx: TxClient, businessId: string, actor: MembershipRole) {
    const roles = ROLES_MANAGED_BY[actor] ?? [];
    if (!roles.length) return [];
    return tx.customRole.findMany({
      where: { businessId, archivedAt: null, basedOn: { in: [...roles] } },
      select: { id: true, name: true, basedOn: true, description: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  }

  private async read(tx: TxClient, businessId: string, id: string): Promise<CustomRoleDetail> {
    const row = await tx.customRole.findFirst({ where: { businessId, id }, select: ROW });
    if (!row) throw notFound();
    const [grid, n, last] = await Promise.all([
      customGrid(tx, businessId, id),
      this.counts(tx, businessId, [id]),
      tx.auditLog.findFirst({
        where: { businessId, entityType: 'custom_role', entityId: id },
        orderBy: { createdAt: 'desc' },
        select: { actorUserId: true },
      }),
    ]);
    const by = last?.actorUserId
      ? await tx.membership.findFirst({
          where: { businessId, userId: last.actorUserId },
          select: { user: { select: { name: true } } },
        })
      : null;
    return {
      role: this.toRole(row, n.get(id) ?? 0),
      cells: MODULES.flatMap((module) =>
        CAPABILITIES.map((capability) => ({
          module,
          capability,
          granted: grid.get(key(module, capability)) ?? false,
          source: 'FIRM_ROLE' as const,
        })),
      ),
      updatedBy: by?.user.name ?? null,
    };
  }

  get(tenant: TenantContext, id: string): Promise<CustomRoleDetail> {
    return this.database.withScope({ kind: 'business', businessId: tenant.businessId }, (tx) =>
      this.read(tx, tenant.businessId, id),
    );
  }

  /**
   * Save Role: the role and its whole grid in one transaction, so Cancel or a refusal leaves no
   * role behind. The grid is `basedOn`'s in this firm with `grants` on top; giving more than that
   * is an escalation (409 until acknowledged).
   */
  async create(tenant: TenantContext, userId: string, body: Create): Promise<CustomRole> {
    this.assertCanChange(tenant);
    const businessId = tenant.businessId;
    try {
      return await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await this.assertNameFree(tx, businessId, body.name);
        const base = await roleGrid(tx, businessId, body.basedOn);
        const grid = new Map(base);
        const grants: readonly PermissionGrant[] = body.grants ?? [];
        for (const g of grants) grid.set(key(g.module, g.capability), g.granted);
        assertViewFirst(grid);
        const escalated = grants.some((g) => g.granted && !base.get(key(g.module, g.capability)));
        if (escalated && !body.acknowledgeEscalation)
          throw conflict(
            'PERMISSION_ESCALATION',
            'This gives the role more than the role it starts from; confirm to continue',
          );
        const row = await tx.customRole.create({
          data: {
            businessId,
            name: body.name,
            description: body.description ?? null,
            basedOn: body.basedOn,
          },
          select: ROW,
        });
        await tx.customRolePermission.createMany({
          data: MODULES.flatMap((module) =>
            CAPABILITIES.map((capability) => ({
              businessId,
              customRoleId: row.id,
              module,
              capability,
              granted: grid.get(key(module, capability)) ?? false,
            })),
          ),
        });
        await this.audit.logIn(
          tx,
          'role.custom_created',
          { type: 'custom_role', id: row.id },
          {
            basedOn: body.basedOn,
            grantedCells: [...grid.values()].filter(Boolean).length,
            changedCells: [...grid].filter(([k, v]) => base.get(k) !== v).length,
            escalated,
            actorUserId: userId,
          },
        );
        return this.toRole(row, 0);
      });
    } catch (e) {
      throw mapDbError(e);
    }
  }

  /**
   * Rename, describe, or Edit Permissions (the cells changed). An escalation is a cell newly
   * given beyond `basedOn`'s grid here. An Admin cannot close Roles & Permissions to their own
   * custom role (409 ADMIN_LOCKOUT, as for the Admin role). The members get it on their next
   * request.
   */
  async update(
    tenant: TenantContext,
    userId: string,
    id: string,
    body: Update,
  ): Promise<CustomRoleDetail> {
    this.assertCanChange(tenant);
    const businessId = tenant.businessId;
    let detail: CustomRoleDetail;
    try {
      detail = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        await tx.$executeRaw`SELECT 1 FROM custom_roles WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
        const row = await tx.customRole.findFirst({ where: { businessId, id }, select: ROW });
        if (!row) throw notFound();
        if (row.archivedAt)
          throw conflict('CUSTOM_ROLE_ARCHIVED', 'This role is archived and cannot be changed');
        const renamed = body.name !== undefined && body.name !== row.name;
        if (renamed && body.name?.toLowerCase() !== row.name.toLowerCase())
          await this.assertNameFree(tx, businessId, body.name as string, id);
        const described =
          body.description !== undefined && (body.description ?? null) !== row.description;
        let changedCells = 0;
        let escalated = false;
        if (body.grants?.length) {
          const [current, base] = await Promise.all([
            customGrid(tx, businessId, id),
            roleGrid(tx, businessId, row.basedOn),
          ]);
          const grid = new Map(current);
          for (const g of body.grants) grid.set(key(g.module, g.capability), g.granted);
          assertViewFirst(grid);
          if (
            tenant.kind === 'staff' &&
            tenant.role === 'ADMIN' &&
            tenant.customRoleId === id &&
            ROLE_PAGE.some((c) => !grid.get(key('STAFF_MANAGEMENT', c)))
          )
            throw conflict(
              'ADMIN_LOCKOUT',
              'You would lose Roles & Permissions; only the Owner can take it away',
            );
          escalated = body.grants.some((g) => {
            const k = key(g.module, g.capability);
            return g.granted && !current.get(k) && !base.get(k);
          });
          if (escalated && !body.acknowledgeEscalation)
            throw conflict(
              'PERMISSION_ESCALATION',
              'This gives the role more than the role it starts from; confirm to continue',
            );
          for (const [k, value] of grid) {
            if (current.get(k) === value) continue;
            const [module, capability] = k.split(':') as [PermissionModule, PermissionCapability];
            await tx.customRolePermission.update({
              where: { customRoleId_module_capability: { customRoleId: id, module, capability } },
              data: { granted: value },
            });
            changedCells++;
          }
        }
        if (renamed || described || changedCells)
          await tx.customRole.update({
            where: { businessId_id: { businessId, id } },
            data: {
              ...(renamed ? { name: body.name } : {}),
              ...(described ? { description: body.description ?? null } : {}),
              updatedAt: new Date(),
            },
          });
        await this.audit.logIn(
          tx,
          'role.custom_updated',
          { type: 'custom_role', id },
          { renamed, described, changedCells, escalated, actorUserId: userId },
        );
        return this.read(tx, businessId, id);
      });
    } catch (e) {
      throw mapDbError(e);
    }
    this.grants.invalidateCustom(businessId, id);
    return detail;
  }

  /** Archive: it can no longer be given. Refused while anyone not inactive still has it. */
  async archive(tenant: TenantContext, userId: string, id: string): Promise<CustomRole> {
    this.assertCanChange(tenant);
    const businessId = tenant.businessId;
    const role = await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      await tx.$executeRaw`SELECT 1 FROM custom_roles WHERE business_id = ${businessId}::uuid AND id = ${id}::uuid FOR UPDATE`;
      const row = await tx.customRole.findFirst({ where: { businessId, id }, select: ROW });
      if (!row) throw notFound();
      if (row.archivedAt) return this.toRole(row, 0);
      const inUse = (await this.counts(tx, businessId, [id])).get(id) ?? 0;
      if (inUse)
        throw conflict(
          'CUSTOM_ROLE_IN_USE',
          `${inUse} ${inUse === 1 ? 'person has' : 'people have'} this role. Give them another role first.`,
        );
      const archived = await tx.customRole.update({
        where: { businessId_id: { businessId, id } },
        data: { archivedAt: new Date() },
        select: ROW,
      });
      await this.audit.logIn(
        tx,
        'role.custom_archived',
        { type: 'custom_role', id },
        { basedOn: row.basedOn, actorUserId: userId },
      );
      return this.toRole(archived, 0);
    });
    this.grants.invalidateCustom(businessId, id);
    return role;
  }
}
