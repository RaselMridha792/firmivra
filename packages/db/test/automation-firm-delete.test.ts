// r0_demo_unseed_automations (Oct 19): a firm with published automation rules can be deleted.
// A rule names its current version and each version names its rule, a foreign-key cycle that
// app_delete_business_data now breaks (clearing the rule's side first). Run as the migrate role
// runs on RDS (no superuser, no BYPASSRLS), with an active rule, an archived one, and a run.
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
  const urls = await prepareTestDatabase('automation_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

describe('deleting a firm with automation rules', () => {
  it(
    'breaks the rule and version cycle and removes every automation row',
    async () => {
      const firm = await runInScope(owner, { kind: 'platform' }, (tx) =>
        tx.business.create({ data: { slug: `auto-del-${run}`, name: 'Leaving' } }),
      );
      await runInScope(owner, { kind: 'business', businessId: firm.id }, async (tx) => {
        for (const [name, status] of [
          ['Active rule', 'ACTIVE'],
          ['Archived rule', 'ARCHIVED'],
        ] as const) {
          const rule = await tx.automationRule.create({
            data: { businessId: firm.id, name, category: 'LEADS' },
          });
          const version = await tx.automationRuleVersion.create({
            data: {
              businessId: firm.id,
              ruleId: rule.id,
              version: 1,
              triggerModule: 'LEADS',
              triggerEvent: 'lead.submitted',
              timing: 'IMMEDIATE',
              actions: [{ id: 'a1', type: 'send_email' }],
            },
          });
          await tx.automationRule.update({
            where: { id: rule.id },
            data: {
              status,
              currentVersionId: version.id,
              ...(status === 'ARCHIVED' ? { archivedAt: new Date() } : {}),
            },
          });
          if (status === 'ACTIVE') {
            await tx.automationRun.create({
              data: {
                businessId: firm.id,
                ruleId: rule.id,
                ruleVersionId: version.id,
                sourceModule: 'LEADS',
                sourceEventKey: `lead.submitted:${run}`,
                correlationId: randomUUID(),
                status: 'SUCCESS',
                startedAt: new Date(),
                finishedAt: new Date(),
              },
            });
          }
        }
      });

      const role = `fv_autodel_${run}`;
      const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
      await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
      await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
      let deleted: { table_name: string; deleted: bigint }[];
      try {
        deleted = await owner.$transaction(
          async (tx) => {
            await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
            return tx.$queryRaw<{ table_name: string; deleted: bigint }[]>`
              SELECT * FROM app_delete_business_data(${firm.id}::uuid)`;
          },
          { timeout: SLOW },
        );
      } finally {
        await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
      }

      const counts = Object.fromEntries(deleted.map((r) => [r.table_name, Number(r.deleted)]));
      expect(counts).toMatchObject({
        automation_rules: 2,
        automation_rule_versions: 2,
        automation_runs: 1,
        businesses: 1,
      });
      const left = await owner.$queryRaw<{ n: number }[]>`
        SELECT count(*)::int AS n FROM automation_rules WHERE business_id = ${firm.id}::uuid`;
      expect(left[0]!.n).toBe(0);
    },
    SLOW,
  );
});
