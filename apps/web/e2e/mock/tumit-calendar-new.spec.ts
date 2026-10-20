import { expect, test } from '@playwright/test';

// Schedule Appointment (/calendar/new), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The scheduling mock blocks 2 PM for every staff member. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('checks the form, shows the staff day and schedules an appointment', async ({ page }) => {
  // The mock's bookings are at a fixed -04:00 offset: "tomorrow" stays in daylight time.
  await page.clock.setFixedTime(new Date('2026-10-14T12:00:00-04:00'));
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/calendar/new`);
  await expect(page).toHaveTitle('Schedule appointment');
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });

  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page.getByText('Choose a client or lead, or add a new contact.')).toBeVisible();
  await expect(page.getByText('Choose an appointment type.')).toBeVisible();

  await page.getByLabel('Client / Lead *').fill('Nina');
  await page
    .getByTestId('contact-results')
    .getByRole('button', { name: /Nina Fairbanks/ })
    .click();
  await expect(
    page.getByTestId('client-information').getByLabel('Email', { exact: true }),
  ).toHaveValue('nina@example.test');
  await page.getByLabel('Appointment Type *').selectOption({ label: 'Follow-Up' });
  await expect(page.getByTestId('appointment-summary')).toContainText('30 min');

  // Tomorrow at 8 AM is free.
  const tomorrow = '2026-10-15';
  await page.getByLabel('Date *').fill(tomorrow);
  await page.getByLabel('Start Time *').selectOption('08:00');
  await page.getByLabel('End Time *').selectOption('08:30');
  await expect(page.getByTestId('staff-day')).toContainText('Selected Time');
  await expect(page.getByTestId('no-conflicts')).toBeVisible();

  await page.getByRole('button', { name: 'Schedule Appointment' }).click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/, { timeout: 30_000 });
});

test('saves a draft without booking', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/calendar/new`);
  await expect(page.getByLabel('Client / Lead *')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Save as Draft' }).click();
  await expect(page.getByTestId('schedule-note')).toContainText('Draft saved');
});

test('opens on the date and hour picked on the calendar', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.goto(`http://app.localhost:${port}/calendar/new?date=2026-10-15&time=09:00`);
  await expect(page.getByLabel('Date *')).toHaveValue('2026-10-15', { timeout: 60_000 });
  await expect(page.getByLabel('Start Time *')).toHaveValue('09:00');
  await expect(page.getByLabel('End Time *')).toHaveValue('10:00');
  const summary = page.getByTestId('appointment-summary');
  await expect(summary).toContainText('9:00 AM – 10:00 AM');
  await expect(summary).toContainText('1 hour');
  // The design's staff chip with its remove button.
  await expect(page.getByRole('button', { name: /^Remove / })).toBeVisible();
});
