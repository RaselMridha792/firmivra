import {
  ApiRequestError,
  CreateProfileChangeRequest,
  PROFILE_CHANGE_FIELDS,
  parseInput,
  type ProfileChange,
  type ProfileChangeField,
  type ProfileChangesClient,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';
import { settingsFixture } from './settings';

/**
 * Mock data for `api.profileChanges` (Company Profile's Request Change). Synthetic data only.
 * STAFF gets 403 FORBIDDEN, like the API; the same `requestId` again answers the first request;
 * the current legal name is refused as a proposed one. `empty: true`
 * (NEXT_PUBLIC_API_MOCK_EMPTY=profileChanges) starts with no requests; otherwise one licensing
 * request is in review with a reply from Firmivra.
 */
type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';

const seed = (): ProfileChange[] => [
  {
    id: '0199c0e0-0c00-7000-8000-000000000001',
    number: '#1003',
    kind: 'LICENSING',
    fields: ['licenseNumber', 'expirationDate'],
    status: 'IN_PROGRESS',
    submittedAt: '2026-10-20T14:00:00.000Z',
    submittedBy: 'Sam Sample',
    closedAt: null,
    latestReply: {
      body: 'We are checking the new license number with the state board.',
      at: '2026-10-21T09:30:00.000Z',
    },
  },
];

export function createProfileChangesMock(
  options: { role?: MockRole; empty?: boolean } = {},
): ProfileChangesClient {
  let items: ProfileChange[] = options.empty ? [] : seed();
  const keys = new Map<string, string>();
  let next = 1004;
  const allowed = async () => {
    await mockDelay();
    if (options.role === 'STAFF')
      throw new ApiRequestError(403, 'FORBIDDEN', 'This action is not permitted');
  };
  return {
    list: async () => {
      await allowed();
      return { items: items.slice(0, 20) };
    },
    create: async (input) => {
      const body = parseInput(CreateProfileChangeRequest, input);
      await allowed();
      const known = items.find((i) => i.id === keys.get(body.requestId));
      if (known) return known;
      if (body.changes.legalName === settingsFixture().business.legalName)
        throw new ApiRequestError(
          400,
          'VALIDATION_FAILED',
          'The request is not valid',
          undefined,
          undefined,
          [{ path: 'changes.legalName', message: 'This is already the legal name' }],
        );
      const fields = (Object.keys(PROFILE_CHANGE_FIELDS) as ProfileChangeField[]).filter(
        (f) => body.changes[f] !== undefined,
      );
      const made: ProfileChange = {
        id: `0199c0e0-0c00-7000-8000-${String(next).padStart(12, '0')}`,
        number: `#${next++}`,
        kind: body.kind,
        fields,
        status: 'OPEN',
        submittedAt: new Date().toISOString(),
        submittedBy: 'Sam Sample',
        closedAt: null,
        latestReply: null,
      };
      keys.set(body.requestId, made.id);
      items = [made, ...items];
      return made;
    },
  };
}
