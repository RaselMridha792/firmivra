// R56: the Super Admin Integrations writes for admin-scope.test.ts, each against a record of its
// own (platform integrations in each status, catalog entries, a plan), made with the owner client
// so every write meets something it can change. Providers and environments differ from
// admin-integrations.e2e.test.ts, which may run at the same time (one live connection each).
import { randomUUID } from 'node:crypto';
import { createPrismaClient, type Prisma, runInScope } from '@firmivra/db';
import { TEST_CLIENT_OPTIONS, testDatabaseUrls } from '@firmivra/db/testing';
import type { Fixtures } from '../global-setup.js';
import { records, type SupportWrite } from './admin-support-writes.js';

const tag = randomUUID().slice(0, 8);
const refs = { planId: '' };
const BASE = 'POST /api/v1/admin/integrations';
const at = new Date().toISOString();

type IntegrationWrite = SupportWrite & { params?: () => Record<string, string> };

export function integrationsWrites(fx: Fixtures): Record<string, IntegrationWrite> {
  void fx;
  return {
    [`${BASE}/platform`]: {
      body: {
        name: `Fake Scope ${tag}`,
        category: 'OTHER',
        description: 'Fake scope integration',
      },
    },
    'PATCH /api/v1/admin/integrations/platform/:id': {
      body: { version: 1, longDescription: 'Fake scope edit' },
      record: 'int-patch',
    },
    'PUT /api/v1/admin/integrations/platform/:id/credentials': {
      body: { values: { apiKey: 'fake-scope-key-0001' } },
      record: 'int-creds',
    },
    [`${BASE}/platform/:id/test`]: { body: {}, record: 'int-test' },
    [`${BASE}/platform/:id/reconnect`]: { body: {}, record: 'int-reconnect' },
    [`${BASE}/platform/:id/activate`]: {
      body: { confirmWithoutTest: true },
      record: 'int-activate',
    },
    [`${BASE}/platform/:id/disable`]: { body: { reason: 'Fake scope' }, record: 'int-disable' },
    [`${BASE}/platform/:id/enable`]: { body: {}, record: 'int-enable' },
    [`${BASE}/platform/:id/remove`]: { body: {}, record: 'int-remove' },
    [`${BASE}/platform/:id/sync`]: { body: {}, record: 'int-sync' },
    [`${BASE}/catalog`]: {
      body: {
        provider: `scope_books_${tag}`,
        name: 'Fake Scope Books',
        category: 'OTHER',
        shortDescription: 'Fake scope entry',
      },
    },
    'PATCH /api/v1/admin/integrations/catalog/:id': {
      body: { version: 1, name: 'Fake scope edit' },
      record: 'cat-patch',
    },
    'PUT /api/v1/admin/integrations/catalog/:id/plans/:planId': {
      body: {},
      record: 'cat-plans',
      params: () => refs,
    },
    'DELETE /api/v1/admin/integrations/catalog/:id/plans/:planId': {
      body: {},
      record: 'cat-plans',
      params: () => refs,
    },
    'PUT /api/v1/admin/integrations/catalog/:id/firms/:businessId': {
      body: { access: 'ALLOW' },
      record: 'cat-firms',
    },
    'DELETE /api/v1/admin/integrations/catalog/:id/firms/:businessId': {
      body: {},
      record: 'cat-firms',
    },
  };
}

/** The records the writes above act on. */
export async function prepareIntegrations(fx: Fixtures): Promise<void> {
  const owner = createPrismaClient(testDatabaseUrls('test_api').owner, TEST_CLIENT_OPTIONS);
  const custom = (key: string): Prisma.PlatformIntegrationUncheckedCreateInput => ({
    provider: `custom_scope_${key.replace(/-/g, '_')}_${tag}`,
    name: `Fake Scope ${key}`,
    category: 'OTHER',
    description: 'Fake scope integration',
    environment: 'TEST',
    settings: {},
  });
  // A complete custom connection (its key's hint and its base URL), as after the wizard.
  const complete = {
    hints: { apiKey: { display: '••••0001', updatedAt: at } },
    values: { baseUrl: { value: 'https://api.example.test/', updatedAt: at } },
  };
  try {
    await runInScope(owner, { kind: 'platform' }, async (tx) => {
      const make = async (
        key: string,
        data: Partial<Prisma.PlatformIntegrationUncheckedCreateInput> = {},
      ) => {
        const row = await tx.platformIntegration.create({ data: { ...custom(key), ...data } });
        records[key] = row.id;
        return row.id;
      };
      await make('int-patch');
      await make('int-creds');
      await make('int-test', { provider: 'cloudflare', environment: 'LIVE' });
      await make('int-reconnect', { provider: 'docusign', environment: 'LIVE' });
      await make('int-activate', { settings: complete });
      await make('int-remove');
      for (const key of ['int-disable', 'int-enable', 'int-sync']) {
        const id = await make(key, { settings: complete });
        await tx.platformIntegration.update({
          where: { id },
          data: { status: 'ACTIVE', activatedWithoutTest: true },
        });
      }
      for (const key of ['cat-patch', 'cat-plans', 'cat-firms']) {
        const row = await tx.platformIntegrationCatalog.create({
          data: {
            provider: `scope_${key.replace(/-/g, '_')}_${tag}`,
            name: `Fake Scope ${key}`,
            category: 'OTHER',
            shortDescription: 'Fake scope entry',
          },
        });
        records[key] = row.id;
      }
      const plan = await tx.platformPlan.create({
        data: {
          code: `SCOPE_${tag.toUpperCase().replace(/[^A-Z0-9]/g, 'X')}`,
          name: 'Fake Scope Plan',
          basePriceCents: 0,
          includedSeats: 1,
          displayOrder: 900,
        },
      });
      refs.planId = plan.id;
    });
    // Only a SUPER_ADMIN disables (the database checks it): the one to re-enable.
    await runInScope(owner, { kind: 'admin', adminUserId: fx.users.admin.id }, (tx) =>
      tx.platformIntegration.update({
        where: { id: records['int-enable'] as string },
        data: { status: 'DISABLED' },
      }),
    );
  } finally {
    await owner.$disconnect();
  }
}
