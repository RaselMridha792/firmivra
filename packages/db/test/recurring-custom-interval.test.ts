// r1_billing_frequency_custom and r1_recurring_custom_interval (R1, Oct 28; IP-F05): a recurring
// invoice repeats every N weeks, months or years. The interval is set exactly when the frequency is
// CUSTOM, and CUSTOM is never a service's billing frequency. Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
let count = 0;
let customId = '';
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const day = (d: string) => new Date(`${d}T00:00:00Z`);

const schedule = (data: Record<string, unknown> = {}) =>
  firmA().recurringInvoice.create({
    data: {
      ...A(),
      clientId: f.client,
      name: `Quarterly Review ${++count}`,
      frequency: 'CUSTOM',
      intervalCount: 3,
      intervalUnit: 'MONTH',
      startOn: day('2026-11-01'),
      nextSendOn: day('2026-11-01'),
      ...data,
    },
  });

beforeAll(async () => {
  f = await createFirms(owner, 'rci');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('a custom recurring invoice', () => {
  it('repeats every N weeks, months or years', async () => {
    for (const intervalUnit of ['WEEK', 'MONTH', 'YEAR']) {
      await expect(schedule({ intervalUnit })).resolves.toMatchObject({
        frequency: 'CUSTOM',
        intervalCount: 3,
        intervalUnit,
      });
    }
    customId = (await schedule({ intervalCount: 52, intervalUnit: 'WEEK' })).id;
  });

  it('has both parts of its interval, from 1 to 52', async () => {
    expect(await failure(schedule({ intervalCount: null }))).toMatch(/custom_interval/);
    expect(await failure(schedule({ intervalUnit: null }))).toMatch(/custom_interval/);
    expect(await failure(schedule({ intervalCount: 0 }))).toMatch(/custom_interval/);
    expect(await failure(schedule({ intervalCount: 53 }))).toMatch(/custom_interval/);
  });

  it('is the only frequency with an interval', async () => {
    await expect(
      schedule({ frequency: 'MONTHLY', intervalCount: null, intervalUnit: null }),
    ).resolves.toMatchObject({ intervalCount: null, intervalUnit: null });
    expect(await failure(schedule({ frequency: 'MONTHLY' }))).toMatch(/custom_interval/);
    const weekly = await schedule({ frequency: 'WEEKLY', intervalCount: null, intervalUnit: null });
    expect(
      await failure(
        firmA().recurringInvoice.update({ where: { id: weekly.id }, data: { intervalCount: 2 } }),
      ),
    ).toMatch(/custom_interval/);
  });
});

describe('services', () => {
  it('never bill on a CUSTOM frequency', async () => {
    expect(
      await failure(
        firmA().service.create({
          data: { ...A(), kind: 'BOOKKEEPING', name: 'Bookkeeping', billingFrequency: 'CUSTOM' },
        }),
      ),
    ).toMatch(/not_custom/);
    await expect(
      firmA().service.create({
        data: { ...A(), kind: 'BOOKKEEPING', name: 'Bookkeeping', billingFrequency: 'MONTHLY' },
      }),
    ).resolves.toMatchObject({ billingFrequency: 'MONTHLY' });
  });
});

describe('isolation', () => {
  it("firm B cannot see or change firm A's custom schedule", async () => {
    expect(await firmB().recurringInvoice.findMany({ where: { id: customId } })).toEqual([]);
    const { count: changed } = await firmB().recurringInvoice.updateMany({
      where: { id: customId },
      data: { intervalCount: 1 },
    });
    expect(changed).toBe(0);
  });
});
