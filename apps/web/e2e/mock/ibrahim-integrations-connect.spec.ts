import { expect, test, type Page } from '@playwright/test';
import { ConnectIntegrationRequest } from '@firmivra/types';
import {
  setupConnection,
  setupFixture,
  setupTestResult,
} from '../../src/mocks/integrations-connect';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const base = `http://app.localhost:${port}/integrations/microsoft365/connect`;
async function mockSetup(
  page: Page,
  state: Parameters<typeof setupFixture>[0] | 'offline' | 'forbidden' = 'data',
) {
  await page.route('**/api/v1/business/integrations/**', async (route) => {
    if (state === 'offline') return route.abort('connectionfailed');
    if (state === 'forbidden')
      return route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      });
    if (route.request().method() === 'GET') return route.fulfill({ json: setupFixture(state) });
    if (route.request().url().endsWith('/test')) return route.fulfill({ json: setupTestResult() });
    return route.fulfill({ json: { mode: 'CONNECTED', connection: setupConnection() } });
  });
}
async function frames(page: Page) {
  for (const section of ['connect', 'configure', 'permissions', 'complete'])
    await expect(page.getByTestId(`setup-${section}`)).toBeVisible();
}
test('all design sections, route navigation, preference persistence and least privilege', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockSetup(page);
  await page.goto(base);
  await frames(page);
  await expect(page.getByLabel('Environment')).toHaveCount(0);
  await expect(page.getByLabel('Mailbox / Account')).toBeDisabled();
  await page.screenshot({ path: info.outputPath('connect-data-desktop.png'), fullPage: true });
  await page.getByLabel('Email (Outlook)', { exact: true }).uncheck();
  await expect(page.getByText('Read and manage your email', { exact: true })).toHaveCount(0);
  await page.getByLabel('Sync Frequency').selectOption('30');
  await page
    .getByRole('navigation', { name: 'Connection setup steps' })
    .getByRole('link', { name: /Configure/ })
    .click();
  await expect(page).toHaveURL(`${base}/configure`);
  await page.reload();
  await expect(page.getByLabel('Sync Frequency')).toHaveValue('30');
  await expect(page.getByLabel('Email (Outlook)', { exact: true })).not.toBeChecked();
  for (const [name, suffix] of [
    ['Permissions', '/permissions'],
    ['Complete', '/complete'],
  ]) {
    await page
      .getByRole('navigation', { name: 'Connection setup steps' })
      .getByRole('link', { name: new RegExp(name ?? '') })
      .click();
    await expect(page).toHaveURL(base + suffix);
    await frames(page);
  }
  await page.setViewportSize({ width: 375, height: 900 });
  await page.screenshot({ path: info.outputPath('connect-data-mobile.png'), fullPage: true });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBeTruthy();
});
test('connect sends only contract fields and preserves preferences on a failed retry', async ({
  page,
}) => {
  await mockSetup(page);
  let attempts = 0;
  await page.route('**/providers/microsoft365/connect', async (route) => {
    const body = ConnectIntegrationRequest.parse(route.request().postDataJSON());
    expect(body.settings?.syncEveryMinutes).toBe(30);
    expect(body.settings?.entities).not.toContain('email');
    expect(body.environment).toBe('LIVE');
    expect(body.testAfterConnect).toBe(false);
    expect(body).not.toHaveProperty('businessId');
    attempts++;
    if (attempts === 1)
      return route.fulfill({
        status: 409,
        json: { error: { code: 'NOT_SUPPORTED', message: 'Please retry authorization.' } },
      });
    await route.fulfill({ json: { mode: 'CONNECTED', connection: setupConnection() } });
  });
  await page.goto(base);
  await page.getByLabel('Email (Outlook)', { exact: true }).uncheck();
  await page.getByLabel('Sync Frequency').selectOption('30');
  await page.getByLabel('Run a test sync after connection').uncheck();
  await page.getByRole('button', { name: 'Connect & Continue', exact: true }).click();
  await expect(page.getByTestId('setup-complete').getByRole('alert')).toContainText('retry');
  await expect(page.getByLabel('Sync Frequency')).toHaveValue('30');
  await page.getByRole('button', { name: 'Connect & Continue', exact: true }).click();
  await expect(page).toHaveURL(base + '/complete');
  expect(attempts).toBe(2);
});
for (const state of ['empty', 'offline', 'forbidden', 'readonly'] as const) {
  test(`${state} retains all four section frames`, async ({ page }, info) => {
    await mockSetup(page, state);
    await page.goto(base);
    await frames(page);
    if (state === 'offline') await expect(page.getByTestId('page-error')).toBeVisible();
    if (state === 'forbidden') await expect(page.getByTestId('page-forbidden')).toBeVisible();
    if (state !== 'empty')
      await expect(page.getByRole('button', { name: 'Connect & Continue' })).toBeDisabled();
    await page.screenshot({
      path: info.outputPath(`connect-${state}-desktop.png`),
      fullPage: true,
    });
  });
}
test('unsupported sync directions cannot be selected', async ({ page }) => {
  await mockSetup(page, 'limited');
  await page.goto(base + '/configure');
  await expect(page.getByLabel('Sync Direction')).toHaveValue('IMPORT');
  await expect(page.getByLabel('Sync Direction').locator('option[value="TWO_WAY"]')).toHaveCount(0);
});
test('connected state prevents duplicate connection and runs an actual test action', async ({
  page,
}) => {
  await mockSetup(page, 'connected');
  await page.goto(base + '/complete');
  await expect(page.getByRole('button', { name: 'Connect & Continue' })).toBeDisabled();
  await page.getByRole('button', { name: 'Run connection test', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Connection test:' })).toContainText(
    'Connection verified.',
  );
});
test('OAuth redirect uses the API result rather than pretending to connect', async ({ page }) => {
  await mockSetup(page);
  await page.route('**/providers/microsoft365/connect', (route) =>
    route.fulfill({
      json: { mode: 'REDIRECT', url: 'https://authorization.example.test/authorize' },
    }),
  );
  await page.route('https://authorization.example.test/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<h1>Synthetic provider authorization</h1>' }),
  );
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in with Microsoft 365', exact: true }).click();
  await expect(page).toHaveURL('https://authorization.example.test/authorize');
});

test('provider-issued credentials stay out of the saved preferences', async ({ page }) => {
  await mockSetup(page);
  await page.route('**/providers/microsoft365', async (route) => {
    const fixture = setupFixture();
    fixture.provider.authMethod = 'API_KEY';
    fixture.provider.credentialFields = [{ key: 'apiKey', label: 'Provider API key', help: null }];
    await route.fulfill({ json: fixture });
  });
  await page.route('**/providers/microsoft365/connect', async (route) => {
    const body = ConnectIntegrationRequest.parse(route.request().postDataJSON());
    expect(body.credentials).toEqual({ apiKey: 'synthetic-test-value' });
    await route.fulfill({ json: { mode: 'CONNECTED', connection: setupConnection() } });
  });
  await page.goto(base);
  await page.getByLabel('Provider API key').fill('synthetic-test-value');
  await page.getByLabel('Sync Frequency').selectOption('30');
  expect(await page.evaluate(() => JSON.stringify(Object.entries(sessionStorage)))).not.toContain(
    'synthetic-test-value',
  );
  await page.getByRole('button', { name: 'Connect & Continue' }).click();
  await expect(page).toHaveURL(base + '/complete');
  await expect(page.getByLabel('Provider API key')).toHaveValue('');
});

test('failed authorization returns to a clear retry path without losing settings', async ({
  page,
}) => {
  await mockSetup(page);
  await page.goto(base + '/configure');
  await page.getByLabel('Sync Frequency').selectOption('30');
  await page.goto(base + '?result=failed');
  await expect(page.getByText('Authorization did not finish', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Sync Frequency')).toHaveValue('30');
  await expect(page.getByRole('button', { name: 'Sign in with Microsoft 365' })).toBeEnabled();
});

test('unsafe provider redirect is rejected without navigating away', async ({ page }) => {
  await mockSetup(page);
  await page.route('**/providers/microsoft365/connect', (route) =>
    route.fulfill({ json: { mode: 'REDIRECT', url: 'javascript:void(0)' } }),
  );
  await page.goto(base);
  await page.getByRole('button', { name: 'Sign in with Microsoft 365' }).click();
  await expect(page.getByTestId('setup-complete').getByRole('alert')).toContainText(
    'authorization address is unavailable',
  );
  await expect(page).toHaveURL(base);
});
