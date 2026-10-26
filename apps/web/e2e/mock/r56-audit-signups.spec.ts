import { expect, test } from '@playwright/test';

// R56: the Audit log's area chips and the Sign-ups view counts, in mock mode as an Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('Audit log: an area chip filters by its action prefix', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/audit-log'));
  const rows = page.getByRole('table', { name: 'Audit log' }).locator('tbody tr');
  await expect(rows).toHaveCount(6);
  await expect(rows.first()).toContainText('Appointment rescheduled');
  await page.getByRole('button', { name: 'Appointments', exact: true }).click();
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('appointment.rescheduled');
  await page.getByRole('button', { name: 'All activity' }).click();
  await expect(rows).toHaveCount(6);
});

test('Sign-ups: each tab shows its count', async ({ page }) => {
  await page.goto(app('/sign-ups'));
  await expect(page.getByRole('tab', { name: /^Waiting for Approval/ })).toContainText('4', {
    timeout: 60_000,
  });
  await expect(page.getByRole('tab', { name: /^Approved/ })).toContainText('1');
  await expect(page.getByRole('tab', { name: /^Declined/ })).toContainText('1');
});
