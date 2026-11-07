import { expect, test, type Page } from '@playwright/test';
import {
  integrationManageFixture,
  MANAGE_INTEGRATION_ID,
} from '../../src/mocks/integrations-manage';
import { IntegrationEnvironment, IntegrationTab } from '@firmivra/types';
import { integrationOverviewFixture } from '../../src/mocks/integrations';
import { setupFixture } from '../../src/mocks/integrations-connect';
import { marketplaceFixture } from '../../src/mocks/integrations-marketplace';

// R55, Octavia's Integrations review of Oct 28: Cancel and Back keep the list's search, filters,
// sort and view (IN-F02), one set of category names (IN-F03), and a Help icon per area (IN-F04).
// Mock mode, as the Owner; one 1440 px screenshot of the overview.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

/** The firm's integrations API, from the shared fixtures (the client calls the real API). */
async function fixtures(page: Page) {
  await page.route('**/api/v1/business/integrations**', async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.includes('/providers/')) return route.fulfill({ json: setupFixture('data') });
    if (url.pathname.endsWith('/marketplace')) {
      return route.fulfill({
        json: marketplaceFixture(
          { search: url.searchParams.get('search') ?? '', sort: 'popular' },
          false,
        ),
      });
    }
    return route.fulfill({
      json: integrationOverviewFixture(
        {
          tab: IntegrationTab.parse(url.searchParams.get('tab') ?? 'all'),
          environment: IntegrationEnvironment.parse(url.searchParams.get('environment') ?? 'LIVE'),
          search: url.searchParams.get('search') ?? '',
          ...(url.searchParams.get('readiness')
            ? {
                readiness: url.searchParams.get('readiness') as 'connectable' | 'coming_soon',
              }
            : {}),
        },
        false,
      ),
    });
  });
}

test('Overview: View details, then Cancel returns to the same search (IN-F02 A)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations'));
  await page.getByLabel('Search integrations').fill('Microsoft');
  await expect(page).toHaveURL(/search=Microsoft/);
  await page.getByRole('button', { name: 'Actions for Microsoft 365' }).click();
  await page.getByRole('menuitem', { name: 'View details' }).click();
  // Connected in the fixture, so View details opens its Manage page, carrying where it came from.
  await expect(page).toHaveURL(
    /\/integrations\/[^/?]+\?from=%2Fintegrations%3Fsearch%3DMicrosoft$/,
  );
  // Browser Back gives the same list.
  await page.goBack();
  await expect(page.getByLabel('Search integrations')).toHaveValue('Microsoft');
  // Setup's Cancel returns there too.
  await page.goto(
    app(
      `/integrations/microsoft365/connect?from=${encodeURIComponent('/integrations?search=Microsoft')}`,
    ),
  );
  await page.getByRole('link', { name: 'Cancel' }).click();
  await expect(page).toHaveURL(/\/integrations\?search=Microsoft$/);
  await expect(page.getByLabel('Search integrations')).toHaveValue('Microsoft');
});

test('Marketplace: the search and view live in the address, so Back keeps them (IN-F02 B)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations/marketplace'));
  await page.getByLabel('Search integrations').fill('website');
  await expect(page).toHaveURL(/search=website/);
  await page.goto(app('/integrations'));
  await page.goBack();
  await expect(page.getByLabel('Search integrations')).toHaveValue('website');
});

test('one set of category names, and a Help icon per area (IN-F03, F04)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations'));
  const categories = page.getByRole('combobox').filter({ hasText: 'CRM & Lead Generation' });
  await expect(categories).toHaveCount(1);
  await expect(page.getByText('Crm & Leads')).toHaveCount(0);
  for (const topic of [
    'Integrations overview',
    'Search, filters and Live or Test',
    'Integration health',
  ]) {
    await expect(page.getByRole('button', { name: `About ${topic}` })).toBeVisible();
  }
  const health = page.getByRole('button', { name: 'About Integration health' });
  await expect(health).toHaveAccessibleDescription(/nothing has been checked/);
  await health.focus();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/overview.png' });
});

test('a provider not enabled yet reads so and offers no Connect; readiness and chips (IN-Y01, Y03, Y04)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations'));
  await expect(page.getByText(/more coming soon/)).toBeVisible();
  const notYet = page.getByTestId('integration-card').filter({ hasText: 'Not available yet' });
  await expect(notYet.first()).toBeVisible();
  await expect(notYet.first().getByRole('link', { name: 'Connect' })).toHaveCount(0);
  await page.getByLabel('Integration readiness').selectOption({ label: 'Coming soon' });
  const chips = page.getByTestId('integration-filter-chips');
  await expect(chips).toContainText('Coming soon');
  await expect(chips).toContainText('shown');
  await expect(
    page.getByTestId('integration-card').filter({ hasText: 'Not connected' }),
  ).toHaveCount(0);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/overview-readiness.png' });
  await chips.getByRole('button', { name: 'Clear all filters' }).click();
  await expect(chips).toHaveCount(0);
});

test('Cancel on a started request asks Keep draft or Discard; Escape keeps it (IN-Y05)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations/marketplace'));
  const open = page.getByRole('button', { name: 'Request Integration' }).first();
  await open.click();
  const name = page.getByLabel('Provider / software name');
  await name.fill('Synthetic Ledger');
  await page.getByRole('button', { name: 'Cancel' }).click();
  const ask = page.getByRole('alertdialog', { name: 'Keep this request as a draft?' });
  await expect(ask).toBeVisible();
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/request-keep-draft.png' });
  await ask.getByRole('button', { name: 'Keep draft' }).click();
  await open.click();
  await expect(name).toHaveValue('Synthetic Ledger');
  await page.keyboard.press('Escape');
  await open.click();
  await expect(name).toHaveValue('Synthetic Ledger');
  await page.getByRole('button', { name: 'Cancel' }).click();
  await page.getByRole('button', { name: 'Discard' }).click();
  await open.click();
  await expect(name).toHaveValue('');
});

test('Disconnect says what happens before it happens (IN-Y17)', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.route(
    `**/api/v1/business/integrations/connections/${MANAGE_INTEGRATION_ID}**`,
    (route) => route.fulfill({ json: integrationManageFixture() }),
  );
  await page.goto(app(`/integrations/${MANAGE_INTEGRATION_ID}`));
  await page.getByRole('button', { name: 'Disconnect' }).first().click();
  const outcome = page.getByTestId('disconnect-outcome');
  await expect(outcome).toContainText('None of your clients');
  await expect(outcome).toContainText('kept');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/disconnect.png' });
});

test('connecting shows the provider’s facts first, in its own words (IN-Y11, Y12)', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await fixtures(page);
  await page.goto(app('/integrations/quickbooks/connect'));
  const facts = page.getByTestId('provider-facts');
  await expect(facts).toContainText('Sign-in');
  await expect(facts).toContainText('Sync direction');
  await expect(facts).toContainText('How often');
  await expect(facts).toContainText('Test environment');
  await expect(page.getByText("You'll be redirected to your provider")).toHaveCount(0);
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/integrations/connect-facts.png' });
});
