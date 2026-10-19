import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { OkResponse } from '../schemas.js';
import {
  AdminCommBroadcast,
  AdminCommBroadcastId,
  AdminCommBroadcastSummary,
  AdminCommBroadcastTestSent,
  AdminCommMediaTicket,
  AdminCommSegment,
  AdminCommSegmentCount,
  AdminCommSegmentId,
  CreateAdminCommBroadcastRequest,
  CreateAdminCommMediaRequest,
  CreateAdminCommSegmentRequest,
  ListAdminCommBroadcastRecipientsQuery,
  ListAdminCommBroadcastRecipientsResponse,
  ListAdminCommBroadcastsQuery,
  ListAdminCommBroadcastsResponse,
  ListAdminCommMediaQuery,
  ListAdminCommMediaResponse,
  ListAdminCommSegmentsQuery,
  ListAdminCommSegmentsResponse,
  ScheduleAdminCommBroadcastRequest,
  SendAdminCommBroadcastRequest,
  TestAdminCommBroadcastRequest,
  UpdateAdminCommBroadcastRequest,
  UpdateAdminCommSegmentRequest,
} from './broadcasts.js';

const BASE = '/admin/communications';
const broadcast = (id: string) => `${BASE}/broadcasts/${parseInput(AdminCommBroadcastId, id)}`;
const segment = (id: string) => `${BASE}/segments/${parseInput(AdminCommSegmentId, id)}`;

/**
 * `api.adminBroadcasts` (apps/web/src/lib/api.ts): Super Admin broadcasts (the dashboard and the
 * 4-step flow), audiences (segments) and the file library. 401 without the Super Admin site's
 * session, 403 for anyone else. Screens show errors with
 * `errorMessage(error, ADMIN_COMM_BROADCAST_ERRORS)`. Every send, schedule, cancel, retry and
 * test is audited (ids only).
 */
export function createAdminBroadcastsClient(request: ApiRequest) {
  const post = <T extends Parameters<ApiRequest>[0]>(schema: T, path: string, body: unknown = {}) =>
    request(schema, path, { method: 'POST', body });
  return {
    broadcasts: {
      list: async (
        query: ListAdminCommBroadcastsQuery = {},
      ): Promise<ListAdminCommBroadcastsResponse> =>
        request(
          ListAdminCommBroadcastsResponse,
          `${BASE}/broadcasts${toQuery(parseInput(ListAdminCommBroadcastsQuery, query))}`,
        ),
      summary: async (): Promise<AdminCommBroadcastSummary> =>
        request(AdminCommBroadcastSummary, `${BASE}/broadcasts/summary`),
      get: async (id: string): Promise<AdminCommBroadcast> =>
        request(AdminCommBroadcast, broadcast(id)),
      /** Step 1: a draft with its name. */
      create: async (body: CreateAdminCommBroadcastRequest): Promise<AdminCommBroadcast> =>
        post(
          AdminCommBroadcast,
          `${BASE}/broadcasts`,
          parseInput(CreateAdminCommBroadcastRequest, body),
        ),
      /**
       * Steps 1 to 3: name, audience, channel content. 409 NOT_EDITABLE, SEGMENT_ARCHIVED or
       * MEDIA_NOT_USABLE.
       */
      update: async (
        id: string,
        body: UpdateAdminCommBroadcastRequest,
      ): Promise<AdminCommBroadcast> =>
        request(AdminCommBroadcast, broadcast(id), {
          method: 'PATCH',
          body: parseInput(UpdateAdminCommBroadcastRequest, body),
        }),
      /** To the signed-in member only; not a send. */
      test: async (
        id: string,
        body: TestAdminCommBroadcastRequest,
      ): Promise<AdminCommBroadcastTestSent> =>
        post(
          AdminCommBroadcastTestSent,
          `${broadcast(id)}/test`,
          parseInput(TestAdminCommBroadcastRequest, body),
        ),
      /** Step 4, later. 409 NOT_EDITABLE, NO_SEGMENT, NO_CHANNEL or SCHEDULE_IN_PAST. */
      schedule: async (
        id: string,
        body: ScheduleAdminCommBroadcastRequest,
      ): Promise<AdminCommBroadcast> =>
        post(
          AdminCommBroadcast,
          `${broadcast(id)}/schedule`,
          parseInput(ScheduleAdminCommBroadcastRequest, body),
        ),
      /** Step 4, now: counts the audience and sends. 409 NO_SEGMENT, NO_CHANNEL or EMPTY_AUDIENCE. */
      send: async (id: string, body: SendAdminCommBroadcastRequest): Promise<AdminCommBroadcast> =>
        post(
          AdminCommBroadcast,
          `${broadcast(id)}/send`,
          parseInput(SendAdminCommBroadcastRequest, body),
        ),
      /** 409 NOT_SCHEDULED. */
      cancel: async (id: string): Promise<AdminCommBroadcast> =>
        post(AdminCommBroadcast, `${broadcast(id)}/cancel`),
      /** The failed recipients again. 409 NOT_RETRYABLE. */
      retry: async (id: string, body: SendAdminCommBroadcastRequest): Promise<AdminCommBroadcast> =>
        post(
          AdminCommBroadcast,
          `${broadcast(id)}/retry`,
          parseInput(SendAdminCommBroadcastRequest, body),
        ),
      /** A new draft with the same audience and content, named "<name> (copy)". */
      duplicate: async (id: string): Promise<AdminCommBroadcast> =>
        post(AdminCommBroadcast, `${broadcast(id)}/duplicate`),
      /** 409 NOT_FINISHED. */
      archive: async (id: string): Promise<AdminCommBroadcast> =>
        post(AdminCommBroadcast, `${broadcast(id)}/archive`),
      /** Drafts only. 409 NOT_DRAFT. */
      remove: async (id: string): Promise<OkResponse> =>
        request(OkResponse, broadcast(id), { method: 'DELETE' }),
      recipients: async (
        id: string,
        query: ListAdminCommBroadcastRecipientsQuery = {},
      ): Promise<ListAdminCommBroadcastRecipientsResponse> =>
        request(
          ListAdminCommBroadcastRecipientsResponse,
          `${broadcast(id)}/recipients${toQuery(parseInput(ListAdminCommBroadcastRecipientsQuery, query))}`,
        ),
    },
    segments: {
      list: async (
        query: ListAdminCommSegmentsQuery = {},
      ): Promise<ListAdminCommSegmentsResponse> =>
        request(
          ListAdminCommSegmentsResponse,
          `${BASE}/segments${toQuery(parseInput(ListAdminCommSegmentsQuery, query))}`,
        ),
      /** 409 DUPLICATE_NAME. */
      create: async (body: CreateAdminCommSegmentRequest): Promise<AdminCommSegment> =>
        post(AdminCommSegment, `${BASE}/segments`, parseInput(CreateAdminCommSegmentRequest, body)),
      /** 409 DUPLICATE_NAME; an archived segment is NOT_FOUND here. */
      update: async (id: string, body: UpdateAdminCommSegmentRequest): Promise<AdminCommSegment> =>
        request(AdminCommSegment, segment(id), {
          method: 'PATCH',
          body: parseInput(UpdateAdminCommSegmentRequest, body),
        }),
      /** Counts the audience now and keeps the count on the segment. */
      count: async (id: string): Promise<AdminCommSegmentCount> =>
        post(AdminCommSegmentCount, `${segment(id)}/count`),
    },
    media: {
      list: async (query: ListAdminCommMediaQuery = {}): Promise<ListAdminCommMediaResponse> =>
        request(
          ListAdminCommMediaResponse,
          `${BASE}/media${toQuery(parseInput(ListAdminCommMediaQuery, query))}`,
        ),
      /** An upload ticket; PUT the file to `uploadUrl`, then wait for the scan. */
      create: async (body: CreateAdminCommMediaRequest): Promise<AdminCommMediaTicket> =>
        post(AdminCommMediaTicket, `${BASE}/media`, parseInput(CreateAdminCommMediaRequest, body)),
    },
  };
}

export type AdminBroadcastsClient = ReturnType<typeof createAdminBroadcastsClient>;
