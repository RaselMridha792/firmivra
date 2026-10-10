import { expect, test } from '@playwright/test';

// The firm's audit log in mock mode, as an owner. The mock has six synthetic entries from the
// last few hours; one is Firmivra Support's (no person, no IP).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('an owner reads, filters and pages the audit log', async ({ page }) => {
  await page.goto(app('/audit-log'));
  await expect(page.getByTestId('page-title')).toHaveText('Audit log');
  const rows = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
  await expect(rows).toHaveCount(6);

  const support = rows.filter({ hasText: 'Firmivra Support' });
  await expect(support).toContainText('client.viewed');
  await expect(support.getByRole('cell').nth(4)).toHaveText('—');
  await expect(rows.filter({ hasText: 'Jamie Sample (client)' })).toHaveCount(1);

  const first = rows.first();
  await first.getByText('Details', { exact: true }).click();
  await expect(first).toContainText('mock-request-1');

  // One end only, then more than 366 days: the contract's messages, and the rows stay.
  const apply = page.getByRole('button', { name: 'Apply filters' });
  await page.getByLabel('From', { exact: true }).fill('2026-01-01');
  await apply.click();
  await expect(page.getByText('Give both from and to, or neither')).toBeVisible();
  await page.getByLabel('To', { exact: true }).fill('2027-03-01');
  await apply.click();
  await expect(page.getByText('Use a range of at most 366 days')).toBeVisible();
  await expect(rows).toHaveCount(6);

  await page.getByLabel('From', { exact: true }).fill('');
  await page.getByLabel('To', { exact: true }).fill('');
  await page.getByLabel('Action').fill('appointment.');
  await apply.click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('appointment.rescheduled');
  await expect(page.getByRole('button', { name: 'Next', exact: true })).toBeDisabled();

  // The team mock's ids are not the audit mock's, so a person shows the empty state.
  await page.getByLabel('Action').fill('');
  await page.getByLabel('Person').selectOption({ label: 'Sam Staff' });
  await apply.click();
  await expect(page.getByText('Nothing matches these filters.')).toBeVisible();

  await page.getByRole('button', { name: 'Clear' }).click();
  await expect(rows).toHaveCount(6);

  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth))
    .toBeLessThanOrEqual(375);
});
