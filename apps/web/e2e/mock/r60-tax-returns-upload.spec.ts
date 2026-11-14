import { expect, test, type Page } from '@playwright/test';

// R60, Tax Returns Review 2 (TX-F08, F10): Upload and Request stay on the return. A return with
// its service opens Upload Document for its client, service and year, and the file can be one of
// the return's own documents (linked as it uploads). A return without its service sets it up in
// place (one of the client's engagements, or a new one for this return and year) instead of
// sending staff to the client's Documents. Mock mode as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test.describe.configure({ timeout: 180_000 });

async function openReturn(page: Page, status: string) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(app('/tax-returns'));
  await page
    .getByTestId('tr-filters')
    .getByLabel('Status', { exact: true })
    .selectOption(status, { timeout: 60_000 });
  await page.getByRole('row').nth(1).getByTestId('return-link').click();
  await page.getByRole('tab', { name: 'Intake & Documents' }).click({ timeout: 60_000 });
}

test('a return with its service uploads in place and can link the file as one of its documents', async ({
  page,
}) => {
  await openReturn(page, 'IN_PREPARATION');
  await page.getByRole('button', { name: 'Upload Documents' }).click();
  const dialog = page.getByTestId('upload-document');
  await expect(dialog).toContainText('Tax Returns');
  const link = dialog.getByLabel(/^Link to the \d{4} return as$/);
  await expect(link).toHaveValue('');
  await expect(link.locator('option', { hasText: 'Draft' })).toHaveCount(1);
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'e2e/screenshots/r60-tax-returns-upload/upload.png' });
});

test('a return without its service sets it up in place', async ({ page }) => {
  await openReturn(page, 'CLOSED');
  await expect(page.getByRole('button', { name: 'Upload Documents' })).toHaveCount(0);
  await page.getByTestId('set-up-return-service').click();
  const dialog = page.getByTestId('return-service-dialog');
  await expect(dialog.getByLabel("This return's service")).toContainText('A new engagement');
  await expect(dialog.getByLabel('Service').locator('option').first()).not.toHaveText(
    /No active tax service/,
  );
  await page.mouse.move(5, 5);
  await page.screenshot({ path: 'e2e/screenshots/r60-tax-returns-upload/set-up-service.png' });
});
