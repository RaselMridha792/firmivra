// R55: the Super Admin Reports & Analytics writes for admin-scope.test.ts. The builder runs and
// exports; each saved-report write acts on a saved report of its own, owned by the sweep's admin.
import { randomUUID } from 'node:crypto';
import { createPrismaClient, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { SupportWrite } from './admin-support-writes.js';

type Fixtures = { users: { admin: { id: string } } };
const R = '/api/v1/admin/reports';
const tag = randomUUID().slice(0, 8);
const ids: Record<string, string> = {};
const KINDS = ['update', 'delete', 'run', 'duplicate'] as const;

/** One saved report per write that names one. */
export async function prepareReports(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  try {
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, async (tx) => {
      for (const k of KINDS)
        ids[k] = (
          await tx.platformSavedReport.create({
            data: {
              ownerUserId: fx.users.admin.id,
              name: `Fake scope ${k} ${tag}`,
              reportType: 'FIRMS',
              fields: ['firm.name'],
              filters: {},
              dateRange: { preset: 'LAST_30_DAYS' },
              sort: [],
            },
            select: { id: true },
          })
        ).id;
    });
  } finally {
    await owner.$disconnect();
  }
}

/** `:id` read when the write is sent (after prepareReports), not when WRITES is built. */
const saved = (k: (typeof KINDS)[number]) => ({
  get id() {
    return ids[k]!;
  },
});

export function reportsWrites(): Record<
  string,
  SupportWrite & { params?: Record<string, string> }
> {
  const def = { type: 'FIRMS', fields: ['firm.name', 'firm.status'] };
  return {
    [`POST ${R}/builder/run`]: { body: def },
    [`POST ${R}/builder/export`]: { body: { ...def, format: 'CSV' } },
    [`POST ${R}/saved`]: { body: { name: `Fake scope new ${tag}`, ...def } },
    [`PATCH ${R}/saved/:id`]: { body: { shared: true }, params: saved('update') },
    [`DELETE ${R}/saved/:id`]: { body: {}, params: saved('delete') },
    [`POST ${R}/saved/:id/run`]: { body: {}, params: saved('run') },
    [`POST ${R}/saved/:id/duplicate`]: { body: {}, params: saved('duplicate') },
  };
}
