import { expect, test } from '@playwright/test';

// The client portal in mock mode (playwright.mock.config.ts): portalAuth(slug) is one mock per
// firm (lib/auth.ts), signed in as an active client unless NEXT_PUBLIC_API_MOCK_CLIENT says
// otherwise, and the sign-in check reads GET /portal/{slug}/me from it.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('a signed-in client opens their portal, moves around and signs out', async ({ page }) => {
  await page.goto(portal('/lvp/home'));
  await expect(page.getByTestId('firm-name')).toHaveText('LVP Accounting & Taxes');
  await expect(page.getByText('Welcome Back, John!')).toBeVisible();

  // Moving inside the portal keeps the same mock session (no new sign-in).
  await page
    .getByRole('navigation', { name: 'Main' })
    .getByRole('link', { name: 'My Profile' })
    .click();
  await expect(page).toHaveURL(portal('/lvp/profile'));
  await expect(page.getByTestId('firm-name')).toBeVisible();

  await page.getByRole('button', { name: /Client/ }).click();
  await page.getByRole('menuitem', { name: 'Sign out' }).click();
  await expect(page).toHaveURL(portal('/lvp/sign-in'));
});
