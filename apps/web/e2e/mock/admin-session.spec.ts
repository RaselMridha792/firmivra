import { expect, test } from '@playwright/test';

// The Super Admin console in mock mode (playwright.mock.config.ts): adminAuth is the mock in
// mocks/admin-auth.ts (lib/auth.ts), signed in as the invented Super Admin Morgan Admin.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the mock Super Admin opens the console, moves around and signs out', async ({ page }) => {
  await page.goto(admin('/'));
  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toBeVisible();

  await nav.getByRole('link', { name: 'Firms', exact: true }).click();
  await expect(page).toHaveURL(admin('/firms'));

  await page.getByRole('button', { name: /Super Admin/ }).click();
  await expect(page.getByTestId('me-email')).toHaveText('morgan.admin@example.test');
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(admin('/sign-in'));
});
