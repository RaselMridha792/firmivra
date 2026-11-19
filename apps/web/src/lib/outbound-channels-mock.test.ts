// M19 (Messaging Review 2): one New Message to several channels, in the mock, answering and
// refusing as the API does. Send and Schedule with `channels` make one message per channel (the
// draft's own, and a copy for each other), each to who its own channel reaches; without
// `channels` the answer is as before. Refused: an email with no subject, files alone with Email
// or Text, a text over 1,600 characters, channels without the draft's own, a channel nobody can
// receive, and copies from a scheduled message. Runs the mock directly.
import { describe, expect, it } from 'vitest';
import { firstClientId } from '../mocks/clients';
import { createMessagesMock } from '../mocks/messages';

/** Jamie Sample (portal and email) and Acme Widgets (an email, no portal), synthetic. */
const jamie = firstClientId;
const acme = '0199b6a1-0000-7000-8000-000000000002';
const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
// The mock waits a little on every call, as the network would.
const SLOW = { timeout: 30_000 };
const statusOf = (m: { recipients: { id: string; status: string | null }[] }) =>
  Object.fromEntries(m.recipients.map((r) => [r.id, r.status]));

describe('messages mock: one New Message to several channels (M19)', () => {
  it('two channels make two messages, each to who its channel reaches', SLOW, async () => {
    const out = createMessagesMock().outbound;
    const d = await out.create({
      channel: 'PORTAL',
      subject: 'Two ways (fake)',
      body: 'Hello',
      clientIds: [jamie, acme],
    });
    const review = await out.review(d.id, { channels: 'PORTAL,EMAIL' });
    expect(review.channels).toEqual([
      {
        channel: 'PORTAL',
        total: 2,
        canReceive: 1,
        cannotReceive: [
          {
            kind: 'CLIENT',
            id: acme,
            name: 'Acme Widgets LLC (fake)',
            reason: 'NO_PORTAL_ACCESS',
          },
        ],
      },
      {
        channel: 'EMAIL',
        total: 2,
        canReceive: 1,
        cannotReceive: [
          {
            kind: 'CLIENT',
            id: acme,
            name: 'Acme Widgets LLC (fake)',
            reason: 'NO_PORTAL_ACCESS',
          },
        ],
      },
    ]);
    expect(review.checks.map((c) => c.code)).toEqual(['SOME_SKIPPED', 'READY']);
    // Without channels the review is as before.
    expect(await out.review(d.id)).not.toHaveProperty('channels');

    const sent = await out.send(d.id, { version: d.updatedAt, channels: ['PORTAL', 'EMAIL'] });
    expect(sent).toMatchObject({ id: d.id, channel: 'PORTAL', status: 'SENT' });
    expect(statusOf(sent)).toEqual({ [jamie]: 'SENT', [acme]: 'SKIPPED' });
    expect(sent.others?.map((o) => [o.channel, o.status, o.subject])).toEqual([
      ['EMAIL', 'SENT', 'Two ways (fake)'],
    ]);
    expect(statusOf(sent.others![0]!)).toEqual({ [jamie]: 'SENT', [acme]: 'SKIPPED' });

    // One channel: the answer is the message alone, as before.
    const one = await out.create({ channel: 'PORTAL', body: 'Just one', clientIds: [jamie] });
    const alone = await out.send(one.id, { version: one.updatedAt });
    expect(alone.status).toBe('SENT');
    expect(alone).not.toHaveProperty('others');
  });

  it('refuses what one channel cannot take, and then makes nothing', SLOW, async () => {
    const out = createMessagesMock().outbound;
    const bodies = async (body: string) =>
      (await out.list()).items.filter((m) => m.body === body).length;
    // Email needs a subject.
    const a = await out.create({ channel: 'PORTAL', body: 'No subject', clientIds: [jamie] });
    await expect(
      out.send(a.id, { version: a.updatedAt, channels: ['PORTAL', 'EMAIL'] }),
    ).rejects.toMatchObject({ status: 400, code: 'SUBJECT_REQUIRED' });
    expect(await bodies('No subject')).toBe(1);
    // A text is at most 1,600 characters.
    const long = 'x'.repeat(1601);
    const b = await out.create({ channel: 'PORTAL', body: long, clientIds: [jamie] });
    expect(
      (await out.review(b.id, { channels: 'PORTAL,SMS' })).checks.map((c) => c.code),
    ).toContain('SMS_TOO_LONG');
    await expect(
      out.send(b.id, { version: b.updatedAt, channels: ['PORTAL', 'SMS'] }),
    ).rejects.toMatchObject({ status: 400, code: 'SMS_TOO_LONG' });
    // A channel nobody can receive on (texts are off) stops them all, and says which.
    const c = await out.create({ channel: 'PORTAL', body: 'Nobody', clientIds: [jamie] });
    await expect(
      out.send(c.id, { version: c.updatedAt, channels: ['PORTAL', 'SMS'] }),
    ).rejects.toMatchObject({
      status: 409,
      code: 'NO_RECIPIENTS',
      message: expect.stringContaining('by text'),
    });
    expect(await bodies('Nobody')).toBe(1);
    // The channels must include the one it is saved on.
    await expect(
      out.send(c.id, { version: c.updatedAt, channels: ['EMAIL'] }),
    ).rejects.toMatchObject({ status: 400, code: 'VALIDATION_FAILED' });
  });

  it('files go with the Portal message; files alone only by Portal alone', SLOW, async () => {
    const out = createMessagesMock().outbound;
    const d = await out.create({ channel: 'PORTAL', subject: 'Alone (fake)', clientIds: [jamie] });
    const ticket = await out.startFile(d.id, {
      fileName: 'Fake W-2.pdf',
      contentType: 'application/pdf',
      sizeBytes: 64,
      sha256: 'a'.repeat(64),
    });
    await out.confirmFile(d.id, { uploadToken: ticket.uploadToken });
    const withFile = await out.get(d.id);
    expect(
      (await out.review(d.id, { channels: 'PORTAL,EMAIL' })).checks.find(
        (c) => c.code === 'TEXT_REQUIRED',
      ),
    ).toMatchObject({ severity: 'BLOCK' });
    await expect(
      out.send(d.id, { version: withFile.updatedAt, channels: ['PORTAL', 'EMAIL'] }),
    ).rejects.toMatchObject({ status: 400, code: 'TEXT_REQUIRED' });
    // The refusal kept the file on the draft.
    expect((await out.get(d.id)).files.map((f) => f.fileName)).toEqual(['Fake W-2.pdf']);
    const portalOnly = await out.send(d.id, {
      version: withFile.updatedAt,
      channels: ['PORTAL'],
    });
    expect(portalOnly).toMatchObject({ status: 'SENT', others: [] });

    // An Email draft with a file, also by Portal: the file goes with the Portal message.
    const e = await out.create({
      channel: 'EMAIL',
      subject: 'Your form (fake)',
      body: 'Here it is',
      clientIds: [jamie],
    });
    const t2 = await out.startFile(e.id, {
      fileName: 'Fake 1099.pdf',
      contentType: 'application/pdf',
      sizeBytes: 64,
      sha256: 'b'.repeat(64),
    });
    await out.confirmFile(e.id, { uploadToken: t2.uploadToken });
    const ev = (await out.get(e.id)).updatedAt;
    await expect(out.send(e.id, { version: ev })).rejects.toMatchObject({
      status: 409,
      code: 'FILES_NEED_PORTAL',
    });
    const both = await out.send(e.id, { version: ev, channels: ['EMAIL', 'PORTAL'] });
    expect(both.files).toEqual([]);
    expect(both.others?.[0]).toMatchObject({ channel: 'PORTAL', status: 'SENT' });
    expect(both.others?.[0]?.files.map((f) => f.fileName)).toEqual(['Fake 1099.pdf']);
  });

  it(
    'Schedule fans out too; each is canceled on its own; a scheduled one stays on its channel',
    SLOW,
    async () => {
      const out = createMessagesMock().outbound;
      const d = await out.create({
        channel: 'PORTAL',
        subject: 'Planned (fake)',
        body: 'Later',
        clientIds: [jamie],
      });
      const at = later();
      const planned = await out.schedule(d.id, {
        version: d.updatedAt,
        scheduledFor: at,
        channels: ['PORTAL', 'EMAIL'],
      });
      expect(planned).toMatchObject({ status: 'SCHEDULED', channel: 'PORTAL' });
      const email = planned.others![0]!;
      expect(email).toMatchObject({ status: 'SCHEDULED', channel: 'EMAIL' });
      const listed = (await out.list({ status: 'SCHEDULED' })).items.map((m) => [m.id, m.channel]);
      expect(listed).toEqual(
        expect.arrayContaining([
          [d.id, 'PORTAL'],
          [email.id, 'EMAIL'],
        ]),
      );
      await expect(
        out.schedule(d.id, {
          version: planned.updatedAt,
          scheduledFor: at,
          channels: ['PORTAL', 'EMAIL'],
        }),
      ).rejects.toMatchObject({ status: 409, code: 'CHANNELS_FIXED' });
      const canceled = await out.cancel(email.id, { version: email.updatedAt });
      expect(canceled.status).toBe('CANCELED');
      expect((await out.get(d.id)).status).toBe('SCHEDULED');
    },
  );
});
