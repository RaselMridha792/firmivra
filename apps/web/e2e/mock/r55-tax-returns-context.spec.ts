import { expect, test } from '@playwright/test';

// Tax Returns Review 2, the way out of the Tax Returns list and a return and the way back: the
// page opened keeps the client and the return, and Back comes to the same place. Mock mode
// (playwright.mock.config.ts) as the Owner, the mocks answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const season = String(new Date().getFullYear() - 1);

test.describe.configure({ timeout: 180_000 });

// Tax Returns Review 2 (F03a): the list's search and filters come back with Back.
test('Request Client Information from a searched and filtered list comes Back to that list', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  const filters = page.getByTestId('tr-filters');
  await filters.getByLabel('Tax Year').selectOption(season, { timeout: 60_000 });
  await filters.getByLabel('Client Type').selectOption('INDIVIDUAL');
  await filters.getByLabel('Search returns').fill('Jamie');
  const rows = page.getByRole('row').filter({ has: page.getByTestId('return-link') });
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jamie Sample');

  await rows
    .first()
    .getByRole('button', { name: /^Actions for/ })
    .click();
  await page.getByRole('menuitem', { name: 'Request Client Information', exact: true }).click();
  await expect(page).toHaveURL(/\/documents\/requests\/new\?clientId=[0-9a-f-]+&from=/, {
    timeout: 60_000,
  });
  await page.getByTestId('back-to-origin').click();

  await expect(page).toHaveURL(/\/tax-returns\?/);
  await expect(filters.getByLabel('Search returns')).toHaveValue('Jamie');
  await expect(filters.getByLabel('Tax Year')).toHaveValue(season);
  await expect(filters.getByLabel('Client Type')).toHaveValue('INDIVIDUAL');
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toContainText('Jamie Sample');
});

// Tax Returns Review 2 (F03da): Full Review's Signatures opens Firm Sign for this client and this
// return's service, and Back returns to Full Review.
test('Full Review Signatures: View / Send opens Firm Sign on the client and the return’s service, with Back', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns?q=Morgan%20Testwell'));
  await page.getByTestId('return-link').first().click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\/tax-returns\/[0-9a-f-]{36}/);
  const review = `${page.url().split('?')[0]}/review`;
  await page.goto(review);
  const send = page.getByTestId('signatures').getByRole('link', { name: 'View / Send' });
  const href = new URL((await send.getAttribute('href', { timeout: 60_000 }))!, app('/'));
  const clientId = href.searchParams.get('clientId');
  const engagementId = href.searchParams.get('engagementId');
  expect(engagementId).toMatch(/^[0-9a-f-]{36}$/);

  await send.click();
  await expect(page).toHaveURL(
    /\/firm-sign\/new\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+&from=/,
    {
      timeout: 60_000,
    },
  );
  const client = page.getByLabel('Client', { exact: true });
  await expect(client).toHaveValue(clientId!, { timeout: 60_000 });
  await expect(client.locator('option:checked')).toHaveText('Morgan Testwell');
  const service = page.getByLabel('Service (optional)');
  await expect(service).toHaveValue(engagementId!);
  await expect(service.locator('option:checked')).toHaveText(`${season} Tax Return`);

  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(review);
  await expect(page.getByTestId('signatures')).toBeVisible();
});
