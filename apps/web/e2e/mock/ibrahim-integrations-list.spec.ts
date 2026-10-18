import { expect, test, type Page } from '@playwright/test';
import { IntegrationCategory, IntegrationEnvironment, IntegrationTab } from '@firmivra/types';
import { integrationOverviewFixture } from '../../src/mocks/integrations';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/integrations`;
async function fixture(
  page: Page,
  state: 'data' | 'empty' | 'offline' | 'forbidden' | 'manual' | 'readonly' = 'data',
) {
  await page.route('**/api/v1/business/integrations**', async (route) => {
    if (state === 'offline') return route.abort('connectionfailed');
    if (state === 'forbidden')
      return route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      });
    const requestUrl = new URL(route.request().url());
    const result = integrationOverviewFixture(
      {
        tab: IntegrationTab.parse(requestUrl.searchParams.get('tab') ?? 'all'),
        environment: IntegrationEnvironment.parse(
          requestUrl.searchParams.get('environment') ?? 'LIVE',
        ),
        ...(requestUrl.searchParams.get('category')
          ? { category: IntegrationCategory.parse(requestUrl.searchParams.get('category')) }
          : {}),
        search: requestUrl.searchParams.get('search') ?? '',
      },
      state === 'empty',
    );
    if (state === 'readonly') result.canManage = false;
    if (state === 'manual') {
      const stripe = result.items.find((item) => item.provider.provider === 'stripe')
        ?.connections[0];
      if (stripe) {
        stripe.syncMode = 'MANUAL';
        stripe.syncEveryMinutes = null;
      }
    }
    if (requestUrl.pathname.endsWith('/activity'))
      return route.fulfill({
        json: { items: result.recent, page: 1, pageSize: 25, total: result.recent.length },
      });
    return route.fulfill({ json: result });
  });
}
async function expectFrames(page: Page) {
  for (const id of [
    'add-integration',
    'integration-health',
    'integration-mapping',
    'integration-activity',
  ])
    await expect(page.getByTestId(id)).toBeVisible();
}

test('catalog, tabs, search, categories, mode and insight panels', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await fixture(page);
  await page.goto(url);
  await expect(page.getByRole('heading', { name: 'Integrations', exact: true })).toBeVisible();
  await expect(page.getByTestId('integration-card')).toHaveCount(12);
  await expectFrames(page);
  await page.screenshot({
    path: testInfo.outputPath('integrations-data-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('tab', { name: 'Connected (3)', exact: true }).click();
  await expect(page.getByTestId('integration-card')).toHaveCount(3);
  await page.getByRole('tab', { name: 'Needs Attention (1)', exact: true }).click();
  await expect(page.getByTestId('integration-card')).toHaveCount(1);
  await expect(page.getByText('Authorization expired', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'All Integrations (12)', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('Stripe');
  await expect(page.getByTestId('integration-card')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('');
  await page.getByLabel('Integration category').selectOption('PRODUCTIVITY');
  await expect(page.getByTestId('integration-card')).toHaveCount(2);
  await page.getByLabel('Integration category').selectOption('');
  await page.getByRole('button', { name: 'Test Mode', exact: true }).click();
  await expect(page.getByRole('tab', { name: 'Test Mode', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'View Health', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Manage Mapping', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByRole('link', { name: 'QuickBooks Online' }),
  ).toHaveAttribute('href', /data-mapping$/);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'View All', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('QuickBooks Online sync completed'),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'View Integration Marketplace' })).toHaveAttribute(
    'href',
    '/integrations/marketplace',
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await expectFrames(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('integrations-data-mobile.png'),
    fullPage: true,
  });
});

for (const state of ['empty', 'offline', 'forbidden'] as const) {
  test(`${state}: keeps every widget frame without synthetic fallback data`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await fixture(page, state);
    await page.goto(url);
    await expectFrames(page);
    await expect(page.getByTestId('integration-card')).toHaveCount(0);
    await expect(page.getByText('No fields mapped yet.')).toBeVisible();
    if (state === 'offline') await expect(page.getByTestId('page-error')).toBeVisible();
    if (state === 'forbidden') await expect(page.getByTestId('page-forbidden')).toBeVisible();
    if (state === 'empty')
      await expect(page.getByText('No integrations available yet.')).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`integrations-${state}-desktop.png`),
      fullPage: true,
    });
  });
}

test('Live switch and Test button update the same environment and support keyboard input', async ({
  page,
}) => {
  await fixture(page);
  await page.goto(url);
  const live = page.getByRole('switch', { name: 'Live Mode', exact: true });
  const testMode = page.getByRole('button', { name: 'Test Mode', exact: true });
  await expect(live).toBeChecked();
  const switched = page.waitForResponse(
    (response) =>
      response.request().method() === 'GET' && response.url().includes('environment=TEST'),
  );
  await live.click();
  await switched;
  await expect(live).not.toBeChecked();
  await expect(testMode).toHaveAttribute('aria-pressed', 'true');
  await live.focus();
  await page.keyboard.press('Space');
  await expect(live).toBeChecked();
  await expect(testMode).toHaveAttribute('aria-pressed', 'false');
});

test('connected cards show two aligned actions; available cards offer Connect only', async ({
  page,
}) => {
  await fixture(page);
  let syncing = false;
  await page.route('**/connections/*/sync', async (route) => {
    syncing = true;
    await route.fulfill({
      status: 409,
      json: { error: { code: 'SYNC_IN_PROGRESS', message: 'Already syncing' } },
    });
  });
  await page.goto(url);
  const connected = page
    .getByTestId('integration-card')
    .filter({ has: page.getByRole('heading', { name: 'QuickBooks Online', exact: true }) });
  await expect(connected.getByRole('link', { name: 'Manage', exact: true })).toBeVisible();
  const sync = connected.getByRole('button', { name: 'Sync Now', exact: true });
  await expect(sync).toBeVisible();
  const manageBox = await connected
    .getByRole('link', { name: 'Manage', exact: true })
    .boundingBox();
  const syncBox = await sync.boundingBox();
  expect(manageBox).not.toBeNull();
  expect(syncBox).not.toBeNull();
  expect(Math.abs((manageBox?.y ?? 0) - (syncBox?.y ?? 0))).toBeLessThan(2);
  expect(Math.abs((manageBox?.width ?? 0) - (syncBox?.width ?? 0))).toBeLessThan(2);
  const available = page
    .getByTestId('integration-card')
    .filter({ has: page.getByRole('heading', { name: 'Plaid Bank Feeds', exact: true }) });
  await expect(available.getByRole('link', { name: 'Connect', exact: true })).toBeVisible();
  await expect(available.getByRole('link', { name: 'Manage', exact: true })).toHaveCount(0);
  await expect(available.getByRole('button', { name: /Sync Now|Test/ })).toHaveCount(0);
  await sync.click();
  await expect(connected.getByRole('alert')).toBeVisible();
  expect(syncing).toBe(true);
});

test('manual connected card has Manage and Test; read-only cards hide mutation buttons', async ({
  page,
}) => {
  await fixture(page, 'manual');
  await page.goto(url);
  const stripe = page
    .getByTestId('integration-card')
    .filter({ has: page.getByRole('heading', { name: 'Stripe', exact: true }) });
  await expect(stripe.getByRole('link', { name: 'Manage', exact: true })).toBeVisible();
  await expect(stripe.getByRole('button', { name: 'Test', exact: true })).toBeVisible();
  await expect(stripe.getByRole('button', { name: 'Sync Now', exact: true })).toHaveCount(0);
  await fixture(page, 'readonly');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Sync Now', exact: true })).toHaveCount(0);
  await expect(stripe.getByRole('button', { name: 'Test', exact: true })).toHaveCount(0);
  await expect(stripe.getByRole('link', { name: 'Manage', exact: true })).toBeVisible();
});
