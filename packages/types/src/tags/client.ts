import { type ApiRequest, parseInput } from '../client.js';
import { CreateTagRequest, FirmTag, FirmTagList } from './schemas.js';

/** `api.tags` (apps/web/src/lib/api.ts): the firm's one tag list for Leads and Clients. */
export function createTagsClient(request: ApiRequest) {
  return {
    list: async (): Promise<FirmTagList> => request(FirmTagList, '/business/tags'),
    /** Add New Tag (Owner and Admin). 409 TAG_EXISTS. */
    create: async (body: CreateTagRequest): Promise<FirmTag> =>
      request(FirmTag, '/business/tags', {
        method: 'POST',
        body: parseInput(CreateTagRequest, body),
      }),
  };
}
export type TagsClient = ReturnType<typeof createTagsClient>;
