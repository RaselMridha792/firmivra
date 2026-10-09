import type { MembershipRole } from '@firmivra/types';

/**
 * Mock mode: build a screen before its API is on main. In apps/web/.env.local set
 *   NEXT_PUBLIC_API_MOCK=all              every module that has mocks
 *   NEXT_PUBLIC_API_MOCK=taxStatuses,me   only these modules (names as on `api`, plus
 *                                         `portalAuth`, `adminAuth` and `staffAuth` for lib/auth.ts)
 * Mocks live in apps/web/src/mocks/<module>.ts and are typed like the real client.
 * Off by default, and always off in a production build: `next build` sets NODE_ENV to
 * 'production', so the setting below compiles to '' even if the variable is set. Only
 * `pnpm dev` (and the mock Playwright run) can use it. A "Mock data" badge shows when it's on.
 */
const setting =
  process.env.NODE_ENV === 'production' ? '' : (process.env.NEXT_PUBLIC_API_MOCK ?? '');

/** Modules running on mock data: ['all'], a list of module names, or []. */
export const MOCK_MODULES: readonly string[] = setting
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/** True when this module should use its mock instead of the API. */
export const mocked = (module: string): boolean =>
  MOCK_MODULES.includes('all') || MOCK_MODULES.includes(module);

const ROLES: readonly MembershipRole[] = ['OWNER', 'ADMIN', 'STAFF'];
const role = process.env.NEXT_PUBLIC_API_MOCK_ROLE as MembershipRole | undefined;

/** Role of the mock signed-in user: NEXT_PUBLIC_API_MOCK_ROLE if it's a firm role, else OWNER. */
export const MOCK_ROLE: MembershipRole = role && ROLES.includes(role) ? role : 'OWNER';

/** Waits like a real request, so loading states show in mock mode too. */
export const mockDelay = (ms = 250) => new Promise<void>((resolve) => setTimeout(resolve, ms));
