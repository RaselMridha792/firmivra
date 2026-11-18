import { expect, test } from '@playwright/test';

// R56: the Tax Returns rows R61's live check failed on dev (F25-J, F36, ACC-DOC, F08-S), in mock
// mode as an Owner. The mock keeps its data in the page. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('F36: "Where returns appear" shows for a firm with no tax statuses too', async ({ page }) => {
  await page.goto(app('/settings/tax-statuses'));
  await expect(page.getByTestId('where-returns-appear')).toBeVisible({ timeout: 60_000 });
  // Archive every status: the firm has none left.
  const archive = page.getByRole('button', { name: /^Archive / });
  for (let n = await archive.count(); n > 0; n--) {
    await archive.first().click();
    await expect(archive).toHaveCount(n - 1);
  }
  await expect(page.getByText('No tax statuses yet')).toBeVisible();
  const where = page.getByTestId('where-returns-appear');
  await expect(where).toBeVisible();
  await expect(where).toContainText('Where returns appear');
});

test('F25-J: Filing Jurisdictions opened at once lists every jurisdiction the return has', async ({
  page,
}) => {
  await page.goto(app('/tax-returns?q=Jamie%20Sample'));
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('tab', { name: 'E-File' }).click();
  // Clicked as soon as it shows: it waits for the filings (disabled until then).
  await page.getByTestId('efile').getByRole('button', { name: 'Jurisdictions' }).click();
  const dialog = page.getByTestId('jurisdictions-dialog');
  await expect(dialog).toContainText('Federal');
  await expect(dialog).toContainText('GA');
});

async function openClosedReturn(page: import('@playwright/test').Page) {
  await page.goto(app('/tax-returns'));
  await page.getByTestId('tr-filters').getByLabel('Status', { exact: true }).selectOption('CLOSED');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible({ timeout: 60_000 });
}

test('F08-S: Set Up Service stays open until it is closed', async ({ page }) => {
  await openClosedReturn(page);
  await page.getByTestId('set-up-return-service').first().click();
  const dialog = page.getByTestId('return-service-dialog');
  await expect(
    dialog.getByLabel('Service', { exact: true }).locator('option').first(),
  ).not.toHaveText(/No active tax service|Loading/);
  // It does not close by itself; Cancel closes it.
  await page.waitForTimeout(6_000);
  await expect(dialog).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await expect(dialog).toHaveCount(0);
});

test('F08-S: services that fail to load say so, never "no active tax service"', async ({
  page,
}) => {
  await page.addInitScript(() =>
    window.sessionStorage.setItem('fv-mock-fail', 'servicesPricing.services'),
  );
  await openClosedReturn(page);
  await page.getByTestId('set-up-return-service').first().click();
  const service = page.getByTestId('return-service-dialog').getByLabel('Service', { exact: true });
  await expect(service.locator('option').first()).toHaveText(
    'The services could not be loaded. Close and try again.',
  );
  await expect(page.getByRole('dialog').getByRole('button', { name: 'Save' })).toBeDisabled();
});
