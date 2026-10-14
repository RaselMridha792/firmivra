// R36 (Messages, r36_outbound_messages): New Message and Send Bulk Message: the composed message or
// campaign, with the safeguards the database keeps (status path, content fixed once sending, the
// confirmation above the firm's bulk threshold). Runs as the app role under RLS.
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
  await runInScope(owner, { kind: 'business', businessId: f.firmA }, (tx) =>
    tx.membership.create({ data: { ...A(), userId: staff, role: 'STAFF', status: 'ACTIVE' } }),
  );
  await firmA().messageSettings.create({ data: { ...A(), bulkConfirmThreshold: 2 } });
});

afterAll(async () => {
  await Promise.all([owner.$disconnect(), app.$disconnect(), db.disconnect()]);
});

describe('outbound messages', () => {
  it("start as a draft with the screen's defaults", async () => {
    expect(await message()).toMatchObject({
      status: 'DRAFT',
      kind: 'DIRECT',
      requestReadReceipt: false,
      addToTimeline: true,
      sendCopyToSender: false,
      notifyOnComplete: false,
      totalCount: null,
    });
  });

  it('are never created finished, and keep body, subject and SMS length bounded', async () => {
    await expect(message({ status: 'SENT', completedAt: now() })).rejects.toThrow(
      /starts as a draft/,
    );
    await expect(message({ body: ' ' })).rejects.toThrow(/check constraint/i);
    await expect(message({ body: 'x'.repeat(10001) })).rejects.toThrow(/check constraint/i);
    await expect(message({ subject: 'x'.repeat(201) })).rejects.toThrow(/check constraint/i);
    await expect(message({ channel: 'SMS', body: 'x'.repeat(1601) })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(message({ channel: 'SMS', body: 'x'.repeat(1600) })).resolves.toBeTruthy();
  });

  it('email has its subject once it is more than a draft; scheduling needs a time', async () => {
    await expect(message({ channel: 'EMAIL' })).resolves.toBeTruthy(); // a draft may wait
    await expect(
      message({
        channel: 'EMAIL',
        status: 'SCHEDULED',
        scheduledFor: new Date(Date.now() + 3_600_000),
      }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      message({
        channel: 'EMAIL',
        subject: 'Update',
        status: 'SCHEDULED',
        scheduledFor: new Date(Date.now() + 3_600_000),
      }),
    ).resolves.toBeTruthy();
    await expect(message({ status: 'SCHEDULED' })).rejects.toThrow(/check constraint/i);
  });

  it('name the record they are about, both fields or neither', async () => {
    await expect(message({ relatedEntityType: 'invoice' })).rejects.toThrow(/check constraint/i);
    await expect(
      message({ relatedEntityType: 'Invoice 1', relatedEntityId: randomUUID() }),
    ).rejects.toThrow(/check constraint/i);
    await expect(
      message({ relatedEntityType: 'invoice', relatedEntityId: randomUUID() }),
    ).resolves.toBeTruthy();
  });

  it('a bulk message has its audience and filters, and counts that add up; a direct one has neither', async () => {
    await expect(message({ kind: 'BULK' })).rejects.toThrow(/check constraint/i);
    await expect(message({ audience: 'LEADS' })).rejects.toThrow(/check constraint/i);
    await expect(message({ audienceFilters: { a: 1 } })).rejects.toThrow(/check constraint/i);
    await expect(bulk({ audienceFilters: ['not', 'an', 'object'] })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(bulk({ audienceFilters: { big: 'x'.repeat(9000) } })).rejects.toThrow(
      /check constraint/i,
    );
    await expect(
      bulk({ totalCount: 124, canReceiveCount: 118, cannotReceiveCount: 6 }),
    ).resolves.toBeTruthy();
    await expect(
      bulk({ totalCount: 124, canReceiveCount: 118, cannotReceiveCount: 5 }),
    ).rejects.toThrow(/check constraint/i);
    await expect(bulk({ totalCount: 124 })).rejects.toThrow(/check constraint/i);
    await expect(bulk({ audience: 'BOTH' })).resolves.toBeTruthy();
  });

  it("use the firm's own (R39) template, author and owner", async () => {
    const theirs = await firmB().messageTemplate.create({
      data: {
        businessId: f.firmB,
        kind: 'EMAIL',
        name: `B ${f.run}`,
        body: 'b',
        ownerUserId: staff,
      },
    });
    await expect(message({ templateId: theirs.id })).rejects.toThrow(/foreign key/i);
    await expect(message({ createdByUserId: randomUUID() })).rejects.toThrow(/foreign key/i);
    await expect(message({ assignedUserId: staff })).resolves.toBeTruthy();
  });
});

describe('status path and fixed content', () => {
  it('goes draft, scheduled or sending, then sent; the text changes until it is sending', async () => {
    const m = await message({ channel: 'EMAIL', subject: 'Hello' });
    await expect(setMessage(m.id, { body: 'Changed while a draft' })).resolves.toBeTruthy();
    const when = new Date(Date.now() + 3_600_000);
    await setMessage(m.id, { status: 'SCHEDULED', scheduledFor: when });
    await expect(
      setMessage(m.id, {
        body: 'Changed while scheduled',
        scheduledFor: new Date(when.getTime() + 60_000),
      }),
    ).resolves.toBeTruthy();
    await expect(setMessage(m.id, { status: 'DRAFT' })).resolves.toBeTruthy(); // schedule can be cancelled back
    await setMessage(m.id, { status: 'SENDING' });
    await expect(setMessage(m.id, { body: 'Too late' })).rejects.toThrow(/no longer changes/);
    await expect(setMessage(m.id, { subject: 'Too late' })).rejects.toThrow(/no longer changes/);
    await expect(setMessage(m.id, { status: 'DRAFT' })).rejects.toThrow(/cannot go from SENDING/);
    await expect(setMessage(m.id, { status: 'SENT', completedAt: now() })).resolves.toMatchObject({
      status: 'SENT',
    });
  });

  it('a finished or canceled message is final, and cancel is only before sending', async () => {
    const sent = await message();
    await setMessage(sent.id, { status: 'SENDING' });
    await setMessage(sent.id, { status: 'SENT', completedAt: now() });
    await expect(setMessage(sent.id, { body: 'Edit' })).rejects.toThrow(/final/);
    await expect(setMessage(sent.id, { status: 'CANCELED', canceledAt: now() })).rejects.toThrow(
      /final/,
    );
    const draft = await message();
    await expect(setMessage(draft.id, { status: 'CANCELED' })).rejects.toThrow(/check constraint/i); // needs canceledAt
    await expect(
      setMessage(draft.id, { status: 'CANCELED', canceledAt: now() }),
    ).resolves.toBeTruthy();
    await expect(setMessage(draft.id, { status: 'DRAFT', canceledAt: null })).rejects.toThrow(
      /final/,
    );
    const sending = await message();
    await setMessage(sending.id, { status: 'SENDING' });
    await expect(setMessage(sending.id, { status: 'CANCELED', canceledAt: now() })).rejects.toThrow(
      /cannot go from SENDING/,
    );
  });

  it('the kind and the author never change', async () => {
    const m = await message();
    await expect(setMessage(m.id, { createdByUserId: randomUUID() })).rejects.toThrow(
      /never change|foreign key/,
    );
    await expect(setMessage(m.id, { kind: 'BULK', audience: 'CLIENTS' })).rejects.toThrow(
      /never change/,
    );
  });

  it("a bulk send above the firm's threshold needs its confirmation first", async () => {
    const big = await bulk({ totalCount: 3, canReceiveCount: 3, cannotReceiveCount: 0 });
    await expect(setMessage(big.id, { status: 'SENDING' })).rejects.toThrow(/confirmation/);
    await expect(
      setMessage(big.id, { status: 'SENDING', highVolumeConfirmedAt: now() }),
    ).resolves.toBeTruthy();
    const small = await bulk({ totalCount: 2, canReceiveCount: 2, cannotReceiveCount: 0 });
    await expect(setMessage(small.id, { status: 'SENDING' })).resolves.toBeTruthy();
    const direct = await message({});
    await expect(setMessage(direct.id, { status: 'SENDING' })).resolves.toBeTruthy();
  });
});

describe('isolation between firms', () => {
  it('messages are invisible to another firm; nothing crosses', async () => {
    await message();
    await expectInvisibleToOtherFirm(app, f.firmA, f.firmB, ['outbound_messages']);
    await expect(
      firmB().outboundMessage.create({
        data: { ...A(), kind: 'DIRECT', channel: 'PORTAL', body: 'x', createdByUserId: staff },
      }),
    ).rejects.toThrow(/row-level security|foreign key/i);
  });
});
