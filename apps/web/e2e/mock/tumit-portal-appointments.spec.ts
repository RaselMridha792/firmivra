import { expect, test } from '@playwright/test';

// Portal appointments in mock mode, signed in as the client Jamie Sample. Next week Jamie has
// Monday 10 AM (with Sam Staff). The browser runs in the firm's time zone so the shown times
// match the mock's.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.use({ timezoneId: 'America/New_York' });

/** A day of next week (0 is Monday) in the firm's time zone, where the mock puts its week. */
function nextWeek(offset: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(
    new Date(),
  );
  const day = new Date(`${today}T00:00:00Z`);
  const ahead = ((8 - day.getUTCDay()) % 7 || 7) + offset;
  return new Date(day.getTime() + ahead * 86_400_000).toISOString().slice(0, 10);
}

test('a client books a free time after a taken one', async ({ page }) => {
  await page.goto(portal('/lvp/appointments'));
  await expect(page.getByTestId('page-title')).toHaveText('Appointments');
  // Book: a kind, a day, a free time. 10 AM is offered, but Jamie is already busy then.
  await page.getByRole('button', { name: /Tax consultation/ }).click();
  await page.getByLabel('Day').fill(nextWeek(0));
  await page.getByRole('button', { name: '10:00 AM' }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(
    page.getByText('Someone just booked that time. Please pick another one.'),
  ).toBeVisible();
  await page.getByRole('button', { name: '11:00 AM' }).click();
  await page.getByRole('button', { name: 'Confirm booking' }).click();
  await expect(page.getByText(/^Booked: Tax consultation/)).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
