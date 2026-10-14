// Campaigns (r39_communications): firm-only rows, per-channel and per-status rules, audience
// counts that add up, a forward-only status, content frozen once a campaign is out, and an
// audience that changes only while the campaign is a draft or scheduled.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
const draft = (f = A, data: object = {}) =>
  as(f).communication.create({
    data: {
      businessId: f.id,
      channel: 'EMAIL',
      name: 'C',
      subject: 'Hi',
      body: 'Body',
      createdByUserId: f.owner,
      ...data,
    },
  });
const counts = { selectedCount: 10, autoExcludedCount: 2, manualExcludedCount: 1, finalCount: 7 };
const sending = { status: 'SENDING' as const, startedAt: new Date(), ...counts };
let seg = '';

beforeAll(async () => {
  await setup();
  const s = { businessId: A.id, name: 'List', type: 'STATIC' as const, ownerUserId: A.owner };
  seg = (await as(A).communicationSegment.create({ data: s })).id;
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's campaigns and refuses links across firms", async () => {
    const c = await draft();
    expect(await as(B).communication.findMany()).toEqual([]);
    expect(await as(B).communicationAudienceEntry.findMany()).toEqual([]);
    const entry = {
      businessId: B.id,
      communicationId: c.id,
      kind: 'SEGMENT' as const,
      segmentId: seg,
    };
    expect(await outcome(as(B).communicationAudienceEntry.create({ data: entry }))).toMatch(
      /Foreign key|COMMUNICATION_SENT/,
    );
    expect(await outcome(draft(B, { templateId: c.id, templateVersion: 1 }))).toMatch(
      /Foreign key/,
    );
  });
});

describe('rules', () => {
  it('checks the channel and the status', async () => {
    expect(await outcome(draft(A, { channel: 'SMS' }))).toMatch(/communications_channel/);
    expect(await outcome(draft(A, { status: 'SCHEDULED' }))).toMatch(/communications_status/);
    expect(await outcome(draft(A, { status: 'SENDING' }))).toMatch(/communications_status/);
    expect(await outcome(draft(A, { channel: 'EMAIL', publishStartsAt: new Date() }))).toMatch(
      /communications_channel/,
    );
    const when = {
      status: 'SCHEDULED' as const,
      scheduledFor: new Date(Date.now() + 864e5),
      timezone: 'America/New_York',
    };
    expect(await outcome(draft(A, when))).toBe('ok');
  });
  it('needs audience counts that add up, all or none', async () => {
    expect(await outcome(draft(A, { ...sending, finalCount: 8 }))).toMatch(/communications_status/);
    expect(await outcome(draft(A, { selectedCount: 5 }))).toMatch(/communications_status/);
    expect(await outcome(draft(A, sending))).toBe('ok');
  });
  it('keeps the idempotency key unique per firm', async () => {
    const key = { idempotencyKey: 'send-0001-abcdef' };
    expect(await outcome(draft(A, key))).toBe('ok');
    expect(await outcome(draft(A, key))).toMatch(/Unique/i);
    expect(await outcome(draft(B, key))).toBe('ok');
  });
  it('moves forward only and freezes the content once it is out', async () => {
    const c = await draft();
    const update = (data: object) =>
      outcome(as(A).communication.update({ where: { id: c.id }, data }));
    expect(await update({ status: 'SENT' })).toMatch(/COMMUNICATION_STATUS/);
    expect(await update(sending)).toBe('ok');
    expect(await update({ subject: 'Changed' })).toMatch(/COMMUNICATION_SENT/);
    expect(await update({ name: 'Renamed', archivedAt: new Date() })).toBe('ok');
    expect(await update({ status: 'SENT', sentAt: new Date() })).toBe('ok');
    expect(await update({ status: 'DRAFT' })).toMatch(/COMMUNICATION_STATUS/);
    expect(await outcome(as(A).communication.delete({ where: { id: c.id } }))).toMatch(
      /permission denied/,
    );
  });
  it('derives a campaign from an earlier one with a source kind', async () => {
    const first = await draft();
    expect(await outcome(draft(A, { sourceCommunicationId: first.id }))).toMatch(
      /communications_values/,
    );
    expect(
      await outcome(draft(A, { sourceCommunicationId: first.id, sourceKind: 'DUPLICATE' })),
    ).toBe('ok');
  });
});

describe('audience', () => {
  it('takes segments and people while editable, with one target per kind', async () => {
    const c = await draft();
    const add = (data: object) =>
      outcome(
        as(A).communicationAudienceEntry.create({
          data: { businessId: A.id, communicationId: c.id, ...data } as never,
        }),
      );
    expect(await add({ kind: 'SEGMENT', segmentId: seg })).toBe('ok');
    expect(await add({ kind: 'SEGMENT', segmentId: seg })).toMatch(/Unique/i);
    expect(await add({ kind: 'EXCLUDE_CLIENT', clientId: A.client })).toBe('ok');
    expect(await add({ kind: 'CLIENT', segmentId: seg })).toMatch(/audience_entries_kind/);
    await as(A).communication.update({ where: { id: c.id }, data: sending });
    expect(await add({ kind: 'CLIENT', clientId: A.client })).toMatch(/COMMUNICATION_SENT/);
    expect(
      await outcome(
        as(A).communicationAudienceEntry.deleteMany({ where: { communicationId: c.id } }),
      ),
    ).toMatch(/COMMUNICATION_SENT/);
  });
});
