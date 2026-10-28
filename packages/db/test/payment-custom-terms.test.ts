// r1_payment_custom_terms (R1, Oct 28; IP-F02, IP-F13): the firm's own list of payment terms, each
// a number of days (its code is net_<days>), 1 to 365, at most 12, empty by default. Runs as the
// app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const save = (customTermDays: number[]) =>
  firmA().paymentSettings.update({ where: { businessId: f.firmA }, data: { customTermDays } });
/** Values Prisma can't send (NULL, a NULL element), written as SQL in firm A's scope. */
const saveRaw = (value: string) =>
  runInScope(app, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.$executeRawUnsafe(
      `UPDATE payment_settings SET custom_term_days = ${value} WHERE business_id = '${f.firmA}'::uuid`,
    ),
  );

beforeAll(async () => {
  f = await createFirms(owner, 'pct');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe("the firm's own payment terms", () => {
  it('start empty, and keep a list of days', async () => {
    await expect(
      firmA().paymentSettings.create({ data: { businessId: f.firmA } }),
    ).resolves.toMatchObject({ customTermDays: [] });
    await expect(save([45, 60, 1, 365])).resolves.toMatchObject({
      customTermDays: [45, 60, 1, 365],
    });
    await expect(save([])).resolves.toMatchObject({ customTermDays: [] });
  });

  it('are each 1 to 365 days, at most 12', async () => {
    expect(await failure(save([0]))).toMatch(/custom_term_days/);
    expect(await failure(save([366]))).toMatch(/custom_term_days/);
    expect(await failure(save([-7]))).toMatch(/custom_term_days/);
    await expect(save(Array.from({ length: 12 }, (_, i) => i + 1))).resolves.toBeTruthy();
    expect(await failure(save(Array.from({ length: 13 }, (_, i) => i + 1)))).toMatch(
      /custom_term_days/,
    );
  });

  it('are never NULL, hold no NULL, and are one list', async () => {
    expect(await failure(saveRaw('NULL'))).toMatch(/custom_term_days/);
    expect(await failure(saveRaw('ARRAY[30, NULL]::integer[]'))).toMatch(/custom_term_days/);
    expect(await failure(saveRaw("'{{30},{45}}'::integer[]"))).toMatch(/custom_term_days/);
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's terms", async () => {
    await save([45]);
    expect(await firmB().paymentSettings.findMany({ where: { businessId: f.firmA } })).toEqual([]);
    const { count } = await firmB().paymentSettings.updateMany({
      where: { businessId: f.firmA },
      data: { customTermDays: [90] },
    });
    expect(count).toBe(0);
    await expect(
      firmA().paymentSettings.findUniqueOrThrow({ where: { businessId: f.firmA } }),
    ).resolves.toMatchObject({ customTermDays: [45] });
  });
});
