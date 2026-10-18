import { expect, test } from '@playwright/test';

// Super Admin > Subscriptions (S03) in mock mode: mocks/admin-subscriptions.ts, signed in as the
// mock Super Admin. Each test starts a fresh page, so the in-memory store starts from its fixtures.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the page opens with its KPIs and the subscriptions table', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  await expect(page).toHaveTitle(/Subscriptions/);
  await expect(page.getByRole('heading', { name: 'Subscriptions', level: 1 })).toBeVisible();
  await expect(page.getByTestId('kpi-active-value')).toHaveText(/^\d+$/);
  await expect(page.getByTestId('kpi-mrr-value')).toHaveText(/^\$[\d,]+(\.\d\d)?$/);
  await expect(page.getByTestId('kpi-churn-value')).toHaveText(/^\d+\.\d%$/);
  await expect(page.getByRole('row', { name: /Sample Blue Ridge Tax/ })).toContainText('Team Pro');
  await expect(page.getByText(/Showing 1 – 8 of \d+ subscriptions/)).toBeVisible();
});

test('a KPI card filters the table to the same count', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  const value = await page.getByTestId('kpi-active-value').textContent();
  expect(value).toMatch(/^\d+$/);
  await page.getByTestId('kpi-active').click();
  await expect(page.getByTestId('kpi-active')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByText(new RegExp(`of ${value} subscriptions`))).toBeVisible();
  await expect(page.getByRole('row', { name: /Example Maple Ledger/ })).toHaveCount(0);
});

test('search and the status filter apply on Apply, and Clear resets them', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  await expect(page.getByTestId('open-subscription').first()).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search subscriptions' }).fill('maple');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  await expect(page.getByTestId('open-subscription')).toHaveCount(1);
  await expect(page.getByRole('row', { name: /Example Maple Ledger/ })).toContainText('Past Due');

  await page.getByRole('button', { name: 'Clear', exact: true }).click();
  await page.getByLabel('Status', { exact: true }).selectOption('TRIAL');
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  const rows = page.getByRole('row', { name: /Trial/ });
  await expect(rows.first()).toBeVisible();
  await expect(page.getByRole('row', { name: /Sample Blue Ridge Tax/ })).toHaveCount(0);
});

test('the detail panel changes a plan and shows the price impact first', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  await page.getByRole('button', { name: 'Sample Blue Ridge Tax', exact: true }).click();
  const panel = page.getByTestId('subscription-panel');
  await expect(panel.getByText('Team Pro (Annual)', { exact: true })).toBeVisible();

  await panel.getByRole('button', { name: 'Change Plan' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'Change Plan' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('radio', { name: /^Business/ }).check();
  await expect(dialog.getByTestId('plan-impact')).toContainText('charged');
  await dialog.getByRole('button', { name: 'Update Plan' }).click();

  await expect(page.getByTestId('subscription-toast')).toContainText('Plan changed');
  await expect(panel.getByText('Business (Annual)', { exact: true })).toBeVisible();
});

test('Auto-Renew off needs the client request confirmation, source and notes', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  await page.getByRole('switch', { name: 'Auto-Renew for Sample Summit Tax Group' }).click();
  const dialog = page.getByRole('dialog', { name: 'Turn Off Auto-Renew' });
  await expect(dialog.getByTestId('access-ends')).not.toHaveText('—');
  await dialog.getByRole('button', { name: 'Turn Off Auto-Renew' }).click();
  await expect(dialog.getByText('Confirm that the client asked for this.')).toBeVisible();

  await dialog.getByRole('checkbox', { name: /I confirm the client requested/ }).check();
  await dialog.getByLabel('Request source').selectOption('EMAIL');
  await dialog.getByLabel('Request notes').fill('Owner emailed to stop after this month.');
  await dialog.getByRole('button', { name: 'Turn Off Auto-Renew' }).click();

  await expect(page.getByTestId('subscription-toast')).toContainText('Auto-Renew is off');
  await expect(page.getByRole('row', { name: /Sample Summit Tax Group/ })).toContainText(
    'Non-Renewing',
  );
});

test('a failed conversion keeps the firm in Trial', async ({ page }) => {
  await page.goto(admin('/subscriptions'));
  await page.getByRole('button', { name: 'Actions for Example Riverbend Accounting' }).click();
  await page.getByRole('menuitem', { name: 'Convert to Paid' }).click();
  const dialog = page.getByRole('dialog', { name: 'Convert to Paid' });
  await dialog.getByRole('button', { name: 'Convert to Paid' }).click();
  await expect(dialog.getByTestId('action-outcome')).toContainText('stays in Trial');
  await dialog.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(page.getByRole('row', { name: /Example Riverbend Accounting/ })).toContainText(
    'Trial',
  );
});

test('Subscriptions fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(admin('/subscriptions'));
  await expect(page.getByTestId('subscriptions-card')).toBeVisible();
  await expect(page.getByTestId('open-subscription').first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
