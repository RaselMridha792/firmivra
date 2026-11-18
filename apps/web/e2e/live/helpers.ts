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
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  expect(overflow, 'page scrolls sideways').toBeLessThanOrEqual(1);
}

/** Waits until the workspace or portal shell has loaded and no spinner or error toast remains. */
export async function settled(page: Page) {
  await page.waitForLoadState('networkidle').catch(() => {});
  await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
}

/** True when the width under test is the narrow (phone) one. */
export const narrow = (info: TestInfo) => info.project.name === 'w390';
