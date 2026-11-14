// The intake schedule (R1, Nov 15; migration r1_intake_schedule, Intake Forms Review Two 10c and
// the reminder schedule): each form's own first, final and alert minutes within the settings'
// ranges, and a marker per send, only on a form that was sent and never before it. The firm's own
// rows only. Runs as the app role.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = { firmA: '', firmB: '', engagement: '', form: '' };
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const days = (d: number) => new Date(Date.now() + d * 86_400_000);

const failure = async (p: PromiseLike<unknown>) => {
  try {
    await p;
    return '';
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
};
const intake = (data: Record<string, unknown> = {}) =>
  A().intake.create({
    data: {
      businessId: ids.firmA,
      formId: ids.form,
      engagementId: ids.engagement,
      expiresAt: days(14),
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    ids.firmA = (await tx.business.create({ data: { slug: `isch-a-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `isch-b-${run}`, name: 'B' } })).id;
  });
  await runInScope(owner, { kind: 'business', businessId: ids.firmA }, async (tx) => {
    const businessId = ids.firmA;
    const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
    const service = await tx.service.create({
      data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
    });
    ids.engagement = (
      await tx.engagement.create({
        data: { businessId, clientId: client.id, serviceId: service.id, title: '2026' },
      })
    ).id;
    ids.form = (
      await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: service.id,
          version: 1,
          title: 'Intake (fake)',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      })
    ).id;
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('intakes schedule', () => {
  it("keeps a sent form's own schedule within the settings' ranges, or none", async () => {
    const i = await intake({
      reminderFirstMinutes: 4320,
      reminderFinalMinutes: 5,
      expiryAlertMinutes: 1440,
    });
    expect(i).toMatchObject({
      reminderFirstMinutes: 4320,
      reminderFinalMinutes: 5,
      expiryAlertMinutes: 1440,
      firstReminderSentAt: null,
    });
    // 10c: the final counts back from the expiry, so it may be shorter than the first.
    await expect(
      intake({ reminderFirstMinutes: 43200, reminderFinalMinutes: 86400 }),
    ).resolves.toMatchObject({ reminderFinalMinutes: 86400 });
    await expect(intake({})).resolves.toMatchObject({ reminderFirstMinutes: null });
    for (const bad of [
      { reminderFirstMinutes: 4 },
      { reminderFirstMinutes: 43201 },
      { reminderFinalMinutes: 4 },
      { reminderFinalMinutes: 86401 },
      { expiryAlertMinutes: 29 },
      { expiryAlertMinutes: 10081 },
    ])
      expect(await failure(intake(bad)), JSON.stringify(bad)).toMatch(/intakes_schedule_ranges/);
  });

  it('takes a marker only on a sent form, never before it was sent', async () => {
    const sent = await intake({ reminderFirstMinutes: 60 });
    const marked = await A().intake.update({
      where: { businessId_id: { businessId: ids.firmA, id: sent.id } },
      data: { firstReminderSentAt: new Date(), finalReminderSentAt: new Date() },
    });
    expect(marked.firstReminderSentAt).toBeInstanceOf(Date);
    expect(
      await failure(
        A().intake.update({
          where: { businessId_id: { businessId: ids.firmA, id: sent.id } },
          data: { expiryAlertSentAt: new Date('2000-01-01') },
        }),
      ),
    ).toMatch(/intakes_schedule_sent/);
    const draft = await intake({ status: 'DRAFT', expiresAt: null });
    expect(
      await failure(
        A().intake.update({
          where: { businessId_id: { businessId: ids.firmA, id: draft.id } },
          data: { firstReminderSentAt: new Date() },
        }),
      ),
    ).toMatch(/intakes_schedule_sent/);
  });

  it("is the firm's own: another firm neither reads nor marks it", async () => {
    const mine = await intake({ reminderFirstMinutes: 60 });
    await expect(
      B().intake.findFirst({ where: { id: mine.id }, select: { id: true } }),
    ).resolves.toBeNull();
    const changed = await B().intake.updateMany({
      where: { id: mine.id },
      data: { firstReminderSentAt: new Date() },
    });
    expect(changed.count).toBe(0);
    await expect(
      A().intake.findFirst({ where: { id: mine.id }, select: { firstReminderSentAt: true } }),
    ).resolves.toEqual({ firstReminderSentAt: null });
  });
});
