import { expect, test } from '@playwright/test';

// Every Super Admin page from docs/junior/PAGE-MAP.md opens, inside the shell, with its title.
// These tests open many pages; in `next dev` each compiles on its first visit.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

const consolePages: [path: string, title: string][] = [
  ['/', 'Welcome back,'],
  ['/applications', 'Firm Applications'],
  ['/applications/00000000-0000-4000-8000-000000000001', 'Firm Applications'],
  ['/firms', 'Firms'],
];

test('signed-out visitors to the console are sent to sign in', async ({ page }) => {
  await page.goto(admin('/firms'));
  await expect(page).toHaveURL(admin('/sign-in'));
});

test('the public Super Admin pages open without signing in', async ({ page }) => {
  const publicPages: [path: string, title: string][] = [
    ['/forgot-password', 'Forgot your password?'],
    ['/reset-password', 'Reset your password'],
  ];
  for (const [path, title] of publicPages) {
    await page.goto(admin(path));
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  }
});

test('every console page opens in the shell for the Super Admin', async ({ page }) => {
  await page.goto(admin('/sign-in?dev=1'));
  await page.getByRole('button', { name: /superadmin@firmivra\.test/ }).click();
  await expect(
    page.getByRole('navigation', { name: 'Super Admin navigation', exact: true }),
  ).toBeVisible();

  for (const [path, title] of consolePages) {
    await page.goto(admin(path));
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
  }
  // The active menu item follows the page.
  await expect(page.getByRole('link', { name: 'Firms', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
