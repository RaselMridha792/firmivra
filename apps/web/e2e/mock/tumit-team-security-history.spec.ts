import { expect, test } from '@playwright/test';

// Access & Security, Login History tab (/team/[id]/security/history), in mock mode
// (playwright.mock.config.ts), signed in as the Owner. The mock's sixth member is Hana Kim.
// Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const HANA = '0199c0a0-0a00-7000-8000-000000000006';

test('lists every sign-in and filters by status', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/team/${HANA}/security/history`);
  await expect(page).toHaveTitle('Staff security: Login history');
  await expect(page.getByRole('link', { name: 'Login History' })).toHaveAttribute(
    'aria-current',
    'page',
  );
  const table = page.getByTestId('login-history-all');
  await expect(table.getByRole('row')).toHaveCount(6);
  await expect(page.getByTestId('sign-in-summary')).toContainText('Failed1');

  await table.getByLabel('Status').selectOption('FAILED');
  await expect(table.getByRole('row')).toHaveCount(2);
  await expect(table.getByRole('table')).toContainText('Failed');
  await expect(table.getByRole('table')).not.toContainText('Success');
});

test('keeps its frames when the member is not found', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(
    `http://app.localhost:${port}/team/0199c0a0-0a00-7000-8000-000000000999/security/history`,
  );
  await expect(page.getByText('Login history is not available')).toBeVisible();
  await expect(page.getByTestId('sign-in-summary')).toBeVisible();
});
