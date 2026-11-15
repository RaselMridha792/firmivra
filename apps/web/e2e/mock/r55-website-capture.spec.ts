import { expect, test } from '@playwright/test';
import { IntegrationMarketplaceQuery } from '@firmivra/types';
import {
  marketplaceFixture,
  marketplacePermissions,
} from '../../src/mocks/integrations-marketplace';

// R55, Leads Review Two row 24 (website lead capture), in mock mode. The visitor of a shared form
// link gets a clear page for a dead link, the hourly cap and a bad entry; the firm's share dialog
// says where the link or button goes on the common website builders; and Integrations' Website &
// Lead Forms points to Intake Forms instead of a connect step. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const portal = (path: string) => `http://portal.localhost:${port}${path}`;
const app = (path: string) => `http://app.localhost:${port}${path}`;
/** A share token as the mock makes them (mocks/begin-online.ts). */
const TOKEN = '0199c0d00f0070008000000000000002mockshare00';

test('the visitor gets a clear answer for a bad entry, the cap and a dead link', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // A link carrying its campaign starts as any other.
  await page.goto(portal(`/lvp/start/${TOKEN}?utm_source=google&utm_campaign=spring`));
  const start = page.getByRole('button', { name: 'Start My Form' });
  await expect(start).toBeVisible({ timeout: 60_000 });

  // A bad entry: each field says what is wrong, and nothing starts.
  await page.getByLabel('Email Address *').fill('not an email');
  await start.click();
  await expect(page.getByText('Enter your first name')).toBeVisible();
  await expect(page.getByText('Enter your last name')).toBeVisible();
  await expect(page.getByTestId('intake-next')).toHaveCount(0);

  // The cap: the mock answers 429 for an email with "ratelimit", as the API does past the cap.
  await page.getByLabel('First Name *').fill('Avery');
  await page.getByLabel('Last Name *').fill('Shared');
  await page.getByLabel('Email Address *').fill('ratelimit@example.test');
  await start.click();
  await expect(
    page.getByText('Too many attempts. Wait a few minutes and try again.'),
  ).toBeVisible();
  await expect(page.getByTestId('intake-next')).toHaveCount(0);

  // A dead link: a page that says so, with no form.
  await page.goto(portal(`/lvp/start/${'x'.repeat(43)}`));
  await expect(page.getByTestId('share-invalid')).toContainText(
    'This form link is not available any more',
  );
  await expect(page.getByRole('button', { name: 'Start My Form' })).toHaveCount(0);
});

test('the share dialog says where the link goes; Integrations points to Intake Forms', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // As r55-intake-share: a shared form's card menu opens Share & Publish.
  await page.goto(app('/intake-forms/templates'));
  await page
    .getByRole('button', { name: 'Actions for Audit Support Intake Form' })
    .click({ timeout: 60_000 });
  await page.getByRole('menu').getByRole('menuitem', { name: 'Share & Publish' }).click();
  const guide = page
    .getByRole('dialog', { name: 'Audit Support Intake Form' })
    .getByTestId('website-guide');
  await guide.getByText('How to add it to your website').click();
  for (const name of ['WordPress', 'Wix', 'GoDaddy', 'Shopify']) {
    await expect(guide.getByText(name, { exact: true })).toBeVisible();
  }
  await expect(guide).toContainText('utm_campaign');
  await page.screenshot({ path: test.info().outputPath('website-guide.png') });

  // The marketplace's catalog, as ibrahim-integrations-marketplace serves it.
  await page.route('**/api/v1/business/integrations**', async (route) => {
    const request = new URL(route.request().url());
    if (request.pathname.endsWith('/marketplace')) {
      const query = IntegrationMarketplaceQuery.parse(Object.fromEntries(request.searchParams));
      return route.fulfill({ json: marketplaceFixture(query, false) });
    }
    return route.fulfill({ json: marketplacePermissions(true) });
  });
  await page.goto(app('/integrations/marketplace'));
  const card = page
    .getByTestId('marketplace-integration')
    .filter({ hasText: 'Website & Lead Forms' });
  await expect(card).toContainText('Intake form links and website buttons', { timeout: 60_000 });
  await expect(card.getByRole('link', { name: 'Open Intake Forms' })).toHaveAttribute(
    'href',
    /\/intake-forms/,
  );
});
