// R36 (Messages, r36_outbound_recipients): each recipient of an outbound message and the outcome,
// with the safeguards the database keeps (added only while the message can still change, never
// sent twice, opt-outs respected on bulk sends, a finished message that matches its recipients).
// Runs as the app role under RLS.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createDatabase, createPrismaClient, runInScope } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';
import { createFirms, expectInvisibleToOtherFirm } from './r36-helpers.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);
const db = createDatabase(urls.app, TEST_CLIENT_OPTIONS);

let f: Awaited<ReturnType<typeof createFirms>>;
const staff = randomUUID();
const ids = { lead: '', otherClient: '', thread: '', message: '', otherThreadMessage: '' };
const A = () => ({ businessId: f.firmA });
const firmA = () => db.forBusiness(f.firmA);
const firmB = () => db.forBusiness(f.firmB);
const message = (data: Record<string, unknown> = {}) =>
  firmA().outboundMessage.create({
    data: {
      ...A(),
      kind: 'DIRECT',
      channel: 'PORTAL',
      body: 'Hi {{first_name}}',
      createdByUserId: staff,
      ...data,
    },
  });
const bulk = (data: Record<string, unknown> = {}) =>
  message({
    kind: 'BULK',
    audience: 'CLIENTS',
    audienceFilters: { services: ['payroll'] },
    ...data,
  });
const setMessage = (id: string, data: Record<string, unknown>) =>
  firmA().outboundMessage.update({ where: { id }, data });
const recipient = (outboundMessageId: string, data: Record<string, unknown> = {}) =>
  firmA().outboundMessageRecipient.create({
    data: { ...A(), outboundMessageId, clientId: f.client, channel: 'PORTAL', ...data },
  });
const setRecipient = (id: string, data: Record<string, unknown>) =>
  firmA().outboundMessageRecipient.update({ where: { id }, data });
const now = () => new Date();

beforeAll(async () => {
  f = await createFirms(owner, 'om');
  await runInScope(owner, { kind: 'platform' }, (tx) =>
    tx.user.create({
      data: {
        id: staff,
        cognitoSub: staff,
        pool: 'STAFF',
        email: `s-${f.run}@om.test`,
        name: 'Fake Staff',
      },
    }),
  );
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, async (tx) => {
    await tx.membership.create({
      data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' },
    });
    const service = await tx.service.create({
      data: { ...A(), kind: 'ANNUAL_TAX', name: `Tax ${f.run}` },
    });
    ids.lead = (
      await tx.lead.create({
        data: {
          ...A(),
          serviceId: service.id,
          firstName: 'Fake',
          lastName: 'Lead',
          email: `l-${f.run}@om.test`,
        },
      })
    ).id;
    ids.otherClient = (await tx.client.create({ data: { ...A(), displayName: 'Other' } })).id;
    ids.thread = (
      await tx.messageThread.create({ data: { ...A(), clientId: f.client, subject: 'Hello' } })
    ).id;
    ids.message = (
      await tx.message.create({
        data: {
          ...A(),
          threadId: ids.thread,
          senderUserId: staff,
          direction: 'FIRM_TO_CLIENT',
          body: 'Hello',
        },
      })
    ).id;
    const other = await tx.messageThread.create({
      data: { ...A(), clientId: ids.otherClient, subject: 'Other' },
    });
    ids.otherThreadMessage = (
      await tx.message.create({
        data: {
          ...A(),
          threadId: other.id,
          senderUserId: staff,
          direction: 'FIRM_TO_CLIENT',
          body: 'Hi other',
        },
      })
    ).id;
  });
  await firmA().messageSettings.create({ data: { ...A(), bulkConfirmThreshold: 2 } });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('recipients', () => {
  it('are added while the message is a draft or scheduled, on its channel, queued or skipped', async () => {
    const m = await message();
    await expect(recipient(m.id)).resolves.toMatchObject({ status: 'QUEUED', attempts: 0 });
    await expect(recipient(m.id)).rejects.toThrow(/unique/i);
    await expect(recipient(m.id, { clientId: ids.otherClient, channel: 'EMAIL' })).rejects.toThrow(
      /on its channel/,
    );
    await expect(recipient(m.id, { clientId: ids.otherClient, status: 'SENT' })).rejects.toThrow(
      /queued or skipped/,
    );
    await setMessage(m.id, { status: 'SENDING' });
    await expect(recipient(m.id, { clientId: ids.otherClient })).rejects.toThrow(
      /draft or scheduled/,
    );
  });

  it('are a client or a lead, once per message and channel; a skip has its reason', async () => {
    const m = await message({ channel: 'EMAIL', subject: 'Hello' });
    await expect(
      recipient(m.id, { channel: 'EMAIL', clientId: null, leadId: ids.lead }),
    ).resolves.toBeTruthy();
    await expect(
      recipient(m.id, { channel: 'EMAIL', clientId: null, leadId: ids.lead }),
    ).rejects.toThrow(/unique/i);
    await expect(recipient(m.id, { channel: 'EMAIL', leadId: ids.lead })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(recipient(m.id, { channel: 'EMAIL', clientId: null })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      recipient(m.id, { channel: 'EMAIL', clientId: ids.otherClient, status: 'SKIPPED' }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      recipient(m.id, { channel: 'EMAIL', clientId: ids.otherClient, exclusion: 'NO_CONTACT' }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      recipient(m.id, {
        channel: 'EMAIL',
        clientId: ids.otherClient,
        status: 'SKIPPED',
        exclusion: 'NO_CONTACT',
      }),
    ).resolves.toBeTruthy();
  });

  it('keep their outcome: queued, sent, delivered, read; failed is retried, never after sent', async () => {
    const m = await message();
    const r = await recipient(m.id);
    await expect(setRecipient(r.id, { status: 'SENT' })).rejects.toThrow(/check constraint/i); // needs sentAt
    await expect(
      setRecipient(r.id, { status: 'FAILED', attempts: 1, lastError: 'provider_unavailable' }),
    ).resolves.toBeTruthy();
    await expect(
      setRecipient(r.id, { status: 'FAILED', lastError: 'Provider said no!' }),
    ).rejects.toThrow(/check constraint/i);
    await expect(setRecipient(r.id, { status: 'QUEUED', attempts: 0 })).rejects.toThrow(
      /attempts only go up/,
    );
    await setRecipient(r.id, { status: 'QUEUED', attempts: 2 }); // the retry
    await setRecipient(r.id, {
      status: 'SENT',
      attempts: 3,
      sentAt: now(),
      providerMessageId: 'msg_123',
    });
    for (const status of ['QUEUED', 'FAILED', 'SKIPPED'] as const) {
      await expect(setRecipient(r.id, { status, sentAt: null })).rejects.toThrow(
        /never sent twice|check constraint/i,
      );
    }
    await expect(setRecipient(r.id, { sentAt: new Date('2000-01-01') })).rejects.toThrow(
      /set once/,
    );
    await expect(
      setRecipient(r.id, { status: 'DELIVERED', deliveredAt: now() }),
    ).resolves.toBeTruthy();
    await expect(setRecipient(r.id, { status: 'READ', readAt: now() })).resolves.toMatchObject({
      status: 'READ',
    });
    await expect(setRecipient(r.id, { clientId: ids.otherClient })).rejects.toThrow(/never change/);
  });

  it('finishing needs no queued recipient, and the outcome matches the recipients', async () => {
    const make = async () => {
      const m = await message();
      const a = await recipient(m.id);
      const b = await recipient(m.id, { clientId: ids.otherClient });
      await setMessage(m.id, { status: 'SENDING' });
      return { m, a, b };
    };
    const send = (id: string) => setRecipient(id, { status: 'SENT', sentAt: now(), attempts: 1 });
    const fail = (id: string) =>
      setRecipient(id, { status: 'FAILED', attempts: 1, lastError: 'bounced' });
    const finish = (id: string, status: 'SENT' | 'PARTIAL' | 'FAILED') =>
      setMessage(id, { status, completedAt: now() });
    const one = await make();
    await expect(finish(one.m.id, 'SENT')).rejects.toThrow(/still queued/);
    await send(one.a.id);
    await fail(one.b.id);
    await expect(finish(one.m.id, 'SENT')).rejects.toThrow(/outcome must match/);
    await expect(finish(one.m.id, 'FAILED')).rejects.toThrow(/outcome must match/);
    await expect(finish(one.m.id, 'PARTIAL')).resolves.toMatchObject({ status: 'PARTIAL' });
    const two = await make();
    await fail(two.a.id);
    await fail(two.b.id);
    await expect(finish(two.m.id, 'PARTIAL')).rejects.toThrow(/outcome must match/);
    await expect(finish(two.m.id, 'FAILED')).resolves.toBeTruthy();
    const three = await make();
    await send(three.a.id);
    await setRecipient(three.b.id, { status: 'SKIPPED', exclusion: 'NO_CONTACT' });
    await expect(finish(three.m.id, 'SENT')).resolves.toBeTruthy();
  });

  it('a bulk send never goes to a contact who opted out of the channel; a direct message can', async () => {
    await firmA().communicationConsent.create({
      data: {
        ...A(),
        clientId: ids.otherClient,
        channel: 'EMAIL',
        status: 'OPTED_OUT',
        source: 'unsubscribe_link',
      },
    });
    const b = await bulk({ channel: 'EMAIL', subject: 'News' });
    await expect(recipient(b.id, { channel: 'EMAIL', clientId: ids.otherClient })).rejects.toThrow(
      /opted out/,
    );
    await expect(
      recipient(b.id, {
        channel: 'EMAIL',
        clientId: ids.otherClient,
        status: 'SKIPPED',
        exclusion: 'SUPPRESSED',
      }),
    ).resolves.toBeTruthy();
    const portal = await bulk();
    await expect(recipient(portal.id, { clientId: ids.otherClient })).resolves.toBeTruthy(); // the portal has no opt-out
    const d = await message({ channel: 'EMAIL', subject: 'Hi' });
    await expect(
      recipient(d.id, { channel: 'EMAIL', clientId: ids.otherClient }),
    ).resolves.toBeTruthy();
  });

  it("a portal delivery links the message it made, in this client's own thread", async () => {
    const m = await message();
    await expect(recipient(m.id, { messageId: ids.otherThreadMessage })).rejects.toThrow(
      /own thread/,
    );
    const r = await recipient(m.id);
    await expect(setRecipient(r.id, { messageId: ids.message })).resolves.toBeTruthy();
    const email = await message({ channel: 'EMAIL', subject: 'x' });
    await expect(recipient(email.id, { channel: 'EMAIL', messageId: ids.message })).rejects.toThrow(
      /own thread/,
    );
  });
});

describe('outbound message files', () => {
  const file = (outboundMessageId: string, data: Record<string, unknown> = {}) =>
    firmA().outboundMessageFile.create({
      data: {
        ...A(),
        outboundMessageId,
        fileName: 'Tax_Preparation_Checklist.pdf',
        contentType: 'application/pdf',
        sizeBytes: 428_000,
        sha256: 'a'.repeat(64),
        s3Key: `tenant/${f.firmA}/messages/${randomUUID()}`,
        uploadedByUserId: staff,
        ...data,
      },
    });

  it("start unscanned, under the firm's own prefix, bounded; the scan result is set once", async () => {
    const m = await message();
    const row = await file(m.id);
    expect(row.scanStatus).toBe('PENDING');
    await expect(file(m.id, { scanStatus: 'CLEAN', scannedAt: now() })).rejects.toThrow(
      /starts unscanned/,
    );
    await expect(file(m.id, { s3Key: `tenant/${f.firmB}/messages/x` })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(file(m.id, { s3Key: `tenant/${f.firmA}/documents/x` })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(file(m.id, { sizeBytes: 26_214_401 })).rejects.toThrow(/check constraint/i);
    await expect(file(m.id, { sha256: 'xyz' })).rejects.toThrow(/check constraint/i);
    await expect(file(m.id, { contentType: 'PDF' })).rejects.toThrow(/check constraint/i);
    await expect(file(m.id, { fileName: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(file(m.id, { s3Key: row.s3Key })).rejects.toThrow(/unique/i);
    const scan = (data: Record<string, unknown>) =>
      firmA().outboundMessageFile.update({ where: { id: row.id }, data });
    await expect(scan({ scanStatus: 'CLEAN' })).rejects.toThrow(/check constraint/i);
    await expect(scan({ fileName: 'other.pdf' })).rejects.toThrow(/fixed/);
    await expect(scan({ scanStatus: 'CLEAN', scannedAt: now() })).resolves.toMatchObject({
      scanStatus: 'CLEAN',
    });
    await expect(scan({ scanStatus: 'INFECTED', scannedAt: now() })).rejects.toThrow(/set once/);
  });

  it('join and leave only while the message is a draft or scheduled', async () => {
    const m = await message();
    const row = await file(m.id);
    await expect(
      firmA().outboundMessageFile.delete({ where: { id: row.id } }),
    ).resolves.toBeTruthy();
    const kept = await file(m.id);
    await setMessage(m.id, { status: 'SENDING' });
    await expect(file(m.id)).rejects.toThrow(/draft or scheduled/);
    await expect(firmA().outboundMessageFile.delete({ where: { id: kept.id } })).rejects.toThrow(
      /draft or scheduled/,
    );
  });

  it("are the firm's own and invisible to another firm", async () => {
    const m = await message();
    await file(m.id);
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['outbound_message_files']);
    await expect(
      firmB().outboundMessageFile.create({
        data: {
          businessId: f.firmB,
          outboundMessageId: m.id,
          fileName: 'x.pdf',
          contentType: 'application/pdf',
          sizeBytes: 1,
          sha256: 'b'.repeat(64),
          s3Key: `tenant/${f.firmB}/messages/${randomUUID()}`,
          uploadedByUserId: staff,
        },
      }),
    ).rejects.toThrow(/foreign key|draft or scheduled/i);
  });
});

describe('isolation between firms', () => {
  it('recipients are invisible to another firm; nothing crosses', async () => {
    const m = await message();
    await recipient(m.id);
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['outbound_message_recipients']);
    await expect(
      firmB().outboundMessageRecipient.create({
        data: {
          businessId: f.firmB,
          outboundMessageId: m.id,
          clientId: ids.otherClient,
          channel: 'PORTAL',
        },
      }),
    ).rejects.toThrow(/foreign key/i);
  });
});
