import {
  ApiRequestError,
  CreateTagRequest,
  type FirmTag,
  parseInput,
  TAG_ERRORS,
  type TagsClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import type { MockFirmRole } from './clients';

// The firm's one tag list in mock mode (L5, L6), shared by `api.tags` and the clients mock's
// client tags. Synthetic names only. Built on first use, never on import.

interface MockTag {
  id: string;
  name: string;
  leads: number;
  clients: number;
}

let store: MockTag[] | null = null;
let next = 0;
const tagId = () => {
  next += 1;
  return `0199c0c0-7a90-7000-8000-${String(next).padStart(12, '0')}`;
};

/** The firm's tags, made on first use. */
export function mockFirmTags(): MockTag[] {
  store ??= ['Back Taxes', 'High Value', 'Referral Partner', 'Spanish Speaking'].map((name) => ({
    id: tagId(),
    name,
    leads: 0,
    clients: 0,
  }));
  return store;
}

const key = (name: string) => name.trim().toLowerCase();

/** The firm's tag with this name, in any case. */
export const mockTagNamed = (name: string): MockTag | undefined =>
  mockFirmTags().find((t) => key(t.name) === key(name));

/**
 * The names as the firm keeps them: an existing name (any case) is that tag, repeats count once,
 * and a new one is added for Owner and Admin (400 UNKNOWN_TAG for anyone else).
 */
export function mockResolveTags(names: readonly string[], role: MockFirmRole): string[] {
  const out: string[] = [];
  for (const name of names) {
    const known = mockTagNamed(name);
    if (!known && role === 'STAFF') {
      throw new ApiRequestError(400, 'UNKNOWN_TAG', TAG_ERRORS.UNKNOWN_TAG);
    }
    const tag = known ?? { id: tagId(), name: name.trim(), leads: 0, clients: 0 };
    if (!known) mockFirmTags().push(tag);
    if (!out.some((n) => key(n) === key(tag.name))) out.push(tag.name);
  }
  return out;
}

/** `api.tags` in mock mode. */
export function createTagsMock(options: { role?: MockFirmRole } = {}): TagsClient {
  const role = options.role ?? 'OWNER';
  const sorted = () =>
    [...mockFirmTags()].sort((a, b) => a.name.localeCompare(b.name)).map((t) => ({ ...t }));
  return {
    list: async () => {
      await mockDelay();
      return { items: sorted() };
    },
    create: async (body): Promise<FirmTag> => {
      await mockDelay();
      const { name } = parseInput(CreateTagRequest, body);
      if (role === 'STAFF') {
        throw new ApiRequestError(403, 'FORBIDDEN', 'Only an Owner or Admin can add a tag.');
      }
      if (mockTagNamed(name)) throw new ApiRequestError(409, 'TAG_EXISTS', TAG_ERRORS.TAG_EXISTS);
      const tag = { id: tagId(), name, leads: 0, clients: 0 };
      mockFirmTags().push(tag);
      return { ...tag };
    },
  };
}
