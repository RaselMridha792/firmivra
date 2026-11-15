// Invoices Review 2 I-N04 (R60, Nov 16; migration r60_invoice_reminder_steps, the lead's approval
// under Rasel's packages/db delegation): a firm's invoice reminders go out on one to five days
// before the due date (0: the due date), and the overdue notice repeats at most 1 to 12 times.
// Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';
import { failure } from './r38-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);
let f: Awaited<ReturnType<typeof createFirms>>;
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createFirms(owner, 'irs');
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('payment_settings reminder steps', () => {
  it('a new firm reminds 3 days before and repeats the overdue notice at most 3 times', async () => {
    const row = await firmA().paymentSettings.create({ data: { businessId: f.firmA } });
    expect([row.reminderDaysBeforeList, row.overdueReminderMax]).toEqual([[3], 3]);
  });

  it("the migration's backfill keeps each firm's day", async () => {
    await firmB().paymentSettings.create({
      data: { businessId: f.firmB, reminderDaysBefore: 7, reminderDaysBeforeList: [3] },
    });
    // The migration's own statement, on a row made before it.
    await runInScope(
      owner,
      { kind: 'business', businessId: f.firmB },
      (tx) =>
        tx.$executeRaw`UPDATE payment_settings
        SET reminder_days_before_list = ARRAY[COALESCE(reminder_days_before, 3)]
        WHERE business_id = ${f.firmB}::uuid`,
    );
    const row = await firmB().paymentSettings.findUniqueOrThrow({
      where: { businessId: f.firmB },
    });
    expect(row.reminderDaysBeforeList).toEqual([7]);
  });

  it('takes several days, the due date among them, and refuses what is out of range', async () => {
    const set = (data: { reminderDaysBeforeList?: number[]; overdueReminderMax?: number }) =>
      firmA().paymentSettings.update({ where: { businessId: f.firmA }, data });
    const kept = await set({ reminderDaysBeforeList: [7, 1, 0], overdueReminderMax: 12 });
    expect([kept.reminderDaysBeforeList, kept.overdueReminderMax]).toEqual([[7, 1, 0], 12]);
    for (const bad of [
      { reminderDaysBeforeList: [-1] },
      { reminderDaysBeforeList: [61] },
      { reminderDaysBeforeList: [1, 2, 3, 4, 5, 6] },
      { reminderDaysBeforeList: [] },
      { overdueReminderMax: 13 },
      { overdueReminderMax: 0 },
    ]) {
      expect(await failure(set(bad)), JSON.stringify(bad)).toMatch(
        /payment_settings_reminder_steps/,
      );
    }
  });
});
