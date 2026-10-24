// R60's columns (R1, Oct 24; migration r1_intake_staff_settings): Intake Form Settings I7, I8, I9
// and I12 on intake_settings, and Staff Management SM3's saved job titles and security defaults
// for new accounts. A firm never sees another firm's rows, and the rules hold. Runs as the app
// role under RLS.
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { runInScope } from '../src/client.js';
import { connect, createTwoFirms, failure, type TwoFirms } from './r38-helpers.js';

const { owner, db } = connect(inject('dbUrls'));
let f: TwoFirms;
const A = () => db.forBusiness(f.firmA);
const B = () => db.forBusiness(f.firmB);

beforeAll(async () => {
  f = await createTwoFirms(owner, 'r1is');
});

describe('isolation', () => {
  it("another firm never sees or changes a firm's job titles or security defaults", async () => {
    const title = await A().staffJobTitle.create({
      data: { businessId: f.firmA, name: 'Tax Preparer', createdByUserId: f.memberA },
    });
    await A().staffSecurityDefaults.create({
      data: { businessId: f.firmA, restrictDevices: true },
    });

    expect(await B().staffJobTitle.findMany()).toEqual([]);
    expect(await B().staffSecurityDefaults.findMany()).toEqual([]);
    const { count } = await B().staffJobTitle.updateMany({
      where: { id: title.id },
      data: { name: 'Taken' },
    });
    expect(count).toBe(0);
    expect(
      await failure(B().staffJobTitle.create({ data: { businessId: f.firmA, name: 'Sneaky' } })),
    ).toMatch(/row-level security/i);
    expect(
      await failure(B().staffSecurityDefaults.create({ data: { businessId: f.firmA } })),
    ).toMatch(/row-level security/i);
  });

  it("a job title's creator is a member of the same firm", async () => {
    expect(
      await failure(
        A().staffJobTitle.create({
          data: { businessId: f.firmA, name: 'Bookkeeper', createdByUserId: f.memberB },
        }),
      ),
    ).toMatch(/foreign key/i);
  });
});

describe('intake settings (I7, I8, I9, I12)', () => {
  const save = (
    firm: () => ReturnType<typeof A>,
    businessId: string,
    data: Record<string, unknown>,
  ) =>
    firm().intakeSettings.upsert({
      where: { businessId },
      create: { businessId, ...data },
      update: data,
    });

  it('defaults to 3 and 7 days, a 24-hour alert, no extra emails and no retention period', async () => {
    const row = await save(B, f.firmB, {});
    expect(row).toMatchObject({
      firstReminderMinutes: 4320,
      finalReminderMinutes: 10080,
      expiryAlertMinutes: 1440,
      notifyAdditionalEmails: [],
      dataRetentionYears: null,
    });
  });

  it('keeps the reminders in range and the final after the first', async () => {
    await save(A, f.firmA, { firstReminderMinutes: 5, finalReminderMinutes: 30 });
    for (const data of [
      { firstReminderMinutes: 4, finalReminderMinutes: 30 },
      { firstReminderMinutes: 43201, finalReminderMinutes: 86400 },
      { firstReminderMinutes: 60, finalReminderMinutes: 60 },
      { firstReminderMinutes: 60, finalReminderMinutes: 86401 },
    ]) {
      expect(await failure(save(A, f.firmA, data))).toMatch(/intake_settings_ranges/);
    }
  });

  it('takes no alert (null) or 30 minutes to 7 days', async () => {
    await save(A, f.firmA, { expiryAlertMinutes: null });
    await save(A, f.firmA, { expiryAlertMinutes: 30 });
    await save(A, f.firmA, { expiryAlertMinutes: 10080 });
    for (const expiryAlertMinutes of [29, 10081]) {
      expect(await failure(save(A, f.firmA, { expiryAlertMinutes }))).toMatch(
        /intake_settings_expiry_alert_minutes/,
      );
    }
  });

  it('takes a retention period of 1 to 100 years, or none', async () => {
    await save(A, f.firmA, { dataRetentionYears: 7 });
    await save(A, f.firmA, { dataRetentionYears: null });
    for (const dataRetentionYears of [0, 101]) {
      expect(await failure(save(A, f.firmA, { dataRetentionYears }))).toMatch(
        /intake_settings_data_retention_years/,
      );
    }
  });

  it('takes at most 10 extra emails, never null', async () => {
    const ten = Array.from({ length: 10 }, (_, i) => `staff${i}@example.test`);
    await save(A, f.firmA, { notifyAdditionalEmails: ten });
    expect(
      await failure(
        save(A, f.firmA, { notifyAdditionalEmails: [...ten, 'one.more@example.test'] }),
      ),
    ).toMatch(/intake_settings_notify_additional_emails/);
    // Prisma never sends a null list, so the rule is checked with SQL in the firm's scope.
    expect(
      await failure(
        runInScope(
          owner,
          { kind: 'business', businessId: f.firmA },
          (tx) => tx.$executeRaw`UPDATE intake_settings SET notify_additional_emails = NULL
                                  WHERE business_id = ${f.firmA}::uuid`,
        ),
      ),
    ).toMatch(/intake_settings_notify_additional_emails/);
  });
});

describe('saved job titles (SM3)', () => {
  it('are trimmed, 1 to 80 characters, and unique ignoring case while active', async () => {
    for (const name of ['', ' Padded ', 'x'.repeat(81)]) {
      expect(
        await failure(A().staffJobTitle.create({ data: { businessId: f.firmA, name } })),
      ).toMatch(/staff_job_titles_name/);
    }
    const first = await A().staffJobTitle.create({
      data: { businessId: f.firmA, name: 'Senior Accountant' },
    });
    expect(
      await failure(
        A().staffJobTitle.create({ data: { businessId: f.firmA, name: 'senior accountant' } }),
      ),
    ).toMatch(/unique/i);
    // Another firm may use the same name, and an archived title frees it.
    await B().staffJobTitle.create({ data: { businessId: f.firmB, name: 'Senior Accountant' } });
    await A().staffJobTitle.update({ where: { id: first.id }, data: { archivedAt: new Date() } });
    await A().staffJobTitle.create({ data: { businessId: f.firmA, name: 'SENIOR ACCOUNTANT' } });
  });

  it('are archived, never deleted', async () => {
    const t = await A().staffJobTitle.create({ data: { businessId: f.firmA, name: 'Archivist' } });
    expect(await failure(A().staffJobTitle.delete({ where: { id: t.id } }))).toMatch(
      /permission denied/i,
    );
  });
});

describe('security defaults for new accounts (SM3)', () => {
  it('are one row per firm with the account defaults', async () => {
    const row = await B().staffSecurityDefaults.upsert({
      where: { businessId: f.firmB },
      create: { businessId: f.firmB },
      update: {},
    });
    expect(row).toMatchObject({
      allowedAuthMethods: ['AUTHENTICATOR_APP', 'BACKUP_CODES'],
      accessLocation: 'ANYWHERE',
      allowedIps: [],
      allowedCountries: [],
      maxConcurrentSessions: 1,
      autoLogoutMinutes: null,
      notifyLockouts: true,
    });
    expect(
      await failure(B().staffSecurityDefaults.create({ data: { businessId: f.firmB } })),
    ).toMatch(/unique/i);
  });

  it('follow the account rules: the location matches its list, values in range', async () => {
    const set = (data: Record<string, unknown>) =>
      B().staffSecurityDefaults.update({ where: { businessId: f.firmB }, data });
    await set({ accessLocation: 'ALLOWED_IPS', allowedIps: ['203.0.113.7', '203.0.113.0/24'] });
    await set({ accessLocation: 'ANYWHERE', allowedIps: [] });
    for (const data of [
      { accessLocation: 'ALLOWED_IPS', allowedIps: [] },
      { accessLocation: 'ANYWHERE', allowedCountries: ['US'] },
      { allowedIps: ['not-an-ip'], accessLocation: 'ALLOWED_IPS' },
      { autoLogoutMinutes: 4 },
      { maxConcurrentSessions: 11 },
      { allowedAuthMethods: [] },
    ]) {
      expect(await failure(set(data))).toMatch(/staff_security_defaults_rules/);
    }
  });
});
