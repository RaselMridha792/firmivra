import { expect, test } from '@playwright/test';

// Settings > Billing & Subscriptions (/settings/billing), in mock mode (playwright.mock.config.ts), signed in as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('keeps every billing card and shows the usage', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/settings/billing`);
  await expect(page).toHaveTitle('Billing & subscriptions');
  await expect(page.getByTestId('billing-usage')).toContainText('Staff users', { timeout: 60_000 });
  for (const card of ['billing-plan', 'billing-method', 'billing-invoices']) {
    await expect(page.getByTestId(card)).toContainText('not connected');
  }
  await expect(page.getByRole('link', { name: 'Payments & Payouts' })).toHaveAttribute(
    'href',
    '/settings/payments',
  );
});
