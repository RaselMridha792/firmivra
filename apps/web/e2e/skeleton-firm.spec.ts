import { expect, type Page, test } from '@playwright/test';

// Every firm workspace page from docs/junior/PAGE-MAP.md opens in its layout with its title.
// These tests open many pages; in `next dev` each compiles on its first visit.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const app = (path: string) => `http://app.localhost:${port}${path}`;
const id = '00000000-0000-4000-8000-000000000001';

const publicPages: [path: string, title: string][] = [
  ['/forgot-password', 'Forgot your password?'],
  ['/reset-password', 'Reset your password'],
  ['/activate', 'Activate your account'],
  ['/welcome', 'Welcome'],
  ['/apply', 'Apply'],
  ['/apply/done', 'Application sent'],
];

const workspacePages: [path: string, title: string][] = [
  ['/', 'Welcome back,'],
  ['/clients', 'Clients'],
  [`/clients/${id}`, 'Unavailable client'],
  [`/clients/${id}/documents`, 'Documents'],
  [`/clients/${id}/messages`, 'Messages & notes'],
  [`/clients/${id}/invoices`, 'Invoices'],
  ['/sign-ups', 'Pending sign-ups'],
  ['/messages', 'Messages & notes'],
  ['/invoices', 'Invoices'],
  ['/workspaces', 'Service workspaces'],
  [`/workspaces/${id}`, 'Service workspace'],
  ['/leads', 'Leads inbox'],
  [`/leads/${id}`, 'Lead review'],
  ['/calendar', 'Calendar'],
  ['/team', 'Team'],
  ['/settings/profile', 'Firm profile'],
  ['/settings/branding', 'Branding'],
  ['/settings/portal', 'Client portal settings'],
  ['/settings/legal', 'Terms & Privacy'],
  ['/settings/availability', 'Availability'],
  ['/settings/tax-statuses', 'Tax statuses'],
];

async function signIn(page: Page, email: string) {
  await page.goto(app('/sign-in?dev=1'));
  await page.getByRole('button', { name: new RegExp(email.replace('.', '\\.')) }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
}

const menu = (page: Page, label: string) =>
  page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: label, exact: true });

test('the public firm pages open without signing in', async ({ page }) => {
  for (const [path, title] of publicPages) {
    await page.goto(app(path));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
});

test('every workspace page opens in the shell for the owner', async ({ page }) => {
  await signIn(page, 'owner@lvp.test');
  for (const [path, title] of workspacePages) {
    await page.goto(app(path));
    if (title === 'Unavailable client')
      await expect(page.getByTestId('page-not-found')).toBeVisible();
    else
      await expect(
        page.getByRole('heading', { name: title, exact: title !== 'Welcome back,' }),
      ).toBeVisible();
  }
  await page.goto(app('/settings'));
  await expect(page.getByRole('heading', { name: 'Workspace settings' })).toBeVisible();
  await page.goto(app('/setup'));
  await expect(page.getByTestId('page-title')).toHaveText('Set up your firm');
});

test('Sign-ups, Team and Settings show for the owner, not for staff', async ({ page }) => {
  await signIn(page, 'owner@lvp.test');
  for (const label of ['Pending sign-ups', 'Team', 'Settings'])
    await expect(menu(page, label)).toBeVisible();

  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page).toHaveURL(app('/sign-in'));

  await signIn(page, 'staff@lvp.test');
  await expect(menu(page, 'Clients')).toBeVisible();
  for (const label of ['Pending sign-ups', 'Team', 'Settings'])
    await expect(menu(page, label)).toHaveCount(0);
});

test('a firm that cannot be opened shows why, with Sign out (no dead end)', async ({ page }) => {
  // invited@lvp.test only has an INVITED membership, so GET /business refuses them.
  await page.goto(app('/sign-in?dev=1'));
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
  await expect(page.getByTestId('page-title')).toHaveCount(0);
  await page.getByRole('button', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(app('/sign-in'));
});
