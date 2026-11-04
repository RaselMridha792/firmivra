// The Manual Event Confirmation master (R1, Oct 29; migration r1_automation_manual_confirmation,
// Octavia's AU-F29): automation_settings.manual_confirmation_enabled, OFF unless the firm turns it
// on, never NULL, and one firm's switch is never another's. Runs as the app role under RLS.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const urls = inject('dbUrls');
const { owner, db } = connect(urls);
/** The app role without the tenant client, for SQL the client would never write. */
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);
const switchOf = (firm: () => ReturnType<typeof A>, businessId: string) =>
  firm().automationSettings.findUniqueOrThrow({
    where: { businessId },
    select: { manualConfirmationEnabled: true },
  });

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1amc');
  await A().automationSettings.create({ data: { businessId: f.firmA } });
  await B().automationSettings.create({ data: { businessId: f.firmB } });
});

afterAll(async () => {
  await app.$disconnect();
});

describe('the master switch', () => {
  it('is OFF for a new firm row, and the firm turns it on and off', async () => {
    await expect(switchOf(A, f.firmA)).resolves.toEqual({ manualConfirmationEnabled: false });
    const set = (manualConfirmationEnabled: boolean) =>
      A().automationSettings.update({
        where: { businessId: f.firmA },
        data: { manualConfirmationEnabled },
        select: { manualConfirmationEnabled: true },
      });
    await expect(set(true)).resolves.toEqual({ manualConfirmationEnabled: true });
    await expect(set(false)).resolves.toEqual({ manualConfirmationEnabled: false });
  });

  it('is never NULL', async () => {
    expect(
      await failure(
        runInScope(app, { kind: 'business', businessId: f.firmA }, (tx) =>
          tx.$executeRawUnsafe(
            'UPDATE automation_settings SET manual_confirmation_enabled = NULL WHERE business_id = $1::uuid',
            f.firmA,
          ),
        ),
      ),
    ).toMatch(/null value|not-null|23502/i);
  });
});

describe('isolation', () => {
  it("firm B never sees or changes firm A's switch, and keeps its own", async () => {
    await A().automationSettings.update({
      where: { businessId: f.firmA },
      data: { manualConfirmationEnabled: true },
    });
    expect(await B().automationSettings.findMany({ where: { businessId: f.firmA } })).toEqual([]);
    const { count } = await B().automationSettings.updateMany({
      where: { businessId: f.firmA },
      data: { manualConfirmationEnabled: false },
    });
    expect(count).toBe(0);
    await expect(switchOf(A, f.firmA)).resolves.toEqual({ manualConfirmationEnabled: true });
    await expect(switchOf(B, f.firmB)).resolves.toEqual({ manualConfirmationEnabled: false });
  });
});
