import { expect, test } from '@playwright/test';

// Access & Security, Activity & Audit tab (/team/[id]/security/activity), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('lists the audit trail and searches it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/activity`);
  await expect(page).toHaveTitle('Staff security: Activity & audit');
  await expect(page.getByRole('link', { name: 'Activity & Audit' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const trail = page.getByTestId('activity-audit');
  await expect(trail.getByRole('row')).toHaveCount(6);
  await expect(trail).toContainText('Viewed client records');
  await expect(trail).toContainText('Hana Kim');

  await trail.getByLabel('Search activity').fill('payroll');
  await expect(trail.getByRole('row')).toHaveCount(2);
  await expect(trail).toContainText('Created payroll entry');

  await trail.getByLabel('Search activity').fill('nothing like this');
  await expect(trail.getByText('No matching activity')).toBeVisible();
});

test('keeps its frame when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security/activity`,
  );
  await expect(page.getByText('Activity is not available')).toBeVisible();
});
