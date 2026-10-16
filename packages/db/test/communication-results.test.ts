// Campaign results (r39_comm_results): recipients and delivery events are firm-only, written
// only for a campaign that is sending or sent, and recipients keep their identity.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
const base = { channel: 'EMAIL' as const, name: 'C', subject: 'Hi', body: 'b' };
const counts = { selectedCount: 1, autoExcludedCount: 0, manualExcludedCount: 0, finalCount: 1 };
let sending = '';
let draft = '';
let recipient = '';
const rec = (data: object) =>
  as(A).communicationRecipient.create({
    data: {
      businessId: A.id,
      communicationId: sending,
      clientId: A.client,
      addressMask: 'p***@example.test',
      ...data,
    } as never,
  });

beforeAll(async () => {
  await setup();
  const mk = (data: object) =>
    as(A).communication.create({
      data: { businessId: A.id, createdByUserId: A.owner, ...base, ...data },
    });
  draft = (await mk({})).id;
  sending = (await mk({ status: 'SENDING', startedAt: new Date(), ...counts })).id;
  recipient = (await rec({})).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's recipients and events", async () => {
    const event = {
      businessId: A.id,
      communicationId: sending,
      recipientId: recipient,
      type: 'SENT' as const,
      occurredAt: new Date(),
    };
    await as(A).communicationEvent.create({ data: event });
    expect(await as(B).communicationRecipient.findMany()).toEqual([]);
    expect(await as(B).communicationEvent.findMany()).toEqual([]);
    expect(await as(A).communicationEvent.count()).toBe(1);
    const into = as(B).communicationRecipient.create({
      data: { businessId: B.id, communicationId: sending, clientId: B.client, addressMask: 'x***' },
    });
    expect(await outcome(into)).toMatch(/Foreign key|COMMUNICATION_NOT_SENDING/);
  });
});

describe('recipients', () => {
  it('are added only while sending, once per person, with a masked address', async () => {
    const early = as(A).communicationRecipient.create({
      data: {
        businessId: A.id,
        communicationId: draft,
        clientId: A.client,
        addressMask: 'p***@x.test',
      },
    });
    expect(await outcome(early)).toMatch(/COMMUNICATION_NOT_SENDING/);
    expect(await outcome(rec({}))).toMatch(/Unique/i);
    expect(await outcome(rec({ clientId: null }))).toMatch(/recipients_values/);
    expect(
      await outcome(
        as(A).communicationRecipient.create({
          data: {
            businessId: A.id,
            communicationId: sending,
            leadId: null,
            clientId: A.client,
            addressMask: 'pat@example.test',
          },
        }),
      ),
    ).toMatch(/Unique|recipients_values/);
  });
  it('change their status and engagement, never who they are', async () => {
    const update = (data: object) =>
      outcome(as(A).communicationRecipient.update({ where: { id: recipient }, data }));
    expect(await update({ status: 'OPENED', openCount: 2, firstOpenedAt: new Date() })).toBe('ok');
    expect(await update({ addressMask: 'other***' })).toMatch(/RECIPIENT_FROZEN/);
    expect(await update({ status: 'BOUNCED' })).toMatch(/recipients_values/);
    expect(await update({ status: 'BOUNCED', failureCode: 'mailbox_full' })).toBe('ok');
  });
});

describe('events', () => {
  it('are insert-only, deduplicated by provider id, and only for a campaign that went out', async () => {
    const ev = (data: object) =>
      outcome(
        as(A).communicationEvent.create({
          data: {
            businessId: A.id,
            communicationId: sending,
            type: 'OPENED',
            occurredAt: new Date(),
            ...data,
          } as never,
        }),
      );
    expect(await ev({ providerEventId: 'evt-1' })).toBe('ok');
    expect(await ev({ providerEventId: 'evt-1' })).toMatch(/Unique/i);
    expect(await ev({ communicationId: draft })).toMatch(/COMMUNICATION_NOT_SENT/);
    expect(await outcome(as(A).communicationEvent.updateMany({ data: { type: 'SENT' } }))).toMatch(
      /permission denied/,
    );
    expect(await outcome(as(A).communicationEvent.deleteMany())).toMatch(/permission denied/);
  });
});
