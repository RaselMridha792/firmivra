import { expect, test, type Page } from '@playwright/test';
import { CreateIntegrationRequest, IntegrationMarketplaceQuery } from '@firmivra/types';
import {
  integrationRequestFixture,
  marketplaceConnectionId,
  marketplaceFixture,
  marketplacePermissions,
} from '../../src/mocks/integrations-marketplace';

const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const url = `http://app.localhost:${port}/integrations/marketplace`;
async function mockCatalog(
  page: Page,
  state: 'data' | 'empty' | 'offline' | 'forbidden' | 'readonly' | 'unavailable' = 'data',
) {
  await page.route('**/api/v1/business/integrations**', async (route) => {
    if (state === 'offline') return route.abort('connectionfailed');
    if (state === 'forbidden')
      return route.fulfill({
        status: 403,
        json: { error: { code: 'FORBIDDEN', message: 'Forbidden' } },
      });
    const request = new URL(route.request().url());
    if (request.pathname.endsWith('/marketplace')) {
      const query = IntegrationMarketplaceQuery.parse(Object.fromEntries(request.searchParams));
      const result = marketplaceFixture(query, state === 'empty');
      if (state === 'unavailable')
        for (const item of [...result.items, ...result.featured]) item.provider.comingSoon = true;
      return route.fulfill({ json: result });
    }
    return route.fulfill({ json: marketplacePermissions(state !== 'readonly') });
  });
}
async function frames(page: Page) {
  for (const id of [
    'marketplace-categories',
    'marketplace-request',
    'marketplace-banner',
    'marketplace-featured',
    'marketplace-catalog',
    'custom-integration',
  ])
    await expect(page.getByTestId(id)).toBeVisible();
}

test('catalog search, category navigation, sorting, view modes and connected actions', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockCatalog(page);
  await page.goto(url);
  await expect(page.getByTestId('marketplace-integration')).toHaveCount(18);
  await expect(page.getByTestId('featured-integration')).toHaveCount(4);
  await frames(page);
  const quickbooks = page
    .getByTestId('marketplace-integration')
    .filter({ hasText: 'QuickBooks Online' });
  // IN-F02 (R55): the link carries the Marketplace it came from, for Cancel and Back.
  await expect(quickbooks.getByRole('link', { name: 'Manage', exact: true })).toHaveAttribute(
    'href',
    `/integrations/${marketplaceConnectionId}?from=%2Fintegrations%2Fmarketplace`,
  );
  await expect(quickbooks.getByRole('link', { name: 'Connect', exact: true })).toHaveCount(0);
  const payroll = page
    .getByTestId('marketplace-integration')
    .filter({ hasText: 'Payroll Providers' });
  await expect(payroll.getByText('Not available to connect yet.')).toBeVisible();
  await expect(payroll.getByRole('link', { name: 'Connect', exact: true })).toHaveCount(0);
  await page.screenshot({
    path: testInfo.outputPath('marketplace-data-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('Stripe');
  await expect(page.getByTestId('marketplace-integration')).toHaveCount(1);
  await page.getByRole('searchbox', { name: 'Search integrations' }).fill('');
  await page
    .getByRole('navigation', { name: 'Integration categories' })
    .getByRole('button', { name: 'Payments', exact: true })
    .click();
  await expect(page.getByTestId('marketplace-integration')).toHaveCount(2);
  await expect(page.getByLabel('Integration category')).toHaveValue('PAYMENTS');
  await page.getByLabel('Integration category').selectOption('');
  await page.getByLabel('Sort integrations').selectOption('name');
  await expect(page.getByTestId('marketplace-integration').first().getByRole('heading')).toHaveText(
    'API & Webhooks',
  );
  await page.getByRole('button', { name: 'List view', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List view', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: 'Grid view', exact: true }).click();
  await page.getByRole('button', { name: 'Options for Google Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View details' }).click();
  await expect(
    page.getByRole('dialog').getByRole('heading', { name: 'Google Workspace' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('link', { name: 'API & Webhooks setup' })).toHaveAttribute(
    'href',
    '/integrations/custom_api/connect',
  );
  await page.setViewportSize({ width: 375, height: 812 });
  await frames(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: testInfo.outputPath('marketplace-data-mobile.png'),
    fullPage: true,
  });
});

test('request modal validates the shared schema, submits once and confirms API acknowledgement', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockCatalog(page);
  let submitted = 0;
  await page.route('**/api/v1/business/integration-requests', async (route) => {
    const body = CreateIntegrationRequest.parse(route.request().postDataJSON());
    expect(Object.keys(body).sort()).toEqual([
      'businessReason',
      'category',
      'connectTo',
      'providerName',
      'websiteUrl',
    ]);
    submitted += 1;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return route.fulfill({ status: 201, json: integrationRequestFixture(body) });
  });
  await page.goto(url);
  await page
    .getByTestId('marketplace-request')
    .getByRole('button', { name: 'Request Integration', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByText('Mock User · LVP Accounting & Taxes')).toBeVisible();
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByLabel('Provider / software name')).toHaveAttribute(
    'aria-invalid',
    'true',
  );
  expect(submitted).toBe(0);
  await dialog.getByLabel('Provider / software name').fill('Example CRM');
  await dialog.getByLabel('Website URL (optional)').fill('not-a-url');
  await dialog.getByLabel('What should it connect to?').fill('Sync synthetic client contacts.');
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByLabel('Website URL (optional)')).toHaveAttribute('aria-invalid', 'true');
  expect(submitted).toBe(0);
  await dialog.getByLabel('Website URL (optional)').fill('https://example.test');
  await dialog.getByLabel('Category', { exact: true }).selectOption('CRM_LEADS');
  await dialog
    .getByLabel('Business reason / use case (optional)')
    .fill('Reduce duplicate data entry.');
  await page.screenshot({
    path: testInfo.outputPath('marketplace-request-form.png'),
    fullPage: true,
  });
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByRole('button', { name: 'Submitting...' })).toBeDisabled();
  await expect(dialog.getByRole('heading', { name: 'Request submitted' })).toBeVisible();
  expect(submitted).toBe(1);
  // I-UA03: a reference to quote, the day it was sent, its status and the way to follow it.
  const receipt = dialog.getByTestId('request-receipt');
  await expect(receipt).toContainText('Reference:IR-00000000');
  await expect(receipt).toContainText(/Sent:[A-Z][a-z]{2} \d{1,2}, \d{4}/);
  await expect(receipt).toContainText('Status:New');
  await expect(dialog.getByRole('link', { name: 'View my requests' })).toHaveAttribute(
    'href',
    '/integrations/requests',
  );
  await dialog.getByRole('button', { name: 'Done' }).click();
  await expect(dialog).not.toBeVisible();
});

test('request errors keep entered values for a safe retry', async ({ page }) => {
  await mockCatalog(page);
  await page.route('**/api/v1/business/integration-requests', (route) =>
    route.fulfill({
      status: 503,
      json: { error: { code: 'INTERNAL_ERROR', message: 'Synthetic failure' } },
    }),
  );
  await page.goto(url);
  await page
    .getByTestId('custom-integration')
    .getByRole('button', { name: 'Request Integration', exact: true })
    .click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Provider / software name').fill('Example CRM');
  await dialog.getByLabel('What should it connect to?').fill('Sync synthetic contacts.');
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog.getByLabel('Provider / software name')).toHaveValue('Example CRM');
  await expect(dialog.getByRole('button', { name: 'Submit request' })).toBeEnabled();
});

test('the request dialog keeps Tab and Shift+Tab inside; Escape still closes it and returns focus (I-R2-09)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockCatalog(page);
  await page.goto(url);
  const opener = page
    .getByTestId('custom-integration')
    .getByRole('button', { name: 'Request Integration', exact: true });
  await opener.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Mark the dialog's first and last Tab stops (shown, enabled, in page order).
  await page.evaluate(() => {
    const open = document.querySelector('dialog[open]');
    const stops = [
      ...(open?.querySelectorAll<HTMLElement>(
        'a[href], button, input, select, textarea, [tabindex]',
      ) ?? []),
    ].filter((e) => e.tabIndex >= 0 && !e.matches(':disabled') && e.getClientRects().length > 0);
    stops[0]?.setAttribute('data-stop', 'first');
    stops.at(-1)?.setAttribute('data-stop', 'last');
  });
  const first = dialog.locator('[data-stop="first"]');
  const last = dialog.locator('[data-stop="last"]');
  await expect(first).toHaveAccessibleName('Close dialog');
  await last.focus();
  await page.keyboard.press('Tab');
  await expect(first).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(last).toBeFocused();
  // In between, Tab moves on as usual and stays in the dialog.
  await first.focus();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('dialog[open]'))).toBe(true);
  await expect(first).not.toBeFocused();
  // Escape is unchanged: an untouched request closes, and focus is back on the button.
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(opener).toBeFocused();
});

for (const state of ['empty', 'offline', 'forbidden', 'readonly'] as const) {
  test(`${state}: preserves marketplace sections and safe permissions`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 1100 });
    await mockCatalog(page, state);
    await page.goto(url);
    await frames(page);
    if (state !== 'readonly')
      await expect(page.getByTestId('marketplace-integration')).toHaveCount(0);
    if (state === 'empty')
      await expect(page.getByText('No integrations available yet.')).toBeVisible();
    // The page keeps its sections and says why in one quiet notice (R56).
    if (state === 'offline')
      await expect(page.getByTestId('marketplace-unavailable')).toContainText(
        'temporarily unavailable',
      );
    if (state === 'forbidden')
      await expect(page.getByTestId('marketplace-unavailable')).toContainText(
        'You do not have access to the marketplace.',
      );
    if (state === 'readonly' || state === 'forbidden' || state === 'offline')
      await expect(
        page
          .getByTestId('marketplace-request')
          .getByRole('button', { name: 'Request Integration', exact: true }),
      ).toBeDisabled();
    if (state === 'readonly') {
      const available = page
        .getByTestId('marketplace-integration')
        .filter({ hasText: 'Google Workspace' });
      await expect(available.getByRole('link', { name: 'Connect', exact: true })).toHaveCount(0);
    }
    await page.screenshot({
      path: testInfo.outputPath(`marketplace-${state}-desktop.png`),
      fullPage: true,
    });
  });
}

test('page heading uses the site sans font rather than the display font', async ({ page }) => {
  await mockCatalog(page);
  await page.goto(url);
  const heading = page.getByRole('heading', { name: 'Add Integration', exact: true });
  await expect(heading).toBeVisible();
  const fonts = await heading.evaluate((element) => ({
    heading: getComputedStyle(element).fontFamily,
    body: getComputedStyle(document.body).fontFamily,
  }));
  expect(fonts.heading).toBe(fonts.body);
});

test('unavailable providers keep visible disabled actions in featured, catalog and details', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  await mockCatalog(page, 'unavailable');
  await page.goto(url);
  await expect(page.getByTestId('marketplace-integration')).toHaveCount(18);
  for (const id of ['featured-integration', 'marketplace-integration']) {
    const cards = page.getByTestId(id);
    for (let index = 0; index < (await cards.count()); index++) {
      const card = cards.nth(index);
      if (await card.getByRole('heading', { name: 'QuickBooks Online', exact: true }).count()) {
        await expect(card.getByRole('link', { name: 'Manage', exact: true })).toBeVisible();
      } else {
        const action = card.getByRole('button', { name: /^(Connect|Configure)$/ });
        await expect(action).toBeVisible();
        await expect(action).toBeDisabled();
        await expect(action).toHaveAttribute('aria-describedby', /.+/);
        await expect(card.getByRole('link', { name: /^(Connect|Configure)$/ })).toHaveCount(0);
      }
    }
  }
  await page.screenshot({
    path: info.outputPath('marketplace-unavailable-desktop.png'),
    fullPage: true,
  });
  await page.getByRole('button', { name: 'Options for Google Workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'View details' }).click();
  await expect(
    page.getByRole('dialog').getByRole('button', { name: 'Connect', exact: true }),
  ).toBeDisabled();
});
