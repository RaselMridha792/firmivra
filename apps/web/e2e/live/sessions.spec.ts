import { expect, test, type Browser, type Page } from '@playwright/test';
import { serverSkew, totpAt, totpStep } from './env';
import { apiAs, app } from './helpers';

/**
 * Staff SM12 (#1636): a member's saved Max Concurrent Sessions is enforced, so a new sign-in past
 * the limit ends that member's oldest session (401 SESSION_REVOKED). Checked on a harness Staff
 * login no lane uses (LIVE_SM12_EMAIL, LIVE_SM12_PASSWORD, LIVE_SM12_TOTP; made like the other
 * harness logins); skipped until it exists. The Owner sets that member's limit to 1 for the test
 * and puts its old value back. Test Firm B only; never Octavia's qa-* logins.
 */
const email = process.env['LIVE_SM12_EMAIL'];
const password = process.env['LIVE_SM12_PASSWORD'];
const secret = process.env['LIVE_SM12_TOTP'];

let lastStep = 0;
/** A code for a step this login has not used yet (Cognito takes each code once). */
async function freshCode(): Promise<string> {
  const skew = await serverSkew();
  let step = totpStep(Date.now() + skew);
  while (step <= lastStep || 30_000 - ((Date.now() + skew) % 30_000) < 5_000) {
    await new Promise((r) => setTimeout(r, 2_000));
    step = totpStep(Date.now() + skew);
  }
  lastStep = step;
  return totpAt(secret!, step);
}

/** Signs the SM12 login in through the real sign-in screen, in its own browser context. */
async function signInFresh(browser: Browser): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto(app('/sign-in'));
  await page.getByLabel('Email Address').fill(email!);
  await page.getByLabel('Password', { exact: true }).fill(password!);
  await page.getByRole('button', { name: /^Sign In/ }).click();
  const code = page.getByLabel('6-digit code');
  await code.waitFor({ timeout: 30_000 });
  await code.fill(await freshCode());
  await page.getByRole('button', { name: /^Verify/ }).click();
  await page.waitForURL((u) => !u.pathname.endsWith('/sign-in'), { timeout: 30_000 });
  return page;
}

/**
 * The session's own answer to a firm route (GET /business), from inside that browser. Sessions are
 * per firm: the tenant guard checks them on firm routes only, so GET /me (no firm) never would.
 * A session's first firm request starts its row, and a start over the limit ends the oldest.
 */
const meStatus = (page: Page) =>
  page.evaluate(async () => {
    const r = await fetch('/api/v1/business', { credentials: 'include' });
    const body = (await r.json().catch(() => ({}))) as { error?: { code?: string } };
    return { status: r.status, code: body.error?.code ?? null };
  });

test.describe('SM12 Max Concurrent Sessions', () => {
  test.skip(!email || !password || !secret, 'no SM12 harness login in this run (LIVE_SM12_*)');
  test.describe.configure({ timeout: 240_000 });

  test('SM12 a second sign-in on a limit-1 member ends the first session', async ({ browser }) => {
    // The member's id in Test Firm B, and its limit, which is put back after the test.
    const owner = await apiAs('owner');
    const team =
      (
        (await (await owner.get('business/team')).json()) as {
          items?: { id: string; user?: { email?: string } }[];
        }
      ).items ?? [];
    const member = team.find((t) => t.user?.email?.toLowerCase() === email!.toLowerCase());
    expect(member, 'the SM12 harness login is a member of Test Firm B').toBeTruthy();
    const security = `business/staff/${member!.id}/security`;
    const before = ((await (await owner.get(security)).json()) as { maxConcurrentSessions: number })
      .maxConcurrentSessions;
    const set = await owner.put(security, { data: { maxConcurrentSessions: 1 } });
    expect(set.status(), await set.text()).toBe(200);
    try {
      const first = await signInFresh(browser);
      expect(await meStatus(first)).toMatchObject({ status: 200 });
      const second = await signInFresh(browser);
      expect(await meStatus(second)).toMatchObject({ status: 200 });
      // The first session was the oldest: the limit of 1 ended it.
      await expect
        .poll(() => meStatus(first), { timeout: 20_000 })
        .toMatchObject({ status: 401, code: 'SESSION_REVOKED' });
      await first.reload();
      await expect(first).toHaveURL(/\/sign-in/);
      expect(await meStatus(second)).toMatchObject({ status: 200 });
      await first.context().close();
      await second.context().close();
    } finally {
      await owner.put(security, { data: { maxConcurrentSessions: before } });
      await owner.dispose();
    }
  });
});
