import { expect, test } from '@playwright/test';

// Octavia's I8 on the Send page: a send keeps only whether reminders are on, so its schedule shows
// the firm's times (Intake Form Settings) instead of fields the API never kept. Mock mode
// (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test("View Schedule shows the firm's reminder times and where to change them", async ({ page }) => {
  await page.goto(app('/intake-forms/send'));
  await expect(page.getByRole('heading', { level: 1, name: 'Send Intake Form' })).toBeVisible();
  await page.getByRole('button', { name: 'View Schedule' }).click();
  const dialog = page.getByRole('dialog', { name: 'Reminder Schedule' });
  const schedule = dialog.getByTestId('send-schedule');
  await expect(schedule).toContainText('First reminder3 days after sending');
  await expect(schedule).toContainText('Final reminder7 days after sending');
  await expect(schedule).toContainText('Expiration alert24 hours before it expires');
  await expect(dialog.getByRole('textbox')).toHaveCount(0);
  await expect(
    dialog.getByRole('link', { name: 'Change the times in Intake Form Settings' }),
  ).toHaveAttribute('href', '/intake-forms/settings');
  await dialog.getByRole('button', { name: 'Close' }).last().click();
  await expect(dialog).toBeHidden();
  // Off for this form: the schedule cannot be opened.
  await page.getByRole('switch', { name: 'Send reminders' }).click();
  await expect(page.getByRole('button', { name: 'View Schedule' })).toBeDisabled();
});
