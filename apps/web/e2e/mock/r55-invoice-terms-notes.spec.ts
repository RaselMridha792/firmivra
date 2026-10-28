import { expect, test } from '@playwright/test';

// R55, Octavia's Invoices & Payments review of Oct 27, IP-F02: Create Invoice has payment terms
// (the due date follows them), Notes to Client and an Internal Note, and Preview Invoice shows
// what the client sees (never the internal note), changing nothing. Mock mode, as the Owner.
const port = String(Number(process.env['WEB_PORT'] ?? '3000') + 1);
const inDays = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('terms set the due date; the preview shows the client note and never the internal one', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`http://app.localhost:${port}/invoices/new`);
  await page.getByLabel('Client *').selectOption({ index: 1 });
  const terms = page.getByLabel('Payment Terms');
  await expect(terms.locator('option')).toHaveText(['Due on Receipt', 'Net 7', 'Net 14', 'Net 30']);
  await terms.selectOption('net_30');
  await expect(page.getByLabel('Due Date *')).toHaveValue(inDays(30));
  await page.getByLabel('Description 1 *').fill('Annual return (fake)');
  await page.getByLabel('Rate 1 *').fill('450');
  await page.getByLabel('Notes to Client').fill('Thank you for your business (fake).');
  await page.getByLabel('Internal Note').fill('Fake internal: confirm the address first.');
  await expect(page.getByText('It never appears on the client')).toBeVisible();

  await page.getByRole('button', { name: 'Preview Invoice' }).click();
  const preview = page.getByRole('dialog', { name: 'Invoice preview' });
  await expect(preview).toContainText('Nothing is saved or sent.');
  await expect(preview).toContainText('Net 30');
  await expect(preview).toContainText('Thank you for your business (fake).');
  await expect(preview).not.toContainText('Fake internal');
  await expect(preview).toContainText('$450.00');
  await page.screenshot({ path: 'e2e/mock/r55-screenshots/invoices/invoice-preview.png' });
  await preview.getByRole('button', { name: /close/i }).click();

  await page.getByRole('button', { name: 'Save Draft' }).click();
  await expect(page.getByTestId('internal-note')).toContainText(
    'Fake internal: confirm the address first.',
  );
  await expect(page.getByText('Notes to Client:')).toBeVisible();
});
