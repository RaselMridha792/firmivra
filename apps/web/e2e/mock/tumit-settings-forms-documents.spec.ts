import { expect, test } from '@playwright/test';

// Settings > Forms & Documents (/settings/forms-documents), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('shows the file rules, categories and links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/forms-documents`);
  await expect(page).toHaveTitle('Forms & documents');
  await expect(page.getByTestId('allowed-files')).toContainText('10 MB', { timeout: 60_000 });
  await expect(page.getByTestId('categories')).toContainText('Kept');
  await expect(page.getByRole('link', { name: 'Intake Form Settings' })).toHaveAttribute(
    'href',
    '/intake-forms/settings',
  );
});
