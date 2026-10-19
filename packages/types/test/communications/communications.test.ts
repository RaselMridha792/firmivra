import { describe, expect, it } from 'vitest';
import {
  AudienceCandidatesQuery,
  CommunicationsQuery,
  CreateCommunicationRequest,
  CreateSegmentRequest,
  FollowUpRequest,
  PreviewSegmentRequest,
  RescheduleCommunicationRequest,
  ScheduleCommunicationRequest,
  SegmentCriteria,
  SelectAllAudienceRequest,
  SendCommunicationRequest,
  SetAudienceRequest,
  SetConsentRequest,
  StartCommunicationAttachmentRequest,
  TestSendCommunicationRequest,
  UpdateCommunicationRequest,
  createCommunicationsClient,
  createRequest,
} from '../../src/index.js';

const id = '0199c0e0-0a00-7000-8000-000000000001';
const other = '0199c0e0-0a00-7000-8000-000000000002';
const key = '0199c0e0-0a00-7000-8000-000000000003';
const sha = 'a'.repeat(64);

function fakeFetch(body: unknown, status = 200) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
  return { fn, calls };
}

describe('the lists', () => {
  it('default to the campaigns tab, newest first, and read filters', () => {
    expect(CommunicationsQuery.parse({})).toMatchObject({
      tab: 'campaigns',
      sort: 'newest',
      page: 1,
    });
    expect(
      CommunicationsQuery.safeParse({
        tab: 'scheduled',
        channel: 'SMS',
        from: '2026-10-01',
        to: '2026-10-31',
        archived: 'false',
      }).success,
    ).toBe(true);
    expect(CommunicationsQuery.safeParse({ tab: 'inbox' }).success).toBe(false);
    expect(CommunicationsQuery.safeParse({ channel: 'FAX' }).success).toBe(false);
  });
});

describe('starting and saving a draft', () => {
  it('starts on a channel, optionally from a template, and opening a menu creates nothing', () => {
    expect(CreateCommunicationRequest.safeParse({ channel: 'EMAIL' }).success).toBe(true);
    expect(
      CreateCommunicationRequest.safeParse({
        channel: 'SMS',
        templateId: id,
        name: 'October reminder',
      }).success,
    ).toBe(true);
    expect(CreateCommunicationRequest.safeParse({ channel: 'PUSH' }).success).toBe(false);
    expect(CreateCommunicationRequest.safeParse({ channel: 'EMAIL', status: 'SENT' }).success).toBe(
      false,
    );
  });

  it('autosave names the version and a field; a channel change needs to confirm lost content', () => {
    expect(UpdateCommunicationRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(UpdateCommunicationRequest.safeParse({ subject: 'x' }).success).toBe(false);
    expect(
      UpdateCommunicationRequest.safeParse({
        etag: 'v1',
        subject: 'Welcome',
        body: '<p>Hi [Client First Name]</p>',
        replyTo: 'office@firm.example',
      }).success,
    ).toBe(true);
    expect(
      UpdateCommunicationRequest.safeParse({
        etag: 'v1',
        channel: 'SMS',
        confirmStripContent: true,
      }).success,
    ).toBe(true);
    expect(
      UpdateCommunicationRequest.safeParse({ etag: 'v1', replyTo: 'not-an-email' }).success,
    ).toBe(false);
    expect(
      UpdateCommunicationRequest.safeParse({ etag: 'v1', subject: null, previewText: null })
        .success,
    ).toBe(true);
    expect(UpdateCommunicationRequest.safeParse({ etag: 'v1', status: 'SENT' }).success).toBe(
      false,
    );
    expect(
      UpdateCommunicationRequest.safeParse({
        etag: 'v1',
        publishStartsAt: '2026-11-01T09:00:00-04:00',
        publishEndsAt: null,
        visibility: 'dashboard',
      }).success,
    ).toBe(true);
  });

  it('a test goes to the caller’s own address or number in a valid form', () => {
    expect(TestSendCommunicationRequest.safeParse({}).success).toBe(true);
    expect(TestSendCommunicationRequest.safeParse({ toPhone: '+15551234567' }).success).toBe(true);
    expect(TestSendCommunicationRequest.safeParse({ toPhone: '5551234567' }).success).toBe(false);
    expect(TestSendCommunicationRequest.safeParse({ toEmail: 'nope' }).success).toBe(false);
  });

  it('an attachment has the templates’ limits', () => {
    const facts = {
      fileName: 'guide.pdf',
      contentType: 'application/pdf',
      sizeBytes: 1000,
      sha256: sha,
    };
    expect(StartCommunicationAttachmentRequest.safeParse(facts).success).toBe(true);
    expect(
      StartCommunicationAttachmentRequest.safeParse({ ...facts, contentType: 'text/html' }).success,
    ).toBe(false);
    expect(
      StartCommunicationAttachmentRequest.safeParse({ ...facts, sizeBytes: 11 * 1024 * 1024 })
        .success,
    ).toBe(false);
  });
});

describe('recipients', () => {
  it('the candidates view defaults to contacts and keeps filters', () => {
    expect(AudienceCandidatesQuery.parse({ communicationId: id })).toMatchObject({
      view: 'CONTACTS',
      page: 1,
    });
    expect(
      AudienceCandidatesQuery.safeParse({ communicationId: id, view: 'SEGMENTS', search: 'tax' })
        .success,
    ).toBe(true);
    expect(AudienceCandidatesQuery.safeParse({ view: 'CONTACTS' }).success).toBe(false);
    expect(
      AudienceCandidatesQuery.safeParse({ communicationId: id, view: 'EVERYONE' }).success,
    ).toBe(false);
    expect(SelectAllAudienceRequest.safeParse({ communicationId: id, view: 'LEADS' }).success).toBe(
      true,
    );
    expect(SelectAllAudienceRequest.safeParse({ communicationId: id, page: 2 }).success).toBe(
      false,
    );
  });

  it('the audience is segments, people and exclusions, with the version', () => {
    expect(SetAudienceRequest.parse({ etag: 'v1' })).toMatchObject({
      segmentIds: [],
      clientIds: [],
      excludeLeadIds: [],
    });
    expect(
      SetAudienceRequest.safeParse({
        segmentIds: [id],
        clientIds: [other],
        excludeClientIds: [other],
        etag: 'v1',
      }).success,
    ).toBe(true);
    expect(SetAudienceRequest.safeParse({ segmentIds: ['nope'], etag: 'v1' }).success).toBe(false);
    expect(SetAudienceRequest.safeParse({ segmentIds: [id] }).success).toBe(false);
    expect(SetAudienceRequest.safeParse({ etag: 'v1', businessId: id }).success).toBe(false);
  });
});

describe('sending', () => {
  it('needs an idempotency key and the version; a schedule is a full instant', () => {
    expect(SendCommunicationRequest.safeParse({ idempotencyKey: key, etag: 'v1' }).success).toBe(
      true,
    );
    expect(
      SendCommunicationRequest.safeParse({
        idempotencyKey: key,
        expectedFinalCount: 142,
        etag: 'v1',
      }).success,
    ).toBe(true);
    expect(SendCommunicationRequest.safeParse({ etag: 'v1' }).success).toBe(false);
    expect(
      SendCommunicationRequest.safeParse({ idempotencyKey: 'not-a-uuid', etag: 'v1' }).success,
    ).toBe(false);
    expect(
      ScheduleCommunicationRequest.safeParse({
        idempotencyKey: key,
        scheduledFor: '2026-11-02T09:00:00-05:00',
        etag: 'v1',
      }).success,
    ).toBe(true);
    expect(
      ScheduleCommunicationRequest.safeParse({
        idempotencyKey: key,
        scheduledFor: '2026-11-02',
        etag: 'v1',
      }).success,
    ).toBe(false);
    expect(
      RescheduleCommunicationRequest.safeParse({ scheduledFor: '2026-11-03T10:00:00Z', etag: 'v1' })
        .success,
    ).toBe(true);
  });

  it('a follow-up names a result group', () => {
    expect(FollowUpRequest.safeParse({ group: 'NOT_OPENED' }).success).toBe(true);
    expect(FollowUpRequest.safeParse({ group: 'EVERYONE' }).success).toBe(false);
  });
});

describe('segments and consent', () => {
  const criteria = {
    logic: 'AND',
    conditions: [{ field: 'client.status', op: 'IS_ANY_OF', value: ['ACTIVE', 'IN_PROGRESS'] }],
    groups: [
      {
        logic: 'OR',
        conditions: [
          { field: 'client.state', op: 'IS', value: 'GA' },
          { field: 'client.tags', op: 'EXISTS' },
        ],
      },
    ],
  };

  it('a dynamic segment has criteria, a list has members', () => {
    expect(SegmentCriteria.safeParse(criteria).success).toBe(true);
    expect(SegmentCriteria.safeParse({ conditions: [{ field: 'a', op: 'LIKE' }] }).success).toBe(
      false,
    );
    expect(SegmentCriteria.safeParse({ groups: [{ logic: 'OR', conditions: [] }] }).success).toBe(
      false,
    );
    expect(
      CreateSegmentRequest.safeParse({ name: 'GA clients', type: 'DYNAMIC', criteria }).success,
    ).toBe(true);
    expect(CreateSegmentRequest.safeParse({ name: 'GA clients', type: 'DYNAMIC' }).success).toBe(
      false,
    );
    expect(
      CreateSegmentRequest.safeParse({ name: 'VIPs', type: 'STATIC', clientIds: [id] }).success,
    ).toBe(true);
    expect(CreateSegmentRequest.safeParse({ name: 'VIPs', type: 'STATIC', criteria }).success).toBe(
      false,
    );
    expect(PreviewSegmentRequest.safeParse({ criteria, channel: 'EMAIL' }).success).toBe(true);
  });

  it('consent names exactly one contact and an email or SMS channel', () => {
    expect(
      SetConsentRequest.safeParse({ clientId: id, channel: 'SMS', status: 'OPTED_OUT' }).success,
    ).toBe(true);
    expect(
      SetConsentRequest.safeParse({
        leadId: id,
        channel: 'EMAIL',
        status: 'OPTED_IN',
        reason: 'Asked by phone',
      }).success,
    ).toBe(true);
    expect(SetConsentRequest.safeParse({ channel: 'SMS', status: 'OPTED_OUT' }).success).toBe(
      false,
    );
    expect(
      SetConsentRequest.safeParse({
        clientId: id,
        leadId: other,
        channel: 'SMS',
        status: 'OPTED_OUT',
      }).success,
    ).toBe(false);
    expect(
      SetConsentRequest.safeParse({ clientId: id, channel: 'ANNOUNCEMENT', status: 'OPTED_OUT' })
        .success,
    ).toBe(false);
  });
});

describe('createCommunicationsClient', () => {
  it('calls the routes in the contract and never sends a business id', async () => {
    const f = fakeFetch({ items: [], total: 0, page: 1, pageSize: 25 });
    const client = createCommunicationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await client.list({ tab: 'scheduled', channel: 'EMAIL' });
    const url = f.calls[0]?.url ?? '';
    expect(url.startsWith('/api/v1/business/communications?')).toBe(true);
    for (const part of ['tab=scheduled', 'channel=EMAIL', 'sort=newest'])
      expect(url).toContain(part);
    expect(JSON.stringify(f.calls)).not.toMatch(/businessId|x-business-id/i);
  });

  it('refuses bad input before sending anything', async () => {
    const f = fakeFetch({});
    const client = createCommunicationsClient(createRequest({ fetch: f.fn, baseUrl: '/api/v1' }));
    await expect(client.get('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.segment('nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.send(id, { etag: 'v1' } as never)).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
    });
    await expect(client.create({ channel: 'PUSH' } as never)).rejects.toMatchObject({
      status: 400,
    });
    await expect(client.removeAttachment(id, 'nope')).rejects.toMatchObject({ status: 400 });
    await expect(client.candidates({ view: 'CONTACTS' } as never)).rejects.toMatchObject({
      status: 400,
    });
    expect(f.calls).toHaveLength(0);
  });
});
