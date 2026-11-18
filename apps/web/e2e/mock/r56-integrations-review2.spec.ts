import { expect, test, type Page } from '@playwright/test';
import { IntegrationMarketplaceQuery } from '@firmivra/types';
import {
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
