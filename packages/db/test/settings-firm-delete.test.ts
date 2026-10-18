// R0 stage B7 (Oct 18): deleting a firm (app_delete_business_data, as the migrate role runs on
// RDS: no superuser, no BYPASSRLS) takes its feature overrides and the record of the defaults it
// was provisioned with. An active legal hold on the firm blocks the deletion; once released, the
// hold stays on record with its firm link cleared.
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
  const urls = await prepareTestDatabase('settings_delete');
  owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
}, SLOW);

afterAll(async () => {
  await owner?.$disconnect();
});

/** Runs app_delete_business_data as an RDS-like role; resolves to the error message or 'ok'. */
const deleteFirm = async (businessId: string) => {
  const role = `fv_b7del_${randomUUID().slice(0, 8)}`;
  const [me] = await owner.$queryRaw<{ owner: string }[]>`SELECT current_user AS owner`;
  await owner.$executeRawUnsafe(`CREATE ROLE ${role} NOSUPERUSER NOBYPASSRLS NOLOGIN`);
  await owner.$executeRawUnsafe(`GRANT "${me!.owner}" TO ${role}`);
  try {
    await owner.$transaction(
      async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL ROLE ${role}`);
        await tx.$queryRaw`SELECT * FROM app_delete_business_data(${businessId}::uuid)`;
      },
      { timeout: SLOW },
    );
    return 'ok';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    await owner.$executeRawUnsafe(`DROP ROLE IF EXISTS ${role}`);
  }
};

describe('deleting a firm with system-settings rows', () => {
  it(
    'a hold blocks it; once released, the overrides and the defaults record go with the firm',
    async () => {
      const { firm, hold } = await runInScope(owner, { kind: 'platform' }, async (tx) => {
        const firm = await tx.business.create({ data: { slug: `b7-del-${run}`, name: 'Leaving' } });
        await tx.platformFeature.create({ data: { key: `b7.del_${run}`, name: 'Feature' } });
        await tx.platformFeatureOverride.create({
          data: { featureKey: `b7.del_${run}`, businessId: firm.id, state: 'ON' },
        });
        const defaults = await tx.platformDefaultSet.findFirstOrThrow({ where: { kind: 'FIRM' } });
        await tx.platformDefaultSetApplication.create({
          data: { businessId: firm.id, defaultSetId: defaults.id },
        });
        const hold = await tx.platformLegalHold.create({
          data: { name: 'Dispute', reason: 'Open dispute', heldBusinessId: firm.id },
        });
        return { firm, hold };
      });

      expect(await deleteFirm(firm.id)).toMatch(/under a legal hold \(Dispute\); release it first/);
      await runInScope(owner, { kind: 'platform' }, async (tx) => {
        await tx.platformLegalHold.update({
          where: { id: hold.id },
          data: { releasedAt: new Date(), releaseReason: 'Dispute settled.' },
        });
      });
      expect(await deleteFirm(firm.id)).toBe('ok');
      const left = await runInScope(owner, { kind: 'platform' }, async (tx) => ({
        overrides: await tx.platformFeatureOverride.count({ where: { businessId: firm.id } }),
        applications: await tx.platformDefaultSetApplication.count({
          where: { businessId: firm.id },
        }),
        feature: await tx.platformFeature.count({ where: { key: `b7.del_${run}` } }),
        hold: await tx.platformLegalHold.findUniqueOrThrow({ where: { id: hold.id } }),
      }));
      expect(left).toMatchObject({ overrides: 0, applications: 0, feature: 1 });
      expect(left.hold).toMatchObject({ heldBusinessId: null, name: 'Dispute' });
      expect(left.hold.releasedAt).not.toBeNull();
    },
    SLOW,
  );
});
