import { expect, test } from '@playwright/test';

// Every Super Admin page from docs/junior/PAGE-MAP.md opens, inside the shell, with its title.
// These tests open many pages; in `next dev` each compiles on its first visit.
test.describe.configure({ timeout: 240_000 });

const port = process.env['WEB_PORT'] ?? '3000';
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

const consolePages: [path: string, title: string][] = [
  ['/', 'Dashboard'],
  ['/applications', 'Firm Applications'],
  ['/applications/00000000-0000-4000-8000-000000000001', 'Firm application'],
  ['/firms', 'Firms'],
];

test('signed-out visitors to the console are sent to sign in', async ({ page }) => {
  await page.goto(admin('/firms'));
  await expect(page).toHaveURL(admin('/sign-in'));
});

test('the public Super Admin pages open without signing in', async ({ page }) => {
  const publicPages: [path: string, title: string][] = [
    ['/forgot-password', 'Forgot password'],
    ['/reset-password', 'Reset password'],
  ];
  for (const [path, title] of publicPages) {
    await page.goto(admin(path));
    await expect(page.getByTestId('page-title')).toHaveText(title);
  }
});

test('every console page opens in the shell for the Super Admin', async ({ page }) => {
  await page.goto(admin('/sign-in'));
  await page.getByRole('button', { name: /superadmin@firmivra\.test/ }).click();
  await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();

  for (const [path, title] of consolePages) {
    await page.goto(admin(path));
    await expect(page.getByTestId('page-title')).toHaveText(title);
  }
  // The active menu item follows the page.
  await expect(page.getByRole('link', { name: 'Firms', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
});
