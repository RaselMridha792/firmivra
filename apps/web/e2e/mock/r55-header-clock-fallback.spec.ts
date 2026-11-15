import { expect, test } from '@playwright/test';

// R55, Dashboard Review 2 (U2): the header clock shows the firm's time zone. When that can't be
// read, it shows the device's and says so ("Using your device's time zone"); once the firm's zone
// loads, the note goes. In mock mode a call named in sessionStorage `fv-mock-fail` answers 500
// (lib/mock.ts `failable`). Mock mode as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const home = `http://app.localhost:${port}/`;

test('the firm’s time zone: no note when it loads', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(home);
  await expect(page.getByTestId('header-clock')).toBeVisible({ timeout: 60_000 });
  await expect(page.getByTestId('header-clock-note')).toHaveCount(0);
});

test('the firm’s time zone fails: the clock says it uses the device’s, until it loads', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => window.sessionStorage.setItem('fv-mock-fail', 'availability.get'));
  await page.goto(home);
  const note = page.getByTestId('header-clock-note');
  await expect(note).toHaveText("Using your device's time zone", { timeout: 60_000 });
  await expect(page.getByTestId('header-clock')).toHaveAttribute(
    'title',
    /^Using your device's time zone \(.+\): your firm's time zone could not be loaded$/,
  );

  // The call works again: Try again reloads the firm's zone, and the note goes.
  await page.evaluate(() => window.sessionStorage.removeItem('fv-mock-fail'));
  await page
    .getByRole('alert')
    .filter({ hasText: "We couldn't load messages" })
    .getByRole('button', { name: 'Try again' })
    .click();
  await expect(note).toHaveCount(0);
  await expect(page.getByTestId('header-clock')).toBeVisible();
});
