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

test('SM08: assigning a client past someone’s maximum warns, and still assigns', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/clients'));
  // The team mock: Sam Staff carries 2 active clients, their maximum.
  const row = page
    .locator('[data-testid="client-card"], [data-testid="clients-table"] tbody tr')
    .filter({ visible: true })
    .filter({ hasText: 'Riley Example' });
  await row.getByRole('checkbox').check({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Bulk Actions' }).click();
  await page.getByRole('menuitem', { name: 'Assign Staff Member' }).click();
  const dialog = page.getByRole('dialog', { name: 'Assign Staff Member' });
  await dialog.getByLabel('Assign to').selectOption({ label: 'Adam Admin' });
  await expect(dialog.getByTestId('workload-warning')).toHaveCount(0);
  await dialog.getByLabel('Assign to').selectOption({ label: 'Sam Staff' });
  await expect(dialog.getByTestId('workload-warning')).toHaveText(
    'Sam Staff would have 3 active clients, over their maximum of 2. You can still assign them.',
  );
  await dialog.getByRole('button', { name: 'Assign' }).click();
  await expect(page.getByText('1 client updated.')).toBeVisible();
});
