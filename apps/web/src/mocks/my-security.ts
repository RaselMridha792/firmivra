import {
  ApiRequestError,
  ChangeMyPasswordRequest,
  type MySecurityClient,
  type MySessionItem,
  parseInput,
  SignOutOtherSessionsRequest,
} from '@firmivra/types';
import { mockDelay } from '../lib/mock';

// `api.mySecurity` in mock mode (SM14 part B): the signed-in member's own sessions and password.
// "Current-Password-1" is the mock's current password. Synthetic data only.
const CURRENT = 'Current-Password-1';

function seed(): MySessionItem[] {
  const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();
  return [
    {
      id: '0199c0a0-5e55-7000-8000-000000000001',
      device: 'Chrome on Windows',
      place: 'Springfield, GA, USA',
      ip: '203.0.113.12',
      createdAt: ago(90),
      lastActiveAt: ago(1),
      activeNow: true,
      current: true,
    },
    {
      id: '0199c0a0-5e55-7000-8000-000000000002',
      device: 'Safari on iOS',
      place: 'Springfield, GA, USA',
      ip: '198.51.100.40',
      createdAt: ago(60 * 26),
      lastActiveAt: ago(60 * 3),
      activeNow: false,
      current: false,
    },
  ];
}

export function createMySecurityMock(): MySecurityClient {
  let sessions: MySessionItem[] | undefined;
  const mine = () => (sessions ??= seed());
  const endOthers = () => {
    const before = mine().length;
    sessions = mine().filter((s) => s.current);
    return before - sessions.length;
  };
  return {
    sessions: async () => {
      await mockDelay();
      return structuredClone(mine());
    },
    signOutOthers: async (body) => {
      await mockDelay();
      parseInput(SignOutOtherSessionsRequest, body);
      return { ok: true, sessionsRevoked: endOthers() };
    },
    changePassword: async (body) => {
      await mockDelay();
      const input = parseInput(ChangeMyPasswordRequest, body);
      if (input.currentPassword !== CURRENT)
        throw new ApiRequestError(
          400,
          'VALIDATION_FAILED',
          'Your current password is not right',
          undefined,
          undefined,
          [{ path: 'currentPassword', message: 'Your current password is not right' }],
        );
      return { ok: true, sessionsRevoked: endOthers() };
    },
  };
}
