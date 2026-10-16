// The reusable half of `pnpm db:unseed:demo` (R0, PART 2): removes exactly what seedDemoOrg
// created, and nothing else. Separate from unseed-demo.ts (the CLI script) the same way
// seed-demo-org.ts is separate from seed-demo.ts: a plain function with no top-level side effect,
// so a test can import it without running anything at import time.
import type { createPrismaClient } from '../src/client.js';
import { runInScope } from '../src/client.js';
import {
  demoId,
  SEED_DEMO_BUSINESS,
  SEED_DEMO_CLIENTS,
  SEED_DEMO_USERS,
} from './seed-demo-data.js';

type Prisma = ReturnType<typeof createPrismaClient>;

export interface UnseedDemoOrgResult {
  businessId: string;
  tables: { table_name: string; deleted: bigint }[];
  deletedUsers: number;
}

/** Finds the `demo` business by slug and deletes it and its synthetic users. `null` if there is none. */
export async function unseedDemoOrg(prisma: Prisma): Promise<UnseedDemoOrgResult | null> {
  const business = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.business.findUnique({ where: { slug: SEED_DEMO_BUSINESS.slug }, select: { id: true } }),
  );
  if (!business) return null;

  const tables = await prisma.$queryRaw<{ table_name: string; deleted: bigint }[]>`
    SELECT * FROM app_delete_business_data(${business.id}::uuid)`;

  // The demo's own users (staff and the one portal client): safe to delete now that every
  // membership and client_account that pointed at them is gone (the foreign keys would refuse it
  // otherwise). Platform scope, users_delete.
  const userIds = [
    ...Object.values(SEED_DEMO_USERS).map((u) => u.id),
    ...SEED_DEMO_CLIENTS.filter((c) => c.portal).map((c) => demoId(`user:client:${c.key}`)),
  ];
  const deletedUsers = await runInScope(prisma, { kind: 'platform' }, (tx) =>
    tx.user.deleteMany({ where: { id: { in: userIds } } }),
  );

  return { businessId: business.id, tables, deletedUsers: deletedUsers.count };
}
