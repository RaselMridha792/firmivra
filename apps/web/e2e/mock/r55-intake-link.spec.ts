import { expect, test } from '@playwright/test';

// R55, Intake Forms Review Two (ACCESS-01): a lead opens the form the firm emailed through its
// secure link (/{firm}/form#token=...), signed out. The token leaves the address once read; the
// form opens with the portal's own steps and saves. A made-up link says to ask for a new one. In
// mock mode (playwright.mock.config.ts; mocks/intake-link.ts). Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const TOKEN = 'mock-intake-link-token-'.padEnd(43, '0');

test('opens the emailed link signed out, clears the token from the address and saves', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal(`/lvp/form#token=${TOKEN}`));
  const screen = page.getByTestId('intake-link');
  await expect(screen).toContainText('Hi Pat');
  await expect(page).toHaveURL(/\/lvp\/form$/);
  await expect(screen.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(screen.getByTestId('intake-next')).toHaveText(/Continue/);
  // No way back into a portal the lead doesn't have.
  await expect(screen.getByRole('link', { name: 'All intake forms' })).toHaveCount(0);
  await screen.getByRole('button', { name: 'Save and Continue Later' }).click();
  await expect(
    screen.getByRole('status').filter({ hasText: 'Your answers are saved' }),
  ).toContainText('Open the link in your email again');
});

test('a made-up or incomplete link asks for a new one', async ({ page }) => {
  await page.goto(portal(`/lvp/form#token=${'x'.repeat(43)}`));
  await expect(page.getByTestId('intake-link-problem')).toContainText(
    'Ask your firm to send a new one',
  );
  // A new load: going to the same page with only another #fragment would not reload it.
  await page.goto('about:blank');
  await page.goto(portal('/lvp/form#token=short'));
  await expect(page.getByTestId('intake-link-problem')).toContainText('This link is not complete');
});
