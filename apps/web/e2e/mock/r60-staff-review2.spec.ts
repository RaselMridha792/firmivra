// R60, Staff Management Review 2 (Nov 17 review; the lead's decisions of Nov 18). Mock mode, as an
// Owner. Synthetic data only.
import { expect, test } from '@playwright/test';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('SM01: the Reports tile opens the Staff & Team report with its content, and Back returns to Staff Management', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team'));
  await page
    .getByTestId('staff-links')
    .getByRole('link', { name: /^Reports/ })
    .click();
  await expect(page).toHaveURL(app('/reports/staff_team?from=%2Fteam'), { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Staff & Team', level: 1 })).toBeVisible();
  await expect(page.getByTestId('report-table')).toContainText('Alex Rivera');
  await expect(page.getByTestId('report-back')).toHaveText('← Back to Staff Management');
  await page.getByTestId('report-back').click();
  await expect(page).toHaveURL(app('/team'));
});

test('SM04: Create Staff’s permission grid has the Export column, set like any other', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/team/new/permissions'));
  await page.getByLabel('Select a Role *').selectOption({ label: 'Tax Preparer' });
  const exportClients = page.getByRole('checkbox', { name: 'Clients: Export' });
  await expect(exportClients).toBeVisible({ timeout: 60_000 });
  await exportClients.check();
  await expect(exportClients).toBeChecked();
});
