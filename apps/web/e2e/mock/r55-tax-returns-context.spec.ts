import { expect, test } from '@playwright/test';

// Tax Returns Review 2, the way out of the Tax Returns list and a return and the way back: the
// page opened keeps the client and the return, and Back comes to the same place. Mock mode
// (playwright.mock.config.ts) as the Owner, the mocks answering as the API does. Synthetic data.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;
const season = String(new Date().getFullYear() - 1);

test.describe.configure({ timeout: 180_000 });

// Tax Returns Review 2 (F03a): the list's search and filters, its Status too, come back with Back.
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
  // The Status filter too: the status this row shows (the longest label it contains).
  const statusFilter = filters.getByLabel('Status', { exact: true });
  const rowText = await rows.first().innerText();
  const statusLabel = (await statusFilter.locator('option').allTextContents())
    .slice(2)
    .sort((a, b) => b.length - a.length)
    .find((l) => rowText.includes(l))!;
  await statusFilter.selectOption({ label: statusLabel });
  await expect(rows).toHaveCount(1);
  const statusValue = await statusFilter.inputValue();

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
  await expect(statusFilter).toHaveValue(statusValue);
  await expect(page).toHaveURL(new RegExp(`[?&]status=${statusValue}(&|$)`));
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

// Tax Returns Review 2 (F11): Send an Intake Form from a return is for its client and its return.
test('Send an Intake Form from a return presets its client, carries the return and comes Back to it', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The season before last: no intake yet (every client has last season's and the one before).
  await page.goto(app(`/tax-returns?year=${String(Number(season) - 2)}`));
  await page
    .getByRole('row')
    .filter({ hasText: 'Robin Demo' })
    .getByTestId('return-link')
    .click({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'Intake & Documents' }).click({ timeout: 60_000 });
  await expect(page).toHaveURL(/\?tab=documents$/);
  const returnUrl = page.url();
  const returnId = new URL(returnUrl).pathname.split('/')[2]!;
  const send = page.getByTestId('intake-form').getByRole('link', { name: 'Send an Intake Form' });
  const href = new URL((await send.getAttribute('href'))!, app('/'));
  expect(href.pathname).toBe('/intake-forms/send');
  expect(href.searchParams.get('clientId')).toMatch(/^[0-9a-f-]{36}$/);
  // The return's own service (its engagement), so the form is bound to this return.
  expect(href.searchParams.get('engagementId')).toMatch(/^[0-9a-f-]{36}$/);
  expect(href.searchParams.get('from')).toBe(`/tax-returns/${returnId}`);

  await send.click();
  await expect(page).toHaveURL(
    /\/intake-forms\/send\?clientId=[0-9a-f-]+&engagementId=[0-9a-f-]+&from=/,
    { timeout: 60_000 },
  );
  await expect(page.getByTestId('send-recipient')).toContainText('Robin Demo', {
    timeout: 60_000,
  });
  await page.getByTestId('back-to-origin').click();
  await expect(page).toHaveURL(returnUrl);
  await expect(page.getByRole('tab', { name: 'Intake & Documents' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
});
