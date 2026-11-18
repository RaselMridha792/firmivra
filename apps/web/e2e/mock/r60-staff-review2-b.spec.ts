// R60, Staff Management Review 2, second batch (Nov 17 review; the lead's decisions of Nov 18).
// Mock mode, as an Owner. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('SM15: department and team counts name both the active and the assigned staff', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/departments'));
  const named = (testId: string, name: string) =>
    page.getByTestId(testId).filter({ hasText: new RegExp(`^${name}$`) });
  const row = (testId: string, name: string) =>
    page.getByRole('row').filter({ has: named(testId, name) });
  // Tax: two active, one locked and one invited; the deactivated never count.
  await expect(row('department-row', 'Tax')).toContainText('2 active · 4 assigned', {
    timeout: 60_000,
  });
  await expect(page.getByRole('columnheader', { name: 'Staff', exact: true })).toBeVisible();
  await expect(row('department-row', 'Marketing')).toContainText('0 active · 0 assigned');
  await named('department-row', 'Tax').click();
  await expect(page.getByTestId('department-details')).toContainText('2 active · 4 assigned');

  await page.getByRole('link', { name: 'Teams', exact: true }).click();
  await expect(
    page
      .getByRole('row')
      .filter({ has: page.getByTestId('team-row') })
      .first(),
  ).toContainText(/\d+ active · \d+ assigned/);
});
