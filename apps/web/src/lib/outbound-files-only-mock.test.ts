// M22 (Messaging Review 2): New Message's mock refuses what the API refuses. A Portal message may
// be saved with no text so its files can go on the draft; Send and Schedule then need a file
// (400 BODY_REQUIRED), and the client's message says what was sent (the reply's files line).
// Email and text still need a text (400 VALIDATION_FAILED). Runs the mock directly.
import { describe, expect, it } from 'vitest';
import { firstClientId } from '../mocks/clients';
import { createMessagesMock } from '../mocks/messages';

const later = () => new Date(Date.now() + 3 * 86_400_000).toISOString();
// The mock waits a little on every call, as the network would.
const SLOW = { timeout: 20_000 };

describe('messages mock: New Message with files and no text (M22)', () => {
  it('no text and no file is refused at Send and Schedule; a file makes it go', SLOW, async () => {
    const mock = createMessagesMock();
    const out = mock.outbound;
    const d = await out.create({ channel: 'PORTAL', clientIds: [firstClientId] });
    expect(d.body).toBe('');
    const refused = { status: 400, code: 'BODY_REQUIRED' };
    await expect(out.send(d.id, { version: d.updatedAt })).rejects.toMatchObject(refused);
    await expect(
      out.schedule(d.id, { version: d.updatedAt, scheduledFor: later() }),
    ).rejects.toMatchObject(refused);
    expect((await out.review(d.id)).checks.map((c) => c.code)).toContain('BODY_REQUIRED');

    const ticket = await out.startFile(d.id, {
      fileName: 'Fake W-2.pdf',
      contentType: 'application/pdf',
      sizeBytes: 64,
      sha256: 'a'.repeat(64),
    });
    await out.confirmFile(d.id, { uploadToken: ticket.uploadToken });
    const ready = await out.get(d.id);
    const review = await out.review(d.id);
    expect(review.recipients[0]?.body).toBe('Sent 1 file: Fake W-2.pdf');
    expect(review.checks.map((c) => c.code)).toEqual(['READY']);
    const sent = await out.send(d.id, { version: ready.updatedAt });
    const threadId = sent.recipients[0]?.threadId ?? '';
    const thread = await mock.get(threadId);
    expect(thread.messages.at(-1)?.body).toBe('Sent 1 file: Fake W-2.pdf');
  });

  it('email and text still need a text', async () => {
    const out = createMessagesMock().outbound;
    await expect(
      out.create({ channel: 'EMAIL', subject: 'Hi', clientIds: [firstClientId] }),
    ).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      message: 'Enter a message. Only a portal message can go with files alone',
    });
  });

  it('a scheduled message of files alone keeps its last file', SLOW, async () => {
    const out = createMessagesMock().outbound;
    const d = await out.create({ channel: 'PORTAL', clientIds: [firstClientId] });
    const ticket = await out.startFile(d.id, {
      fileName: 'Fake 1099.pdf',
      contentType: 'application/pdf',
      sizeBytes: 64,
      sha256: 'b'.repeat(64),
    });
    const file = await out.confirmFile(d.id, { uploadToken: ticket.uploadToken });
    const planned = await out.schedule(d.id, {
      version: (await out.get(d.id)).updatedAt,
      scheduledFor: later(),
    });
    expect(planned.status).toBe('SCHEDULED');
    await expect(out.removeFile(d.id, file.id)).rejects.toMatchObject({
      status: 400,
      code: 'BODY_REQUIRED',
    });
  });
});
