import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F03: Create Invoice's Assigned Staff,
// per-line tax with the firm's own rate in the summary, Invoice Template, and attachments from the
// client's shared documents. Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);

test('a taxed invoice with staff, a template and a file, from the firm’s own settings', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1100 });
  // Nothing configured yet: the empty states point to Settings.
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  await expect(page.getByText('No tax rates yet.')).toBeVisible();
  await expect(page.getByText('No templates yet: the invoice uses your firm')).toBeVisible();
  await expect(page.getByText('pick the client first')).toBeVisible();

  // The firm's rate and template, in Settings > Payments.
  await page.goto(`http://app.localhost:${port}/settings/payments`);
  await page.getByLabel('Tax name').fill('Fake State Tax');
  await page.getByLabel('Rate (%)').fill('8.25');
  await page.getByRole('button', { name: 'Add Tax' }).click();
  await expect(page.getByRole('region', { name: 'Taxes', exact: true })).toContainText(
    'Fake State Tax',
  );
  await page.getByLabel('Template name').fill('Fake Standard');
  await page.getByRole('button', { name: 'Add Template' }).click();
  await expect(page.getByText('Fake Standard').first()).toBeVisible();

  await page.getByRole('link', { name: 'Invoices & Payments' }).first().click();
  await page.getByRole('link', { name: 'Create Invoice' }).first().click();
  // Jamie Sample (fake) has files shared on their services.
  await page.getByLabel('Client *').selectOption({ label: 'Jamie Sample' });
  await page.getByLabel('Payment Terms').selectOption('net_30');
  await page.getByLabel('Assigned Staff').selectOption({ label: 'Sam Staff' });

  await page.getByLabel('Description 1 *').fill('Tax return preparation (fake)');
  await page.getByLabel('Rate 1 *').fill('100');
  await page.getByLabel('Tax 1').selectOption('TAXABLE');
  await page.getByRole('button', { name: 'Add Line Item' }).click();
  await page.getByLabel('Description 2 *').fill('Advice (fake)');
  await page.getByLabel('Rate 2 *').fill('50');
  await page.getByLabel('Discount ($)').fill('15');
  await page.getByLabel('Tax rate').selectOption({ label: 'Fake State Tax (8.25%)' });
  // 100 taxable of 150, less 15: 100 x 135 x 8.25% / 150 = 7.425, so $7.43.
  await expect(page.getByTestId('invoice-tax')).toHaveText('Tax (Fake State Tax 8.25%)$7.43');
  await expect(page.getByTestId('invoice-total')).toHaveText('$142.43');

  await page.getByLabel('Template', { exact: true }).selectOption({ label: 'Fake Standard' });
  const files = page.getByTestId('invoice-attachments');
  const first = files.getByRole('checkbox').and(page.locator(':enabled')).first();
  await first.check();
  await page.screenshot({
    path: 'e2e/mock/r55-screenshots/invoices/invoice-extras.png',
    fullPage: true,
  });

  await page.getByRole('button', { name: 'Save Draft' }).click();
  await page.waitForURL(/\/invoices\/[0-9a-f-]+$/);
  await expect(page.getByText('Sam Staff')).toBeVisible();
  await expect(page.getByText('Fake Standard')).toBeVisible();
  await expect(page.getByText('Tax (Fake State Tax 8.25%)')).toBeVisible();
  await expect(page.getByTestId('invoice-attachments').getByRole('listitem')).toHaveCount(1);
});
