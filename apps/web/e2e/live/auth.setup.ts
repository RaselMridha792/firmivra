import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, request, test as setup, type Page } from '@playwright/test';
import {
  app,
  appUrl,
  firmSlug,
  login,
  portal,
  portalRole,
  portalUrl,
  serverSkew,
  stateDir,
  statePath,
  totpAt,
  totpStep,
  type Role,
} from './env';

/**
 * Signs each role in once per run through the real sign-in screens, or keeps a session that is
 * still live (staff sessions end after 15 idle minutes). Cognito takes a TOTP code only once, so a
 * role never signs in twice in one 30-second step.
 */
const roles: Role[] = [
  'owner',
  'admin',
  'staff',
  'client',
  // Appointments P10: the other roles, each signed in only when the runner gives its login.
  'manager',
  'bookkeeper',
  'preparer',
  'support',
  'consultant',
  'readonly',
  'custom1',
  'custom2',
  'inbox',
];

async function stillSignedIn(role: Role): Promise<boolean> {
  const path = statePath(role);
  if (!existsSync(path)) return false;
  const base = portalRole(role) ? portalUrl : appUrl;
  const ctx = await request.newContext({ storageState: path, extraHTTPHeaders: { origin: base } });
  // A firm route, not GET /me: staff sessions are per firm and only firm routes check them, so a
  // session the firm ended (idle 15 minutes, SEC-4) still answers /me while its token lasts.
  const check = () =>
    portalRole(role)
      ? ctx.get(`${portalUrl}/api/v1/portal/${firmSlug}/me/tabs`)
      : ctx.get(`${appUrl}/api/v1/business`);
  try {
    if ((await check()).ok()) return true;
    // Only the access token may have expired: refresh the saved session rather than sign in again.
    // A new sign-in past a member's session limit ends the oldest session (SM12), which is the one
    // the other lanes are using (the Owner's limit is 1 and only another member may raise it).
    const refreshed = await ctx.post(
      portalRole(role)
        ? `${portalUrl}/api/v1/portal/${firmSlug}/auth/refresh`
        : `${appUrl}/api/v1/auth/refresh`,
    );
    if (!refreshed.ok() || !(await check()).ok()) return false;
    await ctx.storageState({ path });
    return true;
  } finally {
    await ctx.dispose();
  }
}

/** A fresh code, never one already spent by this role. */
async function nextCode(role: Role, secret: string): Promise<string> {
  const skew = await serverSkew();
  const spent = join(stateDir(), `${role}.step`);
  let step = totpStep(Date.now() + skew);
  const last = existsSync(spent) ? Number(readFileSync(spent, 'utf8')) : 0;
  if (step <= last) {
    const wait = (last + 1) * 30_000 - (Date.now() + skew) + 1_000;
    await new Promise((r) => setTimeout(r, wait));
    step = totpStep(Date.now() + skew);
  }
  // A code with under 5 s left can expire on the way: wait for the next one.
  const left = 30_000 - ((Date.now() + skew) % 30_000);
  if (left < 5_000) {
    await new Promise((r) => setTimeout(r, left + 500));
    step = totpStep(Date.now() + skew);
  }
  writeFileSync(spent, String(step));
  return totpAt(secret, step);
}

async function signIn(page: Page, role: Role) {
  const l = login(role)!;
  const staff = !portalRole(role);
  await page.goto(staff ? app('/sign-in') : portal('/sign-in'));
  await page.getByLabel('Email Address').fill(l.email);
  await page.getByLabel('Password', { exact: true }).fill(l.password);
  await page.getByRole('button', { name: /^Sign In/ }).click();
  const codeField = page.getByLabel(staff ? '6-digit code' : 'Authenticator code');
  const which = await Promise.race([
    page
      .waitForURL((u) => !u.pathname.endsWith('/sign-in'), { timeout: 30_000 })
      .then(() => 'in' as const)
      .catch(() => 'stuck' as const),
    codeField
      .waitFor({ timeout: 30_000 })
      .then(() => 'code' as const)
      .catch(() => 'stuck' as const),
  ]);
  if (which === 'stuck') throw new Error(`${role}: sign-in went neither in nor to the code step`);
  if (which === 'code') {
    if (!l.totp) throw new Error(`${role}: the login asks for an authenticator code and has none`);
    await codeField.fill(await nextCode(role, l.totp));
    await page.getByRole('button', { name: /^Verify/ }).click();
    await page.waitForURL((u) => !u.pathname.endsWith('/sign-in'), { timeout: 30_000 });
  }
  await expect(page.getByRole('heading', { name: /Set up your authenticator/i })).toHaveCount(0);
  await page.context().storageState({ path: statePath(role) });
}

for (const role of roles) {
  setup(`sign in: ${role}`, async ({ page }) => {
    setup.skip(!login(role), `no ${role} login in this run`);
    if (await stillSignedIn(role)) return;
    await signIn(page, role);
    expect(await stillSignedIn(role)).toBe(true);
  });
}
