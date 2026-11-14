import { ApiRequestError } from '@firmivra/types';

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

const emptySetting =
  process.env.NODE_ENV === 'production' ? '' : (process.env.NEXT_PUBLIC_API_MOCK_EMPTY ?? '');
const EMPTY_MODULES = emptySetting
  .split(',')
  .map((m) => m.trim())
  .filter(Boolean);

/**
 * True when this module's mock should start with no records, to build the empty state:
 *   NEXT_PUBLIC_API_MOCK_EMPTY=staff,scheduling   (or `all`). Only mocks that offer `empty` read it.
 */
export const mockedEmpty = (module: string): boolean =>
  EMPTY_MODULES.includes('all') || EMPTY_MODULES.includes(module);

type MockRole = 'OWNER' | 'ADMIN' | 'STAFF';
const ROLES: readonly MockRole[] = ['OWNER', 'ADMIN', 'STAFF'];
const role = process.env.NEXT_PUBLIC_API_MOCK_ROLE as MockRole | undefined;

/** Role of the mock signed-in user: NEXT_PUBLIC_API_MOCK_ROLE if it's a firm role, else OWNER. */
export const MOCK_ROLE: MockRole = role && ROLES.includes(role) ? role : 'OWNER';

/** Waits like a real request, so loading states show in mock mode too. */
export const mockDelay = (ms = 250) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** sessionStorage key a mock spec sets to make named mock calls fail (see `failable`). */
export const MOCK_FAIL_KEY = 'fv-mock-fail';

/**
 * Mock mode, for fault-injection specs (Dashboard Review 2 V6): the module's mock client, whose
 * calls named in sessionStorage `fv-mock-fail` ("dashboard.summary,messages.inbox") answer 500
 * like a failing API, so a spec can show each widget's error state and Try again. Reads the key
 * on every call, so clearing it lets Try again succeed. Mock mode is off in production builds.
 */
export function failable<T extends object>(module: string, client: T): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      const value: unknown = Reflect.get(target, prop, receiver);
      if (typeof value !== 'function' || typeof prop !== 'string') return value;
      return (...args: unknown[]) => {
        let failing: string[] = [];
        try {
          failing = (window.sessionStorage.getItem(MOCK_FAIL_KEY) ?? '').split(',');
        } catch {
          // No storage (server render, a private window): nothing fails.
        }
        if (failing.includes(`${module}.${prop}`))
          return Promise.reject(
            new ApiRequestError(500, 'INTERNAL_ERROR', 'Something went wrong on our side.'),
          );
        return (value as (...a: unknown[]) => unknown).apply(target, args);
      };
    },
  });
}
