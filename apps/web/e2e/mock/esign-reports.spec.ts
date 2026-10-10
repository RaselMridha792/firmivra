import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

const total = (page: import('@playwright/test').Page, label: string) =>
  page
    .getByTestId('report-totals')
    .getByRole('term')
    .filter({ hasText: new RegExp(`^${label}$`) })
    .locator('xpath=following-sibling::dd');

test('totals and activity by sender, filtered by status and sender', async ({ page }) => {
  await page.goto(app('/firm-sign/reports'));
  await expect(page.getByTestId('page-title')).toHaveText('Signing reports');
  // The mock's requests were sent in early October 2026.
  await page.getByLabel('From', { exact: true }).fill('2026-09-01');
  await page.getByLabel('To', { exact: true }).fill('2026-10-31');
  const sent = total(page, 'Sent');
  await expect(sent).toHaveText(/^\d+$/);
  const all = Number(await sent.textContent());
  expect(all).toBeGreaterThan(0);
  const table = page.getByRole('table', { name: 'Activity by sender' });
  await expect(table.getByRole('row').nth(1)).toBeVisible();

  await page.getByLabel('Status').selectOption('COMPLETED');
  await expect(total(page, 'Outstanding')).toHaveText('0');
  await expect(total(page, 'Completion rate')).toHaveText(/^(100%|–)$/);

  await page.getByLabel('Status').selectOption('');
  const sender = page.getByLabel('Sent by');
  const first = await sender.locator('option').nth(1).getAttribute('value');
  await sender.selectOption(first!);
  await expect(table.getByRole('row')).toHaveCount(2);
});

test('an end date before the start is refused', async ({ page }) => {
  await page.goto(app('/firm-sign/reports'));
  await page.getByLabel('From', { exact: true }).fill('2026-10-05');
  await page.getByLabel('To', { exact: true }).fill('2026-10-01');
  await expect(page.getByText('The end date is before the start date')).toBeVisible();
  await expect(page.getByTestId('report')).toHaveCount(0);
});
