// Communications audiences (r39_comm_segments): segments, static list members and consent are
// firm-only, members are one client or lead, and consent is one row per contact and channel.
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';
import { r39Fixtures } from './r39-fixtures.js';

const { A, B, as, setup, close, outcome } = r39Fixtures(inject('dbUrls'));
let list = '';
let dynamic = '';
const segment = (data: object) =>
  as(A).communicationSegment.create({
    data: {
      businessId: A.id,
      name: `S ${Math.random()}`,
      type: 'STATIC',
      ownerUserId: A.owner,
      ...data,
    },
  });

beforeAll(async () => {
  await setup();
  list = (await segment({ name: 'VIP' })).id;
  dynamic = (await segment({ name: 'Open returns', type: 'DYNAMIC', criteria: { all: [] } })).id;
  const member = { businessId: A.id, segmentId: list, clientId: A.client };
  await as(A).communicationSegmentMember.create({ data: member });
  const consent = { businessId: A.id, clientId: A.client, channel: 'EMAIL' as const };
  await as(A).communicationConsent.create({
    data: { ...consent, status: 'OPTED_IN', source: 'portal' },
  });
});
afterAll(close);

describe('row-level security', () => {
  it("hides another firm's rows and refuses links across firms", async () => {
    expect(await as(B).communicationSegment.findMany()).toEqual([]);
    expect(await as(B).communicationSegmentMember.findMany()).toEqual([]);
    expect(await as(B).communicationConsent.findMany()).toEqual([]);
    const m = as(B).communicationSegmentMember.create({
      data: { businessId: B.id, segmentId: list, clientId: B.client },
    });
    expect(await outcome(m)).toMatch(/Foreign key/);
    const c = as(B).communicationConsent.create({
      data: {
        businessId: B.id,
        clientId: A.client,
        channel: 'SMS',
        status: 'OPTED_OUT',
        source: 'staff',
      },
    });
    expect(await outcome(c)).toMatch(/Foreign key/);
  });
});

describe('segments and lists', () => {
  it('hold saved members only in a static list, once each, for their own audience', async () => {
    const add = (d: object) =>
      outcome(
        as(A).communicationSegmentMember.create({ data: { businessId: A.id, ...d } as never }),
      );
    expect(await add({ segmentId: dynamic, clientId: A.client })).toMatch(/SEGMENT_NOT_STATIC/);
    expect(await add({ segmentId: list, clientId: A.client })).toMatch(/Unique/i);
    expect(await add({ segmentId: list })).toMatch(/segment_members_one/);
    const leads = await segment({ audience: 'LEADS' });
    expect(await add({ segmentId: leads.id, clientId: A.client })).toMatch(/SEGMENT_AUDIENCE/);
  });
  it('check names, criteria and are never deleted', async () => {
    expect(await outcome(segment({ name: '   ' }))).toMatch(/segments_values/);
    expect(await outcome(segment({ criteria: [] }))).toMatch(/segments_values/);
    expect(await outcome(as(A).communicationSegment.delete({ where: { id: list } }))).toMatch(
      /permission denied/,
    );
  });
});

describe('consent', () => {
  it('is one row per contact and channel, for email or text only', async () => {
    const make = (d: object) =>
      outcome(
        as(A).communicationConsent.create({
          data: {
            businessId: A.id,
            clientId: A.client,
            status: 'OPTED_OUT',
            source: 'staff',
            ...d,
          } as never,
        }),
      );
    expect(await make({ channel: 'EMAIL' })).toMatch(/Unique/i);
    expect(await make({ channel: 'ANNOUNCEMENT' })).toMatch(/consents_values/);
    expect(await make({ channel: 'SMS', source: 'Bad Source' })).toMatch(/consents_values/);
    expect(await make({ channel: 'SMS' })).toBe('ok');
  });
});
