// R0 stage B6 (Oct 18): Super Admin Communications. Firmivra's own conversations, messages,
// templates, library files, segments and broadcasts. The database keeps the send lifecycle
// (drafts and schedules editable, content fixed once dispatch begins, only drafts deleted),
// checks each destination against its channel, and lets no firm scope reach any of it.
import { createHash, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { createPrismaClient, runInScope, type TxClient } from '../src/client.js';
import { TEST_CLIENT_OPTIONS } from '../src/testing.js';

const urls = inject('dbUrls');
const owner = createPrismaClient(urls.owner, TEST_CLIENT_OPTIONS);
const app = createPrismaClient(urls.app, TEST_CLIENT_OPTIONS);

const run = randomUUID().slice(0, 8);
const ids = {
  admin: randomUUID(),
  other: randomUUID(),
  firm: '',
  firmUser: randomUUID(),
  category: '',
};

const asAdmin = <T>(fn: (tx: TxClient) => Promise<T>, adminUserId = ids.admin) =>
  runInScope(app, { kind: 'admin', adminUserId }, fn);
const asPlatform = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'platform' }, fn);
const asFirm = <T>(fn: (tx: TxClient) => Promise<T>) =>
  runInScope(app, { kind: 'business', businessId: ids.firm }, fn);
/** Settles a promise into its error message (or 'ok'), so a rejection is never unhandled. */
const outcome = (promise: Promise<unknown>) =>
  promise.then(
    () => 'ok',
    (error: unknown) => (error instanceof Error ? error.message : String(error)),
  );

beforeAll(async () => {
  await runInScope(owner, { kind: 'platform' }, async (tx) => {
    for (const id of [ids.admin, ids.other]) {
      await tx.user.create({
        data: { id, cognitoSub: id, pool: 'ADMIN', email: `${id}@sup.test`, name: 'Fake' },
      });
      await tx.platformAdmin.create({ data: { userId: id, role: 'SUPER_ADMIN' } });
    }
    ids.firm = (await tx.business.create({ data: { slug: `b6-${run}`, name: 'Firm' } })).id;
    ids.category = (
      await tx.commTemplateCategory.findUniqueOrThrow({ where: { systemKey: 'support' } })
    ).id;
  });
});

afterAll(async () => {
  await owner.$disconnect();
  await app.$disconnect();
});

const conversation = (extra: Record<string, unknown> = {}) =>
  asAdmin((tx) =>
    tx.commConversation.create({
      data: {
        contactType: 'FIRM',
        linkedBusinessId: ids.firm,
        contactUserId: ids.firmUser,
        contactName: 'Avery Stone',
        contactEmail: 'avery@firm.test',
        ...extra,
      },
    }),
  );
const draft = (conversationId: string, extra: Record<string, unknown> = {}) =>
  asAdmin((tx) =>
    tx.commMessage.create({
      data: {
        conversationId,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        subject: 'Your onboarding',
        body: '<p>Hello</p>',
        recipients: {
          create: [
            {
              contactType: 'FIRM',
              linkedBusinessId: ids.firm,
              contactUserId: ids.firmUser,
              name: 'Avery Stone',
              address: 'avery@firm.test',
            },
          ],
        },
        ...extra,
      },
      include: { recipients: true },
    }),
  );
const setMessage = (id: string, data: Record<string, unknown>) =>
  asAdmin((tx) => tx.commMessage.update({ where: { id }, data }));

describe('communications: who reaches it', () => {
  it('the team and the platform; no firm', async () => {
    const c = await conversation();
    expect(await asPlatform((tx) => tx.commConversation.count({ where: { id: c.id } }))).toBe(1);
    expect(await asFirm((tx) => tx.commConversation.count())).toBe(0);
    expect(await asFirm((tx) => tx.commTemplateCategory.count())).toBe(0);
    expect(
      await outcome(
        asFirm((tx) =>
          tx.commSegment.create({ data: { name: `From a firm ${run}`, definition: {} } }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("read marks are each team member's own", async () => {
    const c = await conversation();
    await asAdmin((tx) =>
      tx.commConversationRead.create({
        data: { conversationId: c.id, userId: ids.admin, lastReadAt: new Date('2020-01-01') },
      }),
    );
    const mine = await asAdmin((tx) =>
      tx.commConversationRead.findMany({ where: { conversationId: c.id } }),
    );
    expect(mine).toHaveLength(1);
    expect(mine[0]!.lastReadAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await asAdmin(
        (tx) => tx.commConversationRead.count({ where: { conversationId: c.id } }),
        ids.other,
      ),
    ).toBe(0);
    expect(
      await outcome(
        asAdmin(
          (tx) =>
            tx.commConversationRead.create({
              data: { conversationId: c.id, userId: ids.admin, lastReadAt: new Date() },
            }),
          ids.other,
        ),
      ),
    ).toMatch(/row-level security/);
  });
});

describe('communications: conversations', () => {
  it('name their contact by type, keep it, and only the database moves the last message time', async () => {
    expect(await outcome(conversation({ linkedBusinessId: null }))).toMatch(/names its contact/);
    expect(await outcome(conversation({ contactType: 'LEAD' }))).toMatch(/names its contact/);
    const c = await conversation();
    for (const data of [{ contactUserId: randomUUID() }, { lastMessageAt: new Date() }]) {
      expect(
        await outcome(asAdmin((tx) => tx.commConversation.update({ where: { id: c.id }, data }))),
      ).toMatch(/communications:/);
    }
    const note = await asAdmin((tx) =>
      tx.commMessage.create({
        data: {
          conversationId: c.id,
          channel: 'INTERNAL',
          direction: 'INTERNAL',
          status: 'SENT',
          body: 'Called them.',
        },
      }),
    );
    expect(note.senderUserId).toBe(ids.admin);
    const after = await asAdmin((tx) =>
      tx.commConversation.findUniqueOrThrow({ where: { id: c.id } }),
    );
    expect(after.lastMessageAt).toEqual(note.sentAt);
  });
});

describe('communications: the send lifecycle', () => {
  it('a draft is edited, scheduled and sent; then its content and recipients never change', async () => {
    const c = await conversation();
    const m = await draft(c.id);
    expect(m).toMatchObject({ status: 'DRAFT', senderUserId: ids.admin, sentAt: null });
    expect(
      await outcome(
        setMessage(m.id, { status: 'SCHEDULED', scheduledAt: new Date(Date.now() + 3_600_000) }),
      ),
    ).toMatch(/comm_messages_values/);
    expect(
      await outcome(
        setMessage(m.id, {
          status: 'SCHEDULED',
          scheduledAt: new Date(Date.now() - 3_600_000),
          scheduledTimeZone: 'America/New_York',
        }),
      ),
    ).toMatch(/scheduled for the future/);
    await setMessage(m.id, {
      status: 'SCHEDULED',
      scheduledAt: new Date(Date.now() + 3_600_000),
      scheduledTimeZone: 'America/New_York',
      body: '<p>Hello again</p>',
    });
    await asPlatform((tx) =>
      tx.commMessage.update({ where: { id: m.id }, data: { status: 'SENDING' } }),
    );
    expect(await outcome(setMessage(m.id, { body: '<p>Changed</p>' }))).toMatch(/never changes/);
    expect(
      await outcome(
        asAdmin((tx) => tx.commMessageRecipient.deleteMany({ where: { messageId: m.id } })),
      ),
    ).toMatch(/keeps its recipients/);
    const rid = m.recipients[0]!.id;
    await asPlatform((tx) =>
      tx.commMessageRecipient.update({
        where: { id: rid },
        data: { status: 'SENT', providerMessageId: 'ses-1' },
      }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.commMessageRecipient.update({ where: { id: rid }, data: { status: 'PENDING' } }),
        ),
      ),
    ).toMatch(/a SENT recipient cannot become PENDING/);
    const sent = await asPlatform((tx) =>
      tx.commMessage.update({ where: { id: m.id }, data: { status: 'SENT' } }),
    );
    expect(sent.sentAt).not.toBeNull();
    expect(await outcome(asAdmin((tx) => tx.commMessage.delete({ where: { id: m.id } })))).toMatch(
      /only a draft message is deleted/,
    );
    // A draft is deleted with its recipients.
    const d = await draft(c.id);
    await asAdmin((tx) => tx.commMessage.delete({ where: { id: d.id } }));
  });

  it('checks each destination against its channel, an email subject, and a double submission', async () => {
    const c = await conversation();
    const sms = (address: string, kind: 'TO' | 'CC' = 'TO') =>
      asAdmin((tx) =>
        tx.commMessage.create({
          data: {
            conversationId: c.id,
            channel: 'SMS',
            direction: 'OUTBOUND',
            body: 'Your call is at 10.',
            recipients: {
              create: [
                { kind, contactType: 'FIRM', linkedBusinessId: ids.firm, name: 'Avery', address },
              ],
            },
          },
        }),
      );
    expect(await outcome(sms('avery@firm.test'))).toMatch(/no valid SMS destination/);
    expect(await outcome(sms('+15125550147', 'CC'))).toMatch(/no valid SMS destination/);
    await expect(sms('+15125550147')).resolves.toMatchObject({ channel: 'SMS' });
    const noSubject = await draft(c.id, { subject: null });
    expect(await outcome(setMessage(noSubject.id, { status: 'SENDING' }))).toMatch(
      /comm_messages_values/,
    );
    const key = `send-${run}`;
    await draft(c.id, { idempotencyKey: key });
    expect(await outcome(draft(c.id, { idempotencyKey: key }))).toMatch(/Unique constraint/);
  });

  it('inbound mail is RECEIVED with no sender', async () => {
    const c = await conversation();
    const inbound = await asPlatform((tx) =>
      tx.commMessage.create({
        data: {
          conversationId: c.id,
          channel: 'EMAIL',
          direction: 'INBOUND',
          status: 'RECEIVED',
          subject: 'Re: hello',
          body: 'Thanks',
          fromAddress: 'avery@firm.test',
        },
      }),
    );
    expect(inbound).toMatchObject({ senderUserId: null });
    expect(inbound.sentAt).not.toBeNull();
  });
});

describe('communications: broadcasts', () => {
  const broadcast = async () => {
    const segment = await asAdmin((tx) =>
      tx.commSegment.create({
        data: { name: `Firms ${randomUUID().slice(0, 6)}`, definition: { contactTypes: ['FIRM'] } },
      }),
    );
    return asAdmin((tx) =>
      tx.commBroadcast.create({ data: { name: 'Product update', segmentId: segment.id } }),
    );
  };

  it('a send needs a channel and an audience; then only the results move', async () => {
    const b = await broadcast();
    const send = (data: Record<string, unknown> = {}) =>
      asAdmin((tx) =>
        tx.commBroadcast.update({ where: { id: b.id }, data: { status: 'SENDING', ...data } }),
      );
    expect(await outcome(send({ recipientCount: 3 }))).toMatch(/at least one channel/);
    await asAdmin((tx) =>
      tx.commBroadcastChannel.create({
        data: { broadcastId: b.id, channel: 'EMAIL', subject: 'Update', body: '<p>News</p>' },
      }),
    );
    expect(await outcome(send({ recipientCount: 0 }))).toMatch(/comm_broadcasts_values/);
    const sending = await send({ recipientCount: 2 });
    expect(sending.sendStartedAt).not.toBeNull();
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.commBroadcast.update({ where: { id: b.id }, data: { name: 'Renamed' } }),
        ),
      ),
    ).toMatch(/is not edited/);
    const recipient = (channel: 'EMAIL' | 'SMS', address: string) =>
      asPlatform((tx) =>
        tx.commBroadcastRecipient.create({
          data: {
            broadcastId: b.id,
            channel,
            contactType: 'FIRM',
            linkedBusinessId: ids.firm,
            name: 'Avery',
            address,
          },
        }),
      );
    expect(await outcome(recipient('SMS', '+15125550147'))).toMatch(/does not send on SMS/);
    const r1 = await recipient('EMAIL', 'avery@firm.test');
    await asPlatform((tx) =>
      tx.commBroadcastRecipient.update({
        where: { id: r1.id },
        data: { status: 'FAILED', errorCode: 'mailbox.full' },
      }),
    );
    await asPlatform((tx) =>
      tx.commBroadcast.update({
        where: { id: b.id },
        data: { status: 'FAILED', errorMessage: 'One recipient failed.' },
      }),
    );
    // A retry puts the failed recipient back in the queue; the first attempt stays in the audit log.
    await asAdmin((tx) =>
      tx.commBroadcast.update({ where: { id: b.id }, data: { status: 'SENDING' } }),
    );
    await expect(
      asPlatform((tx) =>
        tx.commBroadcastRecipient.update({ where: { id: r1.id }, data: { status: 'PENDING' } }),
      ),
    ).resolves.toMatchObject({ status: 'PENDING', errorCode: null });
    const done = await asPlatform((tx) =>
      tx.commBroadcast.update({ where: { id: b.id }, data: { status: 'SENT' } }),
    );
    expect(done.finishedAt).not.toBeNull();
    expect(
      await outcome(asAdmin((tx) => tx.commBroadcast.delete({ where: { id: b.id } }))),
    ).toMatch(/only a draft broadcast is deleted/);
    const archived = await asAdmin((tx) =>
      tx.commBroadcast.update({
        where: { id: b.id },
        data: { archivedAt: new Date('2020-01-01') },
      }),
    );
    expect(archived.archivedAt!.getTime()).toBeGreaterThan(Date.now() - 60_000);
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.commBroadcast.update({ where: { id: b.id }, data: { archivedAt: null } }),
        ),
      ),
    ).toMatch(/archived once/);
  });

  it('starts as a draft; recipients are resolved only while it sends', async () => {
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.commBroadcast.create({ data: { name: 'Sent at once', status: 'SENT' } }),
        ),
      ),
    ).toMatch(/starts as a draft/);
    const b = await broadcast();
    await asAdmin((tx) =>
      tx.commBroadcastChannel.create({ data: { broadcastId: b.id, channel: 'SMS', body: 'News' } }),
    );
    expect(
      await outcome(
        asPlatform((tx) =>
          tx.commBroadcastRecipient.create({
            data: {
              broadcastId: b.id,
              channel: 'SMS',
              contactType: 'FIRM',
              linkedBusinessId: ids.firm,
              name: 'A',
              address: '+15125550147',
            },
          }),
        ),
      ),
    ).toMatch(/resolved when the broadcast sends/);
    await asAdmin((tx) => tx.commBroadcast.delete({ where: { id: b.id } }));
  });
});

describe('communications: templates and the library', () => {
  it("email templates need a subject, SMS has none; merge fields are tokens; shipped keys are the migration's", async () => {
    const template = (data: Record<string, unknown>) =>
      asAdmin((tx) =>
        tx.commTemplate.create({
          data: {
            categoryId: ids.category,
            name: `T ${randomUUID().slice(0, 6)}`,
            body: 'Hi',
            ...data,
          },
        }),
      );
    expect(await outcome(template({ channel: 'EMAIL' }))).toMatch(/comm_templates_values/);
    expect(await outcome(template({ channel: 'SMS', subject: 'No' }))).toMatch(
      /comm_templates_values/,
    );
    expect(await outcome(template({ channel: 'SMS', mergeFields: ['{{firm.name}}'] }))).toMatch(
      /comm_templates_values/,
    );
    await expect(template({ channel: 'SMS', mergeFields: ['firm.name'] })).resolves.toMatchObject({
      createdByUserId: ids.admin,
    });
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.commTemplateCategory.create({
            data: { name: `Keyed ${run}`, systemKey: 'keyed', position: 9 },
          }),
        ),
      ),
    ).toMatch(/only the migration ships/);
  });

  it('files are scanned once by the platform, used as uploaded, and never once unsafe', async () => {
    const id = randomUUID();
    const file = await asAdmin((tx) =>
      tx.commMedia.create({
        data: {
          id,
          kind: 'ATTACHMENT',
          fileName: 'guide.pdf',
          contentType: 'application/pdf',
          sizeBytes: 2048,
          sha256: createHash('sha256').update(id).digest('hex'),
          s3Key: `platform/communications/${id}/guide.pdf`,
        },
      }),
    );
    expect(
      await outcome(
        asAdmin((tx) => tx.commMedia.update({ where: { id }, data: { scanStatus: 'CLEAN' } })),
      ),
    ).toMatch(/only the scanner/);
    await asPlatform((tx) =>
      tx.commMedia.update({ where: { id }, data: { scanStatus: 'INFECTED' } }),
    );
    const c = await conversation();
    const m = await draft(c.id);
    for (const usage of ['ATTACHMENT', 'INLINE_IMAGE'] as const) {
      expect(
        await outcome(
          asAdmin((tx) =>
            tx.commMediaLink.create({ data: { mediaId: file.id, usage, messageId: m.id } }),
          ),
        ),
      ).toMatch(/used as uploaded, and only if it is safe/);
    }
    expect(
      await outcome(
        asAdmin((tx) =>
          tx.commMedia.create({
            data: {
              kind: 'INLINE_IMAGE',
              fileName: 'logo.svg',
              contentType: 'image/svg+xml',
              sizeBytes: 10,
              sha256: '0'.repeat(64),
              s3Key: `platform/communications/${randomUUID()}/logo.svg`,
            },
          }),
        ),
      ),
    ).toMatch(/comm_media_values/);
  });
});
