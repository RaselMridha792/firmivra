// R0 stage B5 (Oct 17): Firmivra's sales record outlives the firm it sold to. Deleting the firm
// (app_delete_business_data) or its application (app_delete_firm_applications), as the migrate
// role runs on RDS (no superuser, no BYPASSRLS), clears only the links: the opportunity, its
// stage and its history stay.
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
  const urls = await prepareTestDatabase('sales_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('deleting a firm that Firmivra sold to', () => {
  it(
    'clears the firm and application links and keeps the sales record and its history',
    async () => {
      const { firm, application, deal } = await runInScope(
        owner,
        { kind: 'platform' },
        async (tx) => {
          const firm = await tx.business.create({
            data: { slug: `b5-del-${run}`, name: 'Leaving' },
          });
          const application = await tx.firmApplication.create({
            data: {
              legalName: 'Leaving LLC',
              contactName: 'Pat Doe',
              contactEmail: 'pat@leaving.test',
              data: {},
            },
          });
          const pipeline = await tx.salesPipeline.findUniqueOrThrow({
            where: { systemKey: 'firmivra_default' },
            include: { stages: true },
          });
          const contact = await tx.salesContact.create({ data: { name: 'Pat Doe' } });
          const deal = await tx.salesOpportunity.create({
            data: {
              pipelineId: pipeline.id,
              stageId: pipeline.stages.find((s) => s.systemKey === 'active_client')!.id,
              contactId: contact.id,
              title: 'Leaving LLC',
              linkedBusinessId: firm.id,
              firmApplicationId: application.id,
            },
          });
          return { firm, application, deal };
        },
      );

      const role = `fv_b5del_${run}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      try {
        await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            await tx.$queryRaw`SELECT * FROM app_delete_firm_applications(${[application.id]}::uuid[])`;
            await tx.$queryRaw`SELECT * FROM app_delete_business_data(${firm.id}::uuid)`;
          },
          { timeout: SLOW },
        );
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }

      const kept = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
        deal: await tx.salesOpportunity.findUniqueOrThrow({ where: { id: deal.id } }),
        history: await tx.salesStageHistory.count({ where: { opportunityId: deal.id } }),
      }));
      expect(kept.deal).toMatchObject({
        linkedBusinessId: null,
        firmApplicationId: null,
        stageId: deal.stageId,
        convertedAt: deal.convertedAt,
      });
      expect(kept.history).toBe(1);
    },
    SLOW,
  );
});
