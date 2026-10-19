import {
  type AdminBroadcastsClient,
  type AdminCommBroadcast,
  type AdminCommSegment,
  ApiRequestError,
  CreateAdminCommBroadcastRequest,
  CreateAdminCommMediaRequest,
  CreateAdminCommSegmentRequest,
  ListAdminCommBroadcastRecipientsQuery,
  ListAdminCommBroadcastsQuery,
  ListAdminCommMediaQuery,
  ListAdminCommSegmentsQuery,
  parseInput,
  ScheduleAdminCommBroadcastRequest,
  TestAdminCommBroadcastRequest,
  UpdateAdminCommBroadcastRequest,
  UpdateAdminCommSegmentRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { getAdminBroadcastDashboard } from './admin-communications-broadcasts';
import { mockAudienceSegments } from './admin-communications-audience';

/**
 * `api.adminBroadcasts` in mock mode (R56): the broadcasts contract on Arfan's S10 fixtures
 * (mocks/admin-communications-broadcasts.ts and -audience.ts, unchanged), mapped to the contract
 * (docs/work/R56-super-admin-api.md). Arfan's "client" audiences become firm-owner audiences: a
 * firm's clients are never reached here (B6). Nothing is sent. Synthetic data only. Nothing is
 * built until the first call.
 */
const ME = { userId: '0199c3a0-0000-7000-8000-0000000000ff', name: 'Octavia Holder' };
const uuid = (block: string, n: number) =>
  `0199c3a0-0000-7000-${block}-${String(n).padStart(12, '0')}`;
const fail = (status: number, code: string) => new ApiRequestError(status, code, code);
const notFound = () => fail(404, 'NOT_FOUND');
const STATUS = { DRAFT: 'DRAFT', SCHEDULED: 'SCHEDULED', SENT: 'SENT', FAILED: 'FAILED' } as const;

interface Store {
  broadcasts: AdminCommBroadcast[];
  segments: AdminCommSegment[];
}

async function build(): Promise<Store> {
  const dashboard = await getAdminBroadcastDashboard();
  const now = new Date().toISOString();
  const segments: AdminCommSegment[] = mockAudienceSegments.map((s, i) => ({
    id: uuid('8100', i + 1),
    name: s.name.replace(/Clients/g, 'Firms'),
    description: s.description.replace(/clients/g, 'firms'),
    definition: { contactTypes: ['FIRM'], firmStatuses: ['ACTIVE'] },
    lastCount: s.contacts,
    lastCountedAt: `${s.updatedAt}T12:00:00.000Z`,
    archivedAt: null,
    createdBy: ME,
    createdAt: `${s.updatedAt}T12:00:00.000Z`,
    updatedAt: `${s.updatedAt}T12:00:00.000Z`,
  }));
  const broadcasts: AdminCommBroadcast[] = dashboard.broadcasts.map((b, i) => {
    const at = `${b.date}T14:00:00.000Z`;
    const status = STATUS[b.status];
    const sending = status === 'SENT' || status === 'FAILED';
    const seg =
      segments.find((s) => s.name.startsWith(b.audience.split(' ')[0] ?? '')) ??
      segments[0] ??
      null;
    return {
      id: uuid('8101', i + 1),
      name: b.name,
      status,
      segment: seg ? { id: seg.id, name: seg.name } : null,
      channels: [
        {
          id: uuid('8102', i + 1),
          channel: b.channel,
          subject: b.channel === 'EMAIL' ? b.name : null,
          body: b.description,
          status: sending ? status : 'DRAFT',
          sentCount: status === 'SENT' ? b.recipients : 0,
          failedCount: status === 'FAILED' ? b.recipients : 0,
          media: [],
        },
      ],
      scheduledAt: status === 'SCHEDULED' ? at : null,
      scheduledTimeZone: status === 'SCHEDULED' ? 'America/New_York' : null,
      recipientCount: sending ? b.recipients : null,
      duplicatedFromId: null,
      sendStartedAt: sending ? at : null,
      finishedAt: sending ? at : null,
      errorMessage: status === 'FAILED' ? 'Every recipient failed (sample)' : null,
      archivedAt: null,
      createdBy: { userId: ME.userId, name: b.createdBy },
      updatedBy: ME,
      createdAt: at,
      updatedAt: now,
    };
  });
  return { broadcasts, segments };
}

export function createAdminBroadcastsMock(): AdminBroadcastsClient {
  let store: Store | undefined;
  const s = async () => (store ??= await build());
  const find = async (id: string) => {
    const b = (await s()).broadcasts.find((x) => x.id === id);
    if (!b) throw notFound();
    return b;
  };
  const editable = (b: AdminCommBroadcast) => {
    if (b.status !== 'DRAFT' && b.status !== 'SCHEDULED') throw fail(409, 'NOT_EDITABLE');
  };
  const touch = (b: AdminCommBroadcast) =>
    Object.assign(b, { updatedAt: new Date().toISOString(), updatedBy: ME });
  const page = <T>(rows: T[], q: { page: number; pageSize: number }) => ({
    items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
    total: rows.length,
    page: q.page,
    pageSize: q.pageSize,
  });

  return {
    broadcasts: {
      list: async (query = {}) => {
        await mockDelay();
        const q = parseInput(ListAdminCommBroadcastsQuery, query);
        const term = q.search?.toLowerCase();
        const rows = (await s()).broadcasts
          .filter(
            (b) =>
              !!b.archivedAt === q.archived &&
              (!q.status || b.status === q.status) &&
              (!q.channel || b.channels.some((c) => c.channel === q.channel)) &&
              (!term || b.name.toLowerCase().includes(term)),
          )
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return page(rows, q);
      },
      summary: async () => {
        await mockDelay();
        const live = (await s()).broadcasts.filter((b) => !b.archivedAt);
        const n = (...st: string[]) => live.filter((b) => st.includes(b.status)).length;
        return {
          total: live.length,
          drafts: n('DRAFT'),
          scheduled: n('SCHEDULED'),
          sent: n('SENT', 'PARTIALLY_SENT'),
          failed: n('FAILED'),
        };
      },
      get: async (id) => (await mockDelay(), find(id)),
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommBroadcastRequest, body);
        const st = await s();
        const at = new Date().toISOString();
        const row: AdminCommBroadcast = {
          id: uuid('8101', st.broadcasts.length + 1),
          name: b.name,
          status: 'DRAFT',
          segment: null,
          channels: [],
          scheduledAt: null,
          scheduledTimeZone: null,
          recipientCount: null,
          duplicatedFromId: null,
          sendStartedAt: null,
          finishedAt: null,
          errorMessage: null,
          archivedAt: null,
          createdBy: ME,
          updatedBy: ME,
          createdAt: at,
          updatedAt: at,
        };
        st.broadcasts.push(row);
        return row;
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommBroadcastRequest, body);
        const row = await find(id);
        editable(row);
        if (b.name) row.name = b.name;
        if (b.segmentId !== undefined) {
          const seg = b.segmentId ? (await s()).segments.find((x) => x.id === b.segmentId) : null;
          if (b.segmentId && !seg) throw notFound();
          if (seg?.archivedAt) throw fail(409, 'SEGMENT_ARCHIVED');
          row.segment = seg ? { id: seg.id, name: seg.name } : null;
        }
        if (b.channels)
          row.channels = b.channels.map((c, i) => ({
            id: uuid('8102', 500 + i),
            channel: c.channel,
            subject: c.subject ?? null,
            body: c.body,
            status: 'DRAFT' as const,
            sentCount: 0,
            failedCount: 0,
            media: [],
          }));
        return touch(row);
      },
      test: async (id, body) => {
        await mockDelay();
        const b = parseInput(TestAdminCommBroadcastRequest, body);
        await find(id);
        return {
          sentTo: b.channels.map((c) =>
            c === 'SMS'
              ? (b.phone ?? '+15125550147')
              : c === 'EMAIL'
                ? 'octavia@firmivra.example.test'
                : 'Your bell',
          ),
        };
      },
      schedule: async (id, body) => {
        await mockDelay();
        const b = parseInput(ScheduleAdminCommBroadcastRequest, body);
        const row = await find(id);
        editable(row);
        if (!row.segment) throw fail(409, 'NO_SEGMENT');
        if (!row.channels.length) throw fail(409, 'NO_CHANNEL');
        if (Date.parse(b.scheduledAt) <= Date.now()) throw fail(409, 'SCHEDULE_IN_PAST');
        return touch(Object.assign(row, { status: 'SCHEDULED', ...b }));
      },
      send: async (id) => {
        await mockDelay();
        const row = await find(id);
        if (['SENDING', 'SENT', 'PARTIALLY_SENT', 'FAILED'].includes(row.status)) return row;
        editable(row);
        if (!row.segment) throw fail(409, 'NO_SEGMENT');
        if (!row.channels.length) throw fail(409, 'NO_CHANNEL');
        const count = (await s()).segments.find((x) => x.id === row.segment!.id)?.lastCount ?? 0;
        if (!count) throw fail(409, 'EMPTY_AUDIENCE');
        const at = new Date().toISOString();
        for (const c of row.channels) Object.assign(c, { status: 'SENT', sentCount: count });
        return touch(
          Object.assign(row, {
            status: 'SENT',
            recipientCount: count,
            sendStartedAt: at,
            finishedAt: at,
          }),
        );
      },
      cancel: async (id) => {
        await mockDelay();
        const row = await find(id);
        if (row.status !== 'SCHEDULED') throw fail(409, 'NOT_SCHEDULED');
        return touch(Object.assign(row, { status: 'CANCELLED' }));
      },
      retry: async (id) => {
        await mockDelay();
        const row = await find(id);
        if (row.status !== 'FAILED') throw fail(409, 'NOT_RETRYABLE');
        for (const c of row.channels)
          Object.assign(c, { status: 'SENT', sentCount: c.failedCount, failedCount: 0 });
        return touch(Object.assign(row, { status: 'SENT', errorMessage: null }));
      },
      duplicate: async (id) => {
        await mockDelay();
        const st = await s();
        const row = await find(id);
        const at = new Date().toISOString();
        const copy: AdminCommBroadcast = {
          ...structuredClone(row),
          id: uuid('8101', st.broadcasts.length + 1),
          name: `${row.name} (copy)`,
          status: 'DRAFT',
          channels: row.channels.map((c) => ({
            ...c,
            status: 'DRAFT' as const,
            sentCount: 0,
            failedCount: 0,
          })),
          scheduledAt: null,
          scheduledTimeZone: null,
          recipientCount: null,
          duplicatedFromId: row.id,
          sendStartedAt: null,
          finishedAt: null,
          errorMessage: null,
          archivedAt: null,
          createdBy: ME,
          createdAt: at,
          updatedAt: at,
        };
        st.broadcasts.push(copy);
        return copy;
      },
      archive: async (id) => {
        await mockDelay();
        const row = await find(id);
        if (!['SENT', 'PARTIALLY_SENT', 'FAILED', 'CANCELLED'].includes(row.status))
          throw fail(409, 'NOT_FINISHED');
        row.archivedAt ??= new Date().toISOString();
        return row;
      },
      remove: async (id) => {
        await mockDelay();
        const st = await s();
        const row = await find(id);
        if (row.status !== 'DRAFT') throw fail(409, 'NOT_DRAFT');
        st.broadcasts = st.broadcasts.filter((x) => x.id !== id);
        return { ok: true as const };
      },
      recipients: async (id, query = {}) => {
        await mockDelay();
        const q = parseInput(ListAdminCommBroadcastRecipientsQuery, query);
        await find(id);
        return page([], q);
      },
    },
    segments: {
      list: async (query = {}) => {
        await mockDelay();
        const q = parseInput(ListAdminCommSegmentsQuery, query);
        const term = q.search?.toLowerCase();
        return page(
          (await s()).segments.filter(
            (x) => !!x.archivedAt === q.archived && (!term || x.name.toLowerCase().includes(term)),
          ),
          q,
        );
      },
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommSegmentRequest, body);
        const st = await s();
        if (st.segments.some((x) => x.name.toLowerCase() === b.name.toLowerCase()))
          throw fail(409, 'DUPLICATE_NAME');
        const at = new Date().toISOString();
        const row: AdminCommSegment = {
          id: uuid('8100', st.segments.length + 1),
          name: b.name,
          description: b.description ?? null,
          definition: b.definition,
          lastCount: null,
          lastCountedAt: null,
          archivedAt: null,
          createdBy: ME,
          createdAt: at,
          updatedAt: at,
        };
        st.segments.push(row);
        return row;
      },
      update: async (id, body) => {
        await mockDelay();
        const b = parseInput(UpdateAdminCommSegmentRequest, body);
        const row = (await s()).segments.find((x) => x.id === id && !x.archivedAt);
        if (!row) throw notFound();
        Object.assign(row, {
          ...(b.name ? { name: b.name } : {}),
          ...(b.description !== undefined ? { description: b.description } : {}),
          ...(b.definition ? { definition: b.definition } : {}),
          ...(b.archived ? { archivedAt: new Date().toISOString() } : {}),
          updatedAt: new Date().toISOString(),
        });
        return row;
      },
      count: async (id) => {
        await mockDelay();
        const row = (await s()).segments.find((x) => x.id === id);
        if (!row) throw notFound();
        const total = row.lastCount ?? 0;
        const countedAt = new Date().toISOString();
        Object.assign(row, { lastCount: total, lastCountedAt: countedAt });
        return {
          total,
          byChannel: {
            EMAIL: total,
            SMS: Math.round(total * 0.6),
            IN_APP: Math.round(total * 0.4),
          },
          countedAt,
        };
      },
    },
    media: {
      list: async (query = {}) => {
        await mockDelay();
        return page([], parseInput(ListAdminCommMediaQuery, query));
      },
      /** A ticket whose `mock:` URL takes nothing; the file stays PENDING (no scanner here). */
      create: async (body) => {
        await mockDelay();
        const b = parseInput(CreateAdminCommMediaRequest, body);
        const at = new Date();
        return {
          media: {
            id: uuid('8103', 1),
            kind: b.kind,
            fileName: b.fileName,
            contentType: b.contentType,
            sizeBytes: b.sizeBytes,
            scanStatus: 'PENDING' as const,
            uploadedBy: ME,
            createdAt: at.toISOString(),
          },
          uploadUrl: 'mock:upload',
          expiresAt: new Date(at.getTime() + 15 * 60_000).toISOString(),
        };
      },
    },
  };
}
