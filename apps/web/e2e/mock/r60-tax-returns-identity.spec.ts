import { expect, type Page, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F31 and F32 (R1's #1176): a business return shows
// its own copy of the business (name, masked EIN, address) on its Overview, correctable until the
// return is first filed and kept as filed after. In mock mode (playwright.mock.config.ts) as the
// Owner, with the mock answering as the API does. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

async function openBusiness(page: Page, status: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  const filters = page.getByTestId('tr-filters');
  await filters.getByLabel('Client Type').selectOption('BUSINESS');
  await filters.getByLabel('Status', { exact: true }).selectOption(status);
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible();
}

test('a business return in preparation corrects its own copy; the client record stays', async ({
  page,
}) => {
  await openBusiness(page, 'IN_PREPARATION');
  const card = page.getByTestId('business-identity');
  await expect(card).toContainText('Business Name');
  await expect(card).toContainText('Correct it here until the return is first filed');
  await card.getByRole('button', { name: 'Correct' }).click();
  const dialog = page.getByTestId('identity-dialog');
  const save = page.getByRole('dialog').getByRole('button', { name: 'Save' });
  await expect(save).toBeDisabled();
  await dialog.getByLabel('Business name').fill('Fake Holdings Group LLC');
  await dialog.getByLabel('Business EIN').fill('00-0004321');
  await dialog.getByLabel('City').fill('Savannah');
  await save.click();
  await expect(page.getByText("The return's business details are corrected.")).toBeVisible();
  await expect(card).toContainText('Fake Holdings Group LLC');
  await expect(card).toContainText('••-•••4321');
  await expect(card).toContainText('Savannah');
});

test('a filed business return keeps its business as filed', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page.getByTestId('tr-filters').getByLabel('Client Type').selectOption('BUSINESS');
  const filed = page
    .getByRole('row')
    .filter({ hasText: /Accepted|Transmitted|Rejected|Closed/ })
    .first();
  await filed.getByTestId('return-link').click();
  await expect(page.getByTestId('return-workspace')).toBeVisible();
  const card = page.getByTestId('business-identity');
  await expect(card).toContainText('Kept as filed');
  await expect(card.getByRole('button', { name: 'Correct' })).toHaveCount(0);
});

test('an individual return has no business card', async ({ page }) => {
  await page.goto(app('/tax-returns'));
  await page.getByTestId('tr-filters').getByLabel('Client Type').selectOption('INDIVIDUAL');
  await page.getByTestId('return-link').first().click();
  await expect(page.getByTestId('return-workspace')).toBeVisible();
  await expect(page.getByTestId('client-details')).toBeVisible();
  await expect(page.getByTestId('business-identity')).toHaveCount(0);
});
