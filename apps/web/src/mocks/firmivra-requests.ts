import {
  ApiRequestError,
  CreateFirmivraRequestUploadRequest,
  FirmivraRequestId,
  type FirmivraRequestItem,
  type FirmivraRequestMessage,
  type FirmivraRequestsClient,
  type FirmivraRequestThread,
  parseInput,
  ReplyFirmivraRequestRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';

/**
 * Mock data for `api.firmivraRequests` (Settings > Requests from Firmivra, SA-FRM-F06). Synthetic
 * data only. As the API: Owner only (403 FORBIDDEN for anyone else), 404 for an unknown request,
 * 409 REQUEST_CLOSED on a resolved one; an answer moves its request from Waiting to Open; the same
 * `requestId` again answers without a second message. `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=firmivraRequests) has no requests; otherwise one waits for the
 * firm's answer and one older one is resolved, with Firmivra's sent reply.
 */
const MOCK_REQUEST_ID = '0199c0f0-0f00-7000-8000-000000000001';
const RESOLVED_ID = '0199c0f0-0f00-7000-8000-000000000002';

interface Row {
  item: FirmivraRequestItem;
  request: string;
  messages: FirmivraRequestMessage[];
}

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const seed = (): Row[] => [
  {
    item: {
      id: MOCK_REQUEST_ID,
      number: 1101,
      subject: 'Your business licence',
      status: 'WAITING_ON_CUSTOMER',
      requestedAt: daysAgo(1),
      lastActivityAt: daysAgo(1),
      awaitingAnswer: true,
    },
    request:
      'Fake: please send a copy of your current business licence.\n\nPlease answer by December 1, 2026.',
    messages: [],
  },
  {
    item: {
      id: RESOLVED_ID,
      number: 1090,
      subject: 'Your office address',
      status: 'RESOLVED',
      requestedAt: daysAgo(20),
      lastActivityAt: daysAgo(18),
      awaitingAnswer: false,
    },
    request: 'Fake: please confirm your main office address.',
    messages: [
      {
        id: '0199c0f0-0f10-7000-8000-000000000001',
        from: 'FIRM',
        authorName: 'Mock User',
        body: 'Fake: 100 Example Street, Suite 2.',
        at: daysAgo(19),
        files: [],
      },
      {
        id: '0199c0f0-0f10-7000-8000-000000000002',
        from: 'FIRMIVRA',
        authorName: 'Firmivra',
        body: 'Fake: thanks, we updated our records.',
        at: daysAgo(18),
        files: [],
      },
    ],
  },
];

export function createFirmivraRequestsMock(
  options: { role?: MockRole; empty?: boolean } = {},
): FirmivraRequestsClient {
  const rows: Row[] = options.empty ? [] : seed();
  const answered = new Map<string, string>();
  let next = 100;
  const tokens = new Map<string, { fileName: string; contentType: string; sizeBytes: number }>();

  const allowed = async () => {
    await mockDelay();
    if ((options.role ?? 'OWNER') !== 'OWNER')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  const find = (id: string) => {
    const row = rows.find((r) => r.item.id === parseInput(FirmivraRequestId, id));
    if (!row) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
    return row;
  };
  const done = (row: Row) => row.item.status === 'RESOLVED' || row.item.status === 'CLOSED';
  const closed = () =>
    new ApiRequestError(
      409,
      'REQUEST_CLOSED',
      'Firmivra has closed this request. Send Firmivra a new message if you need to.',
    );
  const thread = (row: Row): FirmivraRequestThread =>
    structuredClone({
      ...row.item,
      request: row.request,
      messages: row.messages,
      canReply: !done(row),
    });
  const uuid = (n: number) => `0199c0f0-0f20-7000-8000-${String(n).padStart(12, '0')}`;

  return {
    list: async () => {
      await allowed();
      return { items: rows.map((r) => structuredClone(r.item)) };
    },
    get: async (id) => {
      await allowed();
      return thread(find(id));
    },
    createUpload: async (id, body) => {
      const input = parseInput(CreateFirmivraRequestUploadRequest, body);
      await allowed();
      const row = find(id);
      if (done(row)) throw closed();
      const token = `mock-upload-${(next += 1)}`;
      tokens.set(token, input);
      return {
        uploadToken: token,
        url: `mock:${token}`,
        method: 'PUT' as const,
        headers: { 'content-type': input.contentType },
        expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      };
    },
    reply: async (id, body) => {
      const input = parseInput(ReplyFirmivraRequestRequest, body);
      await allowed();
      const row = find(id);
      if (answered.has(input.requestId)) return thread(row);
      if (done(row)) throw closed();
      const files = input.uploadTokens.map((token) => {
        const file = tokens.get(token);
        if (!file)
          throw new ApiRequestError(
            410,
            'UPLOAD_EXPIRED',
            'The upload took too long. Attach the file again.',
          );
        tokens.delete(token);
        // The mock's scanner: clean at once.
        return { id: uuid((next += 1)), ...file, scanStatus: 'CLEAN' as const };
      });
      const at = new Date().toISOString();
      const message: FirmivraRequestMessage = {
        id: uuid((next += 1)),
        from: 'FIRM',
        authorName: 'Mock User',
        body: input.body,
        at,
        files,
      };
      row.messages = [...row.messages, message];
      answered.set(input.requestId, message.id);
      row.item = {
        ...row.item,
        status: row.item.status === 'WAITING_ON_CUSTOMER' ? 'OPEN' : row.item.status,
        awaitingAnswer: false,
        lastActivityAt: at,
      };
      return thread(row);
    },
    fileLink: async (id, fileId) => {
      await allowed();
      const row = find(id);
      const file = row.messages.flatMap((m) => m.files).find((f) => f.id === fileId);
      if (!file) throw new ApiRequestError(404, 'NOT_FOUND', 'Not found');
      return {
        url: `mock:download/${file.id}`,
        expiresAt: new Date(Date.now() + 300_000).toISOString(),
      };
    },
  };
}
