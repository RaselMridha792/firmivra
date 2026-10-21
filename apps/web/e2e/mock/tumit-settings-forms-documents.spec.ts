import { expect, test } from '@playwright/test';
import { UPLOAD_LIMITS } from '@firmivra/types';

// Settings > Forms & Documents (/settings/forms-documents), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const MB = 1024 * 1024;

test('shows the file rules, categories and links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/forms-documents`);
  await expect(page).toHaveTitle('Forms & documents');
  const files = page.getByTestId('allowed-files');
  await expect(files).toContainText(`${UPLOAD_LIMITS.maxBytes / MB} MB`, { timeout: 60_000 });
  await expect(files).toContainText('Files per upload');
  await expect(files).toContainText('Up to 20, 500 MB in all');
  await expect(page.getByTestId('categories')).toContainText('Kept');
  await expect(page.getByRole('link', { name: 'Intake Form Settings' })).toHaveAttribute(
    'href',
    '/intake-forms/settings',
  );
});

test('words retention as the firm’s own recordkeeping', async ({ page }) => {
  await page.goto(`http://app.localhost:${port}/settings/forms-documents`);
  const retention = page.getByTestId('retention');
  await expect(retention).toContainText(
    'While your account is active, records stay until your firm deletes them.',
    { timeout: 60_000 },
  );
  await expect(retention).toContainText('Permanently, in your firm’s own records');
  await expect(retention).toContainText('Firmivra does not keep records forever');
  await expect(retention).not.toContainText('Kept permanently');
  await expect(retention).not.toContainText('platform policy');
});

test('the Templates button opens the Templates page', async ({ page }) => {
  await page.goto(`http://app.localhost:${port}/settings/forms-documents`);
  const templates = page.getByTestId('forms-templates').getByRole('link', { name: 'Templates' });
  await expect(templates).toHaveAttribute('href', '/templates', { timeout: 60_000 });
  await templates.click();
  await expect(page).toHaveURL(`http://app.localhost:${port}/templates`, { timeout: 60_000 });
  await expect(page).toHaveTitle('Templates', { timeout: 60_000 });
  await expect(page.getByRole('heading', { name: 'Page not found' })).toHaveCount(0);
});
