// R36 (Messages, r36_message_settings): the Messages settings and member signatures.
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const settings = (data: Record<string, unknown> = {}) =>
  firmA().messageSettings.upsert({
    where: { businessId: f.firmA },
    create: { ...A(), ...data },
    update: data,
  });

beforeAll(async () => {
  f = await createFirms(owner, 'ms');
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    await tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@ms.test`,
        name: 'Fake Staff',
      },
    });
  });
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
  });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('message settings', () => {
  it('are one row per firm, with the defaults: portal and email on, SMS off, 10 MB, bulk confirm at 100', async () => {
    expect(await settings()).toMatchObject({
      portalEnabled: true,
      emailEnabled: true,
      smsEnabled: false,
      readReceiptsEnabled: false,
      retentionMonths: null,
      attachmentMaxMb: 10,
      allowedAttachmentTypes: ['pdf', 'doc', 'docx', 'jpg', 'png'],
      bulkConfirmThreshold: 100,
      bulkRequiresManager: true,
      notifyUnread: true,
      notifyBulkComplete: true,
    });
    await expect(firmA().messageSettings.create({ data: { ...A() } })).rejects.toThrow(/unique/i);
  });

  it('bound the texts, retention, attachment limits, file types and the bulk threshold', async () => {
    await expect(settings({ senderName: 'x'.repeat(101) })).rejects.toThrow(/check constraint/i);
    await expect(settings({ signature: 'x'.repeat(1001) })).rejects.toThrow(/check constraint/i);
    await expect(settings({ retentionMonths: 0 })).rejects.toThrow(/check constraint/i);
    await expect(settings({ retentionMonths: 24 })).resolves.toBeTruthy();
    await expect(settings({ attachmentMaxMb: 0 })).rejects.toThrow(/check constraint/i);
    await expect(settings({ attachmentMaxMb: 26 })).rejects.toThrow(/check constraint/i);
    await expect(settings({ allowedAttachmentTypes: ['pdf', 'exe'] })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      settings({ allowedAttachmentTypes: ['pdf', 'xlsx', 'csv'] }),
    ).resolves.toBeTruthy();
    await expect(settings({ bulkConfirmThreshold: 0 })).rejects.toThrow(/check constraint/i);
    await expect(settings({ bulkConfirmThreshold: 100001 })).rejects.toThrow(/check constraint/i);
  });

  it('quiet hours are both ends or none', async () => {
    const t = (h: number) => new Date(Date.UTC(1970, 0, 1, h));
    await expect(settings({ quietHoursStart: t(21) })).rejects.toThrow(/check constraint/i);
    await expect(settings({ quietHoursStart: t(21), quietHoursEnd: t(7) })).resolves.toBeTruthy();
    await expect(settings({ quietHoursStart: null, quietHoursEnd: null })).resolves.toBeTruthy();
  });

  it('name a default owner and the member who changed them, from this firm', async () => {
    await expect(settings({ defaultAssigneeUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(
      settings({ defaultAssigneeUserId: staff, updatedByUserId: staff }),
    ).resolves.toBeTruthy();
    await expect(settings({ updatedByUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
  });

  it('are invisible to another firm and cannot be written for another', async () => {
    await settings();
    await firmB().messageSettings.create({ data: { businessId: f.firmB } });
    const seen = await runInScope(app, { kind: 'business', businessId: f.firmB }, (tx) =>
      tx.$queryRawUnsafe<{ n: number }[]>(
        `SELECT count(*)::int AS n FROM message_settings WHERE business_id = '${f.firmA}'::uuid`,
      ),
    );
    expect(seen[0]?.n).toBe(0);
    await expect(firmB().messageSettings.create({ data: { ...A() } })).rejects.toThrow(
      /row-level security|unique/i,
    );
  });
});

describe('message signatures', () => {
  it('are one per member, bounded, and the member is of this firm', async () => {
    const make = (data: Record<string, unknown> = {}) =>
      firmA().messageSignature.create({
        data: { ...A(), userId: staff, body: 'Best regards,\nOctavia', ...data },
      });
    await expect(make({ body: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(make({ body: 'x'.repeat(1001) })).rejects.toThrow(/check constraint/i);
    await expect(make({ userId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(make()).resolves.toBeTruthy();
    await expect(make()).rejects.toThrow(/unique/i);
    await expect(
      firmB().messageSignature.create({ data: { businessId: f.firmB, userId: staff, body: 'x' } }),
    ).rejects.toThrow(/foreign key/i);
  });
});
