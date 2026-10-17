// Dev bootstrap (R0 PART 1 follow-up, Oct 17): the regular seed's seedPlatformPlans and
// seedPlatformTeam never run on dev (only `pnpm db:seed` calls them), so after #677's migrations
// applied there, dev had platform_admins rows but an empty plan ladder, department/role catalog,
// and no platform_members rows at all. This bootstraps all three, generically: no fixed seed user
// id, so it works against dev's real SUPER_ADMIN accounts, not this repo's synthetic seed users.
// Safe to run again -- every write is an upsert, by code or by user id.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { seedPlatformPlans } from './seed-platform-plans.js';
import { seedPlatformTeamCatalog } from './seed-platform-team.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export interface MappedSuperAdmin {
  userId: string;
  email: string;
}

/**
 * Maps every existing SUPER_ADMIN platform_admins row to a CEO-level platform_members row.
 * platform_members writes are gated on app_is_admin() for the whole table, not a self-row check
 * (platform_members_admin_all), so any one existing SUPER_ADMIN can open admin scope and write
 * every row. Returns the id and email of each admin it mapped (new or already-mapped).
 */
export async function mapSuperAdminsToCeo(prisma: Prisma): Promise<MappedSuperAdmin[]> {
  const superAdmins = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.platformAdmin.findMany({
      where: { role: 'SUPER_ADMIN' },
      select: { userId: true, user: { select: { email: true } } },
    }),
  );
  if (superAdmins.length === 0) return [];

  const ceoRole = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.platformRoleDefinition.findUniqueOrThrow({
      where: { code: 'EXECUTIVE_CEO' },
      select: { id: true, departmentId: true },
    }),
  );

  await runInScope(prisma, { kind: 'admin', adminUserId: superAdmins[0]!.userId }, async (tx) => {
    for (const admin of superAdmins) {
      // Create only, not upsert: running this twice must write nothing new (no audit row either)
      // for an admin already mapped, so the audit log stays one row per actual mapping.
      const existing = await tx.platformMember.findUnique({ where: { userId: admin.userId } });
      if (existing) continue;
      await tx.platformMember.create({
        data: {
          userId: admin.userId,
          roleDefinitionId: ceoRole.id,
          departmentId: ceoRole.departmentId,
          scopeType: 'COMPANY',
          status: 'ACTIVE',
        },
      });
      await tx.auditLog.create({
        data: {
          businessId: null,
          actorUserId: admin.userId,
          action: 'platform_member.mapped_to_ceo',
          entityType: 'platform_member',
          entityId: admin.userId,
          metadata: { from: 'dev-bootstrap', note: 'Existing SUPER_ADMIN mapped to CEO' },
        },
      });
    }
  });

  return superAdmins.map((a) => ({ userId: a.userId, email: a.user.email }));
}

/** The plan ladder, the department/role catalog, and the CEO mapping -- everything the regular
 * seed covers that dev never ran. Returns who it mapped, for the caller to report. */
export async function bootstrapPlatformOrg(prisma: Prisma): Promise<MappedSuperAdmin[]> {
  await seedPlatformPlans(prisma);
  await seedPlatformTeamCatalog(prisma);
  return mapSuperAdminsToCeo(prisma);
}
