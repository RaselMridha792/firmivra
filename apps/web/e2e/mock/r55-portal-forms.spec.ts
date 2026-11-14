import { expect, test } from '@playwright/test';

// R55, Intake Forms Review Two INTAKE-ACCESS-02 part B: a form the firm published in the client
// portal is listed beside the standard ones; Start opens the client's own form of it, and the card
// then says Continue. In mock mode (mocks/intake.ts) as the primary login. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('a form published in the portal starts from the list, then continues', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/intake'));
  const card = page.getByTestId('portal-form');
  await expect(card).toContainText('Quarterly Check-In');
  await card.getByRole('button', { name: 'Start Quarterly Check-In' }).click();
  await expect(page).toHaveURL(/\/lvp\/intake\/[0-9a-f-]{36}$/);
  await expect(page.getByRole('heading', { name: 'Quarterly Tax Intake Form' })).toBeVisible();

  // Back by the page's own link (a reload would reset the mock's state).
  await page.getByRole('link', { name: 'All intake forms' }).click();
  await expect(
    page.getByTestId('portal-form').getByRole('link', { name: 'Continue Quarterly Check-In' }),
  ).toBeVisible();
});
