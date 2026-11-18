import { expect, test, type Page } from '@playwright/test';
import {
  IntegrationEnvironment,
  IntegrationMarketplaceQuery,
  IntegrationTab,
} from '@firmivra/types';
import { integrationOverviewFixture } from '../../src/mocks/integrations';
import {
  integrationRequestFixture,
  marketplaceFixture,
  marketplacePermissions,
} from '../../src/mocks/integrations-marketplace';

// R56: Octavia's Integrations Review Two, the rows still open after the check (F: checks, not in
// the repo). The API is served by route, as the other Integrations specs do. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function catalog(page: Page) {
  await page.route('**/api/v1/business/integrations**', async (route) => {
    const request = new URL(route.request().url());
    if (request.pathname.endsWith('/marketplace'))
      return route.fulfill({
        json: marketplaceFixture(
          IntegrationMarketplaceQuery.parse(Object.fromEntries(request.searchParams)),
          false,
        ),
      });
    return route.fulfill({ json: marketplacePermissions(true) });
  });
}

test('I-R2-08: a request dialog closed and opened again shows no errors from the last attempt', async ({
  page,
}) => {
  await catalog(page);
  await page.goto(app('/integrations/marketplace'));
  const open = () =>
    page
      .getByTestId('marketplace-request')
      .getByRole('button', { name: 'Request Integration', exact: true })
      .click();
  await open();
  const dialog = page.getByRole('dialog');
  const name = dialog.getByLabel('Provider / software name');
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(name).toHaveAttribute('aria-invalid', 'true');
  // Nothing typed: Cancel closes, and the dialog comes back clean.
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await open();
  await expect(name).not.toHaveAttribute('aria-invalid', 'true');
  // A started draft with a bad website: Keep draft keeps what was typed, not the error.
  await name.fill('Example CRM (fake)');
  const website = dialog.getByLabel('Website URL (optional)');
  await website.fill('not-a-url');
  await dialog.getByRole('button', { name: 'Submit request' }).click();
  await expect(website).toHaveAttribute('aria-invalid', 'true');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Keep draft' }).click();
  await open();
  await expect(name).toHaveValue('Example CRM (fake)');
  await expect(website).not.toHaveAttribute('aria-invalid', 'true');
});

test('I-UA02: browse, my connections and my requests are one step apart, in the same environment', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route('**/api/v1/business/integrations**', async (route) => {
    const url = new URL(route.request().url());
    return route.fulfill({
      json: integrationOverviewFixture(
        {
          tab: IntegrationTab.parse(url.searchParams.get('tab') ?? 'all'),
          environment: IntegrationEnvironment.parse(url.searchParams.get('environment') ?? 'LIVE'),
          search: '',
        },
        false,
      ),
    });
  });
  await page.goto(app('/integrations?environment=TEST'));
  const nav = page.getByTestId('integrations-nav');
  await expect(nav.getByRole('link', { name: 'My connections' })).toHaveAttribute(
    'aria-current',
    'page',
    { timeout: 60_000 },
  );
  await expect(nav.getByRole('link', { name: 'Browse integrations' })).toHaveAttribute(
    'href',
    '/integrations/marketplace?environment=TEST',
  );
  await expect(nav.getByRole('link', { name: 'My requests' })).toHaveAttribute(
    'href',
    '/integrations/requests?environment=TEST',
  );
  // Every card with a Test connection says so.
  const connected = page
    .getByTestId('integration-card')
    .filter({ has: page.getByTestId('test-badge') });
  await expect(connected.first()).toBeVisible();
  await expect(page.getByRole('link', { name: 'View Integration Marketplace' })).toHaveAttribute(
    'href',
    '/integrations/marketplace?environment=TEST',
  );
});

test('I-UA02, I-UA03: My requests lists each request with its reference, day and status', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const one = {
    ...integrationRequestFixture({
      providerName: 'Example CRM (fake)',
      websiteUrl: '',
      category: 'CRM_LEADS',
      connectTo: 'Sync synthetic contacts.',
      businessReason: '',
    }),
    id: 'abcdef12-0000-4000-8000-000000000001',
    status: 'REVIEWING' as const,
    statusChangedAt: '2026-11-17T10:00:00.000Z',
    createdAt: '2026-11-10T10:00:00.000Z',
  };
  const two = {
    ...one,
    id: '12345678-0000-4000-8000-000000000002',
    providerName: 'Example Payroll (fake)',
    status: 'NEW' as const,
    statusChangedAt: null,
    createdAt: '2026-11-18T09:00:00.000Z',
  };
  await page.route('**/api/v1/business/integration-requests', (route) =>
    route.fulfill({ json: { items: [one, two] } }),
  );
  await page.goto(app('/integrations/requests'));
  const table = page.getByTestId('integration-requests').getByRole('table');
  const rows = table.getByRole('row');
  await expect(rows).toHaveCount(3, { timeout: 60_000 });
  // Newest first.
  await expect(rows.nth(1)).toContainText('IR-12345678');
  await expect(rows.nth(1)).toContainText('Example Payroll (fake)');
  await expect(rows.nth(1)).toContainText('Nov 18, 2026');
  await expect(rows.nth(1)).toContainText('New');
  await expect(rows.nth(1)).toContainText('Not yet');
  await expect(rows.nth(2)).toContainText('IR-ABCDEF12');
  await expect(rows.nth(2)).toContainText('In review');
  await expect(rows.nth(2)).toContainText('Nov 17, 2026');
  await expect(
    page.getByTestId('integrations-nav').getByRole('link', { name: 'My requests' }),
  ).toHaveAttribute('aria-current', 'page');
});
