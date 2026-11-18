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
  await expect(page.getByText('Without dates, the log shows')).toContainText('(America/New_York)');

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

test('M01a: each record shows its name; a gone record reads "Deleted team member"', async ({
  page,
}) => {
  await page.goto(app('/audit-log'));
  const rows = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
  await expect(rows.filter({ hasText: 'appointment.rescheduled' })).toContainText(
    'Tax Planning with Jamie Sample',
  );
  await expect(rows.filter({ hasText: 'client.created' })).toContainText('Jamie Sample');
  await expect(
    rows.filter({ hasText: 'membership.invited' }).getByTestId('audit-record-name'),
  ).toHaveText('Deleted team member');
});

test('M01b: a record opens on its own page; a gone record has no link', async ({ page }) => {
  await page.goto(app('/audit-log'));
  const rows = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
  await expect(
    rows.filter({ hasText: 'membership.invited' }).getByTestId('audit-record-link'),
  ).toHaveCount(0);
  await rows
    .filter({ hasText: 'client.created' })
    .getByRole('link', { name: 'Open client' })
    .click();
  await expect(page).toHaveURL(/\/clients\/0199b6a1-0000-7000-8000-000000000001$/);
});

test('T10a: a To date before the From date has its own message', async ({ page }) => {
  await page.goto(app('/audit-log'));
  await page.getByLabel('From', { exact: true }).fill('2026-11-15');
  await page.getByLabel('To', { exact: true }).fill('2026-11-14');
  await page.getByRole('button', { name: 'Apply filters' }).click();
  await expect(page.getByText('The To date is before the From date')).toBeVisible();
  await expect(page.getByText('Use a range of at most 366 days')).toHaveCount(0);
});

test('R02a: Export saves the file and says how many entries; a failure says why', async ({
  page,
}) => {
  await page.goto(app('/audit-log'));
  const result = page.getByTestId('audit-export-result');
  const saved = page.waitForEvent('download');
  await page.getByTestId('audit-export').click();
  expect((await saved).suggestedFilename()).toBe('audit-log.csv');
  await expect(result).toHaveText('Downloaded 6 entries.');

  // The API refusing (here a 500): the reason, never a false success or a raw error body.
  await page.evaluate(() => window.sessionStorage.setItem('fv-mock-fail', 'auditLog.export'));
  await page.getByTestId('audit-export').click();
  await expect(result).toHaveText(
    'The export did not download. Something went wrong on our side. Try again in a moment.',
  );
  await expect(result).toHaveAttribute('role', 'alert');
});

test('R02a: the Users export downloads through the session too', async ({ page }) => {
  await page.goto(app('/settings/users'));
  const saved = page.waitForEvent('download');
  await page.getByTestId('users-export').click();
  expect((await saved).suggestedFilename()).toBe('users.csv');
  await expect(page.getByTestId('users-result')).toHaveText('The export downloaded.');
});
