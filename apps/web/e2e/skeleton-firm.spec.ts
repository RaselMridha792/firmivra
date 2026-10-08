import { expect, type Page, test } from '@playwright/test';

// Every firm workspace page from docs/junior/PAGE-MAP.md opens in its layout with its title.
// The title is the tab title from the page.tsx metadata (in the server HTML), not a heading.
// These tests open many pages; in `next dev` each compiles on its first visit.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
const id = '00000000-0000-4000-8000-000000000001';

const publicPages: [path: string, title: string][] = [
  ['/forgot-password', 'Forgot password'],
  ['/reset-password', 'Reset password'],
  ['/activate', 'Activate your account'],
  ['/welcome', 'Welcome'],
  ['/apply', 'Apply'],
  ['/apply/done', 'Application sent'],
];

const workspacePages: [path: string, title: string][] = [
  ['/', 'Dashboard'],
  ['/clients', 'Clients'],
  [`/clients/${id}`, 'Client overview'],
  [`/clients/${id}/documents`, 'Client documents'],
  [`/clients/${id}/messages`, 'Client messages'],
  [`/clients/${id}/invoices`, 'Client invoices'],
  ['/sign-ups', 'Sign-ups'],
  ['/messages', 'Messages'],
  ['/invoices', 'Invoices'],
  ['/workspaces', 'Workspaces'],
  [`/workspaces/${id}`, 'Workspace'],
  ['/leads', 'Leads'],
  [`/leads/${id}`, 'Lead'],
  ['/calendar', 'Calendar'],
  ['/team', 'Team'],
  ['/audit-log', 'Audit log'],
  ['/settings/profile', 'Firm profile'],
  ['/settings/branding', 'Branding'],
  ['/settings/portal', 'Client portal settings'],
  ['/settings/legal', 'Terms & Privacy'],
  ['/settings/availability', 'Availability'],
  ['/settings/tax-statuses', 'Tax statuses'],
];

async function signIn(page: Page, email: string) {
  await page.goto(app('/sign-in'));
  await page.getByRole('button', { name: new RegExp(email.replace('.', '\\.')) }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

const menu = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });

test('the public firm pages open without signing in', async ({ page }) => {
  for (const [path, title] of publicPages) {
    await page.goto(app(path));
    await expect(page).toHaveURL(app(path));
    await expect(page).toHaveTitle(title);
  }
});

test('every workspace page opens in the shell for the owner', async ({ page }) => {
  await signIn(page, 'owner@lvp.test');
  for (const [path, title] of workspacePages) {
    await page.goto(app(path));
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await expect(page).toHaveURL(app(path));
    await expect(page).toHaveTitle(title);
  }
  await page.goto(app('/settings'));
  await expect(page).toHaveURL(app('/settings/profile'));
  // Setup has its own layout: Sign out, no sidebar.
  await page.goto(app('/setup'));
  await expect(page.getByRole('button', { name: 'Sign out' })).toBeVisible();
  await expect(page).toHaveTitle('Set up your firm');
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
});

test('/settings opens Profile: a relative 307 to a fixed path, query dropped', async ({
  request,
}) => {
  for (const path of ['/settings', '/settings?next=//evil.example.test']) {
    // Node can't resolve *.localhost (the browser can), so send the app host as a header.
    const res = await request.get(`http://localhost:${port}${path}`, {
      headers: { host: `app.localhost:${port}` },
      maxRedirects: 0,
    });
    expect(res.status(), path).toBe(307);
    expect(res.headers()['location'], path).toBe('/settings/profile');
  }
});

const managerItems = ['Sign-ups', 'Team', 'Audit log', 'Settings'];

test('Sign-ups, Team, Audit log and Settings show for the owner, not for staff', async ({
  page,
}) => {
  await signIn(page, 'owner@lvp.test');
  for (const label of managerItems) await expect(menu(page, label)).toBeVisible();

  await page.getByRole('button', { name: /Owner/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(app('/sign-in'));

  await signIn(page, 'staff@lvp.test');
  await expect(menu(page, 'Clients')).toBeVisible();
  for (const label of managerItems) await expect(menu(page, label)).toHaveCount(0);
});

test('a firm that cannot be opened shows why, with Sign out (no dead end)', async ({ page }) => {
  // invited@lvp.test only has an INVITED membership, so GET /business refuses them.
  await page.goto(app('/sign-in'));
  // Sign in from the page, like the quick sign-in buttons (local dev token).
  const status = await page.evaluate(async () => {
    const r = await fetch('/api/v1/dev/token', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'invited@lvp.test', pool: 'STAFF' }),
    });
    return r.status;
  });
  expect(status).toBe(200);
  await page.goto(app('/'));
  await expect(page.getByTestId('firm-error')).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(app('/sign-in'));
});
