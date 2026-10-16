// R37, Intake Forms: an intake's send setup, the facts the database keeps (sent_at,
// completed_at, last_activity_at, the reference number), drafts, the lead recipient's secure
// link, and the firm's intake settings. Runs as the app role.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  firmA: '',
  firmB: '',
  staffA: randomUUID(),
  staffB: randomUUID(),
  engagement: '',
  form: '',
  lead: '',
  engagementB: '',
  formB: '',
};
const A = () => db.forBusiness(ids.firmA);
const B = () => db.forBusiness(ids.firmB);
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const hours = (h: number) => new Date(Date.now() + h * 3_600_000);

type Setup = Partial<{
  status: 'DRAFT' | 'SENT' | 'IN_PROGRESS' | 'COMPLETED';
  sentAt: Date;
  expiresAt: Date;
  dueOn: Date;
  assignedUserId: string;
  deliveryChannel: 'EMAIL' | 'SMS' | 'PORTAL';
  messageSubject: string;
  messageBody: string;
  referenceNumber: number;
  accessTokenHash: string;
  accessTokenExpiresAt: Date;
  completedByUserId: string;
}>;
/** An intake of the firm's client (or of the lead when `lead`). */
const newIntake = (data: Setup = {}, lead = false) =>
  A().intake.create({
    data: {
      businessId: ids.firmA,
      formId: ids.form,
      ...(lead ? { leadId: ids.lead } : { engagementId: ids.engagement }),
      ...data,
    },
  });

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.staffA, ids.staffB]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'STAFF', email: `${id}@is.test`, name: 'Fake' },
      });
    }
    ids.firmA = (await tx.business.create({ data: { slug: `isa-${run}`, name: 'A' } })).id;
    ids.firmB = (await tx.business.create({ data: { slug: `isb-${run}`, name: 'B' } })).id;
  });
  const setup = async (businessId: string, userId: string) =>
    runInScope(owner, { kind: 'business', businessId }, async (tx) => {
      await tx.membership.create({ data: { businessId, userId, role: 'OWNER', status: 'ACTIVE' } });
      const client = await tx.client.create({ data: { businessId, displayName: 'Client (fake)' } });
      const service = await tx.service.create({
        data: { businessId, kind: 'ANNUAL_TAX', name: 'Annual Tax' },
      });
      const engagement = await tx.engagement.create({
        data: { businessId, clientId: client.id, serviceId: service.id, title: '2025' },
      });
      const form = await tx.intakeForm.create({
        data: {
          businessId,
          serviceId: service.id,
          version: 1,
          title: 'Intake',
          status: 'PUBLISHED',
          publishedAt: new Date(),
        },
      });
      const lead = await tx.lead.create({
        data: {
          businessId,
          serviceId: service.id,
          firstName: 'Lena',
          lastName: 'Lead',
          email: `lead-${randomUUID()}@begin.test`,
        },
      });
      return { engagement: engagement.id, form: form.id, lead: lead.id };
    });
  const a = await setup(ids.firmA, ids.staffA);
  ids.engagement = a.engagement;
  ids.form = a.form;
  ids.lead = a.lead;
  const b = await setup(ids.firmB, ids.staffB);
  ids.engagementB = b.engagement;
  ids.formB = b.form;
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), db.disconnect()]);
});

describe('row-level security', () => {
  it("never shows or changes another firm's intake settings", async () => {
    await A().intakeSettings.create({ data: { businessId: ids.firmA } });
    expect(await B().intakeSettings.findUnique({ where: { businessId: ids.firmA } })).toBeNull();
    expect(
      (
        await B().intakeSettings.updateMany({
          where: { businessId: ids.firmA },
          data: { allowSaveResume: false },
        })
      ).count,
    ).toBe(0);
    await expect(B().intakeSettings.create({ data: { businessId: ids.firmA } })).rejects.toThrow(
      /row-level security/i,
    );
    await expect(
      B().intakeSettings.create({
        data: { businessId: ids.firmB, defaultOwnerUserId: ids.staffA },
      }),
    ).rejects.toThrow(/foreign key/i);
  });

  it('refuses an assignee from another firm', async () => {
    await expect(newIntake({ assignedUserId: ids.staffB })).rejects.toThrow(/foreign key/i);
    await expect(newIntake({ assignedUserId: ids.staffA })).resolves.toMatchObject({
      assignedUserId: ids.staffA,
    });
  });
});

describe('sent_at and drafts', () => {
  it('is set by the database when the intake is sent, whatever the caller sends', async () => {
    const before = Date.now();
    const sent = await newIntake({ sentAt: new Date('2020-01-01') });
    expect(sent.sentAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(sent.lastActivityAt).toBeInstanceOf(Date);
  });

  it('a draft has no sent_at until it is sent, and keeps it for good after', async () => {
    const draft = await newIntake({ status: 'DRAFT', sentAt: new Date() });
    expect(draft.sentAt).toBeNull();
    const sent = await A().intake.update({ where: { id: draft.id }, data: { status: 'SENT' } });
    expect(sent.sentAt).not.toBeNull();
    // A resend or any later change leaves it alone; nobody moves it; no way back to draft.
    const again = await A().intake.update({
      where: { id: draft.id },
      data: { status: 'IN_PROGRESS' },
    });
    expect(again.sentAt).toEqual(sent.sentAt);
    await expect(
      A().intake.update({ where: { id: draft.id }, data: { sentAt: new Date('2020-01-01') } }),
    ).rejects.toThrow(/sent_at is set by the database/);
    await expect(
      A().intake.update({ where: { id: draft.id }, data: { status: 'DRAFT' } }),
    ).rejects.toThrow(/cannot go back to draft/);
  });

  it('an unwanted draft is archived, never deleted', async () => {
    const draft = await newIntake({ status: 'DRAFT' });
    const archived = await A().intake.update({
      where: { id: draft.id },
      data: { status: 'ARCHIVED' },
    });
    expect(archived).toMatchObject({ status: 'ARCHIVED', sentAt: null });
    await expect(A().intake.delete({ where: { id: draft.id } })).rejects.toThrow(
      /permission denied/,
    );
  });
});

describe('completed_at and last_activity_at', () => {
  it('follows COMPLETED and clears when the intake leaves it', async () => {
    const intake = await newIntake();
    expect(intake.completedAt).toBeNull();
    const done = await A().intake.update({
      where: { id: intake.id },
      data: { status: 'COMPLETED', completedByUserId: ids.staffA },
    });
    expect(done.completedAt).not.toBeNull();
    expect(done.completedByUserId).toBe(ids.staffA);
    // Not movable by the caller while it stays COMPLETED.
    const same = await A().intake.update({
      where: { id: intake.id },
      data: { completedAt: new Date('2020-01-01') },
    });
    expect(same.completedAt).toEqual(done.completedAt);
    const reopened = await A().intake.update({
      where: { id: intake.id },
      data: { status: 'IN_PROGRESS' },
    });
    expect(reopened.completedAt).toBeNull();
    expect(reopened.completedByUserId).toBeNull();
  });

  it('last_activity_at moves forward on every change and never back', async () => {
    const intake = await newIntake();
    const next = await A().intake.update({
      where: { id: intake.id },
      data: { remindersEnabled: false, lastActivityAt: new Date('2020-01-01') },
    });
    expect(next.lastActivityAt.getTime()).toBeGreaterThanOrEqual(intake.lastActivityAt.getTime());
    expect(next.remindersEnabled).toBe(false);
  });
});

describe('send setup rules', () => {
  it('expires after it is sent and not before it is due', async () => {
    await expect(newIntake({ expiresAt: new Date('2020-01-01') })).rejects.toThrow(
      /intakes_expiry_after_sent/,
    );
    await expect(
      newIntake({ expiresAt: hours(24), dueOn: new Date(Date.now() + 10 * 86_400_000) }),
    ).rejects.toThrow(/intakes_expiry_after_due/);
    await expect(
      newIntake({ expiresAt: hours(24 * 14), dueOn: new Date(Date.now() + 3 * 86_400_000) }),
    ).resolves.toBeTruthy();
  });

  it('keeps the subject and message short and not blank; the portal is for clients only', async () => {
    for (const data of [
      { messageSubject: ' ' },
      { messageSubject: 'x'.repeat(201) },
      { messageBody: 'x'.repeat(501) },
    ]) {
      await expect(newIntake(data)).rejects.toThrow(/intakes_message_length/);
    }
    await expect(
      newIntake({ deliveryChannel: 'EMAIL', messageSubject: 'Your intake', messageBody: 'Hi' }),
    ).resolves.toBeTruthy();
    await expect(newIntake({ deliveryChannel: 'PORTAL' }, true)).rejects.toThrow(
      /intakes_portal_for_clients/,
    );
    await expect(newIntake({ deliveryChannel: 'PORTAL' })).resolves.toBeTruthy();
  });

  it("a lead recipient's secure link is a hash and an expiry together, for a lead's intake", async () => {
    const hash = sha(randomUUID());
    await expect(newIntake({ accessTokenHash: hash }, true)).rejects.toThrow(
      /intakes_access_token/,
    );
    await expect(
      newIntake({ accessTokenHash: hash, accessTokenExpiresAt: hours(48) }),
    ).rejects.toThrow(/intakes_access_token/);
    await expect(
      newIntake({ accessTokenHash: 'ABC', accessTokenExpiresAt: hours(48) }, true),
    ).rejects.toThrow(/intakes_access_token/);
    await expect(
      newIntake(
        { expiresAt: hours(24), accessTokenHash: hash, accessTokenExpiresAt: hours(72) },
        true,
      ),
    ).rejects.toThrow(/intakes_access_token/);
    await expect(
      newIntake({ accessTokenHash: hash, accessTokenExpiresAt: hours(48) }, true),
    ).resolves.toMatchObject({ accessTokenHash: hash });
  });
});

describe('reference numbers', () => {
  it('are given only while the firm turns them on, one after the other, per firm', async () => {
    const before = await newIntake({ referenceNumber: 99 });
    expect(before.referenceNumber).toBeNull();
    await A().intakeSettings.update({
      where: { businessId: ids.firmA },
      data: { autoSubmissionId: true },
    });
    const first = await newIntake({ referenceNumber: 99 });
    const second = await newIntake({ status: 'DRAFT' });
    expect(first.referenceNumber).toBeGreaterThan(0);
    expect(second.referenceNumber).toBe(first.referenceNumber! + 1);
    await expect(
      A().intake.update({ where: { id: second.id }, data: { referenceNumber: 1 } }),
    ).rejects.toThrow(/reference number/);
    // Firm B has its own numbering (settings off: none).
    const other = await B().intake.create({
      data: { businessId: ids.firmB, formId: ids.formB, engagementId: ids.engagementB },
    });
    expect(other.referenceNumber).toBeNull();
  });
});

describe('intake settings rules', () => {
  const settings = (data: Record<string, unknown>) =>
    A().intakeSettings.update({ where: { businessId: ids.firmA }, data });
  it('keeps days, hours and sizes in range', async () => {
    for (const data of [
      { defaultExpiryDays: 0 },
      { firstReminderDays: 31 },
      { firstReminderDays: 5, finalReminderDays: 5 },
      { finalReminderDays: 61 },
      { expiryAlertHours: 169 },
      { maxFileSizeMb: 20 },
    ]) {
      await expect(settings(data)).rejects.toThrow(/intake_settings_ranges/);
    }
    await expect(settings({ defaultExpiryDays: 30, maxFileSizeMb: 5 })).resolves.toBeTruthy();
  });

  it('accepts only the platform upload types, and a https redirect that is set when on', async () => {
    await expect(settings({ acceptedFileTypes: ['text/csv'] })).rejects.toThrow(
      /intake_settings_file_types/,
    );
    await expect(settings({ acceptedFileTypes: [] })).rejects.toThrow(/intake_settings_file_types/);
    await expect(settings({ redirectAfterCompletion: true })).rejects.toThrow(
      /intake_settings_redirect/,
    );
    for (const redirectUrl of ['http://x.test/done', 'https://x.test/a b', 'javascript:alert(1)']) {
      await expect(settings({ redirectUrl })).rejects.toThrow(/intake_settings_redirect/);
    }
    await expect(
      settings({ redirectAfterCompletion: true, redirectUrl: 'https://firm.test/thanks' }),
    ).resolves.toBeTruthy();
    await expect(settings({ thankYouMessage: 'Thanks​now' })).rejects.toThrow(
      /intake_settings_thank_you/,
    );
  });

  it('defaults keep the automations off', async () => {
    const fresh = await B().intakeSettings.create({ data: { businessId: ids.firmB } });
    expect(fresh).toMatchObject({
      autoCreateClient: false,
      autoCreateFollowUpTask: false,
      routeByService: false,
      defaultExpiryDays: 14,
      maxFileSizeMb: 10,
    });
  });
});
