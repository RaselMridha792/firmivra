import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Database, TxClient } from '@firmivra/db';
import {
  DEFAULT_ROLE_PERMISSIONS,
  type MembershipRole,
  PermissionCapability,
  PermissionModule,
  type PermissionGrant,
  type StaffPermissions,
} from '@firmivra/types';
import { AuditService } from '../audit/audit.service.js';
import { DATABASE } from '../database/database.module.js';
import { PermissionGrantsService } from '../roles/permission-grants.service.js';
import { notFound } from '../workspaces/common.js';
import {
  assertManages,
  cellKey,
  lockTarget,
  mapStaffDbError,
  requireManager,
  type StaffActor,
  staffConflict,
} from './staff.common.js';

const MODULES = PermissionModule.options;
const CAPABILITIES = PermissionCapability.options;

type Source = StaffPermissions['cells'][number]['source'];
type Cell = { granted: boolean; source: Source };

/**
 * A member's grid: the role's default, the firm's role changes, then the member's own. With a
 * custom role, its whole grid stands in for the role's (Settings > Users & Roles).
 */
export async function memberGrid(
  tx: TxClient,
  businessId: string,
  role: MembershipRole,
  membershipId: string | null,
  customRoleId?: string | null,
): Promise<{ role: Map<string, Cell>; member: Map<string, Cell>; updatedAt: Date | null }> {
  const [roleRows, memberRows] = await Promise.all([
    customRoleId
      ? tx.customRolePermission.findMany({
          where: { businessId, customRoleId },
          select: { module: true, capability: true, granted: true },
        })
      : tx.rolePermission.findMany({
          where: { businessId, role },
          select: { module: true, capability: true, granted: true },
        }),
    membershipId
      ? tx.memberPermission.findMany({
          where: { businessId, membershipId },
          select: { module: true, capability: true, granted: true, updatedAt: true },
          orderBy: { updatedAt: 'desc' },
        })
      : Promise.resolve([]),
  ]);
  const firm = new Map(roleRows.map((r) => [cellKey(r.module, r.capability), r.granted]));
  const own = new Map(memberRows.map((r) => [cellKey(r.module, r.capability), r.granted]));
  const roleCells = new Map<string, Cell>();
  const memberCells = new Map<string, Cell>();
  for (const m of MODULES)
    for (const c of CAPABILITIES) {
      const k = cellKey(m, c);
      const f = firm.get(k);
      const base: Cell =
        f === undefined
          ? {
              granted: DEFAULT_ROLE_PERMISSIONS[role][m]?.includes(c) ?? false,
              source: 'ROLE_DEFAULT',
            }
          : { granted: f, source: 'FIRM_ROLE' };
      roleCells.set(k, base);
      const o = own.get(k);
      memberCells.set(k, o === undefined ? base : { granted: o, source: 'MEMBER' });
    }
  return { role: roleCells, member: memberCells, updatedAt: memberRows[0]?.updatedAt ?? null };
}

/**
 * Writes a member's grid: `grants` over what they have now. Only the cells that differ from the
 * role's are kept (member_permissions). 400 PERMISSION_NEEDS_VIEW for a capability with no View
 * in its module; giving more than the role is an escalation, refused (409 PERMISSION_ESCALATION)
 * unless `acknowledged`. Owner and Admin have every permission and none can be added to an
 * Owner's: an Owner's grid is refused.
 */
export async function writeMemberGrid(
  tx: TxClient,
  input: {
    businessId: string;
    membershipId: string;
    role: MembershipRole;
    /** Their custom role, whose grid is the one "more than the role" is measured against. */
    customRoleId?: string | null;
    grants: readonly PermissionGrant[];
    acknowledged: boolean;
    updatedById: string;
    /** A fresh member: no rows yet. */
    fresh?: boolean;
    /** Check only (Create Staff, before the invite): nothing is written. */
    dryRun?: boolean;
  },
): Promise<{ changedCells: number; escalated: boolean }> {
  const { businessId, membershipId, role } = input;
  if (role === 'OWNER')
    throw new BadRequestException({
      code: 'VALIDATION_FAILED',
      message: "The Owner's permissions cannot be changed",
    });
  const grid = await memberGrid(
    tx,
    businessId,
    role,
    input.fresh ? null : membershipId,
    input.customRoleId,
  );
  const now = new Map([...grid.member].map(([k, v]) => [k, v.granted]));
  for (const g of input.grants) now.set(cellKey(g.module, g.capability), g.granted);
  for (const m of MODULES) {
    const others = CAPABILITIES.some((c) => c !== 'VIEW' && now.get(cellKey(m, c)));
    if (others && !now.get(cellKey(m, 'VIEW')))
      throw new BadRequestException({
        code: 'PERMISSION_NEEDS_VIEW',
        message: 'Give View before the other capabilities',
        details: [{ path: 'grants', module: m }],
      });
  }
  const escalated = [...now].some(([k, v]) => v && !grid.role.get(k)?.granted);
  if (escalated && !input.acknowledged)
    throw staffConflict(
      'PERMISSION_ESCALATION',
      "This gives the member more than their role's permissions; confirm to continue",
    );
  if (input.dryRun) return { changedCells: 0, escalated };
  let changedCells = 0;
  for (const m of MODULES)
    for (const c of CAPABILITIES) {
      const k = cellKey(m, c);
      const value = now.get(k) as boolean;
      const before = grid.member.get(k) as Cell;
      const id = { businessId, membershipId, module: m, capability: c };
      if (value === grid.role.get(k)?.granted) {
        if (before.source === 'MEMBER') {
          await tx.memberPermission.delete({
            where: { businessId_membershipId_module_capability: id },
          });
          changedCells++;
        }
      } else if (before.source !== 'MEMBER' || before.granted !== value) {
        await tx.memberPermission.upsert({
          where: { businessId_membershipId_module_capability: id },
          create: { ...id, granted: value, updatedById: input.updatedById },
          update: { granted: value, updatedAt: new Date(), updatedById: input.updatedById },
        });
        changedCells++;
      }
    }
  return { changedCells, escalated };
}

export const toPermissions = (
  role: MembershipRole,
  grid: Awaited<ReturnType<typeof memberGrid>>,
  customRole: { id: string; name: string } | null = null,
): StaffPermissions => ({
  role,
  customRole,
  cells: MODULES.flatMap((module) =>
    CAPABILITIES.map((capability) => ({
      module,
      capability,
      ...(grid.member.get(cellKey(module, capability)) as Cell),
    })),
  ),
  updatedAt: grid.updatedAt?.toISOString() ?? null,
});

/** A member's permissions (Access Summary, the Permissions tab) and their own changes. */
@Injectable()
export class StaffPermissionsService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    private readonly audit: AuditService,
    private readonly grants: PermissionGrantsService,
  ) {}

  /** Read access was checked by the caller (StaffReadService's rule). */
  get(businessId: string, id: string): Promise<StaffPermissions> {
    return this.database.withScope({ kind: 'business', businessId }, async (tx) => {
      const m = await tx.membership.findFirst({
        where: { businessId, id },
        select: { id: true, role: true, customRole: { select: { id: true, name: true } } },
      });
      if (!m) throw notFound();
      return toPermissions(
        m.role,
        await memberGrid(tx, businessId, m.role, m.id, m.customRole?.id),
        m.customRole,
      );
    });
  }

  async set(
    actor: StaffActor,
    id: string,
    grants: readonly PermissionGrant[],
    acknowledged: boolean,
    copiedFrom?: string,
  ): Promise<StaffPermissions> {
    const businessId = actor.businessId;
    try {
      await this.database.withScope({ kind: 'business', businessId }, async (tx) => {
        const by = await requireManager(tx, actor);
        const target = await lockTarget(tx, businessId, id);
        assertManages(actor, target);
        const out = await writeMemberGrid(tx, {
          businessId,
          membershipId: id,
          role: target.role,
          customRoleId: target.customRoleId,
          grants,
          acknowledged,
          updatedById: by,
        });
        await this.audit.logIn(
          tx,
          'staff.permissions_saved',
          { type: 'membership', id },
          { ...out, ...(copiedFrom ? { copiedFrom } : {}) },
          { businessId },
        );
      });
    } catch (e) {
      throw mapStaffDbError(e);
    }
    this.grants.invalidateMember(businessId);
    return this.get(businessId, id);
  }

  /**
   * Copy Permissions from Another Staff Member: `fromId`'s whole grid onto `id`, over `id`'s own
   * role. Giving more than that role counts as acknowledged: the Owner or Admin chose the copy.
   */
  async copy(actor: StaffActor, id: string, fromId: string): Promise<StaffPermissions> {
    const from = await this.get(actor.businessId, fromId);
    return this.set(
      actor,
      id,
      from.cells.map(({ module, capability, granted }) => ({ module, capability, granted })),
      true,
      fromId,
    );
  }
}
