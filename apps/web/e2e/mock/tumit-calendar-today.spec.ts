import { expect, test } from '@playwright/test';

// Appointments > Today (/calendar/today), in mock mode (playwright.mock.config.ts), signed in as
// the Owner. The scheduling mock puts appointments around today. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test("shows today's schedule and sends reminders after asking", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/today`);
  await expect(page).toHaveTitle('Appointments: Today');
  await expect(page.getByRole('link', { name: 'Today', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(page.getByTestId('today-schedule')).toContainText('8:00 AM', { timeout: 60_000 });
  await expect(page.getByTestId('todays-appointments')).toBeVisible();

  await page.getByRole('button', { name: 'Send Appointment Reminders' }).click();
  await page
    .getByRole('dialog', { name: 'Send Appointment Reminders' })
    .getByRole('button', { name: 'Send Reminders' })
    .click();
  await expect(page.getByTestId('reminders-result')).toContainText('sent');
  await expect(page.getByRole('link', { name: 'Manage Appointment Types' })).toHaveAttribute(
    'href',
    '/calendar/types',
  );
});
