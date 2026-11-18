import { expect, test } from '@playwright/test';

// Audit Log Review 2 in mock mode, as an owner. The mock firm is in America/New_York; the browser
// is set to another zone, so a time shown in the browser's zone would fail. The mock's entries are
// 37 minutes apart, the newest 37 minutes before now.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.use({ timezoneId: 'Asia/Dhaka' });

/** 01:00 on Nov 16 in New York: the newest entry is Nov 16 there, the other five Nov 15. */
const NOW = new Date('2026-11-16T06:00:00.000Z');

test('R01: times and the date filter are the firm’s, with its zone shown', async ({ page }) => {
  await page.clock.setFixedTime(NOW);
  await page.goto(app('/audit-log'));
  const rows = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
  await expect(rows).toHaveCount(6);
  // 05:23Z is 12:23 AM EST on Nov 16 (11:23 AM in the browser's own zone).
  await expect(rows.first().getByRole('cell').first()).toHaveText('Nov 16, 2026, 12:23 AM EST');
  await expect(rows.nth(1).getByRole('cell').first()).toHaveText('Nov 15, 2026, 11:46 PM EST');
  await expect(page.getByText('(America/New_York)')).toBeVisible();

  // A day is the firm's day: Nov 16 holds only the newest entry, Nov 15 the other five.
  const apply = page.getByRole('button', { name: 'Apply filters' });
  await page.getByLabel('From', { exact: true }).fill('2026-11-16');
  await page.getByLabel('To', { exact: true }).fill('2026-11-16');
  await apply.click();
  await expect(rows).toHaveCount(1);
  await page.getByLabel('From', { exact: true }).fill('2026-11-15');
  await page.getByLabel('To', { exact: true }).fill('2026-11-15');
  await apply.click();
  await expect(rows).toHaveCount(5);
});

test('R03c: Details reads each change as old → new, null and empty text apart', async ({
  page,
}) => {
  await page.goto(app('/audit-log'));
  const first = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr').first();
  await first.getByText('Details', { exact: true }).click();
  const details = first.getByTestId('audit-details');
  await expect(details).toContainText('location:(none) → (empty)');
  await expect(details).toContainText('reminderSent:true → false');
  await expect(details).toContainText('bufferMinutes:0 → 15');
});
