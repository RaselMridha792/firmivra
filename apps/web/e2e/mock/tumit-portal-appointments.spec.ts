import { expect, test } from '@playwright/test';

// Portal appointments in mock mode, signed in as the client Jamie Sample. Next week Jamie has
// Monday 10 AM (with Sam Staff) and Tuesday 2 PM. The browser runs in the firm's time zone so
// the shown times match the mock's.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;

test.use({ timezoneId: 'America/New_York' });
// The mock puts its week after today and treats New York as a fixed UTC-4, while the screens
// use the real zone. Run on a summer Wednesday: EDT is UTC-4, and next week is past the cutoffs.
test.beforeEach(({ page }) => page.clock.setFixedTime(new Date('2026-07-08T12:00:00-04:00')));

/** A day of the mock's week ('YYYY-MM-DD'): 0 is next Monday, July 13. */
const nextWeek = (offset: number) =>
  new Date(Date.UTC(2026, 6, 13 + offset)).toISOString().slice(0, 10);

test('a client books after a taken time, then reschedules and cancels', async ({ page }) => {
  await page.goto(portal('/lvp/appointments'));
  await expect(page.getByTestId('page-title')).toHaveText('Appointments');
  const mine = page.getByTestId('my-appointment');
  await expect(mine).toHaveCount(2);

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
  await expect(mine).toHaveCount(3);

  // Reschedule Tuesday's appointment to 3 PM the same day.
  const tuesday = mine.filter({ hasText: 'Tue' });
  await tuesday.getByRole('button', { name: 'Reschedule' }).click();
  await expect(tuesday.getByRole('button', { name: '2:00 PM (current)' })).toBeDisabled();
  await tuesday.getByRole('button', { name: '3:00 PM' }).click();
  await tuesday.getByRole('button', { name: /^Move to/ }).click();
  await expect(page.getByText('Your appointment was moved.')).toBeVisible();
  await expect(mine.filter({ hasText: '3:00 PM' })).toHaveCount(1);

  // Cancel the new one.
  const booked = mine.filter({ hasText: '11:00 AM' });
  await booked.getByRole('button', { name: 'Cancel', exact: true }).click();
  await booked.getByLabel('Reason (optional)').fill('Plans changed.');
  await booked.getByRole('button', { name: 'Cancel this appointment' }).click();
  await expect(page.getByText('Your appointment was cancelled.')).toBeVisible();
  await expect(mine).toHaveCount(2);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
