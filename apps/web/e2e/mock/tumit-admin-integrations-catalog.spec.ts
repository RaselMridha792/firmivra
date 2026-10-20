import { expect, test } from '@playwright/test';

// Super Admin Integrations (#813): the platform integration manage page, the customer
// integration catalog and the catalog edit page, in mock mode. playwright.mock.config.ts runs
// NEXT_PUBLIC_API_MOCK=all, which signs the console in as Morgan Admin and serves
// mocks/admin-integrations.ts. Each test opens its page fresh, so the mock starts from its seed:
// Stripe is int_001 (Live, Active), and the catalog has 15 entries (9 enabled, 3 disabled,
// 3 coming soon); Twilio's entry is on Team Pro and up, with 10 firms connected.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;
const STRIPE = '0199d1a0-1a01-7000-8000-000000000001';
const STRIPE_ENTRY = '0199d1a0-1a04-7000-8000-000000000001';
const TWILIO_ENTRY = '0199d1a0-1a04-7000-8000-000000000002';

test('the manage page shows the integration and Test Connection records a passing test', async ({
  page,
}) => {
  await page.goto(admin(`/integrations/platform/${STRIPE}`));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Manage Integration – Stripe' }),
  ).toBeVisible();
  await expect(page.getByTestId('integration-name')).toHaveText('Stripe');
  await expect(page.getByTestId('integration-status')).toHaveText('Active');
  await expect(page.getByTestId('integration-uptime')).toHaveText('99.98%');
  await expect(page.getByTestId('health-title')).toHaveText('Connected');
  await expect(page.getByTestId('environment-value')).toHaveText('Live');
  await expect(page.getByTestId('integration-details')).toContainText('int_001');
  await expect(page.getByTestId('integration-details')).toContainText('Payments & Billing');
  await expect(page.getByTestId('recent-activity').locator('tbody tr').first()).toBeVisible();
  await expect(page.getByTestId('dependents')).toContainText('Stripe');
  await expect(
    page.getByTestId('recent-activity').getByRole('link', { name: 'View All Activity' }),
  ).toHaveAttribute('href', `/integrations/logs?integration=${STRIPE}`);

  await page.getByRole('button', { name: 'Test Connection', exact: true }).click();
  await expect(page.getByText('Stripe: Connection successful (Live).')).toBeVisible();
  await expect(page.getByTestId('last-test')).toContainText('passed');

  // The test is a run in Sync History.
  await page.getByRole('tab', { name: 'Sync History' }).click();
  await expect(page.getByTestId('sync-history').locator('tbody tr').first()).toContainText(
    'Connection test',
  );

  // Credentials stay masked; Update Credentials is there for a Super Admin.
  await page.getByRole('tab', { name: 'Connection Settings' }).click();
  const connection = page.getByTestId('connection-details');
  await expect(connection).toContainText('sk_live_••••4242');
  await expect(connection.getByRole('button', { name: 'Update Credentials' })).toBeEnabled();

  await page.getByRole('tab', { name: 'Access Control' }).click();
  await expect(page.getByTestId('your-access')).toContainText('Super Admin');
  await expect(page.getByTestId('audit-trail').locator('tbody tr').first()).toBeVisible();
});

test('an unknown integration or catalog entry shows a quiet not-found card', async ({ page }) => {
  await page.goto(admin('/integrations/platform/0199d1a0-1a01-7000-8000-000000009999'));
  await expect(page.getByTestId('not-found')).toContainText('Integration not found');
  await page.goto(admin('/integrations/catalog/0199d1a0-1a04-7000-8000-000000009999'));
  await expect(page.getByTestId('not-found')).toContainText('Catalog integration not found');
});

test('the catalog shows its counts, filters by status, search and plan, and opens an entry', async ({
  page,
}) => {
  await page.goto(admin('/integrations/catalog'));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Customer Integration Catalog' }),
  ).toBeVisible();
  await expect(page.getByTestId('catalog-kpi-total-value')).toHaveText('15');
  await expect(page.getByTestId('catalog-kpi-enabled-value')).toHaveText('9');
  await expect(page.getByTestId('catalog-kpi-disabled-value')).toHaveText('3');
  await expect(page.getByTestId('catalog-kpi-coming-soon-value')).toHaveText('3');
  const rows = page.getByTestId('catalog-list').locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(page.getByText('Showing 1 – 10 of 15 integrations')).toBeVisible();

  await page.getByRole('tab', { name: 'Disabled' }).click();
  await expect(page).toHaveURL(/status=DISABLED/);
  await expect(rows).toHaveCount(3);
  await expect(rows.filter({ hasNotText: 'Disabled' })).toHaveCount(0);

  await page.getByRole('tab', { name: 'All Integrations' }).click();
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('Twilio');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Team Pro');
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('');

  // Solo Core sees only the entries on all plans.
  await page
    .getByRole('combobox', { name: 'Plan', exact: true })
    .selectOption({ label: 'Solo Core' });
  await expect(rows).toHaveCount(7);
  await expect(rows.filter({ hasText: 'Twilio' })).toHaveCount(0);

  await page.getByRole('link', { name: 'Manage Stripe' }).click();
  await expect(page).toHaveURL(new RegExp(`/integrations/catalog/${STRIPE_ENTRY}$`));
  await expect(page.getByTestId('catalog-name')).toHaveText('Stripe');
});

test('a catalog entry saves its edits, and disabling it confirms the firms losing access', async ({
  page,
}) => {
  await page.goto(admin(`/integrations/catalog/${TWILIO_ENTRY}`));
  await expect(page.getByRole('heading', { level: 1, name: 'Manage Integration' })).toBeVisible();
  await expect(page.getByTestId('catalog-name')).toHaveText('Twilio');
  await expect(page.getByTestId('catalog-status-tag')).toHaveText('Enabled');
  await expect(page.getByTestId('stat-firms-using')).toContainText('10');
  const save = page.getByRole('button', { name: 'Save Changes' });
  await expect(save).toBeDisabled();

  // A missing name is caught before saving.
  await page.getByLabel('Integration Name').fill('');
  await save.click();
  await expect(page.getByTestId('edit-errors')).toContainText('Enter the integration name.');
  await expect(page.getByLabel('Integration Name')).toHaveAttribute('aria-invalid', 'true');
  await page.getByLabel('Integration Name').fill('Twilio');

  await page.getByLabel('Short Description').fill('SMS reminders, voice and verification codes.');
  await save.click();
  await expect(page.getByText('Twilio: changes saved.')).toBeVisible();
  await expect(page.getByTestId('catalog-summary')).toContainText(
    'SMS reminders, voice and verification codes.',
  );
  await expect(save).toBeDisabled();

  await page.getByRole('radio', { name: 'Disabled' }).check();
  await expect(page.getByTestId('catalog-status')).toContainText('10 connected firms lose access');
  await save.click();
  const dialog = page.getByRole('dialog', { name: 'Remove access for connected firms?' });
  await expect(dialog).toContainText('10 connected firms lose access to Twilio');
  await dialog.getByRole('button', { name: 'Save and Remove Access' }).click();
  await expect(page.getByText('Twilio: changes saved.')).toBeVisible();
  await expect(page.getByTestId('catalog-status-tag')).toHaveText('Disabled');
});

test('a firm override saves at once and the firm preview follows it', async ({ page }) => {
  await page.goto(admin(`/integrations/catalog/${TWILIO_ENTRY}`));
  await page.getByRole('tab', { name: 'Access & Permissions' }).click();
  const preview = page.getByTestId('firm-preview');
  await preview
    .getByRole('combobox', { name: 'Firm' })
    .selectOption({ label: 'Example CPA Studio (Solo Pro)' });
  await expect(page.getByTestId('firm-preview-result')).toContainText('Hidden');

  const overrides = page.getByTestId('firm-overrides');
  await overrides
    .getByRole('combobox', { name: 'Firm' })
    .selectOption({ label: 'Example CPA Studio (Solo Pro)' });
  await overrides.getByRole('radio', { name: 'Allow' }).check();
  await overrides.getByLabel('Reason').fill('Pilot for SMS reminders on Solo Pro');
  await overrides.getByRole('button', { name: 'Save Override' }).click();
  await expect(page.getByText('Example CPA Studio: Allow override saved.')).toBeVisible();
  await expect(
    overrides.locator('tbody tr').filter({ hasText: 'Example CPA Studio' }),
  ).toContainText('Pilot for SMS reminders on Solo Pro');
  await expect(page.getByTestId('firm-preview-result')).toContainText('Can connect');
});

for (const [name, path, ready] of [
  ['the manage page', `/integrations/platform/${STRIPE}`, 'integration-name'],
  ['the catalog', '/integrations/catalog', 'catalog-kpi-total-value'],
  ['a catalog entry', `/integrations/catalog/${STRIPE_ENTRY}`, 'catalog-name'],
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
