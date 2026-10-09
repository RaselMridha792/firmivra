import { expect, test, type Page } from '@playwright/test';

// Appointment details, reschedule and cancel in mock mode, as an owner. Next week: Tuesday 2 PM
// is Jamie Sample with Mock User; Monday 10 AM Jamie is with Sam Staff, so that time is taken;
// Wednesday's appointment with Jamie was cancelled ("Client asked").
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

test("the client's taken time is not offered, and the appointment moves to a free one", async ({
  page,
}) => {
  await openNextWeek(page);
  const tuesday = page.getByTestId('calendar-day').nth(1);
  await tuesday.getByRole('button', { name: /Jamie Sample/ }).click();
  const detail = page.getByTestId('appointment-detail');
  await expect(detail).toContainText('Mock User');
  await expect(detail).toContainText('Video');
  await expect(detail.getByRole('link', { name: /meet\.example\.test/ })).toBeVisible();
  await expect(detail).toContainText('Scheduled');

  await detail.getByRole('button', { name: 'Reschedule' }).click();
  const date = detail.getByLabel('Date');
  const day = await date.inputValue();
  const monday = new Date(Date.parse(`${day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  await date.fill(monday);
  // The client already has 10:00 AM on Monday, so the slots leave it out (as the API, #214).
  await expect(detail.getByRole('button', { name: '11:00 AM' })).toBeVisible();
  await expect(detail.getByRole('button', { name: '10:00 AM' })).toHaveCount(0);
  await detail.getByRole('button', { name: '11:00 AM' }).click();
  await detail.getByRole('button', { name: 'Move to 11:00 AM' }).click();
  await expect(detail.getByText('Appointment moved.')).toBeVisible();
  await expect(detail).toContainText('11:00 AM');
  await expect(detail).toContainText('Moved by');
});

test('an appointment is cancelled with a reason', async ({ page }) => {
  await openNextWeek(page);
  const friday = page.getByTestId('calendar-day').nth(4);
  await friday.getByRole('button', { name: /Riley Example/ }).click();
  const detail = page.getByTestId('appointment-detail');
  await detail.getByRole('button', { name: 'Cancel…' }).click();
  await detail.getByLabel('Reason (optional)').fill('The client is travelling.');
  await detail.getByRole('button', { name: 'Cancel appointment' }).click();
  await expect(detail.getByText('Appointment cancelled.')).toBeVisible();
  await expect(detail).toContainText('Cancelled');
  await expect(detail).toContainText('The client is travelling.');
  await expect(detail.getByRole('button', { name: 'Reschedule' })).toHaveCount(0);
});
