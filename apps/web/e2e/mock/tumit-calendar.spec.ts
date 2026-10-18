import { expect, test } from '@playwright/test';

// Appointments > Calendar (/calendar), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The scheduling mock books its appointments in the current week. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('shows the week, Upcoming Appointments and the right column', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/calendar'));
  await expect(page).toHaveTitle('Appointments');
  await expect(page.getByTestId('page-title')).toHaveText('Appointments');
  await expect(page.getByRole('link', { name: 'Calendar', exact: true })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const calendar = page.getByTestId('appointments-calendar');
  await expect(calendar.getByRole('button', { name: /Consultation/ }).first()).toBeVisible({
    timeout: 60_000,
  });
  await expect(page.getByTestId('upcoming-appointments').getByRole('row').nth(1)).toBeVisible();
  await expect(page.getByTestId('appointments-mini')).toContainText("Today's Appointments");
  await expect(page.getByTestId('appointment-quick-actions')).toBeVisible();

  // Week by week, then a month, then a month to jump to.
  const period = page.getByTestId('calendar-period');
  const shown = await period.innerText();
  await page.getByRole('button', { name: 'Next week' }).click();
  await page.getByRole('button', { name: 'Previous week' }).click();
  await expect(period).toHaveText(shown);
  const toolbar = page.getByTestId('appointments-toolbar');
  await toolbar.getByLabel('Show').selectOption('month');
  await expect(calendar.getByRole('grid')).toBeVisible();
  await toolbar.getByLabel('Go to month').selectOption({ index: 1 });
  await expect(period).toHaveText(/^January \d{4}$/);
  await toolbar.getByLabel('Show').selectOption('week');

  // A card opens the appointment.
  await page.goto(app('/calendar'));
  await calendar
    .getByRole('button', { name: /Consultation/ })
    .first()
    .click();
  await expect(page).toHaveURL(/\/calendar\/[0-9a-f-]{36}$/);
});

test('a day from the small month shows its week; an empty hour books that time', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/calendar?date=2026-09-21'));
  await expect(page.getByTestId('calendar-period')).toHaveText('September 2026', {
    timeout: 60_000,
  });
  await page
    .getByTestId('appointments-calendar')
    .getByRole('button', { name: 'Sunday, September 20, 2026, 8:00 AM' })
    .click();
  await expect(page).toHaveURL(/\/calendar\/new\?date=2026-09-20&time=08:00$/);
});
