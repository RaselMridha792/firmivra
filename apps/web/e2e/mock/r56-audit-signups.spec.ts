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

test('Sign-ups: each view shows its count and the approval steps', async ({ page }) => {
  await page.goto(app('/sign-ups'));
  await expect(page.getByRole('button', { name: /^Waiting for approval/ })).toContainText('2');
  await expect(page.getByText('How approval works')).toBeVisible();
});
