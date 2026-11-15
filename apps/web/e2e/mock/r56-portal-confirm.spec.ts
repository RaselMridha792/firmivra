import { expect, test } from '@playwright/test';

// Appointments Review 2, row 8 (client confirmation), in mock mode (playwright.mock.config.ts,
// signed in as the portal's active client). An upcoming appointment the firm booked asks the
// client to confirm it; one the client booked never asks (mocks/appointments.ts).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test('an appointment the firm booked asks the client to confirm it, once', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(portal('/lvp/appointments'));
  const prompts = page.getByTestId('my-appointment-confirm');
  await expect(prompts.first()).toBeVisible({ timeout: 60_000 });
  const before = await prompts.count();
  await expect(prompts.first()).toContainText('We booked this for you. Please confirm it.');
  // Every row with a prompt is one the firm booked; the client's own booking has none.
  expect(before).toBeLessThan(await page.getByTestId('my-appointment').count());
  await page.screenshot({ path: testInfo.outputPath('confirm-prompt.png'), fullPage: true });

  await prompts.first().getByRole('button', { name: 'Confirm Appointment' }).click();
  await expect(page.getByText('Your appointment is confirmed.')).toBeVisible();
  await expect(prompts).toHaveCount(before - 1);

  await page.setViewportSize({ width: 375, height: 900 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBeTruthy();
});
