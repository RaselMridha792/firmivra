import { expect, test } from '@playwright/test';

// Schedule Appointment (/calendar/new), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The scheduling mock blocks 2 PM for every staff member. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('checks the form, shows the staff day and schedules an appointment', async ({ page }) => {
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
  await expect(page.getByTestId('appointment-summary')).toContainText('30 minutes');

  // Tomorrow at 8 AM is free.
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
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
