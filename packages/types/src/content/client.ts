import { type ApiRequest, parseInput, toQuery } from '../client.js';
import { portalMe } from '../clients/client.js';
import { OkResponse } from '../schemas.js';
import {
  ContentId,
  ContentItem,
  ContentList,
  ContentQuery,
  CreateContentRequest,
  MyContentList,
  MyContentQuery,
  UpdateContentRequest,
} from './schemas.js';

const BASE = '/business/content';
const one = (id: string) => `${BASE}/${parseInput(ContentId, id)}`;

/**
 * `api.content`: the firm's resources, tips and external links. Everyone at the firm reads;
 * Owner and Admin change them (403 FORBIDDEN for Staff). New items are drafts until published.
 */
export function createContentClient(request: ApiRequest) {
  return {
    list: async (query: ContentQuery = {}): Promise<ContentList['items']> => {
      const q = parseInput(ContentQuery, query);
      return (await request(ContentList, `${BASE}${toQuery(q)}`)).items;
    },
    create: async (body: CreateContentRequest): Promise<ContentItem> =>
      request(ContentItem, BASE, { method: 'POST', body: parseInput(CreateContentRequest, body) }),
    update: async (id: string, body: UpdateContentRequest): Promise<ContentItem> =>
      request(ContentItem, one(id), {
        method: 'PATCH',
        body: parseInput(UpdateContentRequest, body),
      }),
    publish: async (id: string): Promise<ContentItem> =>
      request(ContentItem, `${one(id)}/publish`, { method: 'POST' }),
    unpublish: async (id: string): Promise<ContentItem> =>
      request(ContentItem, `${one(id)}/unpublish`, { method: 'POST' }),
    remove: async (id: string): Promise<OkResponse> =>
      request(OkResponse, one(id), { method: 'DELETE' }),
  };
}
export type ContentClient = ReturnType<typeof createContentClient>;

/**
 * `api.myContent(slug)`: the firm's published content for the signed-in client. Resources and
 * external links are 403 BUSINESS_ONLY for an individual client: show the page as unavailable.
 */
export function createMyContentClient(request: ApiRequest, firmSlug: string) {
  return {
    list: async (query: MyContentQuery = {}): Promise<MyContentList['items']> => {
      const q = parseInput(MyContentQuery, query);
      return (await request(MyContentList, `${portalMe(firmSlug)}/content${toQuery(q)}`)).items;
    },
  };
}
export type MyContentClient = ReturnType<typeof createMyContentClient>;
