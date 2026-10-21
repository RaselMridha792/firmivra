import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from '@nestjs/common';
import type { Database } from '@firmivra/db';
import {
  DEFAULT_ROLE_PERMISSIONS,
  FIRM_ROLE_LABELS,
  FIRM_ROLES,
  PermissionCapability,
  PermissionModule,
  type MembershipRole,
  type PermissionModuleList,
  type RoleList,
  type RolePermissions,
} from '@firmivra/types';
import type { z } from 'zod';
import { AuditService } from '../audit/audit.service.js';
import type { TenantContext } from '../common/request-context.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from './permission-grants.service.js';
import { CAPABILITY_INFO, MODULE_INFO, ROLE_DESCRIPTIONS } from './roles-catalog.js';
import type { SaveRoleBody } from './roles-input.js';

type Save = z.output<typeof SaveRoleBody>;

const MODULES = PermissionModule.options;
const CAPABILITIES = PermissionCapability.options;
const key = (m: string, c: string) => `${m}:${c}`;
/** What Roles & Permissions itself needs: read, save and reset a grid. */
const ROLE_PAGE: PermissionCapability[] = ['VIEW', 'EDIT', 'DELETE'];

const forbidden = (code: 'FORBIDDEN' | 'CANNOT_GRANT', message: string) =>
  new ForbiddenException({ code, message });

/**
 * Roles and the permission grid (contract in packages/types/src/staff/roles.ts). Owner and Admin
 * only. The defaults are code; a firm's changes are `role_permissions` rows (only the cells that
 * differ from the default are kept). The Owner's grid is shown and never changed. Audited with the
 * role and counts, never the cells' words.
 */
@Injectable()
export class RolesService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly grants: PermissionGrantsService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Owner and Admin change every role's grid but the Owner's (Octavia's review, Oct 20: an Admin
   * may edit the Admin role too). Who may give a role to a person stays ROLES_MANAGED_BY.
   */
  private assertCanChange(actor: TenantContext, role: MembershipRole) {
    if (role === 'OWNER') throw forbidden('FORBIDDEN', 'The Owner role cannot be changed');
    if (actor.role !== 'OWNER' && actor.role !== 'ADMIN')
      throw forbidden('CANNOT_GRANT', 'You cannot change this role');
  }

  list(tenant: TenantContext): Promise<RoleList> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const businessId = tenant.businessId;
        const [counts, custom] = await Promise.all([
          tx.membership.groupBy({
            by: ['role'],
            where: { businessId, status: { not: 'DEACTIVATED' } },
            _count: { _all: true },
          }),
          tx.rolePermission.groupBy({
            by: ['role'],
            where: { businessId },
            _count: { _all: true },
          }),
        ]);
        const n = new Map(counts.map((c) => [c.role, c._count._all]));
        const changed = new Set(custom.map((c) => c.role));
        return {
          items: FIRM_ROLES.map((role) => ({
            role,
            label: FIRM_ROLE_LABELS[role],
            description: ROLE_DESCRIPTIONS[role],
            memberCount: n.get(role) ?? 0,
            customized: changed.has(role),
            locked: role === 'OWNER',
          })),
        };
      },
    );
  }

  permissions(tenant: TenantContext, role: MembershipRole): Promise<RolePermissions> {
    return this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const rows = await tx.rolePermission.findMany({
          where: { businessId: tenant.businessId, role },
          include: { updatedBy: { select: { user: { select: { name: true } } } } },
          orderBy: { updatedAt: 'desc' },
        });
        const changed = new Map(rows.map((r) => [key(r.module, r.capability), r.granted]));
        const cells = MODULES.flatMap((module) =>
          CAPABILITIES.map((capability) => {
            const own = changed.get(key(module, capability));
            return {
              module,
              capability,
              granted: own ?? DEFAULT_ROLE_PERMISSIONS[role][module]?.includes(capability) ?? false,
              source: own === undefined ? ('ROLE_DEFAULT' as const) : ('FIRM_ROLE' as const),
            };
          }),
        );
        const last = rows[0];
        return {
          role,
          cells,
          updatedAt: last ? last.updatedAt.toISOString() : null,
          updatedBy: last?.updatedBy?.user.name ?? null,
        };
      },
    );
  }

  async save(
    tenant: TenantContext,
    userId: string,
    role: MembershipRole,
    body: Save,
  ): Promise<RolePermissions> {
    this.assertCanChange(tenant, role);
    await this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const businessId = tenant.businessId;
        const rows = await tx.rolePermission.findMany({ where: { businessId, role } });
        const isDefault = (m: PermissionModule, c: PermissionCapability) =>
          DEFAULT_ROLE_PERMISSIONS[role][m]?.includes(c) ?? false;
        const now = new Map<string, boolean>();
        for (const m of MODULES)
          for (const c of CAPABILITIES)
            now.set(
              key(m, c),
              rows.find((r) => r.module === m && r.capability === c)?.granted ?? isDefault(m, c),
            );
        for (const g of body.grants) now.set(key(g.module, g.capability), g.granted);
        // Any capability needs View in its module.
        for (const m of MODULES) {
          const others = CAPABILITIES.filter((c) => c !== 'VIEW' && now.get(key(m, c)));
          if (others.length && !now.get(key(m, 'VIEW')))
            throw new BadRequestException({
              code: 'PERMISSION_NEEDS_VIEW',
              message: 'Give View before the other capabilities',
              details: [{ path: 'grants', module: m }],
            });
        }
        // An Admin cannot close this page to every Admin (only the Owner may take it away).
        if (
          tenant.role === 'ADMIN' &&
          role === 'ADMIN' &&
          ROLE_PAGE.some((c) => !now.get(key('STAFF_MANAGEMENT', c)))
        )
          throw new ConflictException({
            code: 'ADMIN_LOCKOUT',
            message: 'Admins would lose Roles & Permissions; only the Owner can take it away',
          });
        const escalates = body.grants.some((g) => g.granted && !isDefault(g.module, g.capability));
        if (escalates && !body.acknowledgeEscalation)
          throw new ConflictException({
            code: 'PERMISSION_ESCALATION',
            message: 'This gives the role more than its default; confirm to continue',
          });
        const membership = await tx.membership.findFirst({
          where: { businessId, userId },
          select: { id: true },
        });
        let changed = 0;
        for (const m of MODULES) {
          for (const c of CAPABILITIES) {
            const value = now.get(key(m, c)) as boolean;
            const existing = rows.find((r) => r.module === m && r.capability === c);
            const id = { businessId, role, module: m, capability: c };
            if (value === isDefault(m, c)) {
              if (existing) {
                await tx.rolePermission.delete({
                  where: { businessId_role_module_capability: id },
                });
                changed++;
              }
            } else if (!existing || existing.granted !== value) {
              await tx.rolePermission.upsert({
                where: { businessId_role_module_capability: id },
                create: { ...id, granted: value, updatedById: membership?.id ?? null },
                update: {
                  granted: value,
                  updatedAt: new Date(),
                  updatedById: membership?.id ?? null,
                },
              });
              changed++;
            }
          }
        }
        await this.audit.logIn(
          tx,
          'role.permissions_saved',
          { type: 'role' },
          { role, changedCells: changed, escalated: escalates, actorUserId: userId },
        );
      },
    );
    this.grants.invalidate(tenant.businessId, role);
    return this.permissions(tenant, role);
  }

  async reset(
    tenant: TenantContext,
    userId: string,
    role: MembershipRole,
  ): Promise<RolePermissions> {
    this.assertCanChange(tenant, role);
    await this.database.withScope(
      { kind: 'business', businessId: tenant.businessId },
      async (tx) => {
        const { count } = await tx.rolePermission.deleteMany({
          where: { businessId: tenant.businessId, role },
        });
        await this.audit.logIn(
          tx,
          'role.permissions_reset',
          { type: 'role' },
          { role, removedCells: count, actorUserId: userId },
        );
      },
    );
    this.grants.invalidate(tenant.businessId, role);
    return this.permissions(tenant, role);
  }

  modules(): PermissionModuleList {
    return {
      modules: MODULES.map((module) => ({
        module,
        label: MODULE_INFO[module].label,
        description: MODULE_INFO[module].description,
        capabilities: [...CAPABILITIES],
      })),
      capabilities: CAPABILITIES.map((capability) => ({
        capability,
        label: CAPABILITY_INFO[capability].label,
        description: CAPABILITY_INFO[capability].description,
      })),
    };
  }
}
