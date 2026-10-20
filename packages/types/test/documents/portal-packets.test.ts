import { describe, expect, it } from 'vitest';
import {
  ApiRequestError,
  createMyDocumentsClient,
  createRequest,
  DOCUMENT_ERRORS,
  MyDocumentRequest,
  MyRequestPacket,
  MyRequestPacketList,
} from '../../src/index.js';

// R55: the client's side of request packets (Document Request & Upload, Frame 7).
const id = '0199b6a0-0000-7000-8000-000000000001';
const at = '2026-10-07T09:00:00.000Z';
const request = (fn: typeof fetch) => createRequest({ baseUrl: '/api/v1', fetch: fn });

const progress = { requiredTotal: 4, requiredAnswered: 2, itemsTotal: 5, itemsAnswered: 2 };
const row = {
  id,
  reference: 'DR-0024',
  title: 'Fake 2024 tax documents',
  service: { id, title: 'Personal Tax' },
  status: 'OPEN',
  view: 'IN_PROGRESS',
  dueOn: '2026-10-20',
  overdue: false,
  progress,
  sentAt: at,
  submittedAt: null,
};
const item = {
  id,
  title: 'Bank statements',
  instructions: 'January to December 2024',
  required: true,
  category: null,
  status: 'REQUESTED',
  statusNote: null,
  files: [],
  canUpload: true,
};
const packet = {
  ...row,
  message: null,
  requestedBy: 'K. Fake',
  taxYear: 2024,
  expiresAt: null,
  allowMultipleFiles: true,
  items: [item],
  canSubmit: false,
  activity: [{ at, kind: 'SENT', itemTitle: null, by: 'FIRM' }],
};

describe('request packets (portal)', () => {
  it('reads the list and one packet', async () => {
    expect(MyRequestPacketList.parse({ items: [row] }).items[0]?.progress).toEqual(progress);
    expect(MyRequestPacket.parse(packet).items[0]?.title).toBe('Bank statements');
  });

  it('never shows a draft, a cancelled packet or a cancelled item', () => {
    for (const status of ['DRAFT', 'CANCELLED'])
      expect(MyRequestPacketList.safeParse({ items: [{ ...row, status }] }).success).toBe(false);
    const cancelled = { ...packet, items: [{ ...item, status: 'CANCELLED' }] };
    expect(MyRequestPacket.safeParse(cancelled).success).toBe(false);
  });

  it('names who acted only as the client or the firm', () => {
    const event = (by: string) => ({
      ...packet,
      activity: [{ at, kind: 'UPLOADED', itemTitle: 'W-2', by }],
    });
    expect(MyRequestPacket.safeParse(event('YOU')).success).toBe(true);
    expect(MyRequestPacket.safeParse(event('K. Fake')).success).toBe(false);
  });

  it('tells a request on its own from an item of a packet', () => {
    const base = {
      id,
      service: { id, title: 'Personal Tax' },
      category: null,
      title: 'W-2',
      instructions: null,
      dueOn: null,
      status: 'REQUESTED',
      statusNote: null,
    };
    expect(MyDocumentRequest.parse({ ...base, packet: null }).packet).toBeNull();
    const ref = { id, reference: 'DR-0024', title: 'Fake 2024 tax documents' };
    expect(MyDocumentRequest.parse({ ...base, packet: ref }).packet).toEqual(ref);
  });

  it("refuses a bad id before sending, and passes submit's 409s through", async () => {
    const calls: string[] = [];
    const fn = (async (url: string) => {
      calls.push(url);
      return new Response(
        JSON.stringify({ error: { code: 'PACKET_INCOMPLETE', message: 'Fake' } }),
        { status: 409, headers: { 'content-type': 'application/json' } },
      );
    }) as unknown as typeof fetch;
    const api = createMyDocumentsClient(request(fn), 'lvp');
    const bad = await api.packet('../x').catch((e: unknown) => e);
    expect((bad as ApiRequestError).code).toBe('VALIDATION_FAILED');
    expect(calls).toHaveLength(0);
    const refused = await api.submitPacket(id).catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(ApiRequestError);
    expect([(refused as ApiRequestError).status, (refused as ApiRequestError).code]).toEqual([
      409,
      'PACKET_INCOMPLETE',
    ]);
    expect(DOCUMENT_ERRORS.PACKET_INCOMPLETE).toMatch(/required item/);
  });
});
