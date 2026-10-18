// R0 stage B8 (Oct 18): deleting a firm (app_delete_business_data, as the migrate role runs on
// RDS: no superuser, no BYPASSRLS) takes its catalog allow or deny rules; the catalog entry and
// the integration log events that named the firm stay (the log outlives the firm).
//
// Its own database (not the suite's shared `dbUrls`): app_delete_business_data takes ACCESS
// EXCLUSIVE locks on every firm table while it runs.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { prepareTestDatabase, TEST_CLIENT_OPTIONS } from '../src/testing.js';

const SLOW = 300_000;
let owner: ReturnType<typeof createPrismaClient>;
const run = randomUUID().slice(0, 8);

beforeAll(async () => {
  const urls = await prepareTestDatabase('integrations_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('deleting a firm with integration rows', () => {
  it(
    'takes its catalog rules and keeps the catalog entry and the log',
    async () => {
      const made = await runInScope(owner, { kind: 'platform' }, async (tx) => {
        const firm = await tx.business.create({ data: { slug: `b8-del-${run}`, name: 'Leaving' } });
        const entry = await tx.platformIntegrationCatalog.create({
          data: {
            provider: `del_${run}`,
            name: 'Provider',
            category: 'OTHER',
            shortDescription: 'A provider.',
            firmRules: { create: [{ businessId: firm.id, access: 'ALLOW' }] },
          },
        });
        const log = await tx.platformIntegrationLog.create({
          data: {
            source: 'FIRM_CONNECTION',
            provider: `del_${run}`,
            subjectBusinessId: firm.id,
            severity: 'INFO',
            eventType: 'connection.created',
            succeeded: true,
            message: 'Connected.',
          },
        });
        return { firm, entry, log };
      });

      const role = `fv_b8del_${run}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            await tx.$queryRaw`SELECT * FROM app_delete_business_data(${made.firm.id}::uuid)`;
          },
          { timeout: SLOW },
        );
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }

      const left = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
        rules: await tx.platformIntegrationCatalogFirm.count({
          where: { catalogId: made.entry.id },
        }),
        entry: await tx.platformIntegrationCatalog.count({ where: { id: made.entry.id } }),
        log: await tx.platformIntegrationLog.findUnique({ where: { id: made.log.id } }),
      }));
      expect(left).toMatchObject({ rules: 0, entry: 1 });
      expect(left.log?.subjectBusinessId).toBe(made.firm.id);
    },
    SLOW,
  );
});
