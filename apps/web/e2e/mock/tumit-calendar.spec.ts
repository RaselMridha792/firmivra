import { expect, test } from '@playwright/test';

// The calendar in mock mode, as an owner. The appointments mock puts its five appointments in
// the week after today (Monday to Friday, firm time), so a Monday-start week is one click away.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('the week shows every appointment, by staff member and by day', async ({ page }) => {
  await page.goto(app('/calendar'));
  await expect(page.getByTestId('page-title')).toHaveText('Calendar');
  await expect(page.getByText('Times are in America/New_York.')).toBeVisible();
  const todayButton = page.getByRole('button', { name: 'Today' });
  await expect(todayButton).toBeDisabled();
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(todayButton).toBeEnabled();
  const appointments = page.getByTestId('appointment');
  await expect(appointments).toHaveCount(5);
  await expect(appointments.filter({ hasText: 'Jamie Sample' })).toHaveCount(3);
  await expect(appointments.filter({ hasText: '(cancelled)' })).toHaveCount(1);

  const monday = page.getByTestId('calendar-day').first();
  await expect(monday.getByTestId('appointment')).toHaveCount(2);
  await expect(monday).toContainText('Riley Example');

  await page.getByLabel('Staff').selectOption({ label: 'Sam Staff' });
  await expect(appointments).toHaveCount(3);
  await page.getByLabel('Staff').selectOption({ label: 'Everyone' });

  // A day's header opens the Day view, by the hour.
  await monday.getByRole('button').first().click();
  await expect(page.getByRole('button', { name: 'Day', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(appointments).toHaveCount(2);
  await expect(page.getByText('10 AM')).toBeVisible();

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
