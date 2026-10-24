// R0 stage A seed: the LVP-style seed's org chart. The 13 departments and the role catalog are
// reference data in src/platform-team-catalog.ts (Oct 24, so the migrate image's one-offs can run
// them); this file keeps the seed's own CEO mapping of SEED_USERS.superAdmin. Safe to run again.
import { runInScope, type createPrismaClient } from '../src/client.js';
import { seedPlatformTeamCatalog } from '../src/platform-team-catalog.js';
import { SEED_USERS } from './seed-data.js';

export { seedPlatformTeamCatalog };

type Prisma = ReturnType<typeof createPrismaClient>;

/** The LVP-style seed's own org chart plus the one CEO mapping it needs: the seed's own
 * SEED_USERS.superAdmin. Used only by `pnpm db:seed` (never on dev; see bootstrap-platform-org.ts
 * for a generic, dev-safe version that maps every existing SUPER_ADMIN, not one fixed id). */
export async function seedPlatformTeam(prisma: Prisma): Promise<void> {
  const deptIds = await seedPlatformTeamCatalog(prisma);

  // Map every existing SUPER_ADMIN to the CEO role (Rasel's PART 1, item 1). Runs in admin scope,
  // after the platformAdmin upsert above has committed, so app_is_admin() already sees it.
  const ceoRoleId = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.platformRoleDefinition
      .findUniqueOrThrow({ where: { code: 'EXECUTIVE_CEO' }, select: { id: true } })
      .then((r) => r.id),
  );
  await runInScope(prisma, { kind: 'admin', adminUserId: SEED_USERS.superAdmin.id }, async (tx) => {
    await tx.platformMember.upsert({
      where: { userId: SEED_USERS.superAdmin.id },
      update: {},
      create: {
        userId: SEED_USERS.superAdmin.id,
        roleDefinitionId: ceoRoleId,
        departmentId: deptIds['EXECUTIVE']!,
        scopeType: 'COMPANY',
        status: 'ACTIVE',
      },
    });
    await tx.auditLog.create({
      data: {
        businessId: null,
        actorUserId: SEED_USERS.superAdmin.id,
        action: 'platform_member.mapped_to_ceo',
        entityType: 'platform_member',
        entityId: SEED_USERS.superAdmin.id,
        metadata: { from: 'seed', note: 'Existing SUPER_ADMIN mapped to CEO (R0 stage A)' },
      },
    });
  });
}
