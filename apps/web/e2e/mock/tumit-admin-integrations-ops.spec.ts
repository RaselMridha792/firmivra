import { expect, test } from '@playwright/test';

// Super Admin Integrations: API & Webhooks, Integration Logs and Usage & Analytics (#813), in
// mock mode: playwright.mock.config.ts runs NEXT_PUBLIC_API_MOCK=all, which signs the console in
// as Morgan Admin and serves the contract over mocks/admin-integrations.ts (admin-integrations-api.ts:
// like the API, no key peaks, alerts or plan counts yet). Each test opens its page fresh, so the
// mock starts from its seed: three API keys (two active, one revoked by a rotation), four webhook
// endpoints with their deliveries, the integration log and 90 days of usage.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
// Platform integrations in admin-integrations-data.ts (block 1a01): Stripe is n 1, MLS n 7.
const STRIPE = '0199d1a0-1a01-7000-8000-000000000001';
const MLS = '0199d1a0-1a01-7000-8000-000000000007';
const BILLING_HOOK = 'https://hooks.example.test/firmivra/billing';

test('API & Webhooks shows the keys, rate limits and webhook endpoints', async ({ page }) => {
  await page.goto(admin('/integrations/api-webhooks'));
  await expect(page.getByRole('heading', { level: 1, name: 'API & Webhooks' })).toBeVisible();
  await expect(page.getByTestId('kpi-active-keys-value')).toHaveText('2');
  await expect(page.getByTestId('kpi-webhooks-value')).toHaveText('4');

  const keys = page.getByTestId('api-keys');
  await expect(keys.locator('tbody tr')).toHaveCount(3);
  await expect(keys).toContainText('fv_live_8k2q…Zt4P');
  await expect(keys.locator('tbody tr').filter({ hasText: 'fv_live_q7Lm…a91X' })).toContainText(
    'Revoked',
  );
  await page.getByRole('combobox', { name: 'Key status' }).selectOption('ACTIVE');
  await expect(keys.locator('tbody tr')).toHaveCount(2);

  await expect(page.getByTestId('rate-limits')).toContainText(
    'Limit 600 per minute · peak not tracked yet',
  );
  const hooks = page.getByTestId('webhooks');
  await expect(hooks.locator('tbody tr')).toHaveCount(4);
  await expect(hooks).toContainText(BILLING_HOOK);
  await expect(hooks).toContainText('whsec_••••0f7a');

  const nav = page.getByRole('navigation', { name: 'Integrations sections' });
  await expect(nav.getByRole('link', { name: /API & Webhooks/ })).toHaveAttribute(
    'aria-current',
    'page',
  );
});

test('a new API key is shown once, then only its prefix and last four', async ({ page }) => {
  await page.goto(admin('/integrations/api-webhooks'));
  const keys = page.getByTestId('api-keys');
  await expect(keys.locator('tbody tr')).toHaveCount(3);

  await keys.getByRole('button', { name: 'Create API Key' }).click();
  const form = page.getByRole('dialog', { name: 'Create API Key' });
  await form.getByLabel('Key name').fill('Example Reporting Job');
  await form.getByRole('button', { name: 'Create Key' }).click();
  await expect(form.getByText('Choose at least one scope.')).toBeVisible();
  await form.getByLabel('Read usage (usage:read)').check();
  await form.getByRole('button', { name: 'Create Key' }).click();

  const issued = page.getByRole('dialog', { name: 'Copy your new API key' });
  await expect(issued).toContainText('This is the only time it is shown.');
  const secret = (await issued.getByTestId('secret-once').textContent()) ?? '';
  expect(secret).toMatch(/^fv_test_[A-Za-z0-9]{32}$/);
  await issued.getByRole('button', { name: 'Done' }).click();

  await expect(page.getByText(secret)).toHaveCount(0);
  const row = keys.locator('tbody tr').filter({ hasText: 'Example Reporting Job' });
  await expect(row).toContainText(`${secret.slice(0, 12)}…${secret.slice(-4)}`);
  await expect(row).toContainText('usage:read');
  await expect(page.getByTestId('kpi-active-keys-value')).toHaveText('3');
});

test('a failed webhook delivery can be redelivered from its deliveries panel', async ({ page }) => {
  await page.goto(admin('/integrations/api-webhooks'));
  await page.getByRole('button', { name: `Deliveries for ${BILLING_HOOK}` }).click();
  const drawer = page.getByRole('dialog', { name: 'Deliveries' });
  const list = drawer.getByTestId('webhook-deliveries');
  await expect(list.locator('li').first()).toBeVisible();

  await drawer.getByRole('combobox', { name: 'Delivery status' }).selectOption('FAILED');
  await expect(list.locator('li')).toHaveCount(1);
  await expect(list.locator('li')).toContainText('invoice.payment_failed');
  await list.getByRole('button', { name: 'Redeliver invoice.payment_failed' }).click();
  await list.getByRole('button', { name: 'Redeliver', exact: true }).click();

  await drawer
    .getByRole('combobox', { name: 'Delivery status' })
    .selectOption({ label: 'All deliveries' });
  await expect(list.locator('li').first()).toContainText('Attempt 3');
  await expect(list.locator('li').first()).toContainText('Delivered');
});

test('the logs filter, open a record with its metadata, and export', async ({ page }) => {
  await page.goto(admin('/integrations/logs'));
  await expect(page.getByRole('heading', { level: 1, name: 'Integration Logs' })).toBeVisible();
  const logs = page.getByTestId('integration-logs');
  const rows = logs.locator('tbody tr');
  await expect(rows).toHaveCount(20);
  await expect(page.getByText(/^Showing 1 – 20 of \d+ records$/)).toBeVisible();

  await page.getByRole('combobox', { name: 'Severity' }).selectOption('ERROR');
  await expect(page).toHaveURL(/severity=ERROR/);
  await page.getByRole('searchbox', { name: 'Search logs' }).fill('ops.example.test');
  await expect(rows).toHaveCount(4);
  await expect(rows.filter({ hasText: 'Critical' })).toHaveCount(0);
  await expect(rows.filter({ hasText: 'Warning' })).toHaveCount(0);

  await rows
    .first()
    .getByRole('button', { name: /^View / })
    .click();
  const record = page.getByRole('dialog', { name: 'Log Record' });
  await expect(record.getByTestId('log-message')).toContainText('ops.example.test failed (500)');
  await expect(record.getByTestId('log-metadata')).toContainText(
    'https://ops.example.test/alerts/integrations',
  );
  await expect(record.getByTestId('log-metadata')).toContainText('Request ID');
  await expect(record.getByRole('link', { name: 'View Webhook' })).toHaveAttribute(
    'href',
    '/integrations/api-webhooks',
  );
  await expect(page).toHaveURL(/log=0199d1a0-1a03-/);
  await record.getByRole('button', { name: 'Close panel' }).click();

  const exports = page.getByTestId('log-exports');
  await expect(exports).toContainText('No exports yet.');
  await page.getByRole('button', { name: 'Export CSV' }).click();
  await expect(page.getByText(/^Export queued: a CSV of the filtered records/)).toBeVisible();
  await expect(exports.locator('li')).toHaveCount(1);
  await expect(exports).toContainText('Ready · 4 records');
});

test('a link with ?integration= opens the log filtered to it, with the run behind a record', async ({
  page,
}) => {
  await page.goto(admin(`/integrations/logs?integration=${MLS}`));
  await expect(page.getByRole('combobox', { name: 'Integration', exact: true })).toHaveValue(MLS);
  const rows = page.getByTestId('integration-logs').locator('tbody tr');
  await expect(rows.first()).toBeVisible();
  await expect(rows.filter({ hasNotText: 'MLS Data Provider' })).toHaveCount(0);

  await page.getByRole('searchbox', { name: 'Search logs' }).fill('synchronization failed');
  await rows
    .first()
    .getByRole('button', { name: /^View / })
    .click();
  const run = page.getByRole('dialog', { name: 'Log Record' }).getByTestId('related-run');
  await expect(run).toContainText('Synchronization');
  await expect(run).toContainText('Failed');
});

test('usage shows its totals and chart, and follows the range and the subject', async ({
  page,
}) => {
  await page.goto(admin('/integrations/usage'));
  await expect(page.getByRole('heading', { level: 1, name: 'Usage & Analytics' })).toBeVisible();
  await expect(page.getByTestId('usage-requests-value')).toHaveText(/^\d{1,3}(,\d{3})*$/);
  await expect(page.getByTestId('usage-success-rate-value')).toHaveText(/%$/);
  const days = page.getByTestId('usage-chart').locator('svg[role="img"] > g');
  await expect(days).toHaveCount(30);
  const subjects = page.getByTestId('usage-subjects');
  await expect(subjects.locator('tbody tr').first()).toBeVisible();

  await page.getByRole('combobox', { name: 'Time range' }).selectOption('7');
  await expect(page).toHaveURL(/range=7/);
  await expect(days).toHaveCount(7);

  const subject = page.getByRole('combobox', { name: 'Subject' });
  await subject.selectOption(STRIPE);
  await expect(page).toHaveURL(new RegExp(`subject=${STRIPE}`));
  await expect(page.getByTestId('usage-volume')).toContainText('Total Processed');
  await expect(subjects.locator('tbody tr')).toHaveCount(1);
  await expect(subjects.locator('tbody tr')).toContainText('Stripe');
  await subjects.getByRole('button', { name: 'Show All' }).click();
  await expect(subject).toHaveValue('');

  await page.getByRole('combobox', { name: 'Scope' }).selectOption('CATALOG');
  await expect(page.getByTestId('usage-connected')).toContainText('Connected Firms');
  await expect(page.getByTestId('plan-distribution')).toContainText(
    'Connected firms are not counted by plan yet.',
  );
  await expect(page.getByTestId('usage-alerts')).toContainText('No alerts in this range.');
});

for (const [name, path, ready] of [
  ['API & Webhooks', '/integrations/api-webhooks', 'kpi-active-keys-value'],
  ['Integration Logs', '/integrations/logs', 'log-filters'],
  ['Usage & Analytics', '/integrations/usage', 'usage-requests-value'],
] as const) {
  test(`${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    await expect(page.getByTestId(ready)).toBeVisible();
    // Loaded: no skeleton is left, and nothing failed.
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
    await expect(page.getByText(/Could not load this right now/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
