import { expect, test, type Page } from '@playwright/test';

// Appointment details in mock mode, as an owner. Next week: Tuesday 2 PM is Jamie Sample with
// Mock User; Wednesday's appointment with Jamie was cancelled ("Client asked").
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openNextWeek(page: Page) {
  await page.goto(app('/calendar'));
  await page.getByRole('button', { name: 'Next week' }).click();
  await expect(page.getByTestId('appointment')).toHaveCount(5);
}

test('an appointment opens with its client, place, status and history', async ({ page }) => {
  await openNextWeek(page);
  await page
    .getByTestId('calendar-day')
    .nth(1)
    .getByRole('button', { name: /Jamie Sample/ })
    .click();
  const detail = page.getByTestId('appointment-detail');
  await expect(detail).toContainText('Mock User');
  await expect(detail).toContainText('Tax consultation');
  await expect(detail).toContainText('Video');
  await expect(detail.getByRole('link', { name: /meet\.example\.test/ })).toBeVisible();
  await expect(detail).toContainText('Scheduled');
  await expect(detail.getByRole('region', { name: 'History' })).toContainText('Booked by');
});

test('a cancelled appointment shows its reason', async ({ page }) => {
  await openNextWeek(page);
  await page
    .getByTestId('calendar-day')
    .nth(2)
    .getByRole('button', { name: /Jamie Sample/ })
    .click();
  const detail = page.getByTestId('appointment-detail');
  await expect(detail).toContainText('Cancelled');
  await expect(detail).toContainText('Client asked');
});
