import { join } from 'node:path';
import {
  expect,
  request,
  type APIRequestContext,
  type Page,
  type TestInfo,
} from '@playwright/test';
import { appUrl, firmSlug, login, portalUrl, shotsDir, statePath, type Role } from './env';

export { app, portal, runTag } from './env';

/** `test.use(as('owner'))`: the role's saved session (from auth.setup.ts). */
export const as = (role: Role) => ({ storageState: statePath(role) });

/** Skips the test when the run has no login for the role. */
export const hasLogin = (role: Role) => Boolean(login(role));

/**
 * The API as the role, from its saved session: for setup and same-run cleanup only. Every check of
 * what Octavia sees goes through the page. Writes need the site's Origin (the API's cross-site
 * check), so the context sends it.
 */
export async function apiAs(role: Role): Promise<APIRequestContext> {
  const base = role === 'client' ? portalUrl : appUrl;
  const ctx = await request.newContext({
    baseURL: `${base}/api/v1/`,
    storageState: statePath(role),
    extraHTTPHeaders: { origin: base },
  });
  // The saved access token expires during a long run, and an API context does not refresh by
  // itself as the browser does: refresh now and save the new cookies for the next context.
  const res = await ctx.post(
    role === 'client' ? `portal/${firmSlug}/auth/refresh` : 'auth/refresh',
  );
  if (res.ok()) await ctx.storageState({ path: statePath(role) });
  return ctx;
}

/** The client portal's API paths are under portal/<slug>/. */
export const portalApi = (path: string) => `portal/${firmSlug}/${path.replace(/^\//, '')}`;

/** QA Fixture Client 1: its portal login is Octavia's. The harness only reads it, firm side. */
export const FIXTURE_CLIENT_1 = '00000000-0000-4a28-8001-000000000002';

/** The client the run's portal login belongs to, as the firm sees it. */
export type PortalClient = { id: string; name: string; number: string; email: string };

let portalClientOnce: Promise<PortalClient> | undefined;
/**
 * The harness's own portal client (lead, Nov 19): the one Test Firm B client whose email is the
 * run's client login (LIVE_CLIENT, on the SES simulator), found by the Owner's client search. Its
 * id and Client ID are looked up, never written in the specs. Never QA Fixture Client 1.
 */
export function portalClient(): Promise<PortalClient> {
  portalClientOnce ??= (async () => {
    const email = login('client')?.email;
    if (!email) throw new Error('no client login in this run');
    const owner = await apiAs('owner');
    try {
      const res = await owner.get(`business/clients?search=${encodeURIComponent(email)}`);
      expect(res.status(), 'client search').toBe(200);
      type Row = { id: string; displayName: string; clientNumber: string; email: string | null };
      const rows = ((await res.json()) as { items?: Row[] }).items ?? [];
      const mine = rows.filter((c) => c.email?.toLowerCase() === email.toLowerCase());
      expect(mine, 'exactly one Test Firm B client has the portal login email').toHaveLength(1);
      const c = mine[0]!;
      if (c.id === FIXTURE_CLIENT_1) throw new Error('the portal login must not be Client 1');
      return { id: c.id, name: c.displayName, number: c.clientNumber, email };
    } finally {
      await owner.dispose();
    }
  })();
  return portalClientOnce;
}

/**
 * A full-page screenshot under LIVE_SHOTS_DIR/<tab>/, named by row and width. Returns the path for
 * the report. Never take one of a sign-in or MFA screen.
 */
export async function shot(page: Page, tab: string, row: string, info: TestInfo): Promise<string> {
  const name = `${row.replace(/[^A-Za-z0-9_-]+/g, '-')}-${info.project.name}.png`;
  const path = join(shotsDir(tab), name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

/** The page does not scroll sideways (Octavia's 390 px and 1165 px checks). */
export async function expectNoSideScroll(page: Page) {
  const { overflow, widest } = await page.evaluate(() => {
    const doc = document.documentElement;
    const width = doc.clientWidth;
    // The deepest elements that reach past the right edge name what to fix (text only, trimmed);
    // one inside a box that scrolls or clips sideways (a tab strip) does not widen the page.
    const clipped = (el: HTMLElement) => {
      for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
        if (/auto|scroll|hidden|clip/.test(getComputedStyle(p).overflowX)) return true;
      }
      return false;
    };
    const out = [...document.querySelectorAll<HTMLElement>('body *')]
      .filter((el) => el.getBoundingClientRect().right > width + 1 && !clipped(el))
      .filter((el) => ![...el.children].some((c) => c.getBoundingClientRect().right > width + 1))
      .slice(0, 3)
      .map((el) => {
        const id = el.getAttribute('data-testid');
        const text = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 40);
        return `${el.tagName.toLowerCase()}${id ? `[${id}]` : ''} right ${Math.round(el.getBoundingClientRect().right)} "${text}"`;
      });
    return { overflow: doc.scrollWidth - width, widest: out.join('; ') };
  });
  expect(overflow, `page scrolls sideways (${widest || 'no single element'})`).toBeLessThanOrEqual(
    1,
  );
}

/** Waits until the workspace or portal shell has loaded and no spinner or error toast remains. */
export async function settled(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

/** True when the width under test is the narrow (phone) one. */
export const narrow = (info: TestInfo) => info.project.name === 'w390';
