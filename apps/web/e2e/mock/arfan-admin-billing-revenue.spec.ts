import { expect, test } from '@playwright/test';

// SA-BIL-A1: Billing > Revenue on the adminBilling mock. Collected (gross) by payment date and
// type, a period in the address, and "Compare" beside the current period. Mock dates are relative
// to today, so the test reads totals from the page instead of fixed amounts.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const cents = (text: string) => Math.round(Number(text.replace(/[^0-9.]/g, '')) * 100);

test('Revenue: the tab, the period in the address, type split and compare', async ({ page }) => {
  await page.goto(admin('/billing/revenue'));
  const tabs = page.getByRole('navigation', { name: 'Billing sections' });
  await expect(tabs.getByRole('link', { name: 'Revenue' })).toHaveAttribute('aria-current', 'page');

  // No period in the address: this month, both types.
  const month = page.getByLabel('Month', { exact: true });
  await expect(month).not.toHaveValue('');
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('ALL');

  // Collected = one-time + recurring; refunds are their own card, never taken off.
  const current = page.getByTestId('revenue-current');
  const value = async (id: string) =>
    cents((await page.getByTestId(`revenue-current-${id}-value`).textContent()) ?? '');
  await expect(page.getByTestId('revenue-current-collected-value')).not.toHaveText('—');
  expect(await value('collected')).toBe((await value('one-time')) + (await value('recurring')));
  await expect(current.getByText('Refunds (not deducted)')).toBeVisible();

  // Last month, then Compare: the previous calendar month sits beside it.
  await page.getByRole('button', { name: 'Last month' }).click();
  await expect(page).toHaveURL(/from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}/);
  await page.getByRole('switch', { name: 'Compare to last month' }).click();
  await expect(page).toHaveURL(/compare=true/);
  await expect(page.getByTestId('revenue-previous')).toContainText('Compared with');

  // A reload keeps the period, the type and the comparison.
  await page.getByLabel('Type', { exact: true }).selectOption('RECURRING');
  await expect(page).toHaveURL(/type=RECURRING/);
  await page.reload();
  await expect(page.getByLabel('Type', { exact: true })).toHaveValue('RECURRING');
  await expect(page.getByTestId('revenue-previous')).toBeVisible();
  expect(await value('one-time')).toBe(0);
});

test('Revenue: a reversed period is refused on the page', async ({ page }) => {
  await page.goto(admin('/billing/revenue?from=2026-10-20&to=2026-10-01'));
  await expect(page.getByText('Choose a start on or before the end.')).toBeVisible();
});

test('Revenue fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(admin('/billing/revenue?compare=true'));
  await expect(page.getByTestId('revenue-current')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
