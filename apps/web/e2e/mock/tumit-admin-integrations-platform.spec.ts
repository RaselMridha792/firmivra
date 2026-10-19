import { expect, test, type Page } from '@playwright/test';

// Super Admin Platform Integrations list and Add Platform Integration wizard (#813) in mock mode:
// playwright.mock.config.ts runs NEXT_PUBLIC_API_MOCK=all, which signs the console in as Morgan
// Admin and serves mocks/admin-integrations.ts. Each test opens its page fresh, so the mock starts
// from its seed: 12 platform integrations (Stripe to Datadog; MLS Data Provider in Error; Amazon
// SES and the Datadog draft in Test) and a removed one. The wizard moves between its steps in
// the browser, so the draft it creates lives as long as the page.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const admin = (path: string) => `http://admin.localhost:${port}${path}`;

async function openWizard(page: Page) {
  await page.goto(admin('/integrations/platform/new'));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Add Platform Integration' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { name: '1. General Information' })).toBeVisible();
  // The providers have loaded once the Provider list is enabled.
  await expect(page.getByLabel('Provider', { exact: true })).toBeEnabled();
}

test('the platform list shows every integration, and its filters and sorting narrow it', async ({
  page,
}) => {
  await page.goto(admin('/integrations/platform'));
  await expect(
    page.getByRole('heading', { level: 1, name: 'Platform Integrations' }),
  ).toBeVisible();
  await expect(
    page
      .getByRole('navigation', { name: 'Integrations sections' })
      .getByRole('link', { name: /Platform Integrations/ }),
  ).toHaveAttribute('aria-current', 'page');

  const list = page.getByTestId('platform-list');
  const rows = list.locator('tbody tr');
  await expect(rows).toHaveCount(10);
  await expect(list.getByText('Showing 1 – 10 of 12 integrations')).toBeVisible();
  await expect(list.getByRole('link', { name: 'Stripe', exact: true })).toHaveAttribute(
    'href',
    '/integrations/platform/0199d1a0-1a01-7000-8000-000000000001',
  );
  const mls = rows.filter({ hasText: 'MLS Data Provider' });
  await expect(mls).toContainText('Error');
  await expect(mls).toContainText('Live');
  await expect(rows.filter({ hasText: 'Twilio' })).toContainText('Test passed');
  // Secrets never reach the list.
  await expect(list).not.toContainText('••••');

  await page.getByRole('combobox', { name: 'Status' }).selectOption('ERROR');
  await expect(page).toHaveURL(/status=ERROR/);
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('MLS Data Provider');

  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await expect(rows).toHaveCount(10);
  await page.getByRole('combobox', { name: 'Category' }).selectOption('EMAIL');
  await expect(rows).toHaveCount(3);
  for (const name of ['SendGrid', 'Amazon SES', 'Postmark'])
    await expect(list.getByRole('link', { name, exact: true })).toBeVisible();
  await page.getByRole('combobox', { name: 'Environment' }).selectOption('TEST');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Amazon SES');

  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('twilio');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Twilio');

  await page.getByRole('button', { name: 'Clear Filters' }).click();
  await list.getByRole('button', { name: 'Integration', exact: true }).click();
  await expect(page).toHaveURL(/sort=name/);
  await expect(rows.first()).toContainText('Amazon SES');
  await list.getByRole('button', { name: 'Page 2' }).click();
  await expect(rows).toHaveCount(2);

  // The draft continues its setup instead of opening a manage page.
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('datadog');
  await expect(list.getByRole('link', { name: 'Datadog', exact: true })).toHaveAttribute(
    'href',
    /\/integrations\/platform\/new\/connection\?draft=0199d1a0-1a01-/,
  );
  await expect(rows.first()).toContainText('Setup step 2 of 4');
});

test('the wizard checks each step and walks all four to a saved draft', async ({ page }) => {
  await openWizard(page);
  await expect(page.getByTestId('wizard-categories')).toContainText('Payments & Billing');

  // Step 1: required fields and a safe address.
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  const errors = page.getByTestId('wizard-errors');
  await expect(errors).toContainText('Enter the integration name.');
  await expect(errors).toContainText('Choose a category.');
  const name = page.getByLabel(/^Integration Name/);
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  await expect(name).toBeFocused();

  await name.fill('Sample Status Pager');
  await page.getByLabel(/^Category/).selectOption('OTHER');
  await page.getByLabel(/^Short Description/).fill('Status page alerts for the Firmivra team.');
  await expect(page.getByText('41/250')).toBeVisible();
  await page.getByLabel(/^Provider Website/).fill('http://status.example.test');
  await page.getByRole('button', { name: 'Next', exact: true }).click();
  await expect(errors).toContainText('The provider website must start with https://.');
  await page.getByLabel(/^Provider Website/).fill('https://status.example.test');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  // Step 2: the custom provider's fields; the secret is checked, then saved masked.
  await expect(page).toHaveURL(/\/integrations\/platform\/new\/connection\?draft=0199d1a0-1a01-/);
  await expect(page.getByRole('heading', { name: '2. Connection Details' })).toBeVisible();
  await expect(page.getByTestId('wizard-draft')).toContainText('Sample Status Pager');
  await expect(page.getByTestId('test-result')).toContainText('no test endpoint');
  const apiKey = page.getByLabel(/^API Key/);
  await expect(apiKey).toHaveAttribute('type', 'password');
  await apiKey.fill('short');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(errors).toContainText('API Key looks too short.');
  await expect(errors).toContainText('Enter the base url.');
  await apiKey.fill('sample-status-key-9a7c');
  await page.getByLabel(/^Base URL/).fill('https://api.status.example.test');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 3: settings.
  await expect(page).toHaveURL(/\/integrations\/platform\/new\/settings\?draft=/);
  await expect(page.getByRole('heading', { name: '3. Settings & Access' })).toBeVisible();
  await expect(page.getByTestId('wizard-scopes')).toContainText('no scopes to choose');
  await expect(page.getByTestId('wizard-alerts')).toContainText('Error rate above');
  await page.getByLabel(/^Sync Schedule/).selectOption('HOURLY');
  await page.getByRole('button', { name: 'Continue' }).click();

  // Step 4: a redacted summary of every step, then Save as Draft.
  await expect(page).toHaveURL(/\/integrations\/platform\/new\/review\?draft=/);
  await expect(page.getByRole('heading', { name: '4. Review & Save' })).toBeVisible();
  await expect(page.getByTestId('review-service')).toContainText('Sample Status Pager');
  await expect(page.getByTestId('review-service')).toContainText('Custom service');
  await expect(page.getByTestId('review-connection')).toContainText('••••9a7c');
  await expect(page.getByTestId('review-connection')).not.toContainText('sample-status-key');
  await expect(page.getByTestId('review-settings')).toContainText('Hourly');
  await expect(page.getByTestId('review-readiness')).toContainText('No test endpoint');
  await page.getByRole('button', { name: 'Save as Draft' }).click();

  await expect(page).toHaveURL(/\/integrations\/platform(\?|$)/);
  await expect(
    page.getByText('Sample Status Pager was saved as a draft. Continue its setup'),
  ).toBeVisible();
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('Sample Status');
  const row = page.getByTestId('platform-list').locator('tbody tr');
  await expect(row).toHaveCount(1);
  await expect(row).toContainText('Draft');
  await expect(row).toContainText('Setup step 4 of 4');
});

test('a tested Stripe test connection activates from the review', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel('Provider', { exact: true }).selectOption('stripe');
  await expect(page.getByLabel(/^Integration Name/)).toHaveValue('Stripe');
  await expect(page.getByLabel(/^Category/)).toHaveValue('PAYMENTS_BILLING');
  await page.getByRole('button', { name: 'Next', exact: true }).click();

  await expect(page.getByRole('heading', { name: '2. Connection Details' })).toBeVisible();
  const secretKey = page.getByLabel(/^Secret Key/);
  await secretKey.fill('sk_live_sample_4242');
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByTestId('wizard-errors')).toContainText(
    'Secret Key is a live value; this connection is Test. Live and test credentials never mix.',
  );
  await secretKey.fill('sk_test_sample_4242');
  await page.getByLabel(/^Publishable Key/).fill('pk_test_sample_123');
  await page.getByLabel(/^Webhook Signing Secret/).fill('whsec_sample_91c2');
  await page.getByRole('button', { name: 'Save & Test Connection' }).click();
  await expect(page.getByTestId('test-result')).toContainText('Connection successful (Test).');
  // Saved write-only: the box is empty again and only the masked hint is shown.
  await expect(secretKey).toHaveValue('');
  await expect(page.getByText(/Saved: sk_test_••••4242/)).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: '3. Settings & Access' })).toBeVisible();
  await page.getByRole('button', { name: 'Continue' }).click();

  await expect(page.getByRole('heading', { name: '4. Review & Save' })).toBeVisible();
  await expect(page.getByTestId('review-readiness')).toContainText('Ready to activate');
  await page.getByRole('button', { name: 'Activate Integration' }).click();
  const dialog = page.getByRole('dialog', { name: 'Activate Stripe?' });
  await dialog.getByRole('button', { name: 'Activate Integration' }).click();

  await expect(page).toHaveURL(/\/integrations\/platform(\?|$)/);
  await expect(page.getByText(/^Stripe is active\./)).toBeVisible();
  await page.getByRole('combobox', { name: 'Environment' }).selectOption('TEST');
  const stripe = page
    .getByTestId('platform-list')
    .locator('tbody tr')
    .filter({ hasText: 'Stripe' });
  await expect(stripe).toContainText('Active');
  await expect(stripe).toContainText('Test');
});

test('leaving the wizard with unsaved changes asks first', async ({ page }) => {
  await openWizard(page);
  await page.getByLabel(/^Integration Name/).fill('Sample Unsaved Service');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Leave without saving?' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Keep Editing' }).click();
  await expect(page.getByLabel(/^Integration Name/)).toHaveValue('Sample Unsaved Service');

  await page.getByRole('button', { name: 'Cancel' }).click();
  await page
    .getByRole('dialog', { name: 'Leave without saving?' })
    .getByRole('button', { name: 'Leave Without Saving' })
    .click();
  await expect(page).toHaveURL(/\/integrations$/);
});

for (const [name, path] of [
  ['the platform list', '/integrations/platform'],
  ['the wizard', '/integrations/platform/new'],
] as const) {
  test(`${name} fits a phone without sideways scrolling`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(admin(path));
    if (path === '/integrations/platform')
      await expect(page.getByTestId('platform-list').locator('tbody tr').first()).toBeVisible();
    else await expect(page.getByLabel('Provider', { exact: true })).toBeEnabled();
    // Loaded: no skeleton is left, and nothing failed.
    await expect(page.getByRole('status', { name: /^Loading/ })).toHaveCount(0);
    await expect(page.getByText(/Could not load this right now/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
  });
}
