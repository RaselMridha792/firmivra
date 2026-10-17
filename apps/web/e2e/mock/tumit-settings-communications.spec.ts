import { expect, test } from '@playwright/test';

// Settings > Communications (/settings/communications), in mock mode (playwright.mock.config.ts),
// signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('previews and saves the sender identity and email content', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/communications`);
  await expect(page).toHaveTitle('Communications settings');
  await expect(page.getByLabel('From Name')).toBeVisible({ timeout: 60_000 });

  await page.getByLabel('Reply-To Email').fill('not-an-email');
  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByText('Enter a valid email, or leave it empty.')).toBeVisible();

  await page.getByLabel('From Name').fill('LVP Client Team');
  await page.getByLabel('Reply-To Email').fill('office@example.test');
  await page.getByLabel('Footer').fill('LVP Accounting & Taxes, Springfield');
  const preview = page.getByTestId('email-preview');
  await expect(preview).toContainText('LVP Client Team');
  await expect(preview).toContainText('office@example.test');
  await expect(preview).toContainText('LVP Accounting & Taxes, Springfield');

  await page.getByRole('button', { name: 'Save Changes' }).click();
  await expect(page.getByTestId('communications-saved')).toHaveText(
    'Communication settings saved.',
  );
  await expect(page.getByLabel('From Name')).toHaveValue('LVP Client Team');
});
