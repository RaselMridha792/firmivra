import { expect, test } from '@playwright/test';

// Appointment detail (/calendar/[id]), in mock mode (playwright.mock.config.ts), signed in as the
// Owner. The scheduling mock's third appointment is Bruno Sandoval's, Pending. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const BRUNO = '0199c0b0-0a10-7000-8000-000000000003';

test('shows the appointment and confirms it, adds a note and sends a reminder', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/${BRUNO}`);
  await expect(page).toHaveTitle('Appointment details');
  const summary = page.getByTestId('detail-summary');
  await expect(summary).toContainText('Bruno Sandoval', { timeout: 60_000 });
  await expect(summary).toContainText('Pending');
  await expect(page.getByTestId('detail-history')).toContainText('Booked');

  await page.getByRole('button', { name: 'Confirm' }).click();
  await expect(page.getByTestId('detail-result')).toHaveText('The appointment is confirmed.');
  await expect(summary).toContainText('Confirmed');

  await page.getByLabel('Add a note (internal)').fill('Bring last year’s return.');
  await page.getByRole('button', { name: 'Add Note' }).click();
  await expect(page.getByTestId('detail-result')).toHaveText('Note added.');

  await page.getByRole('button', { name: 'Send Reminder' }).click();
  await expect(page.getByTestId('detail-result')).toContainText('reminder');
  await expect(page.getByRole('link', { name: 'Edit' })).toHaveAttribute(
    'href',
    `/calendar/${BRUNO}/edit`,
  );
});

test('keeps its frames when the appointment is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/calendar/0199c0b0-0a10-7000-8000-000000000999`);
  await expect(page.getByTestId('detail-summary')).toContainText('was not found', {
    timeout: 60_000,
  });
  await expect(page.getByTestId('detail-related')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Mark Completed' })).toBeDisabled();
});
