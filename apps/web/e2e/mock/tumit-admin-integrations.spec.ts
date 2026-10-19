import { expect, test } from '@playwright/test';

// Super Admin Integrations dashboard (#813) in mock mode: playwright.mock.config.ts runs
// NEXT_PUBLIC_API_MOCK=all, which signs the console in as Morgan Admin and serves
// mocks/admin-integrations.ts. Each test opens the page fresh, so the mock starts from its seed:
// 12 platform integrations (6 active, 2 needing attention, 1 error, 1 disabled) and 15 catalog
// entries (9 enabled, 3 disabled, 3 coming soon).
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

test('the dashboard shows its cards, platform list, catalog counts and activity', async ({
  page,
}) => {
  await page.goto(admin('/integrations'));
  await expect(page.getByRole('heading', { level: 1, name: 'Integrations' })).toBeVisible();
  await expect(page.getByTestId('kpi-total-value')).toHaveText('27');
  await expect(page.getByTestId('kpi-active-value')).toHaveText('6');
  await expect(page.getByTestId('kpi-attention-value')).toHaveText('3');
  await expect(page.getByTestId('kpi-disabled-value')).toHaveText('1');
  await expect(page.getByTestId('kpi-active')).toContainText(/\d+(\.\d+)?% uptime \(30 days\)/);

  const list = page.getByTestId('platform-integrations');
  await expect(list.locator('tbody tr')).toHaveCount(8);
  await expect(list.getByRole('link', { name: 'Stripe', exact: true })).toBeVisible();
  const mls = list.locator('tbody tr').filter({ hasText: 'MLS Data Provider' });
  await expect(mls).toContainText('Error');
  await expect(mls).toContainText('Connection failed');
  await expect(list.getByRole('link', { name: 'View all 12 platform integrations' })).toBeVisible();
  await expect(list.getByRole('link', { name: 'Add Platform Integration' })).toHaveAttribute(
    'href',
    '/integrations/platform/new',
  );

  await expect(page.getByTestId('catalog-total-value')).toHaveText('15');
  await expect(page.getByTestId('catalog-enabled-value')).toHaveText('9');
  await expect(page.getByTestId('catalog-disabled-value')).toHaveText('3');
  await expect(page.getByTestId('catalog-coming-soon-value')).toHaveText('3');

  const activity = page.getByTestId('integration-activity');
  await expect(activity.locator('li')).toHaveCount(5);
  await expect(activity.locator('li').first()).toContainText('Stripe synchronization completed');
  await expect(activity.getByRole('link', { name: 'View All Activity' })).toHaveAttribute(
    'href',
    '/integrations/logs',
  );

  const nav = page.getByRole('navigation', { name: 'Integrations sections' });
  await expect(nav.getByRole('link', { name: /Dashboard/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
  await expect(nav.getByRole('link', { name: /Customer Integration Catalog/ })).toHaveAttribute(
    'href',
    '/integrations/catalog',
  );
});

test('the Needs Attention card filters the platform list', async ({ page }) => {
  await page.goto(admin('/integrations'));
  const list = page.getByTestId('platform-integrations');
  await expect(list.locator('tbody tr')).toHaveCount(8);

  await page.getByTestId('kpi-attention').click();
  await expect(page.getByTestId('kpi-attention')).toHaveAttribute('aria-pressed', 'true');
  await expect(list.locator('tbody tr')).toHaveCount(3);
  for (const name of ['OpenAI', 'MLS Data Provider', 'Google Maps Platform'])
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible();
  await expect(list.locator('tbody tr').filter({ hasText: 'Active' })).toHaveCount(0);

  await list.getByRole('button', { name: 'Clear filter' }).click();
  await expect(list.locator('tbody tr')).toHaveCount(8);
});

test('disabling an integration confirms its impact and updates the dashboard', async ({ page }) => {
  await page.goto(admin('/integrations'));
  const list = page.getByTestId('platform-integrations');
  await list.getByRole('button', { name: 'More actions for Twilio' }).click();
  await page.getByRole('menuitem', { name: 'Disable' }).click();

  const dialog = page.getByRole('dialog', { name: 'Disable Twilio?' });
  await expect(dialog).toContainText('Catalog: Twilio (Enabled)');
  await dialog.getByLabel('Reason (optional)').fill('Carrier maintenance window.');
  await dialog.getByRole('button', { name: 'Disable Integration' }).click();

  await expect(page.getByText('Twilio was disabled.')).toBeVisible();
  await expect(list.locator('tbody tr').filter({ hasText: 'Twilio' })).toContainText('Disabled');
  await expect(page.getByTestId('kpi-disabled-value')).toHaveText('2');
  await expect(page.getByTestId('kpi-active-value')).toHaveText('5');
  await expect(page.getByTestId('integration-activity')).toContainText('Twilio disabled');
});

test('Test Connection reports the result in a notice', async ({ page }) => {
  await page.goto(admin('/integrations'));
  await page
    .getByTestId('platform-integrations')
    .getByRole('button', { name: 'More actions for Stripe' })
    .click();
  await page.getByRole('menuitem', { name: 'Test Connection' }).click();
  await expect(page.getByText('Stripe: Connection successful (Live).')).toBeVisible();
});

test('the dashboard fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(admin('/integrations'));
  await expect(page.getByTestId('kpi-total-value')).toBeVisible();
  await expect(page.getByTestId('platform-integrations').locator('tbody tr').first()).toBeVisible();
  // Loaded: no skeleton is left, and nothing failed.
  await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
  await expect(page.getByText(/Could not load this right now/)).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
