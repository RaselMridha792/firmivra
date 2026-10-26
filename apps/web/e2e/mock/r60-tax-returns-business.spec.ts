import { expect, test } from '@playwright/test';

// Octavia's Tax Returns review of Oct 25, TX-F31: Create New Return for a business return shows
// the business's identity (Business Name, the masked EIN, Business Address) from the chosen
// client's own record, read-only, with the way to change it on the client. A Personal return shows
// none of it. In mock mode (playwright.mock.config.ts) as the Owner. Synthetic data only.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const app = (path: string) => `http://app.localhost:${port}${path}`;

test('a business return shows the client record’s business name, masked EIN and address', async ({
  page,
}) => {
  await page.goto(app('/tax-returns'));
  await page.getByRole('button', { name: 'Create New Return' }).first().click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Client').selectOption({ label: 'Acme Widgets LLC (fake)' });
  await dialog.getByLabel('Tax type').selectOption('personal');
  await expect(page.getByTestId('business-identity')).toHaveCount(0);

  await dialog.getByLabel('Tax type').selectOption('business');
  const identity = page.getByTestId('business-identity');
  await expect(identity).toContainText('Acme Widgets LLC');
  await expect(identity).toContainText('••-•••0002');
  await expect(identity).not.toContainText('individual');
  // No business address on this record: said so, never filled from elsewhere.
  await expect(identity.getByText('Not on the client record')).toHaveCount(1);
  await expect(
    identity.getByRole('link', { name: 'Change these on the client record' }),
  ).toHaveAttribute('href', /\/clients\/[0-9a-f-]+$/);

  await dialog.getByLabel('Client').selectOption({ label: 'Riley Example' });
  await expect(identity).toContainText('This client is an individual');
});
